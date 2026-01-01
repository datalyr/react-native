import { Platform, AppState } from 'react-native';
import { getOrCreateVisitorId, getOrCreateAnonymousId, getOrCreateSessionId, createFingerprintData, generateUUID, getDeviceInfo, getNetworkType, validateEventName, validateEventData, debugLog, errorLog, Storage, STORAGE_KEYS, } from './utils';
import { createHttpClient, HttpClient } from './http-client';
import { createEventQueue, EventQueue } from './event-queue';
import { attributionManager } from './attribution';
import { AutoEventsManager } from './auto-events';
import { ConversionValueEncoder, ConversionTemplates } from './ConversionValueEncoder';
import { SKAdNetworkBridge } from './native/SKAdNetworkBridge';
import { metaIntegration, tiktokIntegration, appleSearchAdsIntegration } from './integrations';
export class DatalyrSDK {
    constructor() {
        this.autoEventsManager = null;
        this.appStateSubscription = null;
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
                flushInterval: 10000,
                maxQueueSize: 100,
                respectDoNotTrack: true,
            },
            visitorId: '',
            anonymousId: '', // Persistent anonymous identifier
            sessionId: '',
            userProperties: {},
            eventQueue: [],
            isOnline: true,
        };
        // Initialize HTTP client and event queue (will be properly set up in initialize)
        this.httpClient = createHttpClient(this.state.config.endpoint);
        this.eventQueue = createEventQueue(this.httpClient);
    }
    /**
     * Initialize the SDK with configuration
     */
    async initialize(config) {
        var _a, _b, _c, _d;
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
                apiKey: this.state.config.apiKey,
                workspaceId: this.state.config.workspaceId,
                debug: this.state.config.debug || false,
                useServerTracking: (_a = this.state.config.useServerTracking) !== null && _a !== void 0 ? _a : true,
            });
            // Initialize event queue
            this.eventQueue = new EventQueue(this.httpClient, {
                maxQueueSize: this.state.config.maxQueueSize || 100,
                batchSize: this.state.config.batchSize || 10,
                flushInterval: this.state.config.flushInterval || 30000,
                maxRetryCount: this.state.config.maxRetries || 3,
            });
            // Initialize visitor ID, anonymous ID and session
            this.state.visitorId = await getOrCreateVisitorId();
            this.state.anonymousId = await getOrCreateAnonymousId();
            this.state.sessionId = await getOrCreateSessionId();
            // Load persisted user data
            await this.loadPersistedUserData();
            // Initialize attribution manager
            if (this.state.config.enableAttribution) {
                await attributionManager.initialize();
            }
            // Initialize auto-events manager (asynchronously to avoid blocking)
            if (this.state.config.enableAutoEvents) {
                this.autoEventsManager = new AutoEventsManager(this.track.bind(this), this.state.config.autoEventConfig);
                // Initialize auto-events asynchronously to prevent blocking
                setTimeout(async () => {
                    var _a;
                    try {
                        await ((_a = this.autoEventsManager) === null || _a === void 0 ? void 0 : _a.initialize());
                    }
                    catch (error) {
                        errorLog('Error initializing auto-events (non-blocking):', error);
                    }
                }, 100); // Small delay to ensure main thread isn't blocked
            }
            // Set up app state monitoring (also asynchronous)
            setTimeout(() => {
                try {
                    this.setupAppStateMonitoring();
                }
                catch (error) {
                    errorLog('Error setting up app state monitoring (non-blocking):', error);
                }
            }, 50);
            // Initialize SKAdNetwork conversion encoder
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
            // Initialize Meta SDK if configured
            if ((_b = config.meta) === null || _b === void 0 ? void 0 : _b.appId) {
                await metaIntegration.initialize(config.meta, config.debug);
                // Fetch deferred deep link and merge with attribution
                if (config.enableAttribution !== false) {
                    const deferredLink = await metaIntegration.fetchDeferredDeepLink();
                    if (deferredLink) {
                        await this.handleDeferredDeepLink(deferredLink);
                    }
                }
            }
            // Initialize TikTok SDK if configured
            if (((_c = config.tiktok) === null || _c === void 0 ? void 0 : _c.appId) && ((_d = config.tiktok) === null || _d === void 0 ? void 0 : _d.tiktokAppId)) {
                await tiktokIntegration.initialize(config.tiktok, config.debug);
            }
            // Initialize Apple Search Ads attribution (iOS only, auto-fetches on init)
            await appleSearchAdsIntegration.initialize(config.debug);
            debugLog('Platform integrations initialized', {
                meta: metaIntegration.isAvailable(),
                tiktok: tiktokIntegration.isAvailable(),
                appleSearchAds: appleSearchAdsIntegration.isAvailable(),
            });
            // SDK initialized successfully - set state before tracking install event
            this.state.initialized = true;
            // Check for app install (after SDK is marked as initialized)
            if (attributionManager.isInstall()) {
                const installData = await attributionManager.trackInstall();
                await this.track('app_install', {
                    platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'android',
                    sdk_version: '1.0.2',
                    ...installData,
                });
            }
            debugLog('Datalyr SDK initialized successfully', {
                workspaceId: this.state.config.workspaceId,
                visitorId: this.state.visitorId,
                anonymousId: this.state.anonymousId,
                sessionId: this.state.sessionId,
            });
        }
        catch (error) {
            errorLog('Failed to initialize Datalyr SDK:', error);
            throw error;
        }
    }
    /**
     * Track a custom event
     */
    async track(eventName, eventData) {
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
        }
        catch (error) {
            errorLog(`Error tracking event ${eventName}:`, error);
        }
    }
    /**
     * Track a screen view
     */
    async screen(screenName, properties) {
        const screenData = {
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
    async identify(userId, properties) {
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
                const email = (properties === null || properties === void 0 ? void 0 : properties.email) || (typeof userId === 'string' && userId.includes('@') ? userId : null);
                if (email) {
                    await this.fetchAndMergeWebAttribution(email);
                }
            }
            // Forward user data to platform SDKs for Advanced Matching
            const email = properties === null || properties === void 0 ? void 0 : properties.email;
            const phone = properties === null || properties === void 0 ? void 0 : properties.phone;
            const firstName = ((properties === null || properties === void 0 ? void 0 : properties.first_name) || (properties === null || properties === void 0 ? void 0 : properties.firstName));
            const lastName = ((properties === null || properties === void 0 ? void 0 : properties.last_name) || (properties === null || properties === void 0 ? void 0 : properties.lastName));
            const dateOfBirth = ((properties === null || properties === void 0 ? void 0 : properties.date_of_birth) || (properties === null || properties === void 0 ? void 0 : properties.dob) || (properties === null || properties === void 0 ? void 0 : properties.birthday));
            const gender = properties === null || properties === void 0 ? void 0 : properties.gender;
            const city = properties === null || properties === void 0 ? void 0 : properties.city;
            const state = properties === null || properties === void 0 ? void 0 : properties.state;
            const zip = ((properties === null || properties === void 0 ? void 0 : properties.zip) || (properties === null || properties === void 0 ? void 0 : properties.postal_code) || (properties === null || properties === void 0 ? void 0 : properties.zipcode));
            const country = properties === null || properties === void 0 ? void 0 : properties.country;
            // Meta Advanced Matching
            if (metaIntegration.isAvailable()) {
                metaIntegration.setUserData({
                    email,
                    firstName,
                    lastName,
                    phone,
                    dateOfBirth,
                    gender,
                    city,
                    state,
                    zip,
                    country,
                });
            }
            // TikTok identification
            if (tiktokIntegration.isAvailable()) {
                tiktokIntegration.identify(email, phone, userId);
            }
        }
        catch (error) {
            errorLog('Error identifying user:', error);
        }
    }
    /**
     * Fetch web attribution data for user and merge into mobile session
     * Called automatically during identify() if email is provided
     */
    async fetchAndMergeWebAttribution(email) {
        try {
            debugLog('Fetching web attribution for email:', email);
            // Call API endpoint to get web attribution
            const response = await fetch('https://api.datalyr.com/attribution/lookup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Datalyr-API-Key': this.state.config.apiKey,
                },
                body: JSON.stringify({ email }),
            });
            if (!response.ok) {
                debugLog('Failed to fetch web attribution:', response.status);
                return;
            }
            const result = await response.json();
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
        }
        catch (error) {
            errorLog('Error fetching web attribution:', error);
            // Non-blocking - continue even if attribution fetch fails
        }
    }
    /**
     * Alias a user (connect anonymous user to known user)
     */
    async alias(newUserId, previousId) {
        try {
            if (!newUserId || typeof newUserId !== 'string') {
                errorLog(`Invalid user ID for alias: ${newUserId}`);
                return;
            }
            const aliasData = {
                newUserId,
                previousId: previousId || this.state.visitorId,
                visitorId: this.state.visitorId,
                anonymousId: this.state.anonymousId, // Include for identity resolution
            };
            debugLog('Aliasing user:', aliasData);
            // Track alias event
            await this.track('alias', aliasData);
            // Update current user ID
            await this.identify(newUserId);
        }
        catch (error) {
            errorLog('Error aliasing user:', error);
        }
    }
    /**
     * Reset user data (logout)
     */
    async reset() {
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
            // Clear user data from platform SDKs
            if (metaIntegration.isAvailable()) {
                metaIntegration.clearUserData();
            }
            debugLog('User data reset completed');
        }
        catch (error) {
            errorLog('Error resetting user data:', error);
        }
    }
    /**
     * Flush queued events immediately
     */
    async flush() {
        try {
            debugLog('Flushing events...');
            await this.eventQueue.flush();
        }
        catch (error) {
            errorLog('Error flushing events:', error);
        }
    }
    /**
     * Get SDK status and statistics
     */
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
        };
    }
    /**
     * Get the persistent anonymous ID
     */
    getAnonymousId() {
        return this.state.anonymousId;
    }
    /**
     * Get detailed attribution data
     */
    getAttributionData() {
        return attributionManager.getAttributionData();
    }
    /**
     * Set custom attribution data (for testing or manual attribution)
     */
    async setAttributionData(data) {
        await attributionManager.setAttributionData(data);
    }
    /**
     * Get current session information from auto-events
     */
    getCurrentSession() {
        var _a;
        return ((_a = this.autoEventsManager) === null || _a === void 0 ? void 0 : _a.getCurrentSession()) || null;
    }
    /**
     * Force end current session
     */
    async endSession() {
        if (this.autoEventsManager) {
            await this.autoEventsManager.forceEndSession();
        }
    }
    /**
     * Track app update manually
     */
    async trackAppUpdate(previousVersion, currentVersion) {
        if (this.autoEventsManager) {
            await this.autoEventsManager.trackAppUpdate(previousVersion, currentVersion);
        }
    }
    /**
     * Track revenue event manually (purchases, subscriptions)
     */
    async trackRevenue(eventName, properties) {
        if (this.autoEventsManager) {
            await this.autoEventsManager.trackRevenueEvent(eventName, properties);
        }
    }
    /**
     * Update auto-events configuration
     */
    updateAutoEventsConfig(config) {
        if (this.autoEventsManager) {
            this.autoEventsManager.updateConfig(config);
        }
    }
    // MARK: - SKAdNetwork Enhanced Methods
    /**
     * Track event with automatic SKAdNetwork conversion value encoding
     */
    async trackWithSKAdNetwork(event, properties) {
        // Existing tracking (keep exactly as-is)
        await this.track(event, properties);
        // NEW: Automatic SKAdNetwork encoding
        if (!DatalyrSDK.conversionEncoder) {
            if (DatalyrSDK.debugEnabled) {
                errorLog('SKAdNetwork encoder not initialized. Pass skadTemplate in initialize()');
            }
            return;
        }
        const conversionValue = DatalyrSDK.conversionEncoder.encode(event, properties);
        if (conversionValue > 0) {
            const success = await SKAdNetworkBridge.updateConversionValue(conversionValue);
            if (DatalyrSDK.debugEnabled) {
                debugLog(`Event: ${event}, Conversion Value: ${conversionValue}, Success: ${success}`, properties);
            }
        }
        else if (DatalyrSDK.debugEnabled) {
            debugLog(`No conversion value generated for event: ${event}`);
        }
    }
    /**
     * Track purchase with automatic revenue encoding and platform forwarding
     */
    async trackPurchase(value, currency = 'USD', productId) {
        const properties = { revenue: value, currency };
        if (productId)
            properties.product_id = productId;
        await this.trackWithSKAdNetwork('purchase', properties);
        // Forward to Meta if available
        if (metaIntegration.isAvailable()) {
            metaIntegration.logPurchase(value, currency, { fb_content_id: productId });
        }
        // Forward to TikTok if available
        if (tiktokIntegration.isAvailable()) {
            tiktokIntegration.logPurchase(value, currency, productId, 'product');
        }
    }
    /**
     * Track subscription with automatic revenue encoding and platform forwarding
     */
    async trackSubscription(value, currency = 'USD', plan) {
        const properties = { revenue: value, currency };
        if (plan)
            properties.plan = plan;
        await this.trackWithSKAdNetwork('subscribe', properties);
        // Forward to Meta if available
        if (metaIntegration.isAvailable()) {
            metaIntegration.logEvent('Subscribe', value, { subscription_plan: plan });
        }
        // Forward to TikTok if available
        if (tiktokIntegration.isAvailable()) {
            tiktokIntegration.logSubscription(value, currency, plan);
        }
    }
    // MARK: - Standard E-commerce Events
    /**
     * Track add to cart event
     */
    async trackAddToCart(value, currency = 'USD', productId, productName) {
        const properties = { value, currency };
        if (productId)
            properties.product_id = productId;
        if (productName)
            properties.product_name = productName;
        await this.trackWithSKAdNetwork('add_to_cart', properties);
        // Forward to Meta
        if (metaIntegration.isAvailable()) {
            metaIntegration.logEvent('AddToCart', value, {
                currency,
                content_ids: productId ? [productId] : undefined,
                content_name: productName,
            });
        }
        // Forward to TikTok
        if (tiktokIntegration.isAvailable()) {
            tiktokIntegration.logAddToCart(value, currency, productId, 'product');
        }
    }
    /**
     * Track view content/product event
     */
    async trackViewContent(contentId, contentName, contentType = 'product', value, currency) {
        const properties = { content_type: contentType };
        if (contentId)
            properties.content_id = contentId;
        if (contentName)
            properties.content_name = contentName;
        if (value !== undefined)
            properties.value = value;
        if (currency)
            properties.currency = currency;
        await this.track('view_content', properties);
        // Forward to Meta
        if (metaIntegration.isAvailable()) {
            metaIntegration.logEvent('ViewContent', value, {
                content_ids: contentId ? [contentId] : undefined,
                content_name: contentName,
                content_type: contentType,
                currency,
            });
        }
        // Forward to TikTok
        if (tiktokIntegration.isAvailable()) {
            tiktokIntegration.logViewContent(contentId, contentName, contentType);
        }
    }
    /**
     * Track initiate checkout event
     */
    async trackInitiateCheckout(value, currency = 'USD', numItems, productIds) {
        const properties = { value, currency };
        if (numItems !== undefined)
            properties.num_items = numItems;
        if (productIds)
            properties.product_ids = productIds;
        await this.trackWithSKAdNetwork('initiate_checkout', properties);
        // Forward to Meta
        if (metaIntegration.isAvailable()) {
            metaIntegration.logEvent('InitiateCheckout', value, {
                currency,
                num_items: numItems,
                content_ids: productIds,
            });
        }
        // Forward to TikTok
        if (tiktokIntegration.isAvailable()) {
            tiktokIntegration.logInitiateCheckout(value, currency, numItems);
        }
    }
    /**
     * Track complete registration event
     */
    async trackCompleteRegistration(method) {
        const properties = {};
        if (method)
            properties.method = method;
        await this.trackWithSKAdNetwork('complete_registration', properties);
        // Forward to Meta
        if (metaIntegration.isAvailable()) {
            metaIntegration.logEvent('CompleteRegistration', undefined, { registration_method: method });
        }
        // Forward to TikTok
        if (tiktokIntegration.isAvailable()) {
            tiktokIntegration.logCompleteRegistration(method);
        }
    }
    /**
     * Track search event
     */
    async trackSearch(query, resultIds) {
        const properties = { query };
        if (resultIds)
            properties.result_ids = resultIds;
        await this.track('search', properties);
        // Forward to Meta
        if (metaIntegration.isAvailable()) {
            metaIntegration.logEvent('Search', undefined, {
                search_string: query,
                content_ids: resultIds,
            });
        }
        // Forward to TikTok
        if (tiktokIntegration.isAvailable()) {
            tiktokIntegration.logSearch(query);
        }
    }
    /**
     * Track lead/contact form submission
     */
    async trackLead(value, currency) {
        const properties = {};
        if (value !== undefined)
            properties.value = value;
        if (currency)
            properties.currency = currency;
        await this.trackWithSKAdNetwork('lead', properties);
        // Forward to Meta
        if (metaIntegration.isAvailable()) {
            metaIntegration.logEvent('Lead', value, { currency });
        }
        // Forward to TikTok
        if (tiktokIntegration.isAvailable()) {
            tiktokIntegration.logLead(value, currency);
        }
    }
    /**
     * Track add payment info event
     */
    async trackAddPaymentInfo(success = true) {
        await this.track('add_payment_info', { success });
        // Forward to Meta
        if (metaIntegration.isAvailable()) {
            metaIntegration.logEvent('AddPaymentInfo', undefined, { success: success ? 1 : 0 });
        }
        // Forward to TikTok
        if (tiktokIntegration.isAvailable()) {
            tiktokIntegration.logAddPaymentInfo(success);
        }
    }
    // MARK: - Platform Integration Methods
    /**
     * Get deferred attribution data from platform SDKs
     */
    getDeferredAttributionData() {
        return metaIntegration.getDeferredDeepLinkData();
    }
    /**
     * Get platform integration status
     */
    getPlatformIntegrationStatus() {
        return {
            meta: metaIntegration.isAvailable(),
            tiktok: tiktokIntegration.isAvailable(),
            appleSearchAds: appleSearchAdsIntegration.isAvailable(),
        };
    }
    /**
     * Get Apple Search Ads attribution data
     * Returns attribution if user installed via Apple Search Ads, null otherwise
     */
    getAppleSearchAdsAttribution() {
        return appleSearchAdsIntegration.getAttributionData();
    }
    /**
     * Update tracking authorization status on all platform SDKs
     * Call this AFTER the user responds to the ATT permission dialog
     */
    async updateTrackingAuthorization(enabled) {
        if (!this.state.initialized) {
            errorLog('SDK not initialized. Call initialize() first.');
            return;
        }
        metaIntegration.updateTrackingAuthorization(enabled);
        tiktokIntegration.updateTrackingAuthorization(enabled);
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
    async handleDeferredDeepLink(data) {
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
        }
        catch (error) {
            errorLog('Error processing deferred deep link:', error);
        }
    }
    /**
     * Get conversion value for testing (doesn't send to Apple)
     */
    getConversionValue(event, properties) {
        var _a;
        return ((_a = DatalyrSDK.conversionEncoder) === null || _a === void 0 ? void 0 : _a.encode(event, properties)) || null;
    }
    // MARK: - Private Methods
    /**
     * Create an event payload with all required data
     */
    async createEventPayload(eventName, eventData) {
        const deviceInfo = await getDeviceInfo();
        const fingerprintData = await createFingerprintData();
        const attributionData = attributionManager.getAttributionData();
        // Get Apple Search Ads attribution if available
        const asaAttribution = appleSearchAdsIntegration.getAttributionData();
        const asaData = (asaAttribution === null || asaAttribution === void 0 ? void 0 : asaAttribution.attribution) ? {
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
        const payload = {
            workspaceId: this.state.config.workspaceId || 'mobile_sdk',
            visitorId: this.state.visitorId,
            anonymousId: this.state.anonymousId, // Include persistent anonymous ID
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
                network_type: getNetworkType(),
                timestamp: Date.now(),
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
            payload.eventData.userId = this.state.currentUserId;
        }
        if (Object.keys(this.state.userProperties).length > 0) {
            payload.userProperties = this.state.userProperties;
        }
        return payload;
    }
    /**
     * Load persisted user data
     */
    async loadPersistedUserData() {
        try {
            const [userId, userProperties] = await Promise.all([
                Storage.getItem(STORAGE_KEYS.USER_ID),
                Storage.getItem(STORAGE_KEYS.USER_PROPERTIES),
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
        }
        catch (error) {
            errorLog('Error loading persisted user data:', error);
        }
    }
    /**
     * Persist user data to storage
     */
    async persistUserData() {
        try {
            await Promise.all([
                this.state.currentUserId
                    ? Storage.setItem(STORAGE_KEYS.USER_ID, this.state.currentUserId)
                    : Storage.removeItem(STORAGE_KEYS.USER_ID),
                Storage.setItem(STORAGE_KEYS.USER_PROPERTIES, this.state.userProperties),
            ]);
        }
        catch (error) {
            errorLog('Error persisting user data:', error);
        }
    }
    /**
     * Set up app state monitoring for lifecycle events (optimized)
     */
    setupAppStateMonitoring() {
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
                }
                else if (nextAppState === 'active') {
                    // App became active, ensure we have fresh session if needed
                    this.refreshSession();
                    // Notify auto-events manager for session handling
                    if (this.autoEventsManager) {
                        this.autoEventsManager.handleAppForeground();
                    }
                }
            });
        }
        catch (error) {
            errorLog('Error setting up app state monitoring:', error);
        }
    }
    /**
     * Refresh session if needed
     */
    async refreshSession() {
        try {
            const newSessionId = await getOrCreateSessionId();
            if (newSessionId !== this.state.sessionId) {
                this.state.sessionId = newSessionId;
                debugLog('Session refreshed:', newSessionId);
            }
        }
        catch (error) {
            errorLog('Error refreshing session:', error);
        }
    }
    /**
     * Cleanup and destroy the SDK
     */
    destroy() {
        try {
            debugLog('Destroying Datalyr SDK');
            // Remove app state listener
            if (this.appStateSubscription) {
                this.appStateSubscription.remove();
                this.appStateSubscription = null;
            }
            // Destroy event queue
            this.eventQueue.destroy();
            // Reset state
            this.state.initialized = false;
            debugLog('Datalyr SDK destroyed');
        }
        catch (error) {
            errorLog('Error destroying SDK:', error);
        }
    }
}
DatalyrSDK.debugEnabled = false;
// Create singleton instance
const datalyr = new DatalyrSDK();
// Export enhanced Datalyr class with static methods
export class Datalyr {
    /**
     * Initialize Datalyr with SKAdNetwork conversion value encoding
     */
    static async initialize(config) {
        await datalyr.initialize(config);
    }
    /**
     * Track event with automatic SKAdNetwork conversion value encoding
     */
    static async trackWithSKAdNetwork(event, properties) {
        await datalyr.trackWithSKAdNetwork(event, properties);
    }
    /**
     * Track purchase with automatic revenue encoding
     */
    static async trackPurchase(value, currency = 'USD', productId) {
        await datalyr.trackPurchase(value, currency, productId);
    }
    /**
     * Track subscription with automatic revenue encoding
     */
    static async trackSubscription(value, currency = 'USD', plan) {
        await datalyr.trackSubscription(value, currency, plan);
    }
    /**
     * Get conversion value for testing (doesn't send to Apple)
     */
    static getConversionValue(event, properties) {
        return datalyr.getConversionValue(event, properties);
    }
    // Standard SDK methods
    static async track(eventName, eventData) {
        await datalyr.track(eventName, eventData);
    }
    static async screen(screenName, properties) {
        await datalyr.screen(screenName, properties);
    }
    static async identify(userId, properties) {
        await datalyr.identify(userId, properties);
    }
    static async alias(newUserId, previousId) {
        await datalyr.alias(newUserId, previousId);
    }
    static async reset() {
        await datalyr.reset();
    }
    static async flush() {
        await datalyr.flush();
    }
    static getStatus() {
        return datalyr.getStatus();
    }
    static getAnonymousId() {
        return datalyr.getAnonymousId();
    }
    static getAttributionData() {
        return datalyr.getAttributionData();
    }
    static async setAttributionData(data) {
        await datalyr.setAttributionData(data);
    }
    static getCurrentSession() {
        return datalyr.getCurrentSession();
    }
    static async endSession() {
        await datalyr.endSession();
    }
    static async trackAppUpdate(previousVersion, currentVersion) {
        await datalyr.trackAppUpdate(previousVersion, currentVersion);
    }
    static async trackRevenue(eventName, properties) {
        await datalyr.trackRevenue(eventName, properties);
    }
    static updateAutoEventsConfig(config) {
        datalyr.updateAutoEventsConfig(config);
    }
    // Standard e-commerce events (all forward to Meta and TikTok)
    static async trackAddToCart(value, currency = 'USD', productId, productName) {
        await datalyr.trackAddToCart(value, currency, productId, productName);
    }
    static async trackViewContent(contentId, contentName, contentType = 'product', value, currency) {
        await datalyr.trackViewContent(contentId, contentName, contentType, value, currency);
    }
    static async trackInitiateCheckout(value, currency = 'USD', numItems, productIds) {
        await datalyr.trackInitiateCheckout(value, currency, numItems, productIds);
    }
    static async trackCompleteRegistration(method) {
        await datalyr.trackCompleteRegistration(method);
    }
    static async trackSearch(query, resultIds) {
        await datalyr.trackSearch(query, resultIds);
    }
    static async trackLead(value, currency) {
        await datalyr.trackLead(value, currency);
    }
    static async trackAddPaymentInfo(success = true) {
        await datalyr.trackAddPaymentInfo(success);
    }
    // Platform integration methods
    static getDeferredAttributionData() {
        return datalyr.getDeferredAttributionData();
    }
    static getPlatformIntegrationStatus() {
        return datalyr.getPlatformIntegrationStatus();
    }
    static getAppleSearchAdsAttribution() {
        return datalyr.getAppleSearchAdsAttribution();
    }
    static async updateTrackingAuthorization(enabled) {
        await datalyr.updateTrackingAuthorization(enabled);
    }
}
// Export default instance for backward compatibility
export default datalyr;
