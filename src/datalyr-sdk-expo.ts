/**
 * Expo-specific SDK implementation
 * This module re-exports the main SDK but configured to use Expo utilities
 */

import { Platform, AppState } from 'react-native';
import {
  DatalyrConfig,
  EventData,
  UserProperties,
  IdentifyOptions,
  ProviderAttributesHandler,
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
import { warnAboutIgnoredOptions, deviceOsVersion, deviceModelName } from './utils';
import {
  purchaseProperties,
  addToCartProperties,
  viewContentProperties,
  initiateCheckoutProperties,
  completeRegistrationProperties,
  searchProperties,
  leadProperties,
} from './ecommerce-properties';  // shared with bare build — single source of truth (A3-14c)
import { SDK_VERSION } from './version';
import { createHttpClient, HttpClient, utf8ByteLength } from './http-client';
import { createEventQueue, EventQueue } from './event-queue';
import { attributionManager, AttributionData, presentWebMatchIds, primaryClickIdType, attributionForEvent, removeAppUserIdsUnlessAuthorized, attStatusFrom, ATT_STATUS_NAMES, ATT_NOT_AUTHORIZED_REASON } from './attribution';
import { journeyManager } from './journey';
import { createAutoEventsManager, AutoEventsManager } from './auto-events';
import { ConversionValueEncoder, ConversionTemplates } from './ConversionValueEncoder';
import { SKAdNetworkBridge } from './native/SKAdNetworkBridge';
import { appleSearchAdsIntegration, playInstallReferrerIntegration } from './integrations';
import { DeferredDeepLinkResult } from './types';
import { AppleSearchAdsAttribution, AdvertiserInfoBridge, isNativeModuleAvailable } from './native/DatalyrNativeBridge';
import { networkStatusManager } from './network-status';
// Provider namespaces the server's webhooks join on `external_ids` (one list shared by
// both entry points; MUST match the server's person-contract.js).
import { KNOWN_EXTERNAL_NAMESPACES } from './provider-namespaces';
import { PROVISIONAL_MARKER, provisionalFlagFor, isProvisionalFlagFor } from './provisional-identity';

// Largest serialized `eventData` accepted by track(). Ingest answers 413 above its body
// cap; dropping here (with a loud log) beats a queued event that can never deliver.
const MAX_EVENT_DATA_BYTES = 200_000;

// Once-per-process warning latches (unconditional console.warn, not debug-gated).
let skadTemplateMissingWarned = false;
let nativeModulesMissingWarned = false;
const unknownNamespaceWarned = new Set<string>();

// Once-per-install dedupe marker for the identify(email) web-attribution lookup. Module
// const (not a local in fetchAndMergeWebAttribution) so reset() can drop it — 9.C.1.
const WEB_ATTRIBUTION_CHECKED_KEY = 'datalyr_web_attribution_checked';

export class DatalyrSDKExpo {
  private state: SDKState;
  private httpClient: HttpClient;
  private eventQueue: EventQueue;
  private autoEventsManager: AutoEventsManager | null = null;
  private appStateSubscription: any = null;
  // The deferred lookup currently running, so the launch run, an ATT grant and a
  // foreground never issue overlapping requests.
  private deferredLookupInFlight: Promise<void> | null = null;
  // The last lookup this launch was declined with att_not_authorized: re-run it when
  // ATT becomes authorized.
  private deferredLookupAwaitingAtt = false;
  // `$attribution_match` with reason att_not_authorized is reported once per launch.
  private attNotAuthorizedReported = false;
  private networkStatusUnsubscribe: (() => void) | null = null;
  private cachedAdvertiserInfo: any = null;
  private initializing: boolean = false;
  private static conversionEncoder?: ConversionValueEncoder;
  private static debugEnabled = false;
  /** Events that arrived before initialize() completed. Flushed once init finishes. */
  private preInitQueue: Array<{ eventName: string; eventData?: EventData }> = [];
  /**
   * The current user id is the app's provisional (pre-login) id, not a signed-in
   * account. Persisted (STORAGE_KEYS.USER_ID_PROVISIONAL) with the user id.
   */
  private currentUserProvisional = false;
  /**
   * $identify payloads the SDK itself marked provisional. The marker is SDK-owned:
   * createEventPayload strips a caller-set `$provisional_user_id` and keeps it only for
   * the current provisional user or for these objects (a pre-init $identify is replayed
   * after a later real identify may have replaced the guest id).
   */
  private provisionalIdentifyPayloads = new WeakSet<object>();
  /**
   * Handlers registered by syncRevenueCatAttributes / syncSuperwallAttributes. Each
   * registration gets its own token, so an old unsubscribe never removes a newer one.
   */
  private providerAttributeHandlers: {
    revenuecat?: { handler: ProviderAttributesHandler; token: object };
    superwall?: { handler: ProviderAttributesHandler; token: object };
  } = {};
  /** A push is already scheduled for this provider (coalesces one operation's pushes). */
  private providerAttributePushScheduled = { revenuecat: false, superwall: false };
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

      // DEP-01: surface options that are accepted and then ignored.
      warnAboutIgnoredOptions(config as Record<string, any>);

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

      // RN-22 / RN-24: must run BEFORE id creation — detectInstall()'s upgrade
      // guard uses @datalyr/visitor_id etc. as evidence of a prior install, so
      // reading it after the lines below would see this launch's own fresh id.
      attributionManager.setDeepLinkHandler((params, url) => {
        void this.track('$deep_link', { ...params, deep_link_url: url, source: 'deep_link' });
      });
      await attributionManager.detectInstall({ existingUserHint: this.state.config.existingUserHint });

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
      // Any click id counts (was fbclid/gclid only), so a bare ?li_fat_id= / ?ttclid= /
      // ?aleid= link records a touch. alart is an app-user id, not a click.
      // Fresh only (port of iOS FSR-34): attribution persists forever, so recording it on
      // every cold start appended a duplicate touchpoint and rolled the 90-day last-touch
      // expiry forward each launch. Record only when the capture time is newer than the last
      // recorded touch; 0 (persisted before this field existed) counts as not new.
      const capturedAt = initialAttribution.attribution_captured_at || 0;
      const lastTouchCapturedAt = journeyManager.getLastTouch()?.captured_at || 0;
      const isNewAttribution = capturedAt > 0 && capturedAt > lastTouchCapturedAt;
      if (isNewAttribution && (initialAttribution.utm_source || primaryClickIdType(initialAttribution) || initialAttribution.lyr)) {
        await journeyManager.recordAttribution(this.state.sessionId, {
          source: initialAttribution.utm_source || initialAttribution.campaign_source,
          medium: initialAttribution.utm_medium || initialAttribution.campaign_medium,
          campaign: initialAttribution.utm_campaign || initialAttribution.campaign_name,
          fbclid: initialAttribution.fbclid,
          gclid: initialAttribution.gclid,
          ttclid: initialAttribution.ttclid,
          gbraid: initialAttribution.gbraid,
          wbraid: initialAttribution.wbraid,
          twclid: initialAttribution.twclid,
          li_fat_id: initialAttribution.li_fat_id,
          sclid: initialAttribution.sclid,
          aleid: initialAttribution.aleid,
          // Every click id gets a type (was fbclid/gclid/ttclid only); those three keep
          // their precedence. Order lives in CLICK_ID_PRIMARY_ORDER (attribution.ts).
          clickIdType: primaryClickIdType(initialAttribution),
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

      // iOS: attempt deferred web-to-app attribution via IP matching, before app_install so
      // the recovered click-ids ride on it.
      //
      // Gated on the lookup not having been ANSWERED yet, not on isInstall(): the
      // first-launch flag is spent by the launch that observed the install whether or not
      // the request ever reached the server, so an offline cold start — the ordinary state
      // right after a store install — permanently forfeited the only web→app bridge.
      // shouldAttemptDeferredLookup() bounds the retries by the server's match window and
      // an attempt cap.
      await this.runDeferredLookupIfEligible();

      if (attributionManager.isExistingUserFirstLaunch()) {
        // Not an install: an existing user's first launch of a build with the SDK (1.8.0).
        // Its own event, so no install rule, count or export picks it up; it carries no
        // click ids or install attribution (an old install's click is not this launch's).
        await this.track('$sdk_first_launch_existing', {
          platform: Platform.OS,
          sdk_version: SDK_VERSION,
          first_sdk_launch_time: new Date().toISOString(),
          ...(attributionManager.getInstallClassification() ?? {}),
        });
        await attributionManager.markInstallTracked();
      } else if (attributionManager.isInstall()) {
        const installData = await attributionManager.trackInstall();
        await this.track('app_install', {
          platform: Platform.OS,
          sdk_version: SDK_VERSION,
          sdk_variant: 'expo',
          ...installData,
          ...(attributionManager.getInstallClassification() ?? {}),
        });
        // TR-21: commit the first-launch marker only AFTER app_install is durably enqueued.
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

      // Handlers registered before initialize() finished get their first push now (ids
      // and any deferred web attribution are in place).
      this.notifyProviderAttributeHandlers();

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

  /**
   * Identify a user.
   *
   * Pass `{ provisional: true }` when `userId` is the app's own pre-login (guest) id
   * rather than a signed-in account. A provisional id is ignored while a signed-in user
   * is current, every event sent while it is current carries
   * `$provisional_user_id: true`, and the next identify() with a real id replaces it
   * without the account-switch reset (same person, same install).
   */
  async identify(userId: string, properties?: UserProperties, options?: IdentifyOptions): Promise<void> {
    await this.identifyUser(userId, properties, true, options?.provisional === true);
  }

  /**
   * Apply an identity transition. Public identify() treats a different known ID as an
   * account switch; alias() deliberately links two IDs for the same person and opts out.
   */
  private async identifyUser(
    userId: string,
    properties: UserProperties | undefined,
    resetOnAccountSwitch: boolean,
    provisional = false,
  ): Promise<void> {
    try {
      if (!userId || typeof userId !== 'string') {
        errorLog(`Invalid user ID for identify: ${userId}`);
        return;
      }

      debugLog('Identifying user:', { userId, properties, provisional });

      // A provisional (pre-login) id never overrides a signed-in account and never
      // triggers the account-switch reset: apps re-send their guest id on every launch.
      if (provisional && await this.hasSignedInUser()) {
        debugLog('Ignoring provisional identify: a signed-in user is current', userId);
        return;
      }
      // Re-check after the await: a real identify() issued meanwhile (not awaited by
      // the app) may have made a signed-in user current.
      if (provisional && this.state.currentUserId && !this.currentUserProvisional) {
        debugLog('Ignoring provisional identify: a signed-in user is current', userId);
        return;
      }

      // Match the bare RN entrypoint: a direct identify(A) -> identify(B) transition is
      // an implicit logout, so B cannot inherit A's visitor graph or click attribution.
      // Not from a provisional id: provisional -> real and provisional -> provisional are
      // the same person on the same install (server §2.10), so there is nothing to reset.
      // A provisional identify never resets.
      let didReset = false;
      if (
        resetOnAccountSwitch &&
        !provisional &&
        this.state.currentUserId &&
        this.state.currentUserId !== userId &&
        !this.currentUserProvisional
      ) {
        // The provider push for this switch happens once, at the end of identify().
        await this.resetUser(false);
        didReset = true;
      }

      this.state.currentUserId = userId;
      this.currentUserProvisional = provisional;
      this.state.userProperties = { ...this.state.userProperties, ...properties };

      // Redundant-identify suppression: identify() is host-app-driven and apps
      // commonly call it every launch/screen. Re-emitting $identify and re-running
      // the web-attribution lookup for an UNCHANGED identity teaches the server
      // nothing. Measured 2026-07-25: 6.8 identifies/visitor/day on shipped
      // builds, worst single user 129 in 24h. The identity hash includes the visitor id
      // so a rotation (reset/new install) always re-emits and links are never lost.
      // RN-23: HASH the identity — never persist the raw identity.
      //
      // The 1.7.15 version stored this string verbatim in plaintext AsyncStorage,
      // which meant the suppression feature itself wrote PII at rest:
      //   visitor123|user@example.com|email=user@example.com&phone=+15551234
      // iOS hashes with SHA-256 and the web SDK hashes with FNV-1a for exactly
      // this reason; RN was the outlier. The value is only ever compared for
      // equality, so a non-cryptographic digest is sufficient — and `identify()`
      // is synchronous here, so an async WebCrypto-style digest is not an option.
      const identityHash = this.stableEmailHash(
        `${this.state.visitorId}|${userId}|${
          properties ? Object.keys(properties).sort().map((k) => `${k}=${String((properties as Record<string, unknown>)[k])}`).join('&') : ''
        }${
          // Provisional ids hash differently (appended only for them, so a real user's
          // hash is unchanged across the upgrade and does not re-emit).
          provisional ? '|provisional' : ''
        }`,
      );
      const previousIdentityHash = await Storage.getItem(STORAGE_KEYS.LAST_IDENTITY_HASH);
      const isRedundantIdentify = previousIdentityHash === identityHash;

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

      if (isRedundantIdentify) {
        debugLog('Skipping redundant identify (unchanged identity):', userId);
      } else {
        await Storage.setItem(STORAGE_KEYS.LAST_IDENTITY_HASH, identityHash);

        const identifyData: EventData = {
          userId,
          anonymous_id: this.state.anonymousId,
          ...props,
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          ...(firstName ? { first_name: firstName } : {}),
          ...(lastName ? { last_name: lastName } : {}),
        };
        // The marker is SDK-owned (createEventPayload); a caller-passed one is dropped.
        delete identifyData[PROVISIONAL_MARKER];
        // A $identify buffered before initialize() is materialized at replay, when a
        // later real identify may have replaced this provisional user: remember that
        // the SDK marked this payload.
        if (provisional) this.provisionalIdentifyPayloads.add(identifyData);
        await this.track('$identify', identifyData);
      }

      // Fetch and merge web attribution if email is provided.
      //
      // RN-19: runs on EVERY identify — redundant or not — and must stay OUTSIDE
      // the suppression branch above. 1.7.15 returned early on a redundant
      // identify, putting this out of reach: fetchAndMergeWebAttribution marks an
      // email hash checked ONLY after a definitive 200, precisely so a transient
      // 5xx/abort retries on the next identify — and that next identify was
      // suppressed. One transient failure lost web→app attribution for the
      // LIFETIME of the install. Kept in lockstep with datalyr-sdk.ts.
      let webAttributionMerged = false;
      if (this.state.config.enableWebToAppAttribution !== false) {
        const email = properties?.email || (typeof userId === 'string' && userId.includes('@') ? userId : null);
        if (email) {
          webAttributionMerged = await this.fetchAndMergeWebAttribution(email);
        }
      }

      // One provider push per identify, after the web-attribution merge: when the
      // account-switch reset ran, when $identify was sent, or when attribution merged.
      if (didReset || !isRedundantIdentify || webAttributionMerged) {
        this.notifyProviderAttributeHandlers();
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

  private async fetchAndMergeWebAttribution(email: string): Promise<boolean> {
    let merged = false;
    try {
      // Web→app attribution is a one-time, install-time fact — resolve it AT MOST
      // ONCE per email per install. Apps call identify(email) every session; without
      // this, each one re-fires /attribution/lookup (~100k/day from a single app,
      // 99.7% misses). Skip if we've already definitively resolved/checked this email.
      const emailHash = this.stableEmailHash(email);
      const checked = (await Storage.getItem<string[]>(WEB_ATTRIBUTION_CHECKED_KEY)) || [];
      if (checked.includes(emailHash)) {
        debugLog('Web attribution already checked this install for this email; skipping lookup');
        return false;
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
        return false; // transient/non-200 — don't mark checked, retry on next identify
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
        return false;
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
        return false;
      }
      if (webAttribution.visitor_id && webAttribution.visitor_id === this.state.anonymousId) {
        debugLog('Web attribution visitor is our own visitor id — skipping bridge event');
        return false;
      }

      // Merge BEFORE tracking (matches the IP/deferred path), so $web_attribution_matched
      // is self-consistent — createEventPayload spreads attributionData first and the
      // explicit web fields below win. (Old order tracked before merging.)
      await attributionManager.mergeWebAttribution(webAttribution);
      merged = true;

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
        // twclid / li_fat_id / sclid / aleid (+ alart), only when present (see presentWebMatchIds).
        ...presentWebMatchIds(webAttribution),
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
    return merged;
  }

  /**
   * Fetch deferred web attribution via IP-based matching, recovering attribution data
   * (fbclid, utm_*, etc.) from a prelander web visit. Called automatically during
   * initialize() on iOS while the lookup is still eligible (see
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

    // The server matches iOS installs only with ATT authorized when the workspace asks
    // for that, so send the status as it is now: read from the native module, not the
    // launch-time cache (the prompt may have been answered since). Omitted off iOS.
    await this.refreshAdvertiserInfo();
    const attStatus = Platform.OS === 'ios' ? attStatusFrom(this.cachedAdvertiserInfo) : undefined;
    this.deferredLookupAwaitingAtt = false;

    // Without the native module (Expo Go, missing pods) the status is unknown and can
    // never read as authorized. Once the server has declined such a lookup for ATT, stop
    // asking while that is still the case; the flag clears when the module is present.
    if (Platform.OS === 'ios') {
      if (attStatus === undefined) {
        if (await Storage.getItem<boolean>(STORAGE_KEYS.DEFERRED_LOOKUP_NEEDS_ATT_STATUS)) {
          debugLog('Deferred lookup skipped: needs ATT authorization, and the ATT status is unavailable');
          return;
        }
      } else {
        await Storage.removeItem(STORAGE_KEYS.DEFERRED_LOOKUP_NEEDS_ATT_STATUS);
      }
    }

    // Spend the attempt before the request goes out: a request that never returns (app
    // killed mid-flight, hung connection) must still count against the bound.
    await attributionManager.recordDeferredLookupAttempt();

    // Fetched before the request so a device-info failure surfaces here, not as a
    // half-built body. getDeviceInfo() is cached after first resolution.
    const deviceSignals = await getDeviceInfo().catch(() => ({
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
          'X-Datalyr-API-Key': this.state.config.apiKey!,
        },
        // Device signals — the exact values the click-side fp_* capture
        // approximates from the redirect request's headers. This is what opens the
        // server's tier-2 matcher (device-signal-corroborated store clicks up to 7
        // days old); without it the server only runs the short exact-IP window.
        body: JSON.stringify({
          platform: Platform.OS,
          os_version: deviceOsVersion(deviceSignals.osVersion),
          device_model: deviceModelName(deviceSignals.model),
          language: deviceSignals.locale,
          timezone: deviceSignals.timezone,
          ...(attStatus !== undefined ? { att_status: attStatus } : {}),
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

    // `att_not_authorized` is not an answer about the match: the workspace matches iOS
    // installs only with ATT authorized, and it is not. Give the attempt back, stay
    // eligible, and re-run when ATT is granted (updateTrackingAuthorization or the next
    // foreground). Reported once per launch so a relaunch loop can't flood the event.
    if (result.found === false && result.reason === ATT_NOT_AUTHORIZED_REASON) {
      await attributionManager.refundDeferredLookupAttempt();
      this.deferredLookupAwaitingAtt = true;
      if (attStatus === undefined) {
        await Storage.setItem(STORAGE_KEYS.DEFERRED_LOOKUP_NEEDS_ATT_STATUS, true);
      }
      debugLog('Deferred lookup needs ATT authorization — retrying after it is granted');
      if (!this.attNotAuthorizedReported) {
        this.attNotAuthorizedReported = true;
        await this.trackAttributionMatchOutcome(false, ATT_NOT_AUTHORIZED_REASON);
      }
      return;
    }

    // Any other parsed 200 is the server's definitive answer, matched or not — with ONE
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
        // twclid / li_fat_id / sclid / aleid (+ alart), only when present (see presentWebMatchIds).
        ...presentWebMatchIds(webAttribution),
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
   * Run the deferred lookup if it is still eligible (iOS only; inside the match window,
   * not answered, attempts left). Only one runs at a time: a call while one is in flight
   * joins it instead of issuing a second request.
   */
  private runDeferredLookupIfEligible(): Promise<void> {
    if (Platform.OS !== 'ios') return Promise.resolve();
    if (this.deferredLookupInFlight) return this.deferredLookupInFlight;
    const run = (async () => {
      try {
        if (await attributionManager.shouldAttemptDeferredLookup()) {
          await this.fetchDeferredWebAttribution();
        }
      } catch (error) {
        errorLog('Deferred attribution lookup failed:', error as Error);
      } finally {
        this.deferredLookupInFlight = null;
      }
    })();
    this.deferredLookupInFlight = run;
    return run;
  }

  /**
   * After a fresh ATT status read: if ATT is now authorized and this launch's lookup was
   * declined for lack of it (att_not_authorized), run the lookup again (subject to the
   * usual eligibility). Only after such a decline: any other open state (an ingest-lag
   * no_candidates, a failed request) keeps its own retry on a later launch. A lookup
   * already in flight may have been sent before the grant, so it finishes first.
   */
  private async rerunDeferredLookupIfAttGranted(): Promise<void> {
    if (Platform.OS !== 'ios' || !this.state.initialized) return;
    if (attStatusFrom(this.cachedAdvertiserInfo) !== 3) return;
    if (this.deferredLookupInFlight) {
      await this.deferredLookupInFlight;
    }
    if (!this.deferredLookupAwaitingAtt) return;
    await this.runDeferredLookupIfEligible();
  }

  /** Re-read IDFA/IDFV/ATT status from the native module into the cache. */
  private async refreshAdvertiserInfo(): Promise<void> {
    try {
      this.cachedAdvertiserInfo = await AdvertiserInfoBridge.getAdvertiserInfo();
    } catch (error) {
      errorLog('Failed to refresh advertiser info:', error as Error);
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

  async alias(newUserId: string, previousId?: string): Promise<void> {
    try {
      if (!newUserId || typeof newUserId !== 'string') {
        errorLog(`Invalid user ID for alias: ${newUserId}`);
        return;
      }

      // A provisional (pre-login) id is not an account to alias from: the server
      // treats any `$alias` as an unconditional merge, while the guest→account
      // join must go through its §2.10 guards. Signing in from a guest is a
      // plain identify (same install, no reset, no `$alias`).
      if (!previousId && this.state.currentUserId && this.currentUserProvisional) {
        await this.identify(newUserId);
        return;
      }

      const aliasData = {
        newUserId,
        // ingest's $alias link builder reads camelCase `userId`/`previousId`; `newUserId`
        // alone wrote no link. Emit `userId` too. (Event name must be `$alias`, below.)
        userId: newUserId,
        previousId: previousId || this.state.currentUserId || this.state.anonymousId,
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
    await this.resetUser(true);
  }

  /** reset(); `notifyProviders: false` when the caller (identify) pushes once itself. */
  private async resetUser(notifyProviders: boolean): Promise<void> {
    try {
      debugLog('Resetting user data');

      // Pre-init events do not have an identity snapshot yet; they are materialized only
      // when initialize() replays them. Drop the previous user's buffered events so an
      // identify(A) -> identify(B) switch during startup cannot replay A on B's new IDs.
      if (!this.state.initialized) {
        this.preInitQueue = [];
      }

      this.state.currentUserId = undefined;
      this.currentUserProvisional = false;
      this.state.userProperties = {};

      await Storage.removeItem(STORAGE_KEYS.USER_ID);
      await Storage.removeItem(STORAGE_KEYS.USER_PROPERTIES);
      await Storage.removeItem(STORAGE_KEYS.USER_ID_PROVISIONAL);
      // Clear the identify hash so the NEXT identify after a logout /
      // account switch always re-emits (the new identity must relink).
      await Storage.removeItem(STORAGE_KEYS.LAST_IDENTITY_HASH);

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

      // The anonymous id (datalyr_id) just rotated: re-push it to RevenueCat / Superwall.
      if (notifyProviders) this.notifyProviderAttributeHandlers();

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
      if (!skadTemplateMissingWarned) {
        skadTemplateMissingWarned = true;
        console.warn("[Datalyr] skadTemplate not set — SKAdNetwork conversion values are disabled. Set config.skadTemplate ('ecommerce' | 'gaming' | 'subscription')");
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
   * Bind a provider-side user id to this install (person contract §8).
   * Mirror of datalyr-sdk.ts — call with exactly the id you hand the
   * provider (RevenueCat appUserID, Superwall appUserId). Idempotent.
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
      this.notifyProviderAttributeHandlers();
    } catch (error) {
      errorLog('Error binding provider identity:', error as Error);
    }
  }

  /**
   * Keep RevenueCat's attributes in sync with DATALYR. The handler receives
   * getRevenueCatAttributes() once initialize() has finished and again, once per
   * operation, after: every reset(); an identify() that sent $identify, ran the
   * account-switch reset, or merged web attribution; bindProviderIdentity(). Calls run
   * on a microtask after the operation completes. Registering again replaces the
   * previous handler. Handler errors are caught and logged.
   *
   * ```ts
   * Datalyr.syncRevenueCatAttributes((attrs) => Purchases.setAttributes(attrs));
   * ```
   *
   * Login order: `Purchases.logIn(id)` FIRST, then `Datalyr.identify(id)`. identify()
   * pushes; called first, the push lands on the previous RevenueCat user.
   *
   * Logout order: `Purchases.logOut()` FIRST, then `Datalyr.reset()`. reset() pushes
   * the new `datalyr_id`; called the other way round it lands on the logged-out
   * RevenueCat user. (logOut() throws for an anonymous user: catch it.)
   *
   * @returns a function that unregisters this handler.
   */
  syncRevenueCatAttributes(handler: ProviderAttributesHandler): () => void {
    return this.registerProviderAttributeHandler('revenuecat', handler);
  }

  /**
   * Keep Superwall's user attributes in sync with DATALYR. Same contract as
   * syncRevenueCatAttributes(), with getSuperwallAttributes().
   *
   * ```ts
   * Datalyr.syncSuperwallAttributes((attrs) => Superwall.shared.setUserAttributes(attrs));
   * ```
   *
   * Login order: `Superwall.shared.identify({ userId: id })` FIRST, then `Datalyr.identify(id)`.
   *
   * Logout order: `Superwall.shared.reset()` FIRST, then `Datalyr.reset()`.
   * Superwall's reset wipes the user attributes; Datalyr.reset() then pushes the new
   * `datalyr_id`. The other way round the new id is wiped or lands on the
   * logged-out user.
   *
   * @returns a function that unregisters this handler.
   */
  syncSuperwallAttributes(handler: ProviderAttributesHandler): () => void {
    return this.registerProviderAttributeHandler('superwall', handler);
  }

  private registerProviderAttributeHandler(
    provider: 'revenuecat' | 'superwall',
    handler: ProviderAttributesHandler,
  ): () => void {
    if (typeof handler !== 'function') {
      errorLog(`sync${provider === 'revenuecat' ? 'RevenueCat' : 'Superwall'}Attributes requires a function`);
      return () => undefined;
    }
    const token = {};
    this.providerAttributeHandlers[provider] = { handler, token };
    // Before initialize() finishes there is no datalyr_id yet: initialize() pushes.
    this.scheduleProviderAttributePush(provider);
    return () => {
      if (this.providerAttributeHandlers[provider]?.token === token) {
        this.providerAttributeHandlers[provider] = undefined;
      }
    };
  }

  /** Push current attributes to every registered provider handler (post-init only). */
  private notifyProviderAttributeHandlers(): void {
    this.scheduleProviderAttributePush('revenuecat');
    this.scheduleProviderAttributePush('superwall');
  }

  /**
   * Call one provider handler on a microtask, after the operation that triggered it has
   * finished (so a handler that calls back into DATALYR never runs mid-reset), with the
   * attributes as they are then. Pushes requested in the same tick coalesce. Never
   * awaited: a slow native call in the app's handler must not stall the SDK. Errors are
   * logged, never thrown.
   */
  private scheduleProviderAttributePush(provider: 'revenuecat' | 'superwall'): void {
    if (!this.providerAttributeHandlers[provider] || this.providerAttributePushScheduled[provider]) return;
    this.providerAttributePushScheduled[provider] = true;
    Promise.resolve().then(() => {
      this.providerAttributePushScheduled[provider] = false;
      const registration = this.providerAttributeHandlers[provider];
      if (!registration || !this.state.initialized) return;
      try {
        const attributes = provider === 'revenuecat'
          ? this.getRevenueCatAttributes()
          : this.getSuperwallAttributes();
        const result = registration.handler(attributes);
        if (result && typeof (result as Promise<void>).then === 'function') {
          (result as Promise<void>).then(undefined, (error: unknown) => {
            errorLog(`${provider} attribute handler failed:`, error as Error);
          });
        }
      } catch (error) {
        errorLog(`${provider} attribute handler failed:`, error as Error);
      }
    });
  }

  /**
   * Whether a signed-in (non-provisional) user is current. Before initialize() has
   * restored the persisted user, read it from storage, so a provisional identify made
   * during startup cannot replace a signed-in user from the previous launch.
   */
  private async hasSignedInUser(): Promise<boolean> {
    if (this.state.currentUserId) return !this.currentUserProvisional;
    if (this.state.initialized) return false;
    const [persistedUserId, persistedFlag] = await Promise.all([
      Storage.getItem<string>(STORAGE_KEYS.USER_ID),
      Storage.getItem<string>(STORAGE_KEYS.USER_ID_PROVISIONAL),
    ]);
    return !!persistedUserId && !isProvisionalFlagFor(persistedFlag, persistedUserId);
  }

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
    // CUSTOM key, deliberately un-prefixed — RevenueCat strips unknown `$`
    // keys; the server reads `datalyr_id` (webhooks/platforms/revenuecat.js).
    set('datalyr_id', this.state.anonymousId); // the wire/visitor_id id, NOT visitorId (never sent)
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

  async updateTrackingAuthorization(authorized: boolean): Promise<void> {
    if (!this.state.initialized) {
      errorLog('SDK not initialized. Call initialize() first.');
      return;
    }

    // Refresh cached advertiser info after ATT status change
    await this.refreshAdvertiserInfo();

    // Report the native status (0 notDetermined, 1 restricted, 2 denied, 3 authorized),
    // not a yes/no folded to 3/2: "restricted" and "not yet asked" are different answers
    // from "denied". The argument only stands in when the native module is unavailable,
    // and on Android (no ATT; the native value there is the Limit Ad Tracking proxy).
    const nativeStatus = Platform.OS === 'ios' ? attStatusFrom(this.cachedAdvertiserInfo) : undefined;
    const status = nativeStatus ?? (authorized ? 3 : 2);
    await this.track('$att_status', {
      authorized: status === 3,
      status,
      status_name: ATT_STATUS_NAMES[status],
      att_status: status, // key the Meta/Snapchat postback mappers read
    });

    debugLog(`ATT status updated: ${ATT_STATUS_NAMES[status]}`);

    // A grant re-opens the deferred lookup the server declined without it. Not awaited:
    // the caller is usually mid-onboarding and must not wait on a network round trip.
    void this.rerunDeferredLookupIfAttGranted();
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
        sdk_version: SDK_VERSION,
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
        // alart only on app_install / $deep_link with tracking authorized; SDK bookkeeping
        // never (attributionForEvent).
        ...(eventName === '$sdk_first_launch_existing' ? {} : attributionForEvent(eventName, attributionData, advertiserInfo?.att_status)),
        // Apple Search Ads attribution (iOS)
        ...(eventName === '$sdk_first_launch_existing' ? {} : asaData),
        // Google Play Install Referrer (Android) — gclid/gbraid/wbraid/utm_*. Fill it
        // ONLY when the web→app bridge hasn't already recovered ad attribution, so a
        // web-sourced gclid/utm isn't clobbered. (Was fetched at init but never merged
        // at all, dropping Android Google Ads install attribution.)
        ...((attributionData.gclid || attributionData.utm_source || eventName === '$sdk_first_launch_existing')
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
    if (eventName === '$alias' && payload.eventData && !payload.eventData.previousId && (this.state.currentUserId || this.state.anonymousId)) {
      payload.eventData.previousId = this.state.currentUserId || this.state.anonymousId;
    }

    // Provisional (pre-login) user id: mark every event that carries it, so the server
    // can treat it as a guest id (§2.10) rather than a signed-in account. Matched on the
    // event's own userId, so a $alias naming a different id is not marked.
    // SDK-owned: a caller-set value is removed.
    if (payload.eventData) {
      const markCurrentUser = this.currentUserProvisional &&
        !!this.state.currentUserId &&
        payload.eventData.userId === this.state.currentUserId;
      const markedBySdk = !!eventData && this.provisionalIdentifyPayloads.has(eventData);
      if (markCurrentUser || markedBySdk) {
        payload.eventData[PROVISIONAL_MARKER] = true;
      } else {
        delete payload.eventData[PROVISIONAL_MARKER];
      }
    }

    if (Object.keys(this.state.userProperties).length > 0) {
      payload.userProperties = this.state.userProperties;
    }

    // Final tracking gate for app-user ids (AppLovin `alart`) from any source: same cached
    // status that gates the IDFA/GAID. They stay persisted on the device.
    removeAppUserIdsUnlessAuthorized(payload.eventData, advertiserInfo?.att_status);

    return payload;
  }

  private async loadPersistedUserData(): Promise<void> {
    try {
      const [userId, userProperties, userIdProvisional] = await Promise.all([
        Storage.getItem<string>(STORAGE_KEYS.USER_ID),
        Storage.getItem<UserProperties>(STORAGE_KEYS.USER_PROPERTIES),
        Storage.getItem<string>(STORAGE_KEYS.USER_ID_PROVISIONAL),
      ]);

      // Only restore the persisted user when identify() hasn't ALREADY set one (mid-init
      // identify race) — see datalyr-sdk.ts for the full rationale.
      if (userId && this.state.currentUserId === undefined) {
        this.state.currentUserId = userId;
        // Provisional only if the flag was written for THIS user id (see
        // provisional-identity.ts).
        this.currentUserProvisional = isProvisionalFlagFor(userIdProvisional, userId);
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
        this.state.currentUserId && this.currentUserProvisional
          ? Storage.setItem(STORAGE_KEYS.USER_ID_PROVISIONAL, provisionalFlagFor(this.state.currentUserId))
          : Storage.removeItem(STORAGE_KEYS.USER_ID_PROVISIONAL),
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
          // iOS: the ATT answer can change while the app is away (the prompt itself, or
          // Settings), so re-read it; a grant re-opens a declined deferred lookup.
          if (Platform.OS === 'ios') {
            await this.refreshAdvertiserInfo();
            void this.rerunDeferredLookupIfAttGranted();
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

  static async identify(userId: string, properties?: UserProperties, options?: IdentifyOptions): Promise<void> {
    await datalyrExpo.identify(userId, properties, options);
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

  static async bindProviderIdentity(namespace: string, providerUserId: string): Promise<void> {
    await datalyrExpo.bindProviderIdentity(namespace, providerUserId);
  }

  static getRevenueCatAttributes(): Record<string, string> {
    return datalyrExpo.getRevenueCatAttributes();
  }

  /** See DatalyrSDKExpo.syncRevenueCatAttributes. Login: Purchases.logIn() first, then identify(). Logout: Purchases.logOut() first, then reset(). */
  static syncRevenueCatAttributes(handler: ProviderAttributesHandler): () => void {
    return datalyrExpo.syncRevenueCatAttributes(handler);
  }

  /** See DatalyrSDKExpo.syncSuperwallAttributes. Login: Superwall identify first, then identify(). Logout: Superwall reset first, then reset(). */
  static syncSuperwallAttributes(handler: ProviderAttributesHandler): () => void {
    return datalyrExpo.syncSuperwallAttributes(handler);
  }
}

export default datalyrExpo;
