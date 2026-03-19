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
  createFingerprintData,
  generateUUID,
  getDeviceInfo,
  getNetworkType,
  validateEventName,
  validateEventData,
  debugLog,
  errorLog,
  Storage,
  STORAGE_KEYS,
} from './utils';
import { createHttpClient, HttpClient } from './http-client';
import { createEventQueue, EventQueue } from './event-queue';
import { attributionManager, AttributionData } from './attribution';
import { journeyManager } from './journey';
import { createAutoEventsManager, AutoEventsManager, SessionData } from './auto-events';
import { ConversionValueEncoder, ConversionTemplates } from './ConversionValueEncoder';
import { SKAdNetworkBridge } from './native/SKAdNetworkBridge';
import { appleSearchAdsIntegration, playInstallReferrerIntegration } from './integrations';
import { AppleSearchAdsAttribution, AdvertiserInfoBridge } from './native/DatalyrNativeBridge';
import { networkStatusManager } from './network-status';

export class DatalyrSDK {
  private state: SDKState;
  private httpClient: HttpClient;
  private eventQueue: EventQueue;
  private autoEventsManager: AutoEventsManager | null = null;
  private appStateSubscription: any = null;
  private networkStatusUnsubscribe: (() => void) | null = null;
  private cachedAdvertiserInfo: any = null;
  private static conversionEncoder?: ConversionValueEncoder;
  private static debugEnabled = false;

  constructor() {
    // Initialize state with defaults
    this.state = {
      initialized: false,
      config: {
        workspaceId: '',
        apiKey: '',
        debug: false,
        endpoint: 'https://api.datalyr.com', // Updated to server-side API
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

      // Initialize HTTP client with server-side API
      this.httpClient = new HttpClient(this.state.config.endpoint || 'https://api.datalyr.com', {
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

      // PARALLEL INITIALIZATION: IDs and core managers
      // Run ID creation and core manager initialization in parallel for faster startup
      const [visitorId, anonymousId, sessionId] = await Promise.all([
        getOrCreateVisitorId(),
        getOrCreateAnonymousId(),
        getOrCreateSessionId(),
        // These run concurrently but don't return values we need to capture
        this.loadPersistedUserData(),
        this.state.config.enableAttribution ? attributionManager.initialize() : Promise.resolve(),
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
          this.state.config.autoEventConfig
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

      // Check for app install (after SDK is marked as initialized)
      if (attributionManager.isInstall()) {
        // iOS: Attempt deferred web-to-app attribution via IP matching before tracking install
        // Android: Play Store referrer is handled by playInstallReferrerIntegration
        if (Platform.OS === 'ios') {
          await this.fetchDeferredWebAttribution();
        }

        const installData = await attributionManager.trackInstall();
        await this.track('app_install', {
          platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'android',
          sdk_version: '1.6.1',
          ...installData,
        });
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
    }
  }

  /**
   * Track a custom event
   */
  async track(eventName: string, eventData?: EventData): Promise<void> {
    try {
      if (!this.state.initialized) {
        errorLog('SDK not initialized. Call initialize() first.');
        return;
      }

      if (!validateEventName(eventName)) {
        errorLog(`Invalid event name: ${eventName}`);
        return;
      }

      if (!validateEventData(eventData)) {
        errorLog('Invalid event data provided');
        return;
      }

      debugLog(`Tracking event: ${eventName}`, eventData);

      const payload = await this.createEventPayload(eventName, eventData);
      await this.eventQueue.enqueue(payload);

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

    await this.track('pageview', screenData);

    // Also notify auto-events manager for automatic screen tracking
    if (this.autoEventsManager) {
      await this.autoEventsManager.trackScreenView(screenName, properties);
    }
  }

  /**
   * Identify a user
   */
  async identify(userId: string, properties?: UserProperties): Promise<void> {
    try {
      if (!userId || typeof userId !== 'string') {
        errorLog(`Invalid user ID for identify: ${userId}`);
        return;
      }

      debugLog('Identifying user:', { userId, properties });

      // Update current user ID
      this.state.currentUserId = userId;

      // Merge user properties
      this.state.userProperties = { ...this.state.userProperties, ...properties };

      // Persist user data
      await this.persistUserData();

      // Track $identify event for identity resolution
      await this.track('$identify', {
        userId,
        anonymous_id: this.state.anonymousId,
        ...properties
      });

      // Fetch and merge web attribution if email is provided
      if (this.state.config.enableWebToAppAttribution !== false) {
        const email = properties?.email || (typeof userId === 'string' && userId.includes('@') ? userId : null);
        if (email) {
          await this.fetchAndMergeWebAttribution(email);
        }
      }

      // Forward user data to platform SDKs for Advanced Matching
      const email = properties?.email as string | undefined;
      const phone = properties?.phone as string | undefined;
      const firstName = (properties?.first_name || properties?.firstName) as string | undefined;
      const lastName = (properties?.last_name || properties?.lastName) as string | undefined;
      const dateOfBirth = (properties?.date_of_birth || properties?.dob || properties?.birthday) as string | undefined;
      const gender = properties?.gender as string | undefined;
      const city = properties?.city as string | undefined;
    } catch (error) {
      errorLog('Error identifying user:', error as Error);
    }
  }

  /**
   * Fetch web attribution data for user and merge into mobile session
   * Called automatically during identify() if email is provided
   */
  private async fetchAndMergeWebAttribution(email: string): Promise<void> {
    try {
      debugLog('Fetching web attribution for email:', email);

      // Call API endpoint to get web attribution
      const response = await fetch('https://api.datalyr.com/attribution/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Datalyr-API-Key': this.state.config.apiKey!,
        },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        debugLog('Failed to fetch web attribution:', response.status);
        return;
      }

      const result = await response.json() as { found: boolean; attribution?: any };

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

      // Merge web attribution into current session
      await this.track('$web_attribution_merged', {
        web_visitor_id: webAttribution.visitor_id,
        web_user_id: webAttribution.user_id,
        fbclid: webAttribution.fbclid,
        gclid: webAttribution.gclid,
        ttclid: webAttribution.ttclid,
        gbraid: webAttribution.gbraid,
        wbraid: webAttribution.wbraid,
        fbp: webAttribution.fbp,
        fbc: webAttribution.fbc,
        utm_source: webAttribution.utm_source,
        utm_medium: webAttribution.utm_medium,
        utm_campaign: webAttribution.utm_campaign,
        utm_content: webAttribution.utm_content,
        utm_term: webAttribution.utm_term,
        web_timestamp: webAttribution.timestamp,
      });

      // Update attribution manager with web data
      attributionManager.mergeWebAttribution(webAttribution);

      debugLog('Successfully merged web attribution into mobile session');

    } catch (error) {
      errorLog('Error fetching web attribution:', error as Error);
      // Non-blocking - continue even if attribution fetch fails
    }
  }

  /**
   * Fetch deferred web attribution on first app install.
   * Uses IP-based matching (iOS) or Play Store referrer (Android) to recover
   * attribution data (fbclid, utm_*, etc.) from a prelander web visit.
   * Called automatically during initialize() when a fresh install is detected.
   */
  private async fetchDeferredWebAttribution(): Promise<void> {
    if (!this.state.config?.apiKey) {
      debugLog('API key not available for deferred attribution fetch');
      return;
    }

    try {
      debugLog('Fetching deferred web attribution via IP matching...');

      const baseUrl = this.state.config.endpoint || 'https://api.datalyr.com';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${baseUrl}/attribution/deferred-lookup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Datalyr-API-Key': this.state.config.apiKey,
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

      // Merge web attribution into current session
      attributionManager.mergeWebAttribution(webAttribution);

      // Track match event for analytics
      await this.track('$web_attribution_matched', {
        web_visitor_id: webAttribution.visitor_id,
        web_user_id: webAttribution.user_id,
        fbclid: webAttribution.fbclid,
        gclid: webAttribution.gclid,
        ttclid: webAttribution.ttclid,
        gbraid: webAttribution.gbraid,
        wbraid: webAttribution.wbraid,
        fbp: webAttribution.fbp,
        fbc: webAttribution.fbc,
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
        previousId: previousId || this.state.visitorId,
        visitorId: this.state.visitorId,
        anonymousId: this.state.anonymousId,  // Include for identity resolution
      };

      debugLog('Aliasing user:', aliasData);

      // Track alias event
      await this.track('alias', aliasData);

      // Update current user ID
      await this.identify(newUserId);

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

      // Clear user data
      this.state.currentUserId = undefined;
      this.state.userProperties = {};

      // Remove from storage
      await Storage.removeItem(STORAGE_KEYS.USER_ID);
      await Storage.removeItem(STORAGE_KEYS.USER_PROPERTIES);

      // Generate new session
      this.state.sessionId = await getOrCreateSessionId();

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
    if (this.autoEventsManager) {
      await this.autoEventsManager.trackAppUpdate(previousVersion, currentVersion);
    }
  }

  /**
   * Track revenue event manually (purchases, subscriptions)
   */
  async trackRevenue(eventName: string, properties?: EventData): Promise<void> {
    if (this.autoEventsManager) {
      await this.autoEventsManager.trackRevenueEvent(eventName, properties);
    }
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
      if (DatalyrSDK.debugEnabled) {
        errorLog('SKAdNetwork encoder not initialized. Pass skadTemplate in initialize()');
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
    const properties: Record<string, any> = { revenue: value, currency };
    if (productId) properties.product_id = productId;

    await this.trackWithSKAdNetwork('purchase', properties);
  }

  /**
   * Track subscription with automatic revenue encoding and platform forwarding
   */
  async trackSubscription(
    value: number,
    currency = 'USD',
    plan?: string
  ): Promise<void> {
    const properties: Record<string, any> = { revenue: value, currency };
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
    const properties: Record<string, any> = { value, currency };
    if (productId) properties.product_id = productId;
    if (productName) properties.product_name = productName;

    await this.trackWithSKAdNetwork('add_to_cart', properties);
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
    const properties: Record<string, any> = { content_type: contentType };
    if (contentId) properties.content_id = contentId;
    if (contentName) properties.content_name = contentName;
    if (value !== undefined) properties.value = value;
    if (currency) properties.currency = currency;

    await this.track('view_content', properties);
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
    const properties: Record<string, any> = { value, currency };
    if (numItems !== undefined) properties.num_items = numItems;
    if (productIds) properties.product_ids = productIds;

    await this.trackWithSKAdNetwork('initiate_checkout', properties);
  }

  /**
   * Track complete registration event
   */
  async trackCompleteRegistration(method?: string): Promise<void> {
    const properties: Record<string, any> = {};
    if (method) properties.method = method;

    await this.trackWithSKAdNetwork('complete_registration', properties);
  }

  /**
   * Track search event
   */
  async trackSearch(query: string, resultIds?: string[]): Promise<void> {
    const properties: Record<string, any> = { query };
    if (resultIds) properties.result_ids = resultIds;

    await this.track('search', properties);
  }

  /**
   * Track lead/contact form submission
   */
  async trackLead(value?: number, currency?: string): Promise<void> {
    const properties: Record<string, any> = {};
    if (value !== undefined) properties.value = value;
    if (currency) properties.currency = currency;

    await this.trackWithSKAdNetwork('lead', properties);
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
    set('att_status', advertiser?.att_status);

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
      attributionManager.mergeWebAttribution({
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
    const fingerprintData = await createFingerprintData();
    const attributionData = attributionManager.getAttributionData();

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

    const payload: EventPayload = {
      workspaceId: this.state.config.workspaceId || 'mobile_sdk',
      visitorId: this.state.visitorId,
      anonymousId: this.state.anonymousId,  // Include persistent anonymous ID
      sessionId: this.state.sessionId,
      eventId: generateUUID(),
      eventName,
      eventData: {
        ...eventData,
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
        carrier: deviceInfo.carrier,
        network_type: getNetworkType(),
        timestamp: Date.now(),
        sdk_version: '1.6.1',
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
        // Apple Search Ads attribution
        ...asaData,
      },
      fingerprintData,
      source: 'mobile_app',
      timestamp: new Date().toISOString(),
    };

    // Add user data if available
    if (this.state.currentUserId) {
      payload.userId = this.state.currentUserId;
      payload.eventData!.userId = this.state.currentUserId;
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

      if (userId) {
        this.state.currentUserId = userId;
      }

      if (userProperties) {
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
      this.appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
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
          // App became active, ensure we have fresh session if needed
          this.refreshSession();
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

      // Destroy event queue
      this.eventQueue.destroy();

      // Reset state
      this.state.initialized = false;

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

  static async trackRevenue(eventName: string, properties?: EventData): Promise<void> {
    await datalyr.trackRevenue(eventName, properties);
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