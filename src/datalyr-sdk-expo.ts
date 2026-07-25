/**
 * Expo-specific SDK implementation
 * This module re-exports the main SDK but configured to use Expo utilities
 */

import { Platform, AppState } from 'react-native';
import {
  DatalyrConfig,
  EventData,
  UserProperties,
  EventPayload,
  SDKState,
  AutoEventConfig,
} from './types';
import {
  getOrCreateVisitorId,
  getOrCreateAnonymousId,
  getOrCreateSessionId,
  touchSession,
  rotateAnonymousId,
  rotateVisitorId,
  clearSession,
  createDeviceContext,
  generateUUID,
  getDeviceInfo,
  getNetworkType,
  deriveCountryFromLocale,
  validateEventName,
  normalizeEventName,
  validateEventData,
  debugLog,
  errorLog,
  Storage,
  STORAGE_KEYS,
} from './utils-expo';  // <-- KEY DIFFERENCE: uses Expo utilities
import {
  purchaseProperties,
  addToCartProperties,
  viewContentProperties,
  initiateCheckoutProperties,
  completeRegistrationProperties,
  searchProperties,
  leadProperties,
} from './ecommerce-properties';  // shared with bare build — single source of truth (A3-14c)
import { createHttpClient, HttpClient } from './http-client';
import { createEventQueue, EventQueue } from './event-queue';
import { attributionManager, AttributionData } from './attribution';
import { journeyManager } from './journey';
import { createAutoEventsManager, AutoEventsManager } from './auto-events';
import { ConversionValueEncoder, ConversionTemplates } from './ConversionValueEncoder';
import { SKAdNetworkBridge } from './native/SKAdNetworkBridge';
import { appleSearchAdsIntegration, playInstallReferrerIntegration } from './integrations';
import { DeferredDeepLinkResult } from './types';
import { AppleSearchAdsAttribution, AdvertiserInfoBridge } from './native/DatalyrNativeBridge';
import { networkStatusManager } from './network-status';

// Once-per-install dedupe marker for the identify(email) web-attribution lookup. Module
// const (not a local in fetchAndMergeWebAttribution) so reset() can drop it — 9.C.1.
const WEB_ATTRIBUTION_CHECKED_KEY = 'datalyr_web_attribution_checked';

export class DatalyrSDKExpo {
  private state: SDKState;
  private httpClient: HttpClient;
  private eventQueue: EventQueue;
  private autoEventsManager: AutoEventsManager | null = null;
  private appStateSubscription: any = null;
  private networkStatusUnsubscribe: (() => void) | null = null;
  private cachedAdvertiserInfo: any = null;
  private initializing: boolean = false;
  private static conversionEncoder?: ConversionValueEncoder;
  private static debugEnabled = false;
  /** Events that arrived before initialize() completed. Flushed once init finishes. */
  private preInitQueue: Array<{ eventName: string; eventData?: EventData }> = [];
  private static readonly PRE_INIT_QUEUE_MAX = 50;

  constructor() {
    this.state = {
      initialized: false,
      config: {
        workspaceId: '',
        apiKey: '',
        debug: false,
        endpoint: 'https://ingest.datalyr.com/track',
        useServerTracking: true,
        maxRetries: 3,
        retryDelay: 1000,
        batchSize: 10,
        flushInterval: 30000,
        maxQueueSize: 100,
        respectDoNotTrack: true,
        enableAutoEvents: true,
        enableAttribution: true,
      },
      visitorId: '',
      anonymousId: '',
      sessionId: '',
      userProperties: {},
      eventQueue: [],
      isOnline: true,
    };

    this.httpClient = createHttpClient(this.state.config.endpoint!);
    this.eventQueue = createEventQueue(this.httpClient);
  }

  async initialize(config: DatalyrConfig): Promise<void> {
    try {
      debugLog('Initializing Datalyr SDK (Expo)...', { workspaceId: config.workspaceId });

      // Idempotent init: a repeat initialize() (hot-reload, re-login, double-call) must not
      // re-run — it would orphan the prior AppState + network subscriptions (the first
      // becomes unremovable), double-fire flush/$network_status_change, and emit a duplicate
      // session_start. Mirrors the iOS SDK's `guard !initialized`.
      if (this.state.initialized || this.initializing) {
        debugLog('SDK already initialized; ignoring repeat initialize()');
        return;
      }
      this.initializing = true;

      if (!config.apiKey) {
        throw new Error('apiKey is required for Datalyr SDK');
      }

      if (!config.workspaceId) {
        debugLog('workspaceId not provided, using server-side tracking only');
      }

      this.state.config = { ...this.state.config, ...config };

      // Tear down the placeholder queue built in the constructor BEFORE installing the
      // configured one. That placeholder has an empty apiKey, started its own 30s flush
      // timer, and loaded the persisted queue from the SAME storage key — left alive it
      // flushes leftover events through an empty-key client (→ 401 → dead-letter) and
      // races the real queue on storage. destroy() stops its timer for good.
      this.eventQueue.destroy();

      this.httpClient = new HttpClient(this.state.config.endpoint || 'https://ingest.datalyr.com/track', {
        maxRetries: this.state.config.maxRetries || 3,
        retryDelay: this.state.config.retryDelay || 1000,
        timeout: this.state.config.timeout || 15000,
        apiKey: this.state.config.apiKey!,
        workspaceId: this.state.config.workspaceId,
        debug: this.state.config.debug || false,
        useServerTracking: this.state.config.useServerTracking ?? true,
      });

      this.eventQueue = new EventQueue(this.httpClient, {
        maxQueueSize: this.state.config.maxQueueSize || 100,
        batchSize: this.state.config.batchSize || 10,
        flushInterval: this.state.config.flushInterval || 30000,
        maxRetryCount: this.state.config.maxRetries || 3,
      });

      this.state.visitorId = await getOrCreateVisitorId();
      this.state.anonymousId = await getOrCreateAnonymousId();
      this.state.sessionId = await getOrCreateSessionId();

      await this.loadPersistedUserData();

      if (this.state.config.enableAttribution) {
        await attributionManager.initialize();
      }

      // Initialize journey tracking (for first-touch, last-touch, touchpoints)
      await journeyManager.initialize();

      // Record initial attribution to journey if this is a new session with attribution
      const initialAttribution = attributionManager.getAttributionData();
      if (initialAttribution.utm_source || initialAttribution.fbclid || initialAttribution.gclid || initialAttribution.lyr) {
        await journeyManager.recordAttribution(this.state.sessionId, {
          source: initialAttribution.utm_source || initialAttribution.campaign_source,
          medium: initialAttribution.utm_medium || initialAttribution.campaign_medium,
          campaign: initialAttribution.utm_campaign || initialAttribution.campaign_name,
          fbclid: initialAttribution.fbclid,
          gclid: initialAttribution.gclid,
          ttclid: initialAttribution.ttclid,
          clickIdType: initialAttribution.fbclid ? 'fbclid' : initialAttribution.gclid ? 'gclid' : initialAttribution.ttclid ? 'ttclid' : undefined,
          lyr: initialAttribution.lyr,
        });
      }

      if (this.state.config.enableAutoEvents) {
        this.autoEventsManager = new AutoEventsManager(
          this.track.bind(this),
          this.state.config.autoEventConfig,
          // Canonical session id getter — unifies session_start/end's session_id with the
          // wire context.session_id (state.sessionId).
          () => this.state.sessionId
        );

        setTimeout(async () => {
          try {
            await this.autoEventsManager?.initialize();
          } catch (error) {
            errorLog('Error initializing auto-events:', error as Error);
          }
        }, 100);
      }

      setTimeout(() => {
        try {
          this.setupAppStateMonitoring();
        } catch (error) {
          errorLog('Error setting up app state monitoring:', error as Error);
        }
      }, 50);

      // RN-18: wire network status into the event queue. Expo previously had NO network
      // monitoring, so the queue stayed isOnline=true forever — offline events failed,
      // burned their retries, and were dropped, and nothing re-sent on reconnect.
      void this.initializeNetworkMonitoring();

      if (config.skadTemplate) {
        const template = ConversionTemplates[config.skadTemplate];
        if (template) {
          DatalyrSDKExpo.conversionEncoder = new ConversionValueEncoder(template);
          DatalyrSDKExpo.debugEnabled = config.debug || false;

          if (DatalyrSDKExpo.debugEnabled) {
            debugLog(`SKAdNetwork encoder initialized with template: ${config.skadTemplate}`);
          }
        }
      }

      // Initialize Apple Search Ads attribution (iOS only, auto-fetches on init)
      await appleSearchAdsIntegration.initialize(config.debug);

      // Initialize Play Install Referrer (Android only)
      await playInstallReferrerIntegration.initialize();

      // 9.C.3: register for SKAdNetwork / AdAttributionKit attribution once at init (iOS-only;
      // the bridge no-ops off-iOS and swallows-and-logs any failure) so the first SKAN
      // conversion-value update isn't dropped for not being registered.
      await SKAdNetworkBridge.registerForAttribution();

      // Cache advertiser info (IDFA/GAID, ATT status) once at init to avoid per-event native bridge calls
      try {
        this.cachedAdvertiserInfo = await AdvertiserInfoBridge.getAdvertiserInfo();
      } catch (error) {
        errorLog('Failed to cache advertiser info:', error as Error);
      }

      debugLog('Platform integrations initialized', {
        appleSearchAds: appleSearchAdsIntegration.isAvailable(),
        playInstallReferrer: playInstallReferrerIntegration.isAvailable(),
      });

      this.state.initialized = true;

      // Flush any events that were queued before init completed (e.g. screen tracking)
      if (this.preInitQueue.length > 0) {
        debugLog(`Flushing ${this.preInitQueue.length} pre-init event(s)`);
        const queued = [...this.preInitQueue];
        this.preInitQueue = [];
        for (const { eventName, eventData } of queued) {
          await this.track(eventName, eventData);
        }
      }

      if (attributionManager.isInstall()) {
        // iOS: Attempt deferred web-to-app attribution via IP matching before tracking install
        if (Platform.OS === 'ios') {
          await this.fetchDeferredWebAttribution();
        }

        const installData = await attributionManager.trackInstall();
        await this.track('app_install', {
          platform: Platform.OS,
          sdk_version: '1.7.14',
          sdk_variant: 'expo',
          ...installData,
        });
        // TR-21: commit the first-launch marker only AFTER app_install is durably enqueued.
        await attributionManager.markInstallTracked();
      }

      debugLog('Datalyr SDK (Expo) initialized successfully', {
        workspaceId: this.state.config.workspaceId,
        visitorId: this.state.visitorId,
        anonymousId: this.state.anonymousId,
        sessionId: this.state.sessionId,
      });

    } catch (error) {
      errorLog('Failed to initialize Datalyr SDK:', error as Error);
      throw error;
    } finally {
      // Always clear the in-flight flag. `state.initialized` alone gates repeats; leaving
      // `initializing` true on the SUCCESS path (the old bug) permanently bricked the SDK
      // after a destroy()→initialize() cycle. On failure this also re-allows a retry.
      this.initializing = false;
    }
  }

  async track(eventName: string, eventData?: EventData): Promise<void> {
    try {
      if (!this.state.initialized) {
        if (this.preInitQueue.length < DatalyrSDKExpo.PRE_INIT_QUEUE_MAX) {
          debugLog(`Queuing pre-init event: ${eventName}`);
          this.preInitQueue.push({ eventName, eventData });
        } else {
          errorLog('Pre-init event queue full, dropping event:', eventName as unknown as Error);
        }
        return;
      }

      // TR-20: normalize (spaces → underscores) then validate against the fleet charset, so the
      // rest of this method uses one canonical name and bare/Expo behave identically (Expo used
      // to silently DROP a name with a space that bare accepted).
      const name = normalizeEventName(eventName);
      if (!validateEventName(name)) {
        errorLog(`Invalid event name: ${eventName}`);
        return;
      }

      if (!validateEventData(eventData)) {
        errorLog('Invalid event data provided');
        return;
      }

      debugLog(`Tracking event: ${name}`, eventData);

      const payload = await this.createEventPayload(name, eventData);
      await this.eventQueue.enqueue(payload);

      // TR-08: refresh the STORAGE session-activity time on real event activity (throttled to
      // 60s) so the idle window actually slides during continuous foreground use — getOrCreate
      // SessionId (init/foreground/reset) was the only writer. Fire-and-forget.
      void touchSession();

      // Update session activity counters (refreshes lastActivity so session_end duration
      // and the idle-window timeout track real usage). Skip the SDK's own session lifecycle
      // events so `events` counts real activity, not the session_start/end bookkeeping.
      if (this.autoEventsManager && name !== 'session_start' && name !== 'session_end') {
        await this.autoEventsManager.onEvent(name);
      }

    } catch (error) {
      errorLog(`Error tracking event ${eventName}:`, error as Error);
    }
  }

  async screen(screenName: string, properties?: EventData): Promise<void> {
    const screenData: EventData = {
      screen: screenName,
      ...properties,
    };

    // Enrich with session data (pageview count, previous screen) if available.
    // User-provided properties take precedence over enrichment.
    if (this.autoEventsManager) {
      const enrichment = this.autoEventsManager.getScreenViewEnrichment();
      if (enrichment) {
        for (const [key, value] of Object.entries(enrichment)) {
          if (!(key in screenData)) {
            screenData[key] = value;
          }
        }
      }
      // Update session counters (does NOT fire a second event)
      await this.autoEventsManager.recordScreenView(screenName);
    }

    await this.track('pageview', screenData);
  }

  async identify(userId: string, properties?: UserProperties): Promise<void> {
    await this.identifyUser(userId, properties, true);
  }

  /**
   * Apply an identity transition. Public identify() treats a different known ID as an
   * account switch; alias() deliberately links two IDs for the same person and opts out.
   */
  private async identifyUser(
    userId: string,
    properties: UserProperties | undefined,
    resetOnAccountSwitch: boolean,
  ): Promise<void> {
    try {
      if (!userId || typeof userId !== 'string') {
        errorLog(`Invalid user ID for identify: ${userId}`);
        return;
      }

      debugLog('Identifying user:', { userId, properties });

      // Match the bare RN entrypoint: a direct identify(A) -> identify(B) transition is
      // an implicit logout, so B cannot inherit A's visitor graph or click attribution.
      if (resetOnAccountSwitch && this.state.currentUserId && this.state.currentUserId !== userId) {
        await this.reset();
      }

      this.state.currentUserId = userId;
      this.state.userProperties = { ...this.state.userProperties, ...properties };

      await this.persistUserData();

      // 9.C.6: normalize identity trait keys (camelCase → snake_case) + hoist email/phone to the
      // event root so server-side advanced matching finds them (mirrors iOS). Raw props still
      // spread; normalized snake keys are hoisted last and win.
      const props = (properties || {}) as Record<string, any>;
      const email = typeof props.email === 'string' ? props.email : undefined;
      const phone = typeof props.phone === 'string' ? props.phone
        : (typeof props.phoneNumber === 'string' ? props.phoneNumber : undefined);
      const firstName = typeof props.first_name === 'string' ? props.first_name
        : (typeof props.firstName === 'string' ? props.firstName : undefined);
      const lastName = typeof props.last_name === 'string' ? props.last_name
        : (typeof props.lastName === 'string' ? props.lastName : undefined);

      await this.track('$identify', {
        userId,
        anonymous_id: this.state.anonymousId,
        ...props,
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
        ...(firstName ? { first_name: firstName } : {}),
        ...(lastName ? { last_name: lastName } : {}),
      });

      if (this.state.config.enableWebToAppAttribution !== false) {
        const email = properties?.email || (typeof userId === 'string' && userId.includes('@') ? userId : null);
        if (email) {
          await this.fetchAndMergeWebAttribution(email);
        }
      }

    } catch (error) {
      errorLog('Error identifying user:', error as Error);
    }
  }

  /** Stable (cross-launch) non-crypto hash (FNV-1a) so we store no raw email. */
  private stableEmailHash(email: string): string {
    let h = 0x811c9dc5;
    const s = email.toLowerCase();
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16);
  }

  private async fetchAndMergeWebAttribution(email: string): Promise<void> {
    try {
      // Web→app attribution is a one-time, install-time fact — resolve it AT MOST
      // ONCE per email per install. Apps call identify(email) every session; without
      // this, each one re-fires /attribution/lookup (~100k/day from a single app,
      // 99.7% misses). Skip if we've already definitively resolved/checked this email.
      const emailHash = this.stableEmailHash(email);
      const checked = (await Storage.getItem<string[]>(WEB_ATTRIBUTION_CHECKED_KEY)) || [];
      if (checked.includes(emailHash)) {
        debugLog('Web attribution already checked this install for this email; skipping lookup');
        return;
      }

      debugLog('Fetching web attribution for email:', email);

      // BATCH-8(j): bound the request — a stalled connection would otherwise hang this
      // promise indefinitely (identify(email) runs every session). Mirrors the deferred-lookup
      // 10s guard; on abort/timeout the catch leaves `checked` unset so the next identify retries.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      let response: Response;
      try {
        response = await fetch('https://api.datalyr.com/attribution/lookup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Datalyr-API-Key': this.state.config.apiKey!,
          },
          body: JSON.stringify({ email }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        debugLog('Failed to fetch web attribution:', response.status);
        return; // transient/non-200 — don't mark checked, retry on next identify
      }

      // Parse BEFORE marking checked — a body read/parse failure would otherwise
      // permanently suppress this once-per-install lookup. See datalyr-sdk.ts.
      const result = await response.json() as { found: boolean; attribution?: any };

      // Definitive 200 answer (found or not) — record it so repeated identify(email)
      // calls don't re-run this immutable, install-time lookup. (Capped to bound
      // growth from rare account switches.)
      await Storage.setItem(WEB_ATTRIBUTION_CHECKED_KEY, [...checked, emailHash].slice(-20));

      if (!result.found || !result.attribution) {
        debugLog('No web attribution found for user');
        return;
      }

      const webAttribution = result.attribution;
      debugLog('Web attribution found:', {
        visitor_id: webAttribution.visitor_id,
        has_fbclid: !!webAttribution.fbclid,
        has_gclid: !!webAttribution.gclid,
        utm_source: webAttribution.utm_source,
      });

      // Never record an identity-only result as a web match: a real browser
      // visitor with NO click found is an identity, not a touch. The server's
      // public route now returns found:false for these, but guard here too —
      // recording them minted ~1,700/hr of false self-referential bridge rows
      // on one workspace. Same for a result whose visitor_id is OUR OWN
      // current visitor: that is this SDK's prior events reflected back.
      if (webAttribution.identity_only === true) {
        debugLog('Web attribution is identity-only — skipping bridge event');
        return;
      }
      if (webAttribution.visitor_id && webAttribution.visitor_id === this.state.visitorId) {
        debugLog('Web attribution visitor is our own visitor id — skipping bridge event');
        return;
      }

      // Merge BEFORE tracking (matches the IP/deferred path), so $web_attribution_matched
      // is self-consistent — createEventPayload spreads attributionData first and the
      // explicit web fields below win. (Old order tracked before merging.)
      await attributionManager.mergeWebAttribution(webAttribution);

      // Canonical web→app bridge event — email and IP paths both fire
      // `$web_attribution_matched`, distinguished by `match_method`, so server
      // bridges and dashboards see one event name. (Previously this path fired a
      // separate `$web_attribution_merged` that no reader consumed.)
      await this.track('$web_attribution_matched', {
        web_visitor_id: webAttribution.visitor_id,
        web_user_id: webAttribution.user_id,
        fbclid: webAttribution.fbclid,
        gclid: webAttribution.gclid,
        ttclid: webAttribution.ttclid,
        gbraid: webAttribution.gbraid,
        wbraid: webAttribution.wbraid,
        // Emit `_fbp`/`_fbc` (the keys the attribution MV + Meta postback extract) as well
        // as the bare keys — bare fbp/fbc alone have no reader. See datalyr-sdk.ts.
        fbp: webAttribution.fbp,
        fbc: webAttribution.fbc,
        _fbp: webAttribution.fbp,
        _fbc: webAttribution.fbc,
        utm_source: webAttribution.utm_source,
        utm_medium: webAttribution.utm_medium,
        utm_campaign: webAttribution.utm_campaign,
        utm_content: webAttribution.utm_content,
        utm_term: webAttribution.utm_term,
        web_timestamp: webAttribution.timestamp,
        match_method: 'email',
      });

      debugLog('Successfully merged web attribution into mobile session');

    } catch (error) {
      errorLog('Error fetching web attribution:', error as Error);
    }
  }

  /**
   * Fetch deferred web attribution on first app install.
   * Uses IP-based matching to recover attribution data (fbclid, utm_*, etc.)
   * from a prelander web visit. Called automatically during initialize()
   * when a fresh install is detected on iOS.
   */
  private async fetchDeferredWebAttribution(): Promise<void> {
    if (!this.state.config?.apiKey) {
      debugLog('API key not available for deferred attribution fetch');
      return;
    }

    try {
      debugLog('Fetching deferred web attribution via IP matching...');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch('https://api.datalyr.com/attribution/deferred-lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Datalyr-API-Key': this.state.config.apiKey!,
        },
        body: JSON.stringify({ platform: Platform.OS }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        debugLog('Deferred attribution lookup failed:', response.status);
        return;
      }

      const result = await response.json() as { found: boolean; attribution?: any };

      if (!result.found || !result.attribution) {
        debugLog('No deferred web attribution found for this IP');
        return;
      }

      const webAttribution = result.attribution;
      debugLog('Deferred web attribution found:', {
        visitor_id: webAttribution.visitor_id,
        has_fbclid: !!webAttribution.fbclid,
        has_gclid: !!webAttribution.gclid,
        utm_source: webAttribution.utm_source,
      });

      // Same guard as the email path: identity-only results and results
      // pointing at our own visitor id are not web touches — do not merge
      // and do not fire the bridge event.
      if (webAttribution.identity_only === true) {
        debugLog('Deferred web attribution is identity-only — skipping bridge event');
        return;
      }
      if (webAttribution.visitor_id && webAttribution.visitor_id === this.state.visitorId) {
        debugLog('Deferred web attribution visitor is our own visitor id — skipping bridge event');
        return;
      }

      // Merge web attribution into current session
      await attributionManager.mergeWebAttribution(webAttribution);

      // Track match event for analytics
      await this.track('$web_attribution_matched', {
        web_visitor_id: webAttribution.visitor_id,
        web_user_id: webAttribution.user_id,
        fbclid: webAttribution.fbclid,
        gclid: webAttribution.gclid,
        ttclid: webAttribution.ttclid,
        gbraid: webAttribution.gbraid,
        wbraid: webAttribution.wbraid,
        // Emit `_fbp`/`_fbc` (the keys the attribution MV + Meta postback extract) as well
        // as the bare keys — bare fbp/fbc alone have no reader. See datalyr-sdk.ts.
        fbp: webAttribution.fbp,
        fbc: webAttribution.fbc,
        _fbp: webAttribution.fbp,
        _fbc: webAttribution.fbc,
        utm_source: webAttribution.utm_source,
        utm_medium: webAttribution.utm_medium,
        utm_campaign: webAttribution.utm_campaign,
        utm_content: webAttribution.utm_content,
        utm_term: webAttribution.utm_term,
        web_timestamp: webAttribution.timestamp,
        match_method: 'ip',
      });

      debugLog('Successfully merged deferred web attribution');

    } catch (error) {
      errorLog('Error fetching deferred web attribution:', error as Error);
      // Non-blocking - email-based fallback will catch this on identify()
    }
  }

  async alias(newUserId: string, previousId?: string): Promise<void> {
    try {
      if (!newUserId || typeof newUserId !== 'string') {
        errorLog(`Invalid user ID for alias: ${newUserId}`);
        return;
      }

      const aliasData = {
        newUserId,
        // ingest's $alias link builder reads camelCase `userId`/`previousId`; `newUserId`
        // alone wrote no link. Emit `userId` too. (Event name must be `$alias`, below.)
        userId: newUserId,
        previousId: previousId || this.state.visitorId,
        visitorId: this.state.visitorId,
        anonymousId: this.state.anonymousId,
      };

      debugLog('Aliasing user:', aliasData);

      // Track $alias (NOT 'alias' — ingest matches only the '$alias' event name).
      await this.track('$alias', aliasData);
      // An explicit alias is a same-person identity merge, not an account switch. Preserve
      // this visitor's attribution graph while adopting the canonical user ID.
      await this.identifyUser(newUserId, undefined, false);

    } catch (error) {
      errorLog('Error aliasing user:', error as Error);
    }
  }

  async reset(): Promise<void> {
    try {
      debugLog('Resetting user data');

      // Pre-init events do not have an identity snapshot yet; they are materialized only
      // when initialize() replays them. Drop the previous user's buffered events so an
      // identify(A) -> identify(B) switch during startup cannot replay A on B's new IDs.
      if (!this.state.initialized) {
        this.preInitQueue = [];
      }

      this.state.currentUserId = undefined;
      this.state.userProperties = {};

      await Storage.removeItem(STORAGE_KEYS.USER_ID);
      await Storage.removeItem(STORAGE_KEYS.USER_PROPERTIES);

      // TR-28: wipe the previous user's attribution + journey BEFORE rotating ids, so a
      // track() that interleaves reset can never emit the NEW visitor id WITH the OLD
      // click-ids (fbclid/gclid/fbc/utm/lyr ride EVERY event via createEventPayload and feed
      // Meta CAPI; the journey is per-identity). Preserves the install marker (wiping it would
      // re-run install tracking + the deferred lookup next launch and re-import A's web attr).
      await attributionManager.clearAttributionForReset();
      await journeyManager.clearJourney();

      // Rotate anonymous id so the next user isn't merged with this one in the identity
      // graph (Meta CAPI bridge would otherwise leak click-ids/PII between users).
      this.state.anonymousId = await rotateAnonymousId();

      // 9.C.1: rotate the visitor ID too — it rides every event payload and is what the
      // attribution read-path resolves through, so keeping it stitches the next user's
      // events to this user's device history. (iOS reset() regenerates visitorId
      // alongside anonymousId.)
      this.state.visitorId = await rotateVisitorId();

      // Force a genuinely new session (getOrCreateSessionId resumes any session <30min
      // old, always true at logout) by clearing the stored session first. auto-events reads
      // the id via its getSessionId callback, so it picks up the rotation automatically.
      await clearSession();
      this.state.sessionId = await getOrCreateSessionId();

      // 9.C.1: drop the once-per-install web-attribution-checked marker so the next
      // user's identify(email) can recover THEIR web attribution (we just wiped the
      // merged data; the marker would permanently block re-recovery on this install).
      await Storage.removeItem(WEB_ATTRIBUTION_CHECKED_KEY);

      // 9.C.2: a new user identity starts a fresh SKAN conversion-value window — clear
      // the persisted high-water/window-lock so the previous user's higher value doesn't
      // suppress all of the next user's conversion updates.
      await SKAdNetworkBridge.resetConversionState();

      debugLog('User data reset completed');

    } catch (error) {
      errorLog('Error resetting user data:', error as Error);
    }
  }

  async flush(): Promise<void> {
    try {
      debugLog('Flushing events...');
      await this.eventQueue.flush();
    } catch (error) {
      errorLog('Error flushing events:', error as Error);
    }
  }

  getStatus() {
    return {
      initialized: this.state.initialized,
      workspaceId: this.state.config.workspaceId || '',
      visitorId: this.state.visitorId,
      anonymousId: this.state.anonymousId,
      sessionId: this.state.sessionId,
      currentUserId: this.state.currentUserId,
      queueStats: this.eventQueue.getStats(),
      attribution: attributionManager.getAttributionSummary(),
      variant: 'expo',
    };
  }

  getAnonymousId(): string {
    return this.state.anonymousId;
  }

  /**
   * Get detailed attribution data (includes journey tracking data)
   */
  getAttributionData(): AttributionData & Record<string, any> {
    const attribution = attributionManager.getAttributionData();
    const journeyData = journeyManager.getAttributionData();

    // Merge attribution with journey data
    return {
      ...attribution,
      ...journeyData,
    };
  }

  /**
   * Get journey tracking summary
   */
  getJourneySummary() {
    return journeyManager.getJourneySummary();
  }

  /**
   * Get full customer journey (all touchpoints)
   */
  getJourney() {
    return journeyManager.getJourney();
  }

  async setAttributionData(data: Partial<AttributionData>): Promise<void> {
    await attributionManager.setAttributionData(data);
  }

  getCurrentSession() {
    return this.autoEventsManager?.getCurrentSession() || null;
  }

  async endSession(): Promise<void> {
    if (this.autoEventsManager) {
      await this.autoEventsManager.forceEndSession();
    }
  }

  async trackAppUpdate(previousVersion: string, currentVersion: string): Promise<void> {
    await this.track('app_update', {
      previous_version: previousVersion,
      current_version: currentVersion,
    });
  }

  updateAutoEventsConfig(config: Partial<AutoEventConfig>): void {
    if (this.autoEventsManager) {
      this.autoEventsManager.updateConfig(config);
    }
  }

  /**
   * Track event with automatic SKAdNetwork conversion value encoding
   * Uses SKAN 4.0 on iOS 16.1+ with coarse values and lock window support
   */
  async trackWithSKAdNetwork(event: string, properties?: EventData): Promise<void> {
    await this.track(event, properties);

    if (!DatalyrSDKExpo.conversionEncoder) {
      if (DatalyrSDKExpo.debugEnabled) {
        errorLog('SKAdNetwork encoder not initialized. Pass skadTemplate in initialize()');
      }
      return;
    }

    // Use SKAN 4.0 encoding (includes coarse value and lock window)
    const result = DatalyrSDKExpo.conversionEncoder.encodeWithSKAN4(event, properties);

    if (result.fineValue > 0 || result.priority > 0) {
      // Use SKAN 4.0 method (automatically falls back to SKAN 3.0 on older iOS)
      const success = await SKAdNetworkBridge.updatePostbackConversionValue(result);

      if (DatalyrSDKExpo.debugEnabled) {
        debugLog(`SKAN: event=${event}, fine=${result.fineValue}, coarse=${result.coarseValue}, lock=${result.lockWindow}, success=${success}`, properties);
      }
    }
  }

  async trackPurchase(value: number, currency = 'USD', productId?: string): Promise<void> {
    await this.trackWithSKAdNetwork('purchase', purchaseProperties(value, currency, productId));
  }

  async trackSubscription(value: number, currency = 'USD', plan?: string): Promise<void> {
    // Emit BOTH `value` and `revenue` (see datalyr-sdk.ts) so a rule's value_path='value'
    // doesn't yield $0; SKAN/value_usd read either.
    const properties: Record<string, any> = { value, revenue: value, currency };
    if (plan) properties.plan = plan;

    await this.trackWithSKAdNetwork('subscribe', properties);
  }

  // Standard e-commerce events with platform forwarding

  async trackAddToCart(value: number, currency: string, contentId?: string, contentName?: string): Promise<void> {
    // A3-14c: shared builder emits content_id/content_name (canonical) + product_id/product_name
    // (legacy alias). TR-20(b): route through SKAN like bare (was plain track() → mid-funnel
    // conversion values never updated on Expo).
    await this.trackWithSKAdNetwork('add_to_cart', addToCartProperties(value, currency, contentId, contentName));
  }

  async trackViewContent(contentId: string, contentName?: string, contentType?: string, value?: number, currency?: string): Promise<void> {
    await this.track('view_content', viewContentProperties(contentId, contentName, contentType, value, currency));
  }

  async trackInitiateCheckout(value?: number, currency?: string, numItems?: number, contentIds?: string[]): Promise<void> {
    // A3-14c: emits content_ids (canonical) + product_ids (legacy alias).
    // TR-20(b): route mid-funnel events through SKAN like the bare build (was plain track()).
    await this.trackWithSKAdNetwork('initiate_checkout', initiateCheckoutProperties(value, currency, numItems, contentIds));
  }

  async trackCompleteRegistration(registrationMethod?: string): Promise<void> {
    // A3-14c: emits registration_method (canonical) + method (legacy alias).
    // TR-20(b): route through SKAN like the bare build.
    await this.trackWithSKAdNetwork('complete_registration', completeRegistrationProperties(registrationMethod));
  }

  async trackSearch(searchString: string, contentIds?: string[]): Promise<void> {
    // A3-14c: emits search_string/content_ids (canonical) + query/result_ids (legacy alias).
    await this.track('search', searchProperties(searchString, contentIds));
  }

  async trackLead(value?: number, currency?: string): Promise<void> {
    // TR-20(b): route through SKAN like the bare build.
    await this.trackWithSKAdNetwork('lead', leadProperties(value, currency));
  }

  async trackAddPaymentInfo(success?: boolean): Promise<void> {
    const properties: Record<string, any> = {};
    if (success !== undefined) properties.success = success;

    await this.track('add_payment_info', properties);
  }

  // Platform integration methods

  getDeferredAttributionData(): DeferredDeepLinkResult | null {
    return null;
  }

  getPlatformIntegrationStatus(): { appleSearchAds: boolean; playInstallReferrer: boolean } {
    return {
      appleSearchAds: appleSearchAdsIntegration.isAvailable(),
      playInstallReferrer: playInstallReferrerIntegration.isAvailable(),
    };
  }

  /**
   * Get Play Install Referrer data (Android only)
   */
  getPlayInstallReferrer(): Record<string, any> | null {
    const data = playInstallReferrerIntegration.getReferrerData();
    return data ? playInstallReferrerIntegration.getAttributionData() : null;
  }

  /**
   * Get Apple Search Ads attribution data
   * Returns attribution if user installed via Apple Search Ads, null otherwise
   */
  getAppleSearchAdsAttribution(): AppleSearchAdsAttribution | null {
    return appleSearchAdsIntegration.getAttributionData();
  }

  // MARK: - Third-Party Integration Methods

  /**
   * Get attribution data formatted for Superwall's setUserAttributes()
   */
  getSuperwallAttributes(): Record<string, string> {
    const attribution = attributionManager.getAttributionData();
    const advertiser = this.cachedAdvertiserInfo;
    const attrs: Record<string, string> = {};

    const set = (key: string, value: any) => {
      if (value != null && String(value) !== '') attrs[key] = String(value);
    };

    set('datalyr_id', this.state.visitorId);
    set('media_source', attribution.utm_source);
    set('campaign', attribution.utm_campaign);
    set('adgroup', attribution.adset_id || attribution.utm_content);
    set('ad', attribution.ad_id);
    set('keyword', attribution.keyword);
    set('network', attribution.network);
    set('utm_source', attribution.utm_source);
    set('utm_medium', attribution.utm_medium);
    set('utm_campaign', attribution.utm_campaign);
    set('utm_term', attribution.utm_term);
    set('utm_content', attribution.utm_content);
    set('lyr', attribution.lyr);
    set('fbclid', attribution.fbclid);
    set('gclid', attribution.gclid);
    set('ttclid', attribution.ttclid);
    set('idfa', advertiser?.idfa);
    set('gaid', advertiser?.gaid);
    // RN-13: map the numeric ATT status to the same string the RN build sends, so
    // Superwall audiences are consistent across the two builds (was raw number on Expo).
    if (advertiser?.att_status != null) {
      const statusMap: Record<number, string> = { 0: 'notDetermined', 1: 'restricted', 2: 'denied', 3: 'authorized' };
      set('att_status', statusMap[advertiser.att_status] || String(advertiser.att_status));
    }

    return attrs;
  }

  /**
   * Get attribution data formatted for RevenueCat's Purchases.setAttributes()
   */
  getRevenueCatAttributes(): Record<string, string> {
    const attribution = attributionManager.getAttributionData();
    const advertiser = this.cachedAdvertiserInfo;
    const attrs: Record<string, string> = {};

    const set = (key: string, value: any) => {
      if (value != null && String(value) !== '') attrs[key] = String(value);
    };

    // Reserved attributes ($ prefix)
    set('$datalyrId', this.state.visitorId);
    set('$mediaSource', attribution.utm_source);
    set('$campaign', attribution.utm_campaign);
    set('$adGroup', attribution.adset_id);
    set('$ad', attribution.ad_id);
    set('$keyword', attribution.keyword);
    set('$idfa', advertiser?.idfa);
    set('$gpsAdId', advertiser?.gaid);
    if (advertiser?.att_status != null) {
      const statusMap: Record<number, string> = { 0: 'notDetermined', 1: 'restricted', 2: 'denied', 3: 'authorized' };
      set('$attConsentStatus', statusMap[advertiser.att_status] || String(advertiser.att_status));
    }

    // Custom attributes
    set('utm_source', attribution.utm_source);
    set('utm_medium', attribution.utm_medium);
    set('utm_campaign', attribution.utm_campaign);
    set('utm_term', attribution.utm_term);
    set('utm_content', attribution.utm_content);
    set('lyr', attribution.lyr);
    set('fbclid', attribution.fbclid);
    set('gclid', attribution.gclid);
    set('ttclid', attribution.ttclid);
    set('wbraid', attribution.wbraid);
    set('gbraid', attribution.gbraid);
    set('network', attribution.network);
    set('creative_id', attribution.creative_id);

    return attrs;
  }

  async updateTrackingAuthorization(authorized: boolean): Promise<void> {
    if (!this.state.initialized) {
      errorLog('SDK not initialized. Call initialize() first.');
      return;
    }

    // Refresh cached advertiser info after ATT status change
    try {
      this.cachedAdvertiserInfo = await AdvertiserInfoBridge.getAdvertiserInfo();
    } catch (error) {
      errorLog('Failed to refresh advertiser info:', error as Error);
    }

    // Track ATT status event (parity with the RN SDK — Expo was silently omitting it).
    await this.track('$att_status', {
      authorized: authorized,
      status: authorized ? 3 : 2,
      status_name: authorized ? 'authorized' : 'denied',
    });

    debugLog(`ATT status updated: ${authorized ? 'authorized' : 'denied'}`);
  }

  private async handleDeferredDeepLink(data: DeferredDeepLinkResult): Promise<void> {
    debugLog('Handling deferred deep link:', data);

    // Store attribution data
    if (data.fbclid || data.utmSource || data.campaignId) {
      await attributionManager.setAttributionData({
        fbclid: data.fbclid,
        ttclid: data.ttclid,
        utm_source: data.utmSource,
        utm_medium: data.utmMedium,
        utm_campaign: data.utmCampaign,
        utm_content: data.utmContent,
        utm_term: data.utmTerm,
        source: data.source,
      });
    }

    // Track the deferred deep link event
    await this.track('$deferred_deep_link', {
      url: data.url,
      source: data.source,
      fbclid: data.fbclid,
      ttclid: data.ttclid,
      utm_source: data.utmSource,
      utm_medium: data.utmMedium,
      utm_campaign: data.utmCampaign,
      campaign_id: data.campaignId,
      adset_id: data.adsetId,
      ad_id: data.adId,
    });
  }

  getConversionValue(event: string, properties?: Record<string, any>): number | null {
    return DatalyrSDKExpo.conversionEncoder?.encode(event, properties) || null;
  }

  private async createEventPayload(eventName: string, eventData?: EventData): Promise<EventPayload> {
    const deviceInfo = await getDeviceInfo();
    const deviceContext = await createDeviceContext();
    const attributionData = attributionManager.getAttributionData();
    const networkType = getNetworkType();

    // Get Apple Search Ads attribution if available
    const asaAttribution = appleSearchAdsIntegration.getAttributionData();
    const asaData = asaAttribution?.attribution ? {
      asa_campaign_id: asaAttribution.campaignId,
      asa_campaign_name: asaAttribution.campaignName,
      asa_ad_group_id: asaAttribution.adGroupId,
      asa_ad_group_name: asaAttribution.adGroupName,
      asa_keyword_id: asaAttribution.keywordId,
      asa_keyword: asaAttribution.keyword,
      asa_org_id: asaAttribution.orgId,
      asa_org_name: asaAttribution.orgName,
      asa_click_date: asaAttribution.clickDate,
      asa_conversion_type: asaAttribution.conversionType,
      asa_country_or_region: asaAttribution.countryOrRegion,
    } : {};

    // Use cached advertiser info (IDFA/GAID, ATT status) — cached at init, refreshed on ATT change
    const advertiserInfo = this.cachedAdvertiserInfo;

    // TR-18: honor a caller-supplied idempotency key (non-empty string properties.event_id) as
    // the wire eventId, stripping it from properties. Mirrors iOS/Node semantics. Else a UUID.
    const callerEventId = (typeof eventData?.event_id === 'string' && eventData.event_id.trim().length > 0)
      ? eventData.event_id
      : undefined;
    let cleanedEventData = eventData;
    if (callerEventId !== undefined && eventData) {
      cleanedEventData = { ...eventData };
      delete (cleanedEventData as Record<string, unknown>).event_id;
    }

    const payload: EventPayload = {
      workspaceId: this.state.config.workspaceId || 'mobile_sdk',
      visitorId: this.state.visitorId,
      anonymousId: this.state.anonymousId,
      sessionId: this.state.sessionId,
      eventId: callerEventId ?? generateUUID(),
      eventName,
      eventData: {
        // Auto-captured + persisted attribution spread FIRST so caller's explicit event
        // properties (`...eventData`, spread LAST) WIN. (Was attribution-after-eventData,
        // which silently clobbered caller fields like track('purchase', { utm_source })).
        anonymous_id: this.state.anonymousId,
        platform: Platform.OS,
        os_version: deviceInfo.osVersion,
        device_model: deviceInfo.model,
        app_version: deviceInfo.appVersion,
        app_build: deviceInfo.buildNumber,
        app_name: deviceInfo.bundleId,
        app_namespace: deviceInfo.bundleId,
        screen_width: deviceInfo.screenWidth,
        screen_height: deviceInfo.screenHeight,
        locale: deviceInfo.locale,
        timezone: deviceInfo.timezone,
        // ISO-3166-1 alpha-2 from device locale. Mirror of datalyr-sdk.ts —
        // see that file for rationale (meta.js USER_DATA_PATHS.country picks
        // top-level `country` as its first match; bridge-recovered geo still
        // wins server-side when present).
        country: deriveCountryFromLocale(deviceInfo.locale) || undefined,
        carrier: deviceInfo.carrier,
        network_type: networkType,
        sdk_version: '1.7.14',
        schema_version: 1, // A3-25: versioned-envelope stamp (see web SDK)
        sdk_variant: 'expo',
        // Advertiser data (IDFA/GAID, ATT status) for server-side postback
        ...(advertiserInfo ? {
          idfa: advertiserInfo.idfa,
          idfv: advertiserInfo.idfv,
          gaid: advertiserInfo.gaid,
          att_status: advertiserInfo.att_status,
          advertiser_tracking_enabled: advertiserInfo.advertiser_tracking_enabled,
        } : {}),
        ...attributionData,
        // Apple Search Ads attribution (iOS)
        ...asaData,
        // Google Play Install Referrer (Android) — gclid/gbraid/wbraid/utm_*. Fill it
        // ONLY when the web→app bridge hasn't already recovered ad attribution, so a
        // web-sourced gclid/utm isn't clobbered. (Was fetched at init but never merged
        // at all, dropping Android Google Ads install attribution.)
        ...((attributionData.gclid || attributionData.utm_source)
          ? {}
          : playInstallReferrerIntegration.getAttributionData()),
        // Caller-supplied event properties WIN over all auto/attribution fields above.
        // TR-18: cleanedEventData is eventData minus a consumed event_id (now the wire eventId).
        ...cleanedEventData,
        // Always SDK-stamped (not caller-overridable).
        timestamp: Date.now(),
      },
      deviceContext,
      source: 'mobile_app',
      timestamp: new Date().toISOString(),
    };

    // $alias/$identify carry their OWN userId in eventData (the NEW id). alias() fires
    // $alias BEFORE its internal identify(), so state.currentUserId is still the OLD/
    // persisted id here — overwriting eventData.userId with it would write the
    // visitor_user_links row to the WRONG user (ingest reads ed.userId, camelCase). Only
    // fill userId from currentUserId when the event didn't already provide one.
    if (this.state.currentUserId) {
      payload.userId = this.state.currentUserId;
      if (payload.eventData && !('userId' in payload.eventData)) {
        payload.eventData.userId = this.state.currentUserId;
      }
    }

    // Pre-init alias() snapshots previousId from state.visitorId while it's still '' (the
    // constructor default); the replayed $alias would ship empty previousId and the server
    // link builder requires it truthy. Resolve it at payload-creation time (post-init).
    if (eventName === '$alias' && payload.eventData && !payload.eventData.previousId && this.state.visitorId) {
      payload.eventData.previousId = this.state.visitorId;
    }

    if (Object.keys(this.state.userProperties).length > 0) {
      payload.userProperties = this.state.userProperties;
    }

    return payload;
  }

  private async loadPersistedUserData(): Promise<void> {
    try {
      const [userId, userProperties] = await Promise.all([
        Storage.getItem<string>(STORAGE_KEYS.USER_ID),
        Storage.getItem<UserProperties>(STORAGE_KEYS.USER_PROPERTIES),
      ]);

      // Only restore the persisted user when identify() hasn't ALREADY set one (mid-init
      // identify race) — see datalyr-sdk.ts for the full rationale.
      if (userId && this.state.currentUserId === undefined) {
        this.state.currentUserId = userId;
      }

      if (userProperties && Object.keys(this.state.userProperties).length === 0) {
        this.state.userProperties = userProperties;
      }

      debugLog('Loaded persisted user data:', {
        userId: this.state.currentUserId,
        userProperties: this.state.userProperties,
      });

    } catch (error) {
      errorLog('Error loading persisted user data:', error as Error);
    }
  }

  private async persistUserData(): Promise<void> {
    try {
      await Promise.all([
        this.state.currentUserId
          ? Storage.setItem(STORAGE_KEYS.USER_ID, this.state.currentUserId)
          : Storage.removeItem(STORAGE_KEYS.USER_ID),
        Storage.setItem(STORAGE_KEYS.USER_PROPERTIES, this.state.userProperties),
      ]);
    } catch (error) {
      errorLog('Error persisting user data:', error as Error);
    }
  }

  private setupAppStateMonitoring(): void {
    try {
      this.appStateSubscription = AppState.addEventListener('change', async (nextAppState) => {
        debugLog('App state changed:', nextAppState);

        if (nextAppState === 'background') {
          this.flush();
          if (this.autoEventsManager) {
            this.autoEventsManager.handleAppBackground();
          }
        } else if (nextAppState === 'active') {
          // TR-19: AWAIT the session refresh before notifying auto-events so a genuine expiry
          // rotates this.state.sessionId first — the unawaited version raced, letting
          // session_start emit with the OLD id while subsequent events carried the NEW one.
          await this.refreshSession();
          // Refresh network status on foreground (expo-network has no listener API and
          // we poll at 30s, so a foreground refresh picks up changes that happened in
          // the background promptly).
          networkStatusManager.refresh();
          if (this.autoEventsManager) {
            this.autoEventsManager.handleAppForeground();
          }
        }
      });

    } catch (error) {
      errorLog('Error setting up app state monitoring:', error as Error);
    }
  }

  /**
   * Initialize network status monitoring and keep the event queue's online flag in
   * sync, so offline events wait instead of failing/dropping and are re-sent on
   * reconnect. Non-blocking; defaults to online if no network module is available.
   */
  private async initializeNetworkMonitoring(): Promise<void> {
    try {
      await networkStatusManager.initialize();
      this.state.isOnline = networkStatusManager.isOnline();
      this.eventQueue.setOnlineStatus(this.state.isOnline);

      this.networkStatusUnsubscribe = networkStatusManager.subscribe((state) => {
        const isOnline = state.isConnected && (state.isInternetReachable !== false);
        this.state.isOnline = isOnline;
        this.eventQueue.setOnlineStatus(isOnline);

        // Track network status change (parity with the RN SDK — Expo was silently omitting it).
        if (this.state.initialized) {
          this.track('$network_status_change', {
            is_online: isOnline,
            network_type: state.type,
            is_internet_reachable: state.isInternetReachable,
          }).catch(() => {
            // Ignore errors for network status events
          });
        }
      });

      debugLog(`Network monitoring initialized, online: ${this.state.isOnline}`);
    } catch (error) {
      errorLog('Error initializing network monitoring (non-blocking):', error as Error);
      this.state.isOnline = true;
      this.eventQueue.setOnlineStatus(true);
    }
  }

  private async refreshSession(): Promise<void> {
    try {
      const newSessionId = await getOrCreateSessionId();
      if (newSessionId !== this.state.sessionId) {
        this.state.sessionId = newSessionId;
        debugLog('Session refreshed:', newSessionId);
      }
    } catch (error) {
      errorLog('Error refreshing session:', error as Error);
    }
  }

  destroy(): void {
    try {
      debugLog('Destroying Datalyr SDK (Expo)');

      if (this.appStateSubscription) {
        this.appStateSubscription.remove();
        this.appStateSubscription = null;
      }

      if (this.networkStatusUnsubscribe) {
        this.networkStatusUnsubscribe();
        this.networkStatusUnsubscribe = null;
      }
      networkStatusManager.destroy();

      // Tear down attribution + auto-events so destroy()→initialize() doesn't leak the old
      // Linking 'url' subscription / session timers and a fresh init can re-listen.
      attributionManager.destroy();
      if (this.autoEventsManager) {
        this.autoEventsManager.destroy();
        this.autoEventsManager = null;
      }

      this.eventQueue.destroy();
      // `initializing` MUST be cleared too, or a subsequent initialize() hits the
      // idempotent guard and the SDK never re-initializes (silent total loss).
      this.state.initialized = false;
      this.initializing = false;

      debugLog('Datalyr SDK (Expo) destroyed');

    } catch (error) {
      errorLog('Error destroying SDK:', error as Error);
    }
  }
}

// Create singleton instance for Expo
const datalyrExpo = new DatalyrSDKExpo();

// Export static class wrapper for Expo
export class DatalyrExpo {
  static async initialize(config: DatalyrConfig): Promise<void> {
    await datalyrExpo.initialize(config);
  }

  static async trackWithSKAdNetwork(event: string, properties?: Record<string, any>): Promise<void> {
    await datalyrExpo.trackWithSKAdNetwork(event, properties);
  }

  static async trackPurchase(value: number, currency = 'USD', productId?: string): Promise<void> {
    await datalyrExpo.trackPurchase(value, currency, productId);
  }

  static async trackSubscription(value: number, currency = 'USD', plan?: string): Promise<void> {
    await datalyrExpo.trackSubscription(value, currency, plan);
  }

  static getConversionValue(event: string, properties?: Record<string, any>): number | null {
    return datalyrExpo.getConversionValue(event, properties);
  }

  static async track(eventName: string, eventData?: EventData): Promise<void> {
    await datalyrExpo.track(eventName, eventData);
  }

  static async screen(screenName: string, properties?: EventData): Promise<void> {
    await datalyrExpo.screen(screenName, properties);
  }

  static async identify(userId: string, properties?: UserProperties): Promise<void> {
    await datalyrExpo.identify(userId, properties);
  }

  static async alias(newUserId: string, previousId?: string): Promise<void> {
    await datalyrExpo.alias(newUserId, previousId);
  }

  static async reset(): Promise<void> {
    await datalyrExpo.reset();
  }

  static async flush(): Promise<void> {
    await datalyrExpo.flush();
  }

  static getStatus() {
    return datalyrExpo.getStatus();
  }

  static getAnonymousId(): string {
    return datalyrExpo.getAnonymousId();
  }

  static getAttributionData(): AttributionData {
    return datalyrExpo.getAttributionData();
  }

  static async setAttributionData(data: Partial<AttributionData>): Promise<void> {
    await datalyrExpo.setAttributionData(data);
  }

  static getCurrentSession() {
    return datalyrExpo.getCurrentSession();
  }

  static async endSession(): Promise<void> {
    await datalyrExpo.endSession();
  }

  static async trackAppUpdate(previousVersion: string, currentVersion: string): Promise<void> {
    await datalyrExpo.trackAppUpdate(previousVersion, currentVersion);
  }

  static updateAutoEventsConfig(config: Partial<AutoEventConfig>): void {
    datalyrExpo.updateAutoEventsConfig(config);
  }

  // Standard e-commerce events with platform forwarding

  static async trackAddToCart(value: number, currency: string, contentId?: string, contentName?: string): Promise<void> {
    await datalyrExpo.trackAddToCart(value, currency, contentId, contentName);
  }

  static async trackViewContent(contentId: string, contentName?: string, contentType?: string, value?: number, currency?: string): Promise<void> {
    await datalyrExpo.trackViewContent(contentId, contentName, contentType, value, currency);
  }

  static async trackInitiateCheckout(value?: number, currency?: string, numItems?: number, contentIds?: string[]): Promise<void> {
    await datalyrExpo.trackInitiateCheckout(value, currency, numItems, contentIds);
  }

  static async trackCompleteRegistration(registrationMethod?: string): Promise<void> {
    await datalyrExpo.trackCompleteRegistration(registrationMethod);
  }

  static async trackSearch(searchString: string, contentIds?: string[]): Promise<void> {
    await datalyrExpo.trackSearch(searchString, contentIds);
  }

  static async trackLead(value?: number, currency?: string): Promise<void> {
    await datalyrExpo.trackLead(value, currency);
  }

  static async trackAddPaymentInfo(success?: boolean): Promise<void> {
    await datalyrExpo.trackAddPaymentInfo(success);
  }

  // Platform integration methods

  static getDeferredAttributionData(): DeferredDeepLinkResult | null {
    return datalyrExpo.getDeferredAttributionData();
  }

  static getPlatformIntegrationStatus(): { appleSearchAds: boolean; playInstallReferrer: boolean } {
    return datalyrExpo.getPlatformIntegrationStatus();
  }

  static getPlayInstallReferrer(): Record<string, any> | null {
    return datalyrExpo.getPlayInstallReferrer();
  }

  static getAppleSearchAdsAttribution(): AppleSearchAdsAttribution | null {
    return datalyrExpo.getAppleSearchAdsAttribution();
  }

  static async updateTrackingAuthorization(authorized: boolean): Promise<void> {
    await datalyrExpo.updateTrackingAuthorization(authorized);
  }

  // Third-party integration methods

  static getSuperwallAttributes(): Record<string, string> {
    return datalyrExpo.getSuperwallAttributes();
  }

  static getRevenueCatAttributes(): Record<string, string> {
    return datalyrExpo.getRevenueCatAttributes();
  }
}

export default datalyrExpo;
