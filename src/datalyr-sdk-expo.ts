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
} from './utils-expo';  // <-- KEY DIFFERENCE: uses Expo utilities
import { createHttpClient, HttpClient } from './http-client';
import { createEventQueue, EventQueue } from './event-queue';
import { attributionManager, AttributionData } from './attribution';
import { journeyManager } from './journey';
import { createAutoEventsManager, AutoEventsManager } from './auto-events';
import { ConversionValueEncoder, ConversionTemplates } from './ConversionValueEncoder';
import { SKAdNetworkBridge } from './native/SKAdNetworkBridge';
import { metaIntegration, tiktokIntegration, appleSearchAdsIntegration, playInstallReferrerIntegration } from './integrations';
import { DeferredDeepLinkResult } from './types';
import { AppleSearchAdsAttribution, AdvertiserInfoBridge } from './native/DatalyrNativeBridge';

export class DatalyrSDKExpo {
  private state: SDKState;
  private httpClient: HttpClient;
  private eventQueue: EventQueue;
  private autoEventsManager: AutoEventsManager | null = null;
  private appStateSubscription: any = null;
  private cachedAdvertiserInfo: any = null;
  private static conversionEncoder?: ConversionValueEncoder;
  private static debugEnabled = false;

  constructor() {
    this.state = {
      initialized: false,
      config: {
        workspaceId: '',
        apiKey: '',
        debug: false,
        endpoint: 'https://api.datalyr.com',
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

      if (!config.apiKey) {
        throw new Error('apiKey is required for Datalyr SDK');
      }

      if (!config.workspaceId) {
        debugLog('workspaceId not provided, using server-side tracking only');
      }

      this.state.config = { ...this.state.config, ...config };

      this.httpClient = new HttpClient(this.state.config.endpoint || 'https://api.datalyr.com', {
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
          this.state.config.autoEventConfig
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

      // Initialize platform SDKs (Meta/TikTok) if configured
      if (config.meta) {
        try {
          await metaIntegration.initialize(config.meta, config.debug || false);
          debugLog('Meta SDK initialized');

          // Fetch deferred deep link data
          if (config.meta.enableDeferredDeepLink) {
            const deferredData = await metaIntegration.fetchDeferredDeepLink();
            if (deferredData) {
              await this.handleDeferredDeepLink(deferredData);
            }
          }
        } catch (error) {
          errorLog('Failed to initialize Meta SDK:', error as Error);
        }
      }

      if (config.tiktok) {
        try {
          await tiktokIntegration.initialize(config.tiktok, config.debug || false);
          debugLog('TikTok SDK initialized');
        } catch (error) {
          errorLog('Failed to initialize TikTok SDK:', error as Error);
        }
      }

      // Initialize Apple Search Ads attribution (iOS only, auto-fetches on init)
      await appleSearchAdsIntegration.initialize(config.debug);

      // Initialize Play Install Referrer (Android only)
      await playInstallReferrerIntegration.initialize();

      // Cache advertiser info (IDFA/GAID, ATT status) once at init to avoid per-event native bridge calls
      try {
        this.cachedAdvertiserInfo = await AdvertiserInfoBridge.getAdvertiserInfo();
      } catch (error) {
        errorLog('Failed to cache advertiser info:', error as Error);
      }

      debugLog('Platform integrations initialized', {
        meta: metaIntegration.isAvailable(),
        tiktok: tiktokIntegration.isAvailable(),
        appleSearchAds: appleSearchAdsIntegration.isAvailable(),
        playInstallReferrer: playInstallReferrerIntegration.isAvailable(),
      });

      this.state.initialized = true;

      if (attributionManager.isInstall()) {
        const installData = await attributionManager.trackInstall();
        await this.track('app_install', {
          platform: Platform.OS,
          sdk_version: '1.4.9',
          sdk_variant: 'expo',
          ...installData,
        });
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
    }
  }

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

  async screen(screenName: string, properties?: EventData): Promise<void> {
    const screenData: EventData = {
      screen: screenName,
      ...properties,
    };

    await this.track('pageview', screenData);

    if (this.autoEventsManager) {
      await this.autoEventsManager.trackScreenView(screenName, properties);
    }
  }

  async identify(userId: string, properties?: UserProperties): Promise<void> {
    try {
      if (!userId || typeof userId !== 'string') {
        errorLog(`Invalid user ID for identify: ${userId}`);
        return;
      }

      debugLog('Identifying user:', { userId, properties });

      this.state.currentUserId = userId;
      this.state.userProperties = { ...this.state.userProperties, ...properties };

      await this.persistUserData();

      await this.track('$identify', {
        userId,
        anonymous_id: this.state.anonymousId,
        ...properties
      });

      if (this.state.config.enableWebToAppAttribution !== false) {
        const email = properties?.email || (typeof userId === 'string' && userId.includes('@') ? userId : null);
        if (email) {
          await this.fetchAndMergeWebAttribution(email);
        }
      }

      // Forward user data to platform SDKs for Advanced Matching
      if (metaIntegration.isAvailable() && properties) {
        metaIntegration.setUserData({
          email: properties.email,
          phone: properties.phone,
          firstName: properties.firstName || properties.first_name,
          lastName: properties.lastName || properties.last_name,
          city: properties.city,
          state: properties.state,
          zip: properties.zip || properties.zipCode || properties.postalCode,
          country: properties.country,
          gender: properties.gender,
          dateOfBirth: properties.dateOfBirth || properties.dob || properties.birthday,
        });
      }

      if (tiktokIntegration.isAvailable()) {
        tiktokIntegration.identify(
          properties?.email,
          properties?.phone,
          userId
        );
      }

    } catch (error) {
      errorLog('Error identifying user:', error as Error);
    }
  }

  private async fetchAndMergeWebAttribution(email: string): Promise<void> {
    try {
      debugLog('Fetching web attribution for email:', email);

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

      attributionManager.mergeWebAttribution(webAttribution);

      debugLog('Successfully merged web attribution into mobile session');

    } catch (error) {
      errorLog('Error fetching web attribution:', error as Error);
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
        previousId: previousId || this.state.visitorId,
        visitorId: this.state.visitorId,
        anonymousId: this.state.anonymousId,
      };

      debugLog('Aliasing user:', aliasData);

      await this.track('alias', aliasData);
      await this.identify(newUserId);

    } catch (error) {
      errorLog('Error aliasing user:', error as Error);
    }
  }

  async reset(): Promise<void> {
    try {
      debugLog('Resetting user data');

      this.state.currentUserId = undefined;
      this.state.userProperties = {};

      await Storage.removeItem(STORAGE_KEYS.USER_ID);
      await Storage.removeItem(STORAGE_KEYS.USER_PROPERTIES);

      this.state.sessionId = await getOrCreateSessionId();

      // Clear user data from platform SDKs
      if (metaIntegration.isAvailable()) {
        metaIntegration.clearUserData();
      }

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
    if (this.autoEventsManager) {
      await this.autoEventsManager.trackAppUpdate(previousVersion, currentVersion);
    }
  }

  async trackRevenue(eventName: string, properties?: EventData): Promise<void> {
    if (this.autoEventsManager) {
      await this.autoEventsManager.trackRevenueEvent(eventName, properties);
    }
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
    const properties: Record<string, any> = { revenue: value, currency };
    if (productId) properties.product_id = productId;

    await this.trackWithSKAdNetwork('purchase', properties);

    // Forward to platform SDKs
    if (metaIntegration.isAvailable()) {
      metaIntegration.logPurchase(value, currency, { productId });
    }
    if (tiktokIntegration.isAvailable()) {
      tiktokIntegration.logPurchase(value, currency, productId);
    }
  }

  async trackSubscription(value: number, currency = 'USD', plan?: string): Promise<void> {
    const properties: Record<string, any> = { revenue: value, currency };
    if (plan) properties.plan = plan;

    await this.trackWithSKAdNetwork('subscribe', properties);

    // Forward to platform SDKs
    if (metaIntegration.isAvailable()) {
      metaIntegration.logEvent('Subscribe', { value, currency, content_id: plan });
    }
    if (tiktokIntegration.isAvailable()) {
      tiktokIntegration.logSubscription(value, currency, plan);
    }
  }

  // Standard e-commerce events with platform forwarding

  async trackAddToCart(value: number, currency: string, contentId?: string, contentName?: string): Promise<void> {
    const properties: Record<string, any> = { value, currency };
    if (contentId) properties.content_id = contentId;
    if (contentName) properties.content_name = contentName;

    await this.track('add_to_cart', properties);

    if (metaIntegration.isAvailable()) {
      metaIntegration.logEvent('AddToCart', { value, currency, content_id: contentId, content_name: contentName });
    }
    if (tiktokIntegration.isAvailable()) {
      tiktokIntegration.logAddToCart(value, currency, contentId, contentName);
    }
  }

  async trackViewContent(contentId: string, contentName?: string, contentType?: string, value?: number, currency?: string): Promise<void> {
    const properties: Record<string, any> = { content_id: contentId };
    if (contentName) properties.content_name = contentName;
    if (contentType) properties.content_type = contentType;
    if (value !== undefined) properties.value = value;
    if (currency) properties.currency = currency;

    await this.track('view_content', properties);

    if (metaIntegration.isAvailable()) {
      metaIntegration.logEvent('ViewContent', properties);
    }
    if (tiktokIntegration.isAvailable()) {
      tiktokIntegration.logViewContent(contentId, contentName, contentType, value, currency);
    }
  }

  async trackInitiateCheckout(value?: number, currency?: string, numItems?: number, contentIds?: string[]): Promise<void> {
    const properties: Record<string, any> = {};
    if (value !== undefined) properties.value = value;
    if (currency) properties.currency = currency;
    if (numItems !== undefined) properties.num_items = numItems;
    if (contentIds) properties.content_ids = contentIds;

    await this.track('initiate_checkout', properties);

    if (metaIntegration.isAvailable()) {
      metaIntegration.logEvent('InitiateCheckout', properties);
    }
    if (tiktokIntegration.isAvailable()) {
      tiktokIntegration.logInitiateCheckout(value, currency, numItems, contentIds);
    }
  }

  async trackCompleteRegistration(registrationMethod?: string): Promise<void> {
    const properties: Record<string, any> = {};
    if (registrationMethod) properties.registration_method = registrationMethod;

    await this.track('complete_registration', properties);

    if (metaIntegration.isAvailable()) {
      metaIntegration.logEvent('CompleteRegistration', properties);
    }
    if (tiktokIntegration.isAvailable()) {
      tiktokIntegration.logCompleteRegistration(registrationMethod);
    }
  }

  async trackSearch(searchString: string, contentIds?: string[]): Promise<void> {
    const properties: Record<string, any> = { search_string: searchString };
    if (contentIds) properties.content_ids = contentIds;

    await this.track('search', properties);

    if (metaIntegration.isAvailable()) {
      metaIntegration.logEvent('Search', properties);
    }
    if (tiktokIntegration.isAvailable()) {
      tiktokIntegration.logSearch(searchString, contentIds);
    }
  }

  async trackLead(value?: number, currency?: string): Promise<void> {
    const properties: Record<string, any> = {};
    if (value !== undefined) properties.value = value;
    if (currency) properties.currency = currency;

    await this.track('lead', properties);

    if (metaIntegration.isAvailable()) {
      metaIntegration.logEvent('Lead', properties);
    }
    if (tiktokIntegration.isAvailable()) {
      tiktokIntegration.logLead(value, currency);
    }
  }

  async trackAddPaymentInfo(success?: boolean): Promise<void> {
    const properties: Record<string, any> = {};
    if (success !== undefined) properties.success = success;

    await this.track('add_payment_info', properties);

    if (metaIntegration.isAvailable()) {
      metaIntegration.logEvent('AddPaymentInfo', properties);
    }
    if (tiktokIntegration.isAvailable()) {
      tiktokIntegration.logAddPaymentInfo(success);
    }
  }

  // Platform integration methods

  getDeferredAttributionData(): DeferredDeepLinkResult | null {
    if (metaIntegration.isAvailable()) {
      return metaIntegration.getDeferredDeepLinkData();
    }
    return null;
  }

  getPlatformIntegrationStatus(): { meta: boolean; tiktok: boolean; appleSearchAds: boolean; playInstallReferrer: boolean } {
    return {
      meta: metaIntegration.isAvailable(),
      tiktok: tiktokIntegration.isAvailable(),
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

  async updateTrackingAuthorization(authorized: boolean): Promise<void> {
    if (metaIntegration.isAvailable()) {
      metaIntegration.updateTrackingAuthorization(authorized);
    }
    if (tiktokIntegration.isAvailable()) {
      tiktokIntegration.updateTrackingAuthorization(authorized);
    }

    // Refresh cached advertiser info after ATT status change
    try {
      this.cachedAdvertiserInfo = await AdvertiserInfoBridge.getAdvertiserInfo();
    } catch (error) {
      errorLog('Failed to refresh advertiser info:', error as Error);
    }
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
    const fingerprintData = await createFingerprintData();
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

    const payload: EventPayload = {
      workspaceId: this.state.config.workspaceId || 'mobile_sdk',
      visitorId: this.state.visitorId,
      anonymousId: this.state.anonymousId,
      sessionId: this.state.sessionId,
      eventId: generateUUID(),
      eventName,
      eventData: {
        ...eventData,
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
        carrier: deviceInfo.carrier,
        network_type: networkType,
        timestamp: Date.now(),
        sdk_version: '1.4.9',
        sdk_variant: 'expo',
        // Advertiser data (IDFA/GAID, ATT status) for Meta CAPI / TikTok Events API
        ...(advertiserInfo ? {
          idfa: advertiserInfo.idfa,
          idfv: advertiserInfo.idfv,
          gaid: advertiserInfo.gaid,
          att_status: advertiserInfo.att_status,
          advertiser_tracking_enabled: advertiserInfo.advertiser_tracking_enabled,
        } : {}),
        ...attributionData,
        // Apple Search Ads attribution
        ...asaData,
      },
      fingerprintData,
      source: 'mobile_app',
      timestamp: new Date().toISOString(),
    };

    if (this.state.currentUserId) {
      payload.userId = this.state.currentUserId;
      payload.eventData!.userId = this.state.currentUserId;
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
      this.appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
        debugLog('App state changed:', nextAppState);

        if (nextAppState === 'background') {
          this.flush();
          if (this.autoEventsManager) {
            this.autoEventsManager.handleAppBackground();
          }
        } else if (nextAppState === 'active') {
          this.refreshSession();
          if (this.autoEventsManager) {
            this.autoEventsManager.handleAppForeground();
          }
        }
      });

    } catch (error) {
      errorLog('Error setting up app state monitoring:', error as Error);
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

      this.eventQueue.destroy();
      this.state.initialized = false;

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

  static async trackRevenue(eventName: string, properties?: EventData): Promise<void> {
    await datalyrExpo.trackRevenue(eventName, properties);
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

  static getPlatformIntegrationStatus(): { meta: boolean; tiktok: boolean; appleSearchAds: boolean; playInstallReferrer: boolean } {
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
}

export default datalyrExpo;
