import { DatalyrConfig, EventData, UserProperties, AutoEventConfig } from './types';
import { AttributionData } from './attribution';
import { SessionData } from './auto-events';
export declare class DatalyrSDK {
    private state;
    private httpClient;
    private eventQueue;
    private autoEventsManager;
    private appStateSubscription;
    constructor();
    /**
     * Initialize the SDK with configuration
     */
    initialize(config: DatalyrConfig): Promise<void>;
    /**
     * Track a custom event
     */
    track(eventName: string, eventData?: EventData): Promise<void>;
    /**
     * Track a screen view
     */
    screen(screenName: string, properties?: EventData): Promise<void>;
    /**
     * Identify a user
     */
    identify(userId: string, properties?: UserProperties): Promise<void>;
    /**
     * Alias a user (connect anonymous user to known user)
     */
    alias(newUserId: string, previousId?: string): Promise<void>;
    /**
     * Reset user data (logout)
     */
    reset(): Promise<void>;
    /**
     * Flush queued events immediately
     */
    flush(): Promise<void>;
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
    };
    /**
     * Get detailed attribution data
     */
    getAttributionData(): AttributionData;
    /**
     * Set custom attribution data (for testing or manual attribution)
     */
    setAttributionData(data: Partial<AttributionData>): Promise<void>;
    /**
     * Get current session information from auto-events
     */
    getCurrentSession(): SessionData | null;
    /**
     * Force end current session
     */
    endSession(): Promise<void>;
    /**
     * Track app update manually
     */
    trackAppUpdate(previousVersion: string, currentVersion: string): Promise<void>;
    /**
     * Track revenue event manually (purchases, subscriptions)
     */
    trackRevenue(eventName: string, properties?: EventData): Promise<void>;
    /**
     * Update auto-events configuration
     */
    updateAutoEventsConfig(config: Partial<AutoEventConfig>): void;
    /**
     * Create an event payload with all required data
     */
    private createEventPayload;
    /**
     * Load persisted user data
     */
    private loadPersistedUserData;
    /**
     * Persist user data to storage
     */
    private persistUserData;
    /**
     * Set up app state monitoring for lifecycle events (optimized)
     */
    private setupAppStateMonitoring;
    /**
     * Refresh session if needed
     */
    private refreshSession;
    /**
     * Cleanup and destroy the SDK
     */
    destroy(): void;
}
