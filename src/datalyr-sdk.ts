import { Platform, AppState } from 'react-native';
import { 
  DatalyrConfig, 
  EventData, 
  UserProperties, 
  EventPayload, 
  SDKState,
  AppState as AppStateType,
  AutoEventConfig,
} from './types';
import { 
  getOrCreateVisitorId, 
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
import { createAutoEventsManager, AutoEventsManager, SessionData } from './auto-events';

export class DatalyrSDK {
  private state: SDKState;
  private httpClient: HttpClient;
  private eventQueue: EventQueue;
  private autoEventsManager: AutoEventsManager | null = null;
  private appStateSubscription: any = null;

  constructor() {
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
      if (!config.workspaceId) {
        throw new Error('workspaceId is required');
      }

      // Set up configuration
      this.state.config = { ...this.state.config, ...config };

      // Initialize HTTP client
      this.httpClient = new HttpClient(this.state.config.endpoint!, {
        maxRetries: this.state.config.maxRetries || 3,
        retryDelay: this.state.config.retryDelay || 1000,
        timeout: 15000,
      });

      // Initialize event queue
      this.eventQueue = new EventQueue(this.httpClient, {
        maxQueueSize: this.state.config.maxQueueSize || 100,
        batchSize: this.state.config.batchSize || 10,
        flushInterval: this.state.config.flushInterval || 30000,
        maxRetryCount: this.state.config.maxRetries || 3,
      });

      // Initialize visitor ID and session
      this.state.visitorId = await getOrCreateVisitorId();
      this.state.sessionId = await getOrCreateSessionId();

      // Load persisted user data
      await this.loadPersistedUserData();

      // Initialize attribution manager
      if (this.state.config.enableAttribution) {
        await attributionManager.initialize();
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

      // Check for app install
      if (attributionManager.isInstall()) {
        const installData = await attributionManager.trackInstall();
        await this.track('app_install', {
          platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'android',
          sdk_version: '1.0.0',
          ...installData,
        });
      }

      // SDK initialized successfully (no need to track this event)

      this.state.initialized = true;
      debugLog('Datalyr SDK initialized successfully', {
        workspaceId: this.state.config.workspaceId,
        visitorId: this.state.visitorId,
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

    await this.track('pageviews', screenData);

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

      // Track identify event
      await this.track('identify', { 
        userId, 
        ...properties 
      });

    } catch (error) {
      errorLog('Error identifying user:', error as Error);
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
    sessionId: string;
    currentUserId?: string;
    queueStats: any;
    attribution: any;
  } {
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
  getAttributionData(): AttributionData {
    return attributionManager.getAttributionData();
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

  /**
   * Create an event payload with all required data
   */
  private async createEventPayload(eventName: string, eventData?: EventData): Promise<EventPayload> {
    const deviceInfo = await getDeviceInfo();
    const fingerprintData = await createFingerprintData();
    const attributionData = attributionManager.getAttributionData();

    const payload: EventPayload = {
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