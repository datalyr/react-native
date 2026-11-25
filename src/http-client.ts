import { EventPayload, QueuedEvent } from './types';
import { debugLog, errorLog } from './utils';
import { SDK_VERSION, SDK_LIBRARY_NAME, SDK_USER_AGENT } from './version';

interface HttpClientConfig {
  maxRetries: number;
  retryDelay: number;
  timeout: number;
  apiKey: string; // Now required for server-side tracking
  workspaceId?: string; // Optional, for legacy support
  debug: boolean;
  useServerTracking?: boolean; // Flag to use new server API
}

interface HttpResponse {
  success: boolean;
  status: number;
  data?: any;
  error?: string;
  // true when the send was SKIPPED because no API key is configured yet. The queue must
  // treat this as "not ready" — keep the event, don't burn a retry, don't dead-letter.
  authPending?: boolean;
  // true when the server answered 413 (payload too large). Retrying can never succeed;
  // the queue dead-letters the event immediately and marks it non-replayable.
  payloadTooLarge?: boolean;
  // Serialized request body size in bytes (set alongside payloadTooLarge for the log line).
  bodyBytes?: number;
  // true when the failure is temporary (5xx including 503, 429, 408, a timeout or a
  // network error): the queue keeps the event, burns no retry, and backs off.
  transient?: boolean;
  // true when the server refused the event for good (400, 415, 422): sending it again
  // can never succeed, so the queue drops it and counts the drop.
  rejected?: boolean;
  // The server's Retry-After, in ms, when it sent one with a transient answer.
  retryAfterMs?: number;
  // true when the request went to the tracking host (tracking.datalyr.com).
  viaTrackingHost?: boolean;
}

/** Options for one send. */
export interface SendOptions {
  // Send to the normal host with the tracking-only fields removed, even when tracking is
  // authorized. The queue uses it when the tracking host keeps failing.
  avoidTrackingHost?: boolean;
}

/**
 * Reads the app's App Tracking Transparency status NOW (0 notDetermined, 1 restricted,
 * 2 denied, 3 authorized; undefined when unknown). Set on iOS only.
 */
export type TrackingAuthorizationProvider = () => Promise<number | undefined>;

/** Event fields that may be sent only while tracking is authorized. */
const TRACKING_ONLY_KEYS = ['idfa', 'alart'] as const;

/** Longest a single in-request retry waits; a longer Retry-After goes to the queue. */
const MAX_INLINE_RETRY_WAIT_MS = 30000;

/** 5xx, 429 and 408 are the server saying "try again later". */
export const isTransientStatus = (status: number): boolean =>
  status >= 500 || status === 429 || status === 408;

/**
 * The 4xx answers ingest gives for an event it will never accept (a malformed or
 * incomplete body). Every other 4xx keeps the counted-retry-then-dead-letter path: a
 * firewall or captive proxy can answer 403 or 404 on one network, and that must not
 * wipe events for good. 401 has its own hold, 413 is parked permanently, 408/429 are
 * transient.
 */
export const isFinalRejectionStatus = (status: number): boolean =>
  status === 400 || status === 415 || status === 422;

/**
 * UTF-8 byte length of a string without TextEncoder/Buffer (neither is guaranteed in RN).
 */
export const utf8ByteLength = (s: string): number => {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { bytes += 4; i++; } // surrogate pair
    else bytes += 3;
  }
  return bytes;
};

export class HttpClient {
  private config: HttpClientConfig;
  private endpoint: string;
  // Timestamps of recent sends for a sliding-window rate limit (see enforceRateLimit).
  private requestTimes: number[] = [];
  // 401 grace window: hold events instead of dead-lettering them (see sendEvent).
  private static readonly UNAUTHORIZED_HOLD_MS = 10 * 60 * 1000;
  private firstUnauthorizedAt: number | null = null;
  private warnedUnauthorized = false;

  constructor(endpoint: string, config: HttpClientConfig) {
    // Use server-side API unless useServerTracking is explicitly false (the default)
    this.endpoint = config.useServerTracking !== false
      ? 'https://ingest.datalyr.com/track'
      : endpoint;
    this.config = config;
  }

  // Apple privacy manifest: NSPrivacyTracking=true REQUIRES a non-empty
  // NSPrivacyTrackingDomains, and iOS fails every request to a listed host until the
  // user grants ATT. So the manifest lists ONLY tracking.datalyr.com, and only events
  // that carry the IDFA while ATT is authorized AT SEND TIME are sent there (routeFor);
  // all other events go to ingest.datalyr.com and are never blocked. Same backend handler.
  static readonly TRACKING_ENDPOINT = 'https://tracking.datalyr.com/track';

  // iOS: reads the live ATT status at send time. Null elsewhere (Android has no tracking
  // domain block), which keeps the routing below exactly as it was.
  private trackingAuthorizationProvider: TrackingAuthorizationProvider | null = null;

  setTrackingAuthorizationProvider(provider: TrackingAuthorizationProvider | null): void {
    this.trackingAuthorizationProvider = provider;
  }

  /**
   * Where to send `payload`, and what to send. iOS checks the tracking domain when the
   * request is SENT, but the IDFA was copied into the event when it was BUILT: an event
   * queued while tracking was allowed and sent after the user turned it off would go to a
   * blocked host. So the tracking host is used only when the event carries an IDFA AND the
   * live status is authorized (3); otherwise the event goes to the normal host with the
   * IDFA and the other tracking-only fields removed (from a copy; the queued event keeps
   * them for a later authorized send).
   */
  private async routeFor(payload: EventPayload, options?: SendOptions): Promise<{ url: string; payload: EventPayload; viaTrackingHost: boolean }> {
    if (this.config.useServerTracking === false) return { url: this.endpoint, payload, viaTrackingHost: false };
    const data = payload.eventData as Record<string, unknown> | undefined;
    const idfa = data?.idfa;
    const hasIdfa = typeof idfa === 'string' && idfa.length > 0;
    const provider = this.trackingAuthorizationProvider;
    if (!provider) {
      return hasIdfa
        ? { url: HttpClient.TRACKING_ENDPOINT, payload, viaTrackingHost: true }
        : { url: this.endpoint, payload, viaTrackingHost: false };
    }
    if (!data || !TRACKING_ONLY_KEYS.some((k) => data[k] !== undefined)) {
      return { url: this.endpoint, payload, viaTrackingHost: false };
    }
    let status: number | undefined;
    try {
      status = await provider();
    } catch {
      status = undefined; // unknown can never read as authorized
    }
    if (status === 3 && !options?.avoidTrackingHost) {
      return hasIdfa
        ? { url: HttpClient.TRACKING_ENDPOINT, payload, viaTrackingHost: true }
        : { url: this.endpoint, payload, viaTrackingHost: false };
    }
    const stripped: Record<string, unknown> = { ...data };
    for (const key of TRACKING_ONLY_KEYS) delete stripped[key];
    if (status !== 3) {
      // The event must not claim tracking is allowed: report the status at send time.
      stripped.advertiser_tracking_enabled = false;
      if (status === undefined) delete stripped.att_status;
      else stripped.att_status = status;
    }
    return { url: this.endpoint, payload: { ...payload, eventData: stripped as EventPayload['eventData'] }, viaTrackingHost: false };
  }

  /**
   * Send a single event with retry logic
   */
  async sendEvent(payload: EventPayload, options?: SendOptions): Promise<HttpResponse> {
    const route = await this.routeFor(payload, options);
    const response = await this.sendWithRetry(route.payload, 0, route.url);
    return route.viaTrackingHost ? { ...response, viaTrackingHost: true } : response;
  }

  /**
   * Send multiple events in a batch
   */
  async sendBatch(payloads: EventPayload[]): Promise<HttpResponse[]> {
    // For now, send events individually
    // In production, you might want to implement true batching
    return Promise.all(payloads.map(payload => this.sendEvent(payload)));
  }

  /**
   * Send request with exponential backoff retry
   */
  private async sendWithRetry(payload: EventPayload, retryCount: number, url: string): Promise<HttpResponse> {
    try {
      // Defense-in-depth: never fire a server-tracking request without an API key — it
      // would 401 and (after retries) permanently dead-letter the event. Signal the queue
      // to KEEP the event (no retry burned) until a key is configured. Guards the brief
      // window before initialize() applies the key and any stray pre-init client.
      if (this.config.useServerTracking !== false && !this.config.apiKey) {
        debugLog(`Skipping send (no API key configured yet): ${payload.eventName}`);
        return { success: false, status: 0, error: 'API key not set', authPending: true };
      }

      // Sliding-window rate limit (max 100/min) with BACKPRESSURE, not drop. The old
      // fixed-window code threw a non-retryable error at >100/min, which made the queue
      // give up and DROP the event (silent data loss under a burst). Now we wait until
      // the window has room so a burst is paced out instead of lost.
      await this.enforceRateLimit();

      debugLog(`Sending event: ${payload.eventName} (attempt ${retryCount + 1})`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': SDK_USER_AGENT,
      };

      // Server-side tracking uses X-API-Key header
      if (this.config.useServerTracking !== false) {
        headers['X-API-Key'] = this.config.apiKey;
      } else {
        // Legacy client-side tracking
        const authToken = this.config.apiKey || this.config.workspaceId;
        headers['Authorization'] = `Bearer ${authToken}`;
        if (this.config.apiKey) {
          headers['X-API-Key'] = this.config.apiKey;
          headers['X-Datalyr-API-Key'] = this.config.apiKey;
        }
      }
      
      // Transform payload for server-side API if needed
      const requestBody = this.config.useServerTracking !== false 
        ? this.transformForServerAPI(payload)
        : payload;

      const body = JSON.stringify(requestBody);
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });
      } catch (transportError) {
        // Nothing answered: offline, DNS, TLS, reset, or our timeout's abort.
        if (transportError && typeof transportError === 'object') (transportError as any).transport = true;
        throw transportError;
      } finally {
        clearTimeout(timeoutId);
      }

      if (response.ok) {
        this.firstUnauthorizedAt = null;
        this.warnedUnauthorized = false;
      }
      if (!response.ok) {
        if (response.status === 413) {
          // Payload too large: no retry can fix it. Return (don't throw) so the queue can
          // dead-letter immediately without burning its retry budget on a hopeless send.
          const bodyBytes = utf8ByteLength(body);
          errorLog(`Server rejected event '${payload.eventName}' as too large (HTTP 413, ${bodyBytes} bytes); it will not be retried`);
          return {
            success: false,
            status: 413,
            error: `HTTP 413: payload too large (${bodyBytes} bytes)`,
            payloadTooLarge: true,
            bodyBytes,
          };
        }
        if (response.status === 401) {
          // A 401 right after a key rotation / workspace move is usually transient
          // (propagation) or a config mistake being fixed. Hold the queue for a grace
          // window instead of burning the retry budget and dead-lettering cold-start
          // events; after the window, fall through to the permanent 4xx path.
          const now = Date.now();
          if (this.firstUnauthorizedAt === null) this.firstUnauthorizedAt = now;
          if (now - this.firstUnauthorizedAt < HttpClient.UNAUTHORIZED_HOLD_MS) {
            if (!this.warnedUnauthorized) {
              this.warnedUnauthorized = true;
              errorLog(`HTTP 401 from ingest: check the API key. Events are held (not dropped) for ${Math.round(HttpClient.UNAUTHORIZED_HOLD_MS / 60000)} minutes.`);
            }
            return { success: false, status: 401, error: 'HTTP 401: Authentication failed', authPending: true };
          }
          const unauthorized = new Error(`HTTP 401: Authentication failed. Check your API key and workspace ID.`);
          (unauthorized as any).httpStatus = 401;
          throw unauthorized;
        }
        if (isTransientStatus(response.status)) {
          // 5xx (ingest answers 503 + Retry-After when the fault is its own), 429 and 408:
          // honor Retry-After (seconds or HTTP-date). Encode it in the message so the
          // backoff can read it; shouldRetry() treats these as retryable.
          const retryAfterMs = this.parseRetryAfter(response.headers?.get?.('Retry-After'));
          const err = new Error(`HTTP ${response.status}: ${response.statusText || 'try again later'}${retryAfterMs != null ? ` retry-after=${retryAfterMs}` : ''}`);
          (err as any).httpStatus = response.status;
          (err as any).retryAfterMs = retryAfterMs ?? undefined;
          throw err;
        }
        const err = new Error(`HTTP ${response.status}: ${response.statusText}`);
        (err as any).httpStatus = response.status;
        throw err;
      }

      // Any 2xx is an accepted event, whatever the body: ingest answers 204 with no body
      // for an event it filters, and a JSON parse failure here used to count as a failed
      // send and re-send an event the server had already taken.
      let responseData: any;
      try {
        responseData = await response.json();
      } catch {
        responseData = undefined;
      }
      debugLog(`Event sent successfully: ${payload.eventName}`, responseData);

      return {
        success: true,
        status: response.status,
        data: responseData,
      };

    } catch (error) {
      errorLog(`Event send failed (attempt ${retryCount + 1}):`, error as Error);

      const httpStatus: number | undefined = (error as any)?.httpStatus;
      const retryAfterMs: number | undefined = (error as any)?.retryAfterMs;

      // Check if we should retry. A Retry-After longer than the in-request cap is not
      // cut short here: the queue waits it out instead.
      const retryAfterTooLong = retryAfterMs != null && retryAfterMs > MAX_INLINE_RETRY_WAIT_MS;
      if (retryCount < this.config.maxRetries && !retryAfterTooLong && this.shouldRetry(error as Error)) {
        const delay = this.calculateRetryDelay(retryCount, error as Error);
        debugLog(`Retrying in ${delay}ms...`);

        await this.delay(delay);
        // Same payload object, so the same eventId: ingest dedupes a retry of an event
        // whose first answer was lost.
        return this.sendWithRetry(payload, retryCount + 1, url);
      }

      if (httpStatus === undefined) {
        // Nothing answered (offline, DNS, TLS, reset, timeout): temporary. Any other
        // local throw keeps today's path (counted retries, then the dead-letter store).
        const transport = (error as any)?.transport === true;
        return { success: false, status: 0, error: (error as Error)?.message, ...(transport ? { transient: true } : {}) };
      }
      return {
        success: false,
        status: httpStatus,
        error: (error as Error).message,
        transient: isTransientStatus(httpStatus),
        rejected: isFinalRejectionStatus(httpStatus),
        retryAfterMs,
      };
    }
  }

  /**
   * Sliding-window rate limiter with backpressure. Keeps timestamps of recent sends;
   * once the window is full it WAITS until the oldest falls out instead of throwing/
   * dropping, so a burst slows down rather than losing events. Bounded: after the wait
   * the oldest is guaranteed outside the window, so the recursion terminates.
   */
  private async enforceRateLimit(): Promise<void> {
    const WINDOW_MS = 60000;
    const MAX_PER_WINDOW = 100;

    const now = Date.now();
    this.requestTimes = this.requestTimes.filter((t) => now - t < WINDOW_MS);

    if (this.requestTimes.length >= MAX_PER_WINDOW) {
      // waitMs is mathematically <= WINDOW_MS + 5 (the oldest survived the filter, so
      // now - requestTimes[0] < WINDOW_MS). Cap at WINDOW_MS + 100 — defensive against a
      // corrupted future timestamp WITHOUT clipping the +5 margin, so after the wait the
      // oldest is guaranteed outside the window and the recursion exits in one pass.
      const waitMs = WINDOW_MS - (now - this.requestTimes[0]) + 5;
      await this.delay(Math.min(Math.max(waitMs, 0), WINDOW_MS + 100));
      return this.enforceRateLimit();
    }

    this.requestTimes.push(Date.now());
  }

  /**
   * Determine if an error should trigger a retry
   */
  private shouldRetry(error: Error): boolean {
    const retryableErrors = [
      'NetworkError',
      'TimeoutError',
      'AbortError',
      'fetch is not defined', // Fallback for environments without fetch
    ];

    // 429 (rate-limited) and 408 (request timeout) are RETRYABLE backpressure — the ingest
    // /track endpoint enforces a per-API-key limit shared across a customer's whole install
    // base and answers 429 with Retry-After. Must be checked BEFORE the blanket 'HTTP 4'
    // non-retryable rule below, or sustained throttle fast-tracks events to the dead-letter
    // store (silent loss, including purchases).
    if (error.message.includes('HTTP 429') || error.message.includes('HTTP 408')) {
      return true;
    }

    // Don't retry authentication errors (401) or other client errors (4xx)
    if (error.message.includes('HTTP 401') || error.message.includes('HTTP 4')) {
      return false;
    }

    // Retry on server errors (5xx) and network issues
    if (error.message.includes('HTTP 5')) {
      return true;
    }

    return retryableErrors.some(retryableError => 
      error.message.includes(retryableError) || error.name === retryableError
    );
  }

  /**
   * Calculate exponential backoff delay. Honors a server Retry-After (encoded by
   * sendWithRetry into the 429/408 error message) when present.
   */
  private calculateRetryDelay(retryCount: number, error?: Error): number {
    // Server-directed backoff (429/408 Retry-After) takes precedence over the local curve.
    if (error?.message) {
      const m = error.message.match(/retry-after=(\d+)/);
      if (m) {
        const serverMs = parseInt(m[1], 10);
        if (Number.isFinite(serverMs) && serverMs >= 0) {
          return Math.min(serverMs + Math.random() * 250, 30000);
        }
      }
    }
    const baseDelay = this.config.retryDelay;
    const exponentialDelay = Math.pow(2, retryCount) * baseDelay;
    const jitter = Math.random() * 1000; // Add some jitter to prevent thundering herd
    return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
  }

  /**
   * Parse an HTTP Retry-After header value (delta-seconds or an HTTP-date) to ms.
   */
  private parseRetryAfter(value: string | null | undefined): number | null {
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }
    const dateMs = Date.parse(value);
    if (!Number.isNaN(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
    return null;
  }

  /**
   * Promise-based delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Transform payload for server-side API format
   */
  private transformForServerAPI(payload: EventPayload): any {
    return {
      event: payload.eventName,
      eventId: payload.eventId,
      // Anonymous device identity is not an identified user. Ingest keeps
      // visitorId/anonymousId in their own namespace until identify() occurs.
      userId: payload.userId,
      anonymousId: payload.anonymousId || payload.visitorId,
      properties: {
        ...payload.eventData,
        sessionId: payload.sessionId,
        source: payload.source || 'mobile_app',
        device_context: payload.deviceContext,
      },
      context: {
        library: SDK_LIBRARY_NAME,
        version: SDK_VERSION,
        source: 'mobile_app',
        // session_id MUST be in context — ingest's server-track handler reads the session
        // id from context.session_id, NOT properties; without it ingest discards the SDK's
        // session and synthesizes its own hour-bucketed one for every event.
        session_id: payload.sessionId,
        userProperties: payload.userProperties,
      },
      timestamp: payload.timestamp,
    };
  }

  /**
   * Test connectivity to the endpoint
   * @deprecated Not used by the SDK. Sends a real `connection_test` event to the ingest
   * endpoint; do not call it in production.
   */
  async testConnection(): Promise<boolean> {
    try {
      const testPayload: EventPayload = {
        workspaceId: 'test', 
        visitorId: 'test',
        anonymousId: 'test',
        sessionId: 'test',
        eventId: 'test',
        eventName: 'connection_test',
        source: 'mobile_app',
        timestamp: new Date().toISOString(),
      };

      const response = await this.sendEvent(testPayload);
      return response.success;
    } catch (error) {
      errorLog('Connection test failed:', error as Error);
      return false;
    }
  }

  /**
   * Update endpoint URL
   */
  updateEndpoint(endpoint: string): void {
    this.endpoint = endpoint;
    debugLog(`Updated endpoint to: ${endpoint}`);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<HttpClientConfig>): void {
    this.config = { ...this.config, ...config };
    debugLog('Updated HTTP client config:', this.config);
  }
}

/**
 * Default HTTP client factory
 */
export const createHttpClient = (endpoint: string, config?: Partial<HttpClientConfig>): HttpClient => {
  const defaultConfig: HttpClientConfig = {
    maxRetries: 3,
    retryDelay: 1000, // 1 second base delay
    timeout: 15000, // 15 seconds
    apiKey: '',
    workspaceId: '',
    debug: false,
    useServerTracking: true, // Default to the server-side API
  };

  return new HttpClient(endpoint, { ...defaultConfig, ...config });
};
