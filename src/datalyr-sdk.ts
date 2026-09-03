import { Platform, AppState } from 'react-native';
import {
  DatalyrConfig,
  EventData,
  UserProperties,
  EventPayload,
  SDKState,
  AppState as AppStateType,
  AutoEventConfig,
  DeferredDeepLinkResult,
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
  fingerprintOsVersion,
  fingerprintDeviceModel,
  getNetworkType,
  deriveCountryFromLocale,
  validateEventName,
  normalizeEventName,
  validateEventData,
  debugLog,
  errorLog,
  Storage,
  STORAGE_KEYS,
  warnAboutIgnoredOptions,
} from './utils';
import {
  purchaseProperties,
  addToCartProperties,
  viewContentProperties,
  initiateCheckoutProperties,
  completeRegistrationProperties,
  searchProperties,
  leadProperties,
} from './ecommerce-properties';
import { SDK_VERSION } from './version';
import { createHttpClient, HttpClient, utf8ByteLength } from './http-client';
import { createEventQueue, EventQueue } from './event-queue';
import { attributionManager, AttributionData } from './attribution';
import { journeyManager } from './journey';
import { createAutoEventsManager, AutoEventsManager, SessionData } from './auto-events';
import { ConversionValueEncoder, ConversionTemplates } from './ConversionValueEncoder';
import { SKAdNetworkBridge } from './native/SKAdNetworkBridge';
import { appleSearchAdsIntegration, playInstallReferrerIntegration } from './integrations';
import { AppleSearchAdsAttribution, AdvertiserInfoBridge, isNativeModuleAvailable } from './native/DatalyrNativeBridge';
import { networkStatusManager } from './network-status';

// Largest serialized `eventData` accepted by track(). Ingest answers 413 above its body
// cap; dropping here (with a loud log) beats a queued event that can never deliver.
const MAX_EVENT_DATA_BYTES = 200_000;

// Provider namespaces the server's webhooks join on `external_ids`. MUST match
// KNOWN_EXTERNAL_NAMESPACES in datalyr-v2/infra/cloudflare/lib/person-contract.js.
const KNOWN_EXTERNAL_NAMESPACES: readonly string[] = [
  'revenuecat', 'superwall', 'stripe', 'shopify', 'whop', 'checkoutchamp',
  'clickfunnels', 'firebase',
  'klaviyo',
];

// Once-per-process warning latches (unconditional console.warn, not debug-gated).
let skadTemplateMissingWarned = false;
let nativeModulesMissingWarned = false;
const unknownNamespaceWarned = new Set<string>();

// Once-per-install dedupe marker for the identify(email) web-attribution lookup. Module
// const (not a local in fetchAndMergeWebAttribution) so reset() can drop it — 9.C.1.
const WEB_ATTRIBUTION_CHECKED_KEY = 'datalyr_web_attribution_checked';

export class DatalyrSDK {
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
    // Initialize state with defaults
    this.state = {
      initialized: false,
      config: {
        workspaceId: '',
        apiKey: '',
        debug: false,
        endpoint: 'https://ingest.datalyr.com/track',
        useServerTracking: true, // Default to server-side
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
      anonymousId: '',  // Persistent anonymous identifier
      sessionId: '',
      userProperties: {},
      eventQueue: [],
      isOnline: true,
    };

    // Initialize HTTP client and event queue (will be properly set up in initialize)
    this.httpClient = createHttpClient(this.state.config.endpoint!);
    this.eventQueue = createEventQueue(this.httpClient);
  }

  /**
   * Initialize the SDK with configuration
   */
  async initialize(config: DatalyrConfig): Promise<void> {
    try {
      debugLog('Initializing Datalyr SDK...', { workspaceId: config.workspaceId });

      // Idempotent init: a repeat initialize() (hot-reload, re-login, double-call) must not
      // re-run — it would orphan the prior AppState + network subscriptions (the first
      // becomes unremovable), double-fire flush/$network_status_change, and emit a duplicate
      // session_start. Mirrors the iOS SDK's `guard !initialized`.
      if (this.state.initialized || this.initializing) {
        debugLog('SDK already initialized; ignoring repeat initialize()');
        return;
      }
      this.initializing = true;

      // Validate configuration
      if (!config.apiKey) {
        throw new Error('apiKey is required for Datalyr SDK v1.0.0');
      }
      
      // workspaceId is now optional (for backward compatibility)
      if (!config.workspaceId) {
        debugLog('workspaceId not provided, using server-side tracking only');
      }

      // Set up configuration
      this.state.config = { ...this.state.config, ...config };

      // DEP-01: surface options that are accepted and then ignored.
      warnAboutIgnoredOptions(config as Record<string, any>);

      // Tear down the placeholder queue built in the constructor BEFORE installing the
      // configured one. That placeholder has an empty apiKey, started its own 30s flush
      // timer, and loaded the persisted queue from the SAME storage key — left alive it
      // flushes leftover events through an empty-key client (→ 401 → dead-letter) and
      // races the real queue on storage. destroy() stops its timer for good.
      this.eventQueue.destroy();

      // Initialize HTTP client with server-side API
      this.httpClient = new HttpClient(this.state.config.endpoint || 'https://ingest.datalyr.com/track', {
        maxRetries: this.state.config.maxRetries || 3,
        retryDelay: this.state.config.retryDelay || 1000,
        timeout: this.state.config.timeout || 15000,
        apiKey: this.state.config.apiKey!,
        workspaceId: this.state.config.workspaceId,
        debug: this.state.config.debug || false,
        useServerTracking: this.state.config.useServerTracking ?? true,
      });

      // Initialize event queue
      this.eventQueue = new EventQueue(this.httpClient, {
        maxQueueSize: this.state.config.maxQueueSize || 100,
        batchSize: this.state.config.batchSize || 10,
        flushInterval: this.state.config.flushInterval || 30000,
        maxRetryCount: this.state.config.maxRetries || 3,
      });

      // RN-22 / RN-24: install detection is lifecycle, not attribution — with
      // `enableAttribution: false` app_install used to never fire for ANY user.
      // It runs FIRST and alone, deliberately: detectInstall()'s upgrade guard
      // reads @datalyr/visitor_id etc. as evidence of a prior install, so it must
      // observe storage BEFORE the id creation below writes those very keys.
      // Inside the Promise.all it raced them and could suppress a real install.
      attributionManager.setDeepLinkHandler((params, url) => {
        void this.track('$deep_link', { ...params, deep_link_url: url, source: 'deep_link' });
      });
      await attributionManager.detectInstall();

      // PARALLEL INITIALIZATION: IDs and core managers
      // Run ID creation and core manager initialization in parallel for faster startup
      const [visitorId, anonymousId, sessionId] = await Promise.all([
        getOrCreateVisitorId(),
        getOrCreateAnonymousId(),
        getOrCreateSessionId(),
        // These run concurrently but don't return values we need to capture
        this.loadPersistedUserData(),
        this.state.config.enableAttribution
          ? attributionManager.initialize()
          : Promise.resolve(),
        journeyManager.initialize(),
      ]);

      this.state.visitorId = visitorId;
      this.state.anonymousId = anonymousId;
      this.state.sessionId = sessionId;

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

      // Initialize auto-events manager (asynchronously to avoid blocking)
      if (this.state.config.enableAutoEvents) {
        this.autoEventsManager = new AutoEventsManager(
          this.track.bind(this),
          this.state.config.autoEventConfig,
          // Canonical session id getter — unifies session_start/end's session_id with the
          // wire context.session_id (state.sessionId).
          () => this.state.sessionId
        );

        // Initialize auto-events asynchronously to prevent blocking
        setTimeout(async () => {
          try {
            await this.autoEventsManager?.initialize();
          } catch (error) {
            errorLog('Error initializing auto-events (non-blocking):', error as Error);
          }
        }, 100); // Small delay to ensure main thread isn't blocked
      }

      // Set up app state monitoring (also asynchronous)
      setTimeout(() => {
        try {
          this.setupAppStateMonitoring();
        } catch (error) {
          errorLog('Error setting up app state monitoring (non-blocking):', error as Error);
        }
      }, 50);

      // Initialize SKAdNetwork conversion encoder (synchronous, no await needed)
      if (config.skadTemplate) {
        const template = ConversionTemplates[config.skadTemplate];
        if (template) {
          DatalyrSDK.conversionEncoder = new ConversionValueEncoder(template);
          DatalyrSDK.debugEnabled = config.debug || false;

          if (DatalyrSDK.debugEnabled) {
            debugLog(`SKAdNetwork encoder initialized with template: ${config.skadTemplate}`);
            debugLog(`SKAdNetwork bridge available: ${SKAdNetworkBridge.isAvailable()}`);
          }
        }
      }

      // PARALLEL INITIALIZATION: Network monitoring and platform integrations
      // These are independent and can run concurrently for faster startup
      const platformInitPromises: Promise<void>[] = [
        // Network monitoring
        this.initializeNetworkMonitoring(),
        // Apple Search Ads (iOS only)
        appleSearchAdsIntegration.initialize(config.debug),
        // Google Play Install Referrer (Android only)
        playInstallReferrerIntegration.initialize(),
        // 9.C.3: register for SKAdNetwork / AdAttributionKit attribution once at init (iOS-only;
        // the bridge no-ops off-iOS and swallows-and-logs any failure). Without this the first
        // SKAN conversion-value update could be dropped for not being registered.
        SKAdNetworkBridge.registerForAttribution().then(() => undefined),
      ];

      // Wait for all platform integrations to complete
      await Promise.all(platformInitPromises);

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

      // SDK initialized successfully - set state before tracking install event
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

      // iOS: attempt deferred web-to-app attribution via IP matching, before app_install so
      // the recovered click-ids ride on it. Android: the Play Store referrer covers this via
      // playInstallReferrerIntegration.
      //
      // Gated on the lookup not having been ANSWERED yet, not on isInstall(): the
      // first-launch flag is spent by the launch that observed the install whether or not
      // the request ever reached the server, so an offline cold start — the ordinary state
      // right after a store install — permanently forfeited the only web→app bridge.
      // shouldAttemptDeferredLookup() bounds the retries by the server's match window and
      // an attempt cap.
      if (Platform.OS === 'ios' && (await attributionManager.shouldAttemptDeferredLookup())) {
        await this.fetchDeferredWebAttribution();
      }

      // Check for app install (after SDK is marked as initialized)
      if (attributionManager.isInstall()) {
        const installData = await attributionManager.trackInstall();
        await this.track('app_install', {
          platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'android',
          sdk_version: SDK_VERSION,
          ...installData,
        });
        // TR-21: commit the first-launch marker only AFTER app_install is durably enqueued —
        // a crash before this re-fires app_install next launch instead of losing it.
        await attributionManager.markInstallTracked();
      }
      
      // Loud, once: on iOS without the native pods every SKAN / IDFA / Apple Search Ads
      // call is a silent no-op. Expo Go can't load them; a dev build with pod install can.
      if (
        Platform.OS === 'ios' &&
        !nativeModulesMissingWarned &&
        (!isNativeModuleAvailable() || !SKAdNetworkBridge.isAvailable())
      ) {
        nativeModulesMissingWarned = true;
        console.warn('[Datalyr] Native modules not linked — SKAdNetwork, IDFA and Apple Search Ads are disabled. Expo Go does not support them; use a development build and re-run pod install.');
      }

      debugLog('Datalyr SDK initialized successfully', {
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

  /**
   * Track a custom event
   */
  async track(eventName: string, eventData?: EventData): Promise<void> {
    try {
      if (!this.state.initialized) {
        // Queue events that arrive before init completes instead of dropping them
        if (this.preInitQueue.length < DatalyrSDK.PRE_INIT_QUEUE_MAX) {
          debugLog(`Queuing pre-init event: ${eventName}`);
          this.preInitQueue.push({ eventName, eventData });
        } else {
          errorLog('Pre-init event queue full, dropping event:', eventName as unknown as Error);
        }
        return;
      }

      // TR-20: normalize (spaces → underscores) then validate against the fleet charset, so the
      // rest of this method uses one canonical name and bare/Expo behave identically.
      const name = normalizeEventName(eventName);
      if (!validateEventName(name)) {
        errorLog(`Invalid event name: ${eventName}`);
        return;
      }

      if (!validateEventData(eventData)) {
        errorLog('Invalid event data provided');
        return;
      }

      if (eventData) {
        const bytes = utf8ByteLength(JSON.stringify(eventData));
        if (bytes > MAX_EVENT_DATA_BYTES) {
          errorLog(`Dropping event '${name}': eventData is ${bytes} bytes (max ${MAX_EVENT_DATA_BYTES}); the server would reject it with 413`);
          return;
        }
      }

      debugLog(`Tracking event: ${name}`, eventData);

      const payload = await this.createEventPayload(name, eventData);
      await this.eventQueue.enqueue(payload);

      // TR-08: refresh the STORAGE session-activity time on real event activity (throttled to
      // 60s), so a session doesn't wrongly expire during a long continuous-foreground stretch —
      // getOrCreateSessionId (init/foreground/reset) was the only writer. Fire-and-forget so the
      // (throttled) AsyncStorage write never blocks the track path.
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

  /**
   * Track a screen view
   */
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

  /**
   * Identify a user
   */
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

      // Treat an account switch as an implicit logout. This prevents a shared
      // device anonymous/visitor node from being linked to two people when an
      // app forgets to call reset() between accounts.
      if (resetOnAccountSwitch && this.state.currentUserId && this.state.currentUserId !== userId) {
        await this.reset();
      }

      // Update current user ID
      this.state.currentUserId = userId;

      // Merge user properties
      this.state.userProperties = { ...this.state.userProperties, ...properties };

      // Persist user data
      // Redundant-identify suppression: identify() is host-app-driven and apps
      // commonly call it every launch/screen. Re-emitting $identify and re-running
      // the web-attribution lookup for an UNCHANGED identity teaches the server
      // nothing. Measured 2026-07-25: 6.8 identifies/visitor/day on shipped
      // builds, worst single user 129 in 24h. Fingerprint includes the visitor id
      // so a rotation (reset/new install) always re-emits and links are never lost.
      // RN-23: HASH the fingerprint — never persist the raw identity.
      //
      // The 1.7.15 version stored this string verbatim in plaintext AsyncStorage,
      // which meant the suppression feature itself wrote PII at rest:
      //   visitor123|user@example.com|email=user@example.com&phone=+15551234
      // iOS hashes with SHA-256 and the web SDK hashes with FNV-1a for exactly
      // this reason; RN was the outlier. The value is only ever compared for
      // equality, so a non-cryptographic digest is sufficient — and `identify()`
      // is synchronous here, so an async WebCrypto-style digest is not an option.
      const identityFingerprint = this.stableEmailHash(
        `${this.state.visitorId}|${userId}|${
          properties ? Object.keys(properties).sort().map((k) => `${k}=${String((properties as Record<string, unknown>)[k])}`).join('&') : ''
        }`,
      );
      const previousFingerprint = await Storage.getItem(STORAGE_KEYS.LAST_IDENTITY_FINGERPRINT);
      const isRedundantIdentify = previousFingerprint === identityFingerprint;

      await this.persistUserData();

      // 9.C.6: normalize identity trait keys (camelCase → snake_case) and hoist email/phone to
      // the event root, so server-side advanced matching (which keys on first_name/last_name/
      // phone) finds them. Mirrors the iOS identify() key set. Raw props are still spread (so
      // custom traits survive); the normalized snake keys are hoisted last and win.
      const props = (properties || {}) as Record<string, any>;
      const email = typeof props.email === 'string' ? props.email : undefined;
      const phone = typeof props.phone === 'string' ? props.phone
        : (typeof props.phoneNumber === 'string' ? props.phoneNumber : undefined);
      const firstName = typeof props.first_name === 'string' ? props.first_name
        : (typeof props.firstName === 'string' ? props.firstName : undefined);
      const lastName = typeof props.last_name === 'string' ? props.last_name
        : (typeof props.lastName === 'string' ? props.lastName : undefined);

      // Track $identify event for identity resolution
      if (isRedundantIdentify) {
        debugLog('Skipping redundant identify (unchanged identity):', userId);
      } else {
        await Storage.setItem(STORAGE_KEYS.LAST_IDENTITY_FINGERPRINT, identityFingerprint);

        await this.track('$identify', {
          userId,
          anonymous_id: this.state.anonymousId,
          ...props,
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          ...(firstName ? { first_name: firstName } : {}),
          ...(lastName ? { last_name: lastName } : {}),
        });
      }

      // Fetch and merge web attribution if email is provided.
      //
      // RN-19: runs on EVERY identify — redundant or not — and must stay OUTSIDE
      // the suppression branch above. 1.7.15 returned early on a redundant
      // identify, putting this out of reach: fetchAndMergeWebAttribution marks an
      // email hash checked ONLY after a definitive 200 (see the
      // WEB_ATTRIBUTION_CHECKED_KEY write), precisely so a transient 5xx/abort
      // retries on the next identify — and that next identify was suppressed. One
      // transient failure lost web→app attribution for the LIFETIME of the install.
      //
      // Unconditional is cheap and correct: the lookup is idempotent on its own
      // terms, and after a 200 the `checked` list short-circuits it before any
      // network I/O. The waste 1.7.15 removed (the request) stays removed.
      if (this.state.config.enableWebToAppAttribution !== false) {
        const email = properties?.email || (typeof userId === 'string' && userId.includes('@') ? userId : null);
        if (email) {
          await this.fetchAndMergeWebAttribution(email);
        }
      }
      // RN-9: removed a dead "Advanced Matching" block here that destructured
      // email/phone/name/dob/gender/city into locals and then discarded them (nothing
      // was forwarded). The identify traits already ship to the backend via the
      // $identify event above; the pixel-side advanced matching is handled server-side.
    } catch (error) {
      errorLog('Error identifying user:', error as Error);
    }
  }

  /**
   * Fetch web attribution data for user and merge into mobile session
   * Called automatically during identify() if email is provided
   */
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
      // promise indefinitely (identify(email) runs every session), leaking timers/sockets.
      // Mirrors the deferred-lookup 10s guard. On abort/timeout the catch leaves `checked`
      // unset, so the next identify(email) retries.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      // Call API endpoint to get web attribution
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

      // Parse the body BEFORE marking checked — a body read/parse failure (dropped
      // connection mid-body, truncated/HTML 200) would otherwise permanently suppress this
      // once-per-install lookup. On parse failure the catch logs and leaves checked unset,
      // so the next identify(email) retries.
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
      if (webAttribution.visitor_id && webAttribution.visitor_id === this.state.anonymousId) {
        debugLog('Web attribution visitor is our own visitor id — skipping bridge event');
        return;
      }

      // Merge BEFORE tracking (matches the IP/deferred path). This makes
      // $web_attribution_matched self-consistent — see createEventPayload, which spreads
      // attributionData FIRST so the explicit web-recovered fields below win over any
      // pre-existing device attribution. (Old order tracked before merging, so a device
      // with its own deep-link attribution corrupted the match event.)
      await attributionManager.mergeWebAttribution(webAttribution);

      // Emit the canonical web→app bridge event. The email/identify path and the
      // IP/deferred path BOTH fire `$web_attribution_matched`, distinguished only
      // by `match_method` — so server bridges (Meta CAPI recovery, lyr) and match
      // dashboards see one event name. (Historically this path fired a separate
      // `$web_attribution_merged` that no server reader consumed, so email-only
      // matches silently never bridged webhook conversions.)
      await this.track('$web_attribution_matched', {
        web_visitor_id: webAttribution.visitor_id,
        web_user_id: webAttribution.user_id,
        fbclid: webAttribution.fbclid,
        gclid: webAttribution.gclid,
        ttclid: webAttribution.ttclid,
        gbraid: webAttribution.gbraid,
        wbraid: webAttribution.wbraid,
        // Emit `_fbp`/`_fbc` (the Meta cookie names the attribution MV + postback extract
        // via JSONExtractString(event_data,'_fbp')) as well as the bare keys — the bare
        // `fbp`/`fbc` alone have no reader, so recovered web fbp/fbc never reached Meta CAPI.
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
      // Non-blocking - continue even if attribution fetch fails
    }
  }

  /**
   * Fetch deferred web attribution via IP-based matching, recovering attribution data
   * (fbclid, utm_*, etc.) from a prelander web visit. Called automatically during
   * initialize() while the lookup is still eligible (see
   * AttributionManager.shouldAttemptDeferredLookup).
   *
   * Every exit path either marks the lookup resolved (the server answered) or leaves it
   * eligible for a later launch (nothing reached the server / nothing usable came back).
   */
  private async fetchDeferredWebAttribution(): Promise<void> {
    if (!this.state.config?.apiKey) {
      // Not an answer from the server — a later launch with a configured key retries.
      errorLog('API key not available for deferred attribution fetch — web→app match skipped');
      return;
    }

    debugLog('Fetching deferred web attribution via IP matching...');

    // Spend the attempt before the request goes out: a request that never returns (app
    // killed mid-flight, hung connection) must still count against the bound.
    await attributionManager.recordDeferredLookupAttempt();

    // Fetched before the request so a device-info failure surfaces here, not as a
    // half-built body. getDeviceInfo() is cached after first resolution.
    const deviceFp = await getDeviceInfo().catch(() => ({
      osVersion: undefined, model: undefined, locale: undefined, timezone: undefined,
    } as any));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let response: Response;
    try {
      response = await fetch('https://api.datalyr.com/attribution/deferred-lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Datalyr-API-Key': this.state.config.apiKey,
        },
        // Device fingerprint — the exact values the click-side fp_* capture
        // approximates from the redirect request's headers. This is what opens the
        // server's tier-2 matcher (fingerprint-corroborated store clicks up to 7
        // days old); without it the server only runs the short exact-IP window.
        body: JSON.stringify({
          platform: Platform.OS,
          os_version: fingerprintOsVersion(deviceFp.osVersion),
          device_model: fingerprintDeviceModel(deviceFp.model),
          language: deviceFp.locale,
          timezone: deviceFp.timezone,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      // Transport-level failure (offline, captive portal, timeout) — the ordinary state
      // right after a store install. Nothing was answered, so the lookup stays eligible
      // and a later launch inside the match window retries it.
      errorLog('Deferred attribution lookup did not reach the server — retrying on a later launch', error as Error);
      // Still reported: a workspace whose misses are overwhelmingly `request_failed` has a
      // connectivity problem, not an attribution problem, and those need different fixes.
      await this.trackAttributionMatchOutcome(false, 'request_failed');
      return;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      // 5xx/408/429 are transient, so stay eligible. Anything else is definitive for this
      // install — a disabled route (410), a rejected key (401) or a malformed request will
      // not start working inside the server's match window.
      const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
      if (!retryable) {
        await attributionManager.markDeferredLookupResolved();
      }
      errorLog(
        `Deferred attribution lookup failed with status ${response.status}` +
        (retryable ? ' — retrying on a later launch' : ' — not retryable, no further attempts'),
      );
      return;
    }

    let result: { found: boolean; attribution?: any; reason?: string; window_minutes?: number };
    try {
      // Parse BEFORE marking resolved (same ordering as the email path): a truncated body
      // or an HTML error page served as 200 is not an answer, and must not burn the
      // install's one shot at the bridge.
      result = await response.json() as { found: boolean; attribution?: any; reason?: string; window_minutes?: number };
    } catch (error) {
      errorLog('Deferred attribution lookup returned an unparseable body — retrying on a later launch', error as Error);
      return;
    }

    // A parsed 200 is the server's definitive answer, matched or not — with ONE
    // exception: `no_candidates` inside the first hour after install may just be
    // ingest lag (click → queue → analytics store takes seconds to minutes), so it
    // stays eligible for one more launch. Every other reason is terminal — a genuine
    // "no web touch for this IP" must not re-ask forever — and the attempt cap
    // bounds the retry either way.
    const missReason = result.found === false ? (result.reason || 'no_candidates') : null;
    const installAge = attributionManager.installAgeMinutes();
    const freshNoCandidates = missReason === 'no_candidates' && installAge !== null && installAge < 60;
    if (!freshNoCandidates) {
      await attributionManager.markDeferredLookupResolved();
    }

    try {
      if (!result.found || !result.attribution) {
        // A MISS is a measurement, not a non-event. This used to be a debug log and
        // nothing else, so the only installs producing an event were the ones that
        // MATCHED — which makes the match rate (matched / attempted) uncomputable from
        // event data, and a matcher whose threshold nobody can observe is a matcher
        // nobody can tune. The server's `reason` separates no_candidates /
        // no_web_traffic / request_failed / not_enabled: four very different problems
        // that all looked identical from here.
        debugLog('No deferred web attribution found for this IP');
        await this.trackAttributionMatchOutcome(false, result.reason || 'no_candidates', {
          match_window_minutes: result.window_minutes,
        });
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
        await this.trackAttributionMatchOutcome(false, 'identity_only');
        return;
      }
      if (webAttribution.visitor_id && webAttribution.visitor_id === this.state.anonymousId) {
        debugLog('Deferred web attribution visitor is our own visitor id — skipping bridge event');
        await this.trackAttributionMatchOutcome(false, 'self_match');
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
        // Emit `_fbp`/`_fbc` (the Meta cookie names the attribution MV + postback extract
        // via JSONExtractString(event_data,'_fbp')) as well as the bare keys — the bare
        // `fbp`/`fbc` alone have no reader, so recovered web fbp/fbc never reached Meta CAPI.
        fbp: webAttribution.fbp,
        fbc: webAttribution.fbc,
        _fbp: webAttribution.fbp,
        _fbc: webAttribution.fbc,
        utm_source: webAttribution.utm_source,
        utm_medium: webAttribution.utm_medium,
        utm_campaign: webAttribution.utm_campaign,
        utm_content: webAttribution.utm_content,
        utm_term: webAttribution.utm_term,
        // Ad ENTITY ids — the rename-proof join key back to synced spend. The UTMs above
        // carry the same entities by NAME, for display.
        campaign_id: webAttribution.campaign_id,
        adset_id: webAttribution.adset_id,
        ad_id: webAttribution.ad_id,
        placement: webAttribution.placement,
        site_source_name: webAttribution.site_source_name,
        web_timestamp: webAttribution.timestamp,
        match_method: 'ip',
      });

      // Paired with the miss branches above: together these make
      // matched / (matched + missed) computable per workspace and per day.
      await this.trackAttributionMatchOutcome(true, 'matched', {
        match_candidates: webAttribution.match_candidates,
        match_score: webAttribution.match_score,
        match_confidence: webAttribution.match_confidence,
        match_window_minutes: webAttribution.match_window_minutes,
      });

      debugLog('Successfully merged deferred web attribution');

    } catch (error) {
      // The server already answered, so this is a local merge/track failure, not a reason
      // to re-ask. Non-blocking — the email-based path still runs on identify().
      errorLog('Error merging deferred web attribution:', error as Error);
    }
  }

  /**
   * Emit the outcome of one deferred web→app match attempt, matched or not.
   *
   * `$attribution_match` is deliberately separate from `$web_attribution_matched`:
   * the latter is the BRIDGE event downstream readers consume to thread web attribution
   * onto mobile conversions (ingest's lyr bridge follows it, and api/core/identity.js
   * resolves Meta CAPI recovery through it), so it must keep firing only when there IS a
   * real match to thread. This one is pure telemetry — it fires on every definitive
   * attempt, which is what turns "we matched 40 installs" into "we matched 40 of 300,
   * and 180 of the misses were no_candidates".
   */
  private async trackAttributionMatchOutcome(
    matched: boolean,
    reason: string,
    extra: Record<string, any> = {},
  ): Promise<void> {
    try {
      const data: Record<string, any> = {
        provider: 'mmp',
        match_method: 'ip',
        matched,
        reason,
      };
      for (const [k, v] of Object.entries(extra)) {
        if (v !== undefined && v !== null) data[k] = v;
      }
      await this.track('$attribution_match', data);
    } catch (error) {
      // Telemetry must never be able to break the bridge it is measuring.
      errorLog('Failed to record attribution match outcome:', error as Error);
    }
  }

  /**
   * Alias a user (connect anonymous user to known user)
   */
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
        previousId: previousId || this.state.currentUserId || this.state.anonymousId,
        visitorId: this.state.visitorId,
        anonymousId: this.state.anonymousId,  // Include for identity resolution
      };

      debugLog('Aliasing user:', aliasData);

      // Track $alias (NOT 'alias' — ingest matches only the '$alias' event name, so the
      // bare name wrote zero visitor_user_links: alias-based identity merges were dropped).
      await this.track('$alias', aliasData);

      // An explicit alias is a same-person identity merge, not an account switch. Preserve
      // this visitor's attribution graph while adopting the canonical user ID.
      await this.identifyUser(newUserId, undefined, false);

    } catch (error) {
      errorLog('Error aliasing user:', error as Error);
    }
  }

  /**
   * Reset user data (logout)
   */
  async reset(): Promise<void> {
    try {
      debugLog('Resetting user data');

      // Pre-init events do not have an identity snapshot yet; they are materialized only
      // when initialize() replays them. Drop the previous user's buffered events so an
      // identify(A) -> identify(B) switch during startup cannot replay A on B's new IDs.
      if (!this.state.initialized) {
        this.preInitQueue = [];
      }

      // Clear user data
      this.state.currentUserId = undefined;
      this.state.userProperties = {};

      // Remove from storage
      await Storage.removeItem(STORAGE_KEYS.USER_ID);
      await Storage.removeItem(STORAGE_KEYS.USER_PROPERTIES);
      // Clear the identify fingerprint so the NEXT identify after a logout /
      // account switch always re-emits (the new identity must relink).
      await Storage.removeItem(STORAGE_KEYS.LAST_IDENTITY_FINGERPRINT);

      // TR-28: wipe the previous user's attribution + journey BEFORE rotating ids. fbclid/
      // gclid/fbc/utm/lyr are spread into EVERY event via createEventPayload (feeding Meta
      // CAPI), and the journey is per-identity. Clearing FIRST means a track() that
      // interleaves reset can only ever see old-id+old-attr (pre-reset) or new-id+cleared
      // (post-rotation), NEVER new-id+old-attr (the new user credited to the old user's ad
      // click). Preserves the install marker (wiping it would re-run install tracking + the
      // deferred IP lookup next launch and re-import A's web attribution).
      await attributionManager.clearAttributionForReset();
      await journeyManager.clearJourney();

      // Rotate the anonymous ID so the next user is NOT linked to this user's anon id
      // (otherwise logout→login on one device merges both users in the identity graph and
      // the Meta CAPI bridge leaks click-ids/PII between them).
      this.state.anonymousId = await rotateAnonymousId();

      // 9.C.1: rotate the visitor ID too — it rides every event payload and is what the
      // attribution read-path resolves through, so keeping it stitches the next user's
      // events to this user's device history. (iOS reset() regenerates visitorId
      // alongside anonymousId.)
      this.state.visitorId = await rotateVisitorId();

      // Force a genuinely new session. getOrCreateSessionId() resumes any session <30min
      // old (always true at logout), so clear the stored session first — otherwise the next
      // user's events would share the previous user's session id. auto-events reads the id via
      // its getSessionId callback, so it picks up the rotation automatically (TR-28 sync).
      await clearSession();
      this.state.sessionId = await getOrCreateSessionId();

      // 9.C.1: drop the once-per-install web-attribution-checked marker. It dedupes the
      // identify(email) lookup against attribution we just wiped; leaving it would
      // permanently block re-recovery when a user re-identifies on this install
      // (logout/login, QA flows). (Mirrors iOS FSR-93.)
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

  /**
   * Flush queued events immediately
   */
  async flush(): Promise<void> {
    try {
      debugLog('Flushing events...');
      await this.eventQueue.flush();
    } catch (error) {
      errorLog('Error flushing events:', error as Error);
    }
  }

  /**
   * Get SDK status and statistics
   */
  getStatus(): {
    initialized: boolean;
    workspaceId: string;
    visitorId: string;
    anonymousId: string;
    sessionId: string;
    currentUserId?: string;
    queueStats: any;
    attribution: any;
    journey: any;
  } {
    return {
      initialized: this.state.initialized,
      workspaceId: this.state.config.workspaceId || '',
      visitorId: this.state.visitorId,
      anonymousId: this.state.anonymousId,
      sessionId: this.state.sessionId,
      currentUserId: this.state.currentUserId,
      queueStats: this.eventQueue.getStats(),
      attribution: attributionManager.getAttributionSummary(),
      journey: journeyManager.getJourneySummary(),
    };
  }

  /**
   * Get the persistent anonymous ID
   */
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

  /**
   * Set custom attribution data (for testing or manual attribution)
   */
  async setAttributionData(data: Partial<AttributionData>): Promise<void> {
    await attributionManager.setAttributionData(data);
  }

  /**
   * Get current session information from auto-events
   */
  getCurrentSession() {
    return this.autoEventsManager?.getCurrentSession() || null;
  }

  /**
   * Force end current session
   */
  async endSession(): Promise<void> {
    if (this.autoEventsManager) {
      await this.autoEventsManager.forceEndSession();
    }
  }

  /**
   * Track app update manually
   */
  async trackAppUpdate(previousVersion: string, currentVersion: string): Promise<void> {
    await this.track('app_update', {
      previous_version: previousVersion,
      current_version: currentVersion,
    });
  }

  /**
   * Update auto-events configuration
   */
  updateAutoEventsConfig(config: Partial<AutoEventConfig>): void {
    if (this.autoEventsManager) {
      this.autoEventsManager.updateConfig(config);
    }
  }

  // MARK: - SKAdNetwork Enhanced Methods

  /**
   * Track event with automatic SKAdNetwork conversion value encoding
   * Uses SKAN 4.0 on iOS 16.1+ with coarse values and lock window support
   */
  async trackWithSKAdNetwork(
    event: string,
    properties?: EventData
  ): Promise<void> {
    // Existing tracking (keep exactly as-is)
    await this.track(event, properties);

    // Automatic SKAdNetwork encoding with SKAN 4.0 support
    if (!DatalyrSDK.conversionEncoder) {
      if (!skadTemplateMissingWarned) {
        skadTemplateMissingWarned = true;
        console.warn("[Datalyr] skadTemplate not set — SKAdNetwork conversion values are disabled. Set config.skadTemplate ('ecommerce' | 'gaming' | 'subscription')");
      }
      return;
    }

    // Use SKAN 4.0 encoding (includes coarse value and lock window)
    const result = DatalyrSDK.conversionEncoder.encodeWithSKAN4(event, properties);

    if (result.fineValue > 0 || result.priority > 0) {
      // Use SKAN 4.0 method (automatically falls back to SKAN 3.0 on older iOS)
      const success = await SKAdNetworkBridge.updatePostbackConversionValue(result);

      if (DatalyrSDK.debugEnabled) {
        debugLog(`SKAN: event=${event}, fine=${result.fineValue}, coarse=${result.coarseValue}, lock=${result.lockWindow}, success=${success}`, properties);
      }
    } else if (DatalyrSDK.debugEnabled) {
      debugLog(`No conversion value generated for event: ${event}`);
    }
  }

  /**
   * Track purchase with automatic revenue encoding and platform forwarding
   */
  async trackPurchase(
    value: number,
    currency = 'USD',
    productId?: string
  ): Promise<void> {
    // Shared builder (A3-14c): value+revenue both emitted so a rule's value_path='value'
    // never yields $0; product_id + canonical content_id alias for cross-build parity.
    await this.trackWithSKAdNetwork('purchase', purchaseProperties(value, currency, productId));
  }

  /**
   * Track subscription with automatic revenue encoding and platform forwarding
   */
  async trackSubscription(
    value: number,
    currency = 'USD',
    plan?: string
  ): Promise<void> {
    // Emit BOTH `value` and `revenue` — the conversion-rule/CAPI postback value extractor
    // resolves a configured value_path (commonly `value`), while SKAN/value_usd read either;
    // sending only `revenue` risked a $0 value on rules wired to `value`. Matches the other
    // commerce helpers (trackAddToCart/etc.), which already use `value`.
    const properties: Record<string, any> = { value, revenue: value, currency };
    if (plan) properties.plan = plan;

    await this.trackWithSKAdNetwork('subscribe', properties);
  }

  // MARK: - Standard E-commerce Events

  /**
   * Track add to cart event
   */
  async trackAddToCart(
    value: number,
    currency = 'USD',
    productId?: string,
    productName?: string
  ): Promise<void> {
    // A3-14c: shared builder emits content_id/content_name (canonical) + product_id/product_name
    // (legacy alias) so bare + Expo produce one shape.
    await this.trackWithSKAdNetwork('add_to_cart', addToCartProperties(value, currency, productId, productName));
  }

  /**
   * Track view content/product event
   */
  async trackViewContent(
    contentId?: string,
    contentName?: string,
    contentType = 'product',
    value?: number,
    currency?: string
  ): Promise<void> {
    await this.track('view_content', viewContentProperties(contentId, contentName, contentType, value, currency));
  }

  /**
   * Track initiate checkout event
   */
  async trackInitiateCheckout(
    value: number,
    currency = 'USD',
    numItems?: number,
    productIds?: string[]
  ): Promise<void> {
    // A3-14c: emits content_ids (canonical) + product_ids (legacy alias).
    await this.trackWithSKAdNetwork('initiate_checkout', initiateCheckoutProperties(value, currency, numItems, productIds));
  }

  /**
   * Track complete registration event
   */
  async trackCompleteRegistration(method?: string): Promise<void> {
    // A3-14c: emits registration_method (canonical, Meta standard) + method (legacy alias).
    await this.trackWithSKAdNetwork('complete_registration', completeRegistrationProperties(method));
  }

  /**
   * Track search event
   */
  async trackSearch(query: string, resultIds?: string[]): Promise<void> {
    // A3-14c: emits search_string/content_ids (canonical) + query/result_ids (legacy alias).
    await this.track('search', searchProperties(query, resultIds));
  }

  /**
   * Track lead/contact form submission
   */
  async trackLead(value?: number, currency?: string): Promise<void> {
    await this.trackWithSKAdNetwork('lead', leadProperties(value, currency));
  }

  /**
   * Track add payment info event
   */
  async trackAddPaymentInfo(success = true): Promise<void> {
    await this.track('add_payment_info', { success });
  }

  // MARK: - Platform Integration Methods

  /**
   * Get deferred attribution data from platform SDKs
   */
  getDeferredAttributionData(): DeferredDeepLinkResult | null {
    return null;
  }

  /**
   * Get platform integration status
   */
  getPlatformIntegrationStatus(): { appleSearchAds: boolean; playInstallReferrer: boolean } {
    return {
      appleSearchAds: appleSearchAdsIntegration.isAvailable(),
      playInstallReferrer: playInstallReferrerIntegration.isAvailable(),
    };
  }

  /**
   * Get Apple Search Ads attribution data
   * Returns attribution if user installed via Apple Search Ads, null otherwise
   */
  getAppleSearchAdsAttribution(): AppleSearchAdsAttribution | null {
    return appleSearchAdsIntegration.getAttributionData();
  }

  /**
   * Get Google Play Install Referrer attribution data (Android only)
   * Returns referrer data if available, null otherwise
   */
  getPlayInstallReferrer(): Record<string, any> | null {
    const data = playInstallReferrerIntegration.getReferrerData();
    return data ? playInstallReferrerIntegration.getAttributionData() : null;
  }

  // MARK: - Third-Party Integration Methods

  /**
   * Bind a provider-side user id to this install (person contract §8).
   *
   * Call this with EXACTLY the id you hand the provider — e.g.
   * `bindProviderIdentity('revenuecat', await Purchases.getAppUserID())` or
   * `bindProviderIdentity('superwall', appUserId)` — right after configuring
   * that SDK. It emits a deterministic identity edge (install ↔
   * ext:<namespace>), so provider webhooks resolve to this person through
   * the backend registry WITHOUT depending on the datalyr_id attribute
   * forwarding, and the backend gains a real eligible/complete coverage
   * denominator for the handoff. Safe to call on every launch — the
   * backend edge write is idempotent.
   */
  async bindProviderIdentity(namespace: string, providerUserId: string): Promise<void> {
    try {
      const ns = String(namespace || '').trim().toLowerCase();
      const id = String(providerUserId || '').trim();
      if (!ns || !id) {
        errorLog(`bindProviderIdentity requires a namespace and a provider user id (got '${namespace}', '${providerUserId}')`);
        return;
      }
      if (!KNOWN_EXTERNAL_NAMESPACES.includes(ns) && !unknownNamespaceWarned.has(ns)) {
        unknownNamespaceWarned.add(ns);
        console.warn(`[Datalyr] bindProviderIdentity('${ns}'): unknown provider namespace — no Datalyr webhook joins on it, so this binding will not attribute webhook revenue. Known namespaces: ${KNOWN_EXTERNAL_NAMESPACES.join(', ')}. The event is still sent.`);
      }
      await this.track('$provider_identity_bound', {
        external_ids: { [ns]: id },
        provider_namespace: ns,
      });
    } catch (error) {
      errorLog('Error binding provider identity:', error as Error);
    }
  }

  /**
   * Get attribution data formatted for Superwall's setUserAttributes()
   * Returns a flat Record<string, string> with only non-empty values
   */
  getSuperwallAttributes(): Record<string, string> {
    const attribution = attributionManager.getAttributionData();
    const advertiser = this.cachedAdvertiserInfo;
    const attrs: Record<string, string> = {};

    const set = (key: string, value: any) => {
      if (value != null && String(value) !== '') attrs[key] = String(value);
    };

    set('datalyr_id', this.state.anonymousId); // the wire/visitor_id id, NOT visitorId (never sent)
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
    // Raw ad ENTITY ids. `campaign`/`adgroup`/`ad` above are the provider's
    // conventional keys and carry NAMES when no id is known; these are the ids
    // themselves, so a Superwall audience filter can target by ad without
    // breaking the moment a buyer renames the campaign.
    set('campaign_id', attribution.campaign_id);
    set('adset_id', attribution.adset_id);
    set('ad_id', attribution.ad_id);
    set('placement', attribution.placement);
    set('site_source_name', attribution.site_source_name);
    set('fbclid', attribution.fbclid);
    set('gclid', attribution.gclid);
    set('ttclid', attribution.ttclid);
    set('idfa', advertiser?.idfa);
    set('gaid', advertiser?.gaid);
    if (advertiser?.att_status != null) {
      const statusMap: Record<number, string> = { 0: 'notDetermined', 1: 'restricted', 2: 'denied', 3: 'authorized' };
      set('att_status', statusMap[advertiser.att_status] || String(advertiser.att_status));
    }

    return attrs;
  }

  /**
   * Get attribution data formatted for RevenueCat's Purchases.setAttributes()
   * Returns a flat Record<string, string> with $-prefixed reserved keys
   */
  getRevenueCatAttributes(): Record<string, string> {
    const attribution = attributionManager.getAttributionData();
    const advertiser = this.cachedAdvertiserInfo;
    const attrs: Record<string, string> = {};

    const set = (key: string, value: any) => {
      if (value != null && String(value) !== '') attrs[key] = String(value);
    };

    // Datalyr visitor id — CUSTOM key, deliberately un-prefixed: RevenueCat
    // reserves the `$` namespace for its own attribute vocabulary and strips
    // unknown `$` keys, so the old `$datalyrId` never reached the webhook and
    // killed the deterministic visitor-id match. The server reads `datalyr_id`
    // (webhooks/platforms/revenuecat.js).
    set('datalyr_id', this.state.anonymousId); // the wire/visitor_id id, NOT visitorId (never sent)

    // Reserved attributes ($ prefix)
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
    // Raw ad ENTITY ids alongside RevenueCat's reserved $adGroup/$ad above,
    // which carry only the ad-set/ad level. campaign_id in particular has no
    // reserved equivalent ($campaign is the NAME), so without this a
    // RevenueCat-sourced conversion could never join spend by campaign id.
    set('campaign_id', attribution.campaign_id);
    set('adset_id', attribution.adset_id);
    set('ad_id', attribution.ad_id);
    set('placement', attribution.placement);
    set('site_source_name', attribution.site_source_name);

    return attrs;
  }

  /**
   * Update tracking authorization status
   * Call this AFTER the user responds to the ATT permission dialog
   */
  async updateTrackingAuthorization(enabled: boolean): Promise<void> {
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

    // Track ATT status event
    await this.track('$att_status', {
      authorized: enabled,
      status: enabled ? 3 : 2,
      status_name: enabled ? 'authorized' : 'denied',
      att_status: enabled ? 3 : 2, // key the Meta/Snapchat postback mappers read
    });

    debugLog(`ATT status updated: ${enabled ? 'authorized' : 'denied'}`);
  }

  /**
   * Handle deferred deep link data from platform SDKs
   */
  private async handleDeferredDeepLink(data: DeferredDeepLinkResult): Promise<void> {
    try {
      debugLog('Processing deferred deep link:', data);

      // Track deferred attribution event
      await this.track('$deferred_deep_link', {
        url: data.url,
        source: data.source,
        fbclid: data.fbclid,
        ttclid: data.ttclid,
        utm_source: data.utmSource,
        utm_medium: data.utmMedium,
        utm_campaign: data.utmCampaign,
        utm_content: data.utmContent,
        utm_term: data.utmTerm,
        campaign_id: data.campaignId,
        adset_id: data.adsetId,
        ad_id: data.adId,
      });

      // Merge into attribution manager
      await attributionManager.mergeWebAttribution({
        fbclid: data.fbclid,
        ttclid: data.ttclid,
        utm_source: data.utmSource,
        utm_medium: data.utmMedium,
        utm_campaign: data.utmCampaign,
        utm_content: data.utmContent,
        utm_term: data.utmTerm,
      });

      debugLog('Deferred deep link processed successfully');
    } catch (error) {
      errorLog('Error processing deferred deep link:', error as Error);
    }
  }

  /**
   * Get conversion value for testing (doesn't send to Apple)
   */
  getConversionValue(event: string, properties?: Record<string, any>): number | null {
    return DatalyrSDK.conversionEncoder?.encode(event, properties) || null;
  }

  // MARK: - Private Methods

  /**
   * Create an event payload with all required data
   */
  private async createEventPayload(eventName: string, eventData?: EventData): Promise<EventPayload> {
    const deviceInfo = await getDeviceInfo();
    const deviceContext = await createDeviceContext();
    const attributionData = attributionManager.getAttributionData();

    // Get Apple Search Ads attribution if available
    const asaAttribution = appleSearchAdsIntegration.getAttributionData();
    const asaData = asaAttribution?.attribution ? {
      asa_attribution: true,
      asa_campaign_id: asaAttribution.campaignId,
      asa_campaign_name: asaAttribution.campaignName,
      asa_adgroup_id: asaAttribution.adGroupId,
      asa_adgroup_name: asaAttribution.adGroupName,
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

    // TR-18: honor a caller-supplied idempotency key. A non-empty string properties.event_id
    // becomes the wire eventId (the source's dedup key — e.g. a Stripe/RevenueCat webhook event
    // id for a client that double-tracks a purchase alongside a server webhook), mirroring the
    // iOS/Node semantics, and is stripped from properties so it isn't duplicated. Else a UUID.
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
      anonymousId: this.state.anonymousId,  // Include persistent anonymous ID
      sessionId: this.state.sessionId,
      eventId: callerEventId ?? generateUUID(),
      eventName,
      eventData: {
        // Auto-captured mobile data + persisted attribution are spread FIRST so the
        // caller's explicit event properties (`...eventData`, spread LAST) WIN. Previously
        // attribution was spread after eventData, silently clobbering caller-passed fields
        // like track('purchase', { utm_source: 'push' }).
        // Include anonymous_id in event data for attribution
        anonymous_id: this.state.anonymousId,
        // Auto-captured mobile data
        platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'android',
        os_version: deviceInfo.osVersion,
        device_model: deviceInfo.model,
        app_version: deviceInfo.appVersion,
        app_build: deviceInfo.buildNumber,
        app_name: deviceInfo.bundleId,  // Best available app name
        app_namespace: deviceInfo.bundleId,
        screen_width: deviceInfo.screenWidth,
        screen_height: deviceInfo.screenHeight,
        locale: deviceInfo.locale,
        timezone: deviceInfo.timezone,
        // ISO-3166-1 alpha-2 derived from device locale ('en-US' → 'US'). For
        // users who skip the web lander entirely (no web→app bridge to inherit
        // geo from), this is the only zero-config country signal — meta.js
        // USER_DATA_PATHS.country picks it up at the top level and hashes for
        // CAPI's `country` match key. Bridge-recovered geo still overrides
        // when present (server-side spread order).
        country: deriveCountryFromLocale(deviceInfo.locale) || undefined,
        carrier: deviceInfo.carrier,
        network_type: getNetworkType(),
        sdk_version: SDK_VERSION,
        schema_version: 1, // A3-25: versioned-envelope stamp (see web SDK)
        // Advertiser data (IDFA/GAID, ATT status) for server-side postback
        ...(advertiserInfo ? {
          idfa: advertiserInfo.idfa,
          idfv: advertiserInfo.idfv,
          gaid: advertiserInfo.gaid,
          att_status: advertiserInfo.att_status,
          advertiser_tracking_enabled: advertiserInfo.advertiser_tracking_enabled,
        } : {}),
        // Attribution data
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
    // link builder requires it truthy (`if (previousId && userId ...)`). Resolve it at
    // payload-creation time (post-init, so visitorId is populated).
    if (eventName === '$alias' && payload.eventData && !payload.eventData.previousId && (this.state.currentUserId || this.state.anonymousId)) {
      payload.eventData.previousId = this.state.currentUserId || this.state.anonymousId;
    }

    if (Object.keys(this.state.userProperties).length > 0) {
      payload.userProperties = this.state.userProperties;
    }

    return payload;
  }

  /**
   * Load persisted user data
   */
  private async loadPersistedUserData(): Promise<void> {
    try {
      const [userId, userProperties] = await Promise.all([
        Storage.getItem<string>(STORAGE_KEYS.USER_ID),
        Storage.getItem<UserProperties>(STORAGE_KEYS.USER_PROPERTIES),
      ]);

      // Only restore the persisted user when an identify() hasn't ALREADY set one. This
      // load runs concurrently in initialize()'s Promise.all; an app that calls
      // initialize() without awaiting and then identify(B) mid-init would otherwise have
      // the previous launch's persisted user A clobber B (and the replayed $identify(B)
      // would silently become A). Don't overwrite a live identity.
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

  /**
   * Persist user data to storage
   */
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

  /**
   * Initialize network status monitoring
   * Automatically updates event queue when network status changes
   */
  private async initializeNetworkMonitoring(): Promise<void> {
    try {
      await networkStatusManager.initialize();

      // Update event queue with current network status
      this.state.isOnline = networkStatusManager.isOnline();
      this.eventQueue.setOnlineStatus(this.state.isOnline);

      // Subscribe to network changes
      this.networkStatusUnsubscribe = networkStatusManager.subscribe((state) => {
        const isOnline = state.isConnected && (state.isInternetReachable !== false);
        this.state.isOnline = isOnline;
        this.eventQueue.setOnlineStatus(isOnline);

        // Track network status change event (only if SDK is fully initialized)
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
      // Default to online if monitoring fails
      this.state.isOnline = true;
      this.eventQueue.setOnlineStatus(true);
    }
  }

  /**
   * Set up app state monitoring for lifecycle events (optimized)
   */
  private setupAppStateMonitoring(): void {
    try {
      // Listen for app state changes (without tracking every change)
      this.appStateSubscription = AppState.addEventListener('change', async (nextAppState) => {
        debugLog('App state changed:', nextAppState);

        // Only handle meaningful state changes for session management
        if (nextAppState === 'background') {
          // Flush events before going to background
          this.flush();
          // Notify auto-events manager for session handling
          if (this.autoEventsManager) {
            this.autoEventsManager.handleAppBackground();
          }
        } else if (nextAppState === 'active') {
          // TR-19: AWAIT the session refresh BEFORE notifying auto-events. Running them
          // concurrently (unawaited) raced: on a genuine expiry, session_start could emit with
          // the OLD id while subsequent events carried the NEW one. Awaiting rotates
          // this.state.sessionId first, so session_start + everything after share the new id.
          await this.refreshSession();
          // Refresh network status when coming back from background
          networkStatusManager.refresh();
          // Notify auto-events manager for session handling
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
   * Refresh session if needed
   */
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

  /**
   * Cleanup and destroy the SDK
   */
  destroy(): void {
    try {
      debugLog('Destroying Datalyr SDK');

      // Remove app state listener
      if (this.appStateSubscription) {
        this.appStateSubscription.remove();
        this.appStateSubscription = null;
      }

      // Remove network status listener
      if (this.networkStatusUnsubscribe) {
        this.networkStatusUnsubscribe();
        this.networkStatusUnsubscribe = null;
      }

      // Destroy network status manager
      networkStatusManager.destroy();

      // Tear down attribution + auto-events so destroy()→initialize() doesn't leak the old
      // Linking 'url' subscription / session timers and a fresh init can re-listen.
      attributionManager.destroy();
      if (this.autoEventsManager) {
        this.autoEventsManager.destroy();
        this.autoEventsManager = null;
      }

      // Destroy event queue
      this.eventQueue.destroy();

      // Reset state. `initializing` MUST be cleared too, or a subsequent initialize()
      // hits the idempotent guard and the SDK never re-initializes (silent total loss).
      this.state.initialized = false;
      this.initializing = false;

      debugLog('Datalyr SDK destroyed');

    } catch (error) {
      errorLog('Error destroying SDK:', error as Error);
    }
  }
}

// Create singleton instance
const datalyr = new DatalyrSDK();

// Export enhanced Datalyr class with static methods
export class Datalyr {
  /**
   * Initialize Datalyr with SKAdNetwork conversion value encoding
   */
  static async initialize(config: DatalyrConfig): Promise<void> {
    await datalyr.initialize(config);
  }

  /**
   * Track event with automatic SKAdNetwork conversion value encoding
   */
  static async trackWithSKAdNetwork(
    event: string, 
    properties?: Record<string, any>
  ): Promise<void> {
    await datalyr.trackWithSKAdNetwork(event, properties);
  }

  /**
   * Track purchase with automatic revenue encoding
   */
  static async trackPurchase(
    value: number, 
    currency = 'USD', 
    productId?: string
  ): Promise<void> {
    await datalyr.trackPurchase(value, currency, productId);
  }

  /**
   * Track subscription with automatic revenue encoding
   */
  static async trackSubscription(
    value: number, 
    currency = 'USD', 
    plan?: string
  ): Promise<void> {
    await datalyr.trackSubscription(value, currency, plan);
  }

  /**
   * Get conversion value for testing (doesn't send to Apple)
   */
  static getConversionValue(event: string, properties?: Record<string, any>): number | null {
    return datalyr.getConversionValue(event, properties);
  }

  // Standard SDK methods
  static async track(eventName: string, eventData?: EventData): Promise<void> {
    await datalyr.track(eventName, eventData);
  }

  static async screen(screenName: string, properties?: EventData): Promise<void> {
    await datalyr.screen(screenName, properties);
  }

  static async identify(userId: string, properties?: UserProperties): Promise<void> {
    await datalyr.identify(userId, properties);
  }

  static async alias(newUserId: string, previousId?: string): Promise<void> {
    await datalyr.alias(newUserId, previousId);
  }

  static async bindProviderIdentity(namespace: string, providerUserId: string): Promise<void> {
    await datalyr.bindProviderIdentity(namespace, providerUserId);
  }

  static async reset(): Promise<void> {
    await datalyr.reset();
  }

  static async flush(): Promise<void> {
    await datalyr.flush();
  }

  static getStatus() {
    return datalyr.getStatus();
  }

  static getAnonymousId(): string {
    return datalyr.getAnonymousId();
  }

  static getAttributionData(): AttributionData {
    return datalyr.getAttributionData();
  }

  static async setAttributionData(data: Partial<AttributionData>): Promise<void> {
    await datalyr.setAttributionData(data);
  }

  static getCurrentSession() {
    return datalyr.getCurrentSession();
  }

  static async endSession(): Promise<void> {
    await datalyr.endSession();
  }

  static async trackAppUpdate(previousVersion: string, currentVersion: string): Promise<void> {
    await datalyr.trackAppUpdate(previousVersion, currentVersion);
  }

  static updateAutoEventsConfig(config: Partial<AutoEventConfig>): void {
    datalyr.updateAutoEventsConfig(config);
  }

  // Standard e-commerce events
  static async trackAddToCart(
    value: number,
    currency = 'USD',
    productId?: string,
    productName?: string
  ): Promise<void> {
    await datalyr.trackAddToCart(value, currency, productId, productName);
  }

  static async trackViewContent(
    contentId?: string,
    contentName?: string,
    contentType = 'product',
    value?: number,
    currency?: string
  ): Promise<void> {
    await datalyr.trackViewContent(contentId, contentName, contentType, value, currency);
  }

  static async trackInitiateCheckout(
    value: number,
    currency = 'USD',
    numItems?: number,
    productIds?: string[]
  ): Promise<void> {
    await datalyr.trackInitiateCheckout(value, currency, numItems, productIds);
  }

  static async trackCompleteRegistration(method?: string): Promise<void> {
    await datalyr.trackCompleteRegistration(method);
  }

  static async trackSearch(query: string, resultIds?: string[]): Promise<void> {
    await datalyr.trackSearch(query, resultIds);
  }

  static async trackLead(value?: number, currency?: string): Promise<void> {
    await datalyr.trackLead(value, currency);
  }

  static async trackAddPaymentInfo(success = true): Promise<void> {
    await datalyr.trackAddPaymentInfo(success);
  }

  // Platform integration methods
  static getDeferredAttributionData(): DeferredDeepLinkResult | null {
    return datalyr.getDeferredAttributionData();
  }

  static getPlatformIntegrationStatus(): { appleSearchAds: boolean; playInstallReferrer: boolean } {
    return datalyr.getPlatformIntegrationStatus();
  }

  static getAppleSearchAdsAttribution(): AppleSearchAdsAttribution | null {
    return datalyr.getAppleSearchAdsAttribution();
  }

  static async updateTrackingAuthorization(enabled: boolean): Promise<void> {
    await datalyr.updateTrackingAuthorization(enabled);
  }

  // Third-party integration methods

  static getSuperwallAttributes(): Record<string, string> {
    return datalyr.getSuperwallAttributes();
  }

  static getRevenueCatAttributes(): Record<string, string> {
    return datalyr.getRevenueCatAttributes();
  }
}

// Export default instance for backward compatibility
export default datalyr;
