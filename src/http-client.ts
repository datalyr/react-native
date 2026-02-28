import { EventPayload, QueuedEvent } from './types';
import { debugLog, errorLog } from './utils';

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
}

export class HttpClient {
  private config: HttpClientConfig;
  private endpoint: string;
  private lastRequestTime = 0;
  private requestCount = 0;

  constructor(endpoint: string, config: HttpClientConfig) {
    // Use server-side API if flag is set (default to true for v1.0.0)
    this.endpoint = config.useServerTracking !== false 
      ? 'https://api.datalyr.com'
      : endpoint;
    this.config = config;
  }

  /**
   * Send a single event with retry logic
   */
  async sendEvent(payload: EventPayload): Promise<HttpResponse> {
    return this.sendWithRetry(payload, 0);
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
  private async sendWithRetry(payload: EventPayload, retryCount: number): Promise<HttpResponse> {
    try {
      // Basic rate limiting: max 100 requests per minute
      const now = Date.now();
      if (now - this.lastRequestTime < 60000) {
        this.requestCount++;
        if (this.requestCount > 100) {
          throw new Error('Rate limit exceeded: max 100 requests per minute');
        }
      } else {
        this.requestCount = 1;
        this.lastRequestTime = now;
      }

      debugLog(`Sending event: ${payload.eventName} (attempt ${retryCount + 1})`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': `@datalyr/react-native/1.4.8`,
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

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(`HTTP 401: Authentication failed. Check your API key and workspace ID.`);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const responseData = await response.json();
      debugLog(`Event sent successfully: ${payload.eventName}`, responseData);

      return {
        success: true,
        status: response.status,
        data: responseData,
      };

    } catch (error) {
      errorLog(`Event send failed (attempt ${retryCount + 1}):`, error as Error);

      // Check if we should retry
      if (retryCount < this.config.maxRetries && this.shouldRetry(error as Error)) {
        const delay = this.calculateRetryDelay(retryCount);
        debugLog(`Retrying in ${delay}ms...`);
        
        await this.delay(delay);
        return this.sendWithRetry(payload, retryCount + 1);
      }

      return {
        success: false,
        status: 0,
        error: (error as Error).message,
      };
    }
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

    // Don't retry authentication errors (401) or client errors (4xx)
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
   * Calculate exponential backoff delay
   */
  private calculateRetryDelay(retryCount: number): number {
    const baseDelay = this.config.retryDelay;
    const exponentialDelay = Math.pow(2, retryCount) * baseDelay;
    const jitter = Math.random() * 1000; // Add some jitter to prevent thundering herd
    return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
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
      userId: payload.userId || payload.visitorId,
      anonymousId: payload.anonymousId || payload.visitorId,
      properties: {
        ...payload.eventData,
        sessionId: payload.sessionId,
        source: payload.source || 'mobile_app',
        fingerprint: payload.fingerprintData,
      },
      context: {
        library: '@datalyr/react-native',
        version: '1.4.8',
        source: 'mobile_app',  // Explicitly set source for mobile
        userProperties: payload.userProperties,
      },
      timestamp: payload.timestamp,
    };
  }

  /**
   * Test connectivity to the endpoint
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
    useServerTracking: true, // Default to server-side API for v1.0.0
  };

  return new HttpClient(endpoint, { ...defaultConfig, ...config });
}; 