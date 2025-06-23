import { Platform, AppState } from 'react-native';
import { getOrCreateVisitorId, getOrCreateSessionId, createFingerprintData, generateUUID, getDeviceInfo, getNetworkType, validateEventName, validateEventData, debugLog, errorLog, Storage, STORAGE_KEYS, } from './utils';
import { createHttpClient } from './http-client';
import { createEventQueue } from './event-queue';
import { attributionManager } from './attribution';
import { createAutoEventsManager } from './auto-events';
export class DatalyrSDK {
    constructor() {
        this.autoEventsManager = null;
        this.appStateSubscription = null;
        // Initialize state with defaults
        this.state = {
            initialized: false,
            config: {
                workspaceId: '',
                debug: false,
                endpoint: 'https://datalyr-ingest.datalyr-ingest.workers.dev',
                maxRetries: 3,
                retryDelay: 1000,
                batchSize: 10,
                flushInterval: 10000,
                maxQueueSize: 100,
                respectDoNotTrack: true,
            },
            visitorId: '',
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
     * Initialize the SDK
     */
    async initialize(config) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        try {
            debugLog('Initializing Datalyr SDK...', config);
            // Validate required config
            if (!config.workspaceId) {
                throw new Error('workspaceId is required');
            }
            // Update configuration
            this.state.config = { ...this.state.config, ...config };
            // Set up HTTP client with new config
            this.httpClient = createHttpClient(this.state.config.endpoint, {
                maxRetries: this.state.config.maxRetries,
                retryDelay: this.state.config.retryDelay,
                timeout: 15000,
            });
            // Set up event queue
            this.eventQueue = createEventQueue(this.httpClient, {
                maxQueueSize: this.state.config.maxQueueSize,
                batchSize: this.state.config.batchSize,
                flushInterval: this.state.config.flushInterval,
                maxRetryCount: this.state.config.maxRetries,
            });
            // Initialize identifiers
            this.state.visitorId = await getOrCreateVisitorId();
            this.state.sessionId = await getOrCreateSessionId();
            // Initialize attribution manager
            await attributionManager.initialize();
            // Initialize automatic events manager
            this.autoEventsManager = createAutoEventsManager(async (eventName, properties) => {
                await this.track(eventName, properties);
            }, {
                trackSessions: (_b = (_a = this.state.config.autoEvents) === null || _a === void 0 ? void 0 : _a.trackSessions) !== null && _b !== void 0 ? _b : true,
                trackScreenViews: (_d = (_c = this.state.config.autoEvents) === null || _c === void 0 ? void 0 : _c.trackScreenViews) !== null && _d !== void 0 ? _d : true,
                trackAppUpdates: (_f = (_e = this.state.config.autoEvents) === null || _e === void 0 ? void 0 : _e.trackAppUpdates) !== null && _f !== void 0 ? _f : true,
                trackPerformance: (_h = (_g = this.state.config.autoEvents) === null || _g === void 0 ? void 0 : _g.trackPerformance) !== null && _h !== void 0 ? _h : true,
                sessionTimeoutMs: (_k = (_j = this.state.config.autoEvents) === null || _j === void 0 ? void 0 : _j.sessionTimeoutMs) !== null && _k !== void 0 ? _k : 30 * 60 * 1000,
            });
            await this.autoEventsManager.initialize();
            // Load persisted user data
            await this.loadPersistedUserData();
            // Set up app state monitoring
            this.setupAppStateMonitoring();
            // Track initialization and install if first launch
            if (attributionManager.isInstall()) {
                const installData = await attributionManager.trackInstall();
                await this.track('app_install', {
                    platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'android',
                    sdk_version: '1.0.0',
                    ...installData,
                });
            }
            // Track initialization
            await this.track('sdk_initialized', {
                platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'android',
                sdk_version: '1.0.0',
            });
            this.state.initialized = true;
            debugLog('Datalyr SDK initialized successfully', {
                workspaceId: this.state.config.workspaceId,
                visitorId: this.state.visitorId,
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
        await this.track('screen_view', screenData);
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
            // Track identify event
            await this.track('identify', {
                userId,
                ...properties
            });
        }
        catch (error) {
            errorLog('Error identifying user:', error);
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
            workspaceId: this.state.config.workspaceId,
            visitorId: this.state.visitorId,
            sessionId: this.state.sessionId,
            currentUserId: this.state.currentUserId,
            queueStats: this.eventQueue.getStats(),
            attribution: attributionManager.getAttributionSummary(),
        };
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
    /**
     * Create an event payload with all required data
     */
    async createEventPayload(eventName, eventData) {
        const deviceInfo = await getDeviceInfo();
        const fingerprintData = await createFingerprintData();
        const attributionData = attributionManager.getAttributionData();
        const payload = {
            workspaceId: this.state.config.workspaceId,
            visitorId: this.state.visitorId,
            sessionId: this.state.sessionId,
            eventId: generateUUID(),
            eventName,
            eventData: {
                ...eventData,
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
     * Set up app state monitoring for lifecycle events
     */
    setupAppStateMonitoring() {
        try {
            // Track current app state
            this.track('app_state_change', {
                app_state: AppState.currentState,
            });
            // Listen for app state changes
            this.appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
                debugLog('App state changed:', nextAppState);
                this.track('app_state_change', {
                    app_state: nextAppState,
                });
                // Handle app backgrounding/foregrounding
                if (nextAppState === 'background') {
                    // Flush events before going to background
                    this.flush();
                }
                else if (nextAppState === 'active') {
                    // App became active, ensure we have fresh session if needed
                    this.refreshSession();
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
