interface AutoEventConfig {
    trackSessions: boolean;
    trackScreenViews: boolean;
    trackAppUpdates: boolean;
    trackPerformance: boolean;
    sessionTimeoutMs: number;
}
export interface SessionData {
    sessionId: string;
    startTime: number;
    lastActivity: number;
    screenViews: number;
    events: number;
}
export declare class AutoEventsManager {
    private config;
    private currentSession;
    private lastScreenName;
    private performanceMarks;
    private trackEvent;
    constructor(trackEvent: (eventName: string, properties: Record<string, any>) => Promise<void>, config?: Partial<AutoEventConfig>);
    /**
     * Initialize automatic event tracking
     */
    initialize(): Promise<void>;
    /**
     * Start a new session
     */
    private startSession;
    /**
     * End current session
     */
    private endSession;
    /**
     * Setup session monitoring (app state changes)
     * In a real implementation, this would use React Native's AppState
     */
    private setupSessionMonitoring;
    /**
     * Handle app coming to foreground (optimized - less noise)
     */
    handleAppForeground(): Promise<void>;
    /**
     * Handle app going to background (optimized - less noise)
     */
    handleAppBackground(): Promise<void>;
    /**
     * Track automatic screen view
     */
    trackScreenView(screenName: string, properties?: Record<string, any>): Promise<void>;
    /**
     * Track app launch performance
     */
    private trackAppLaunchTime;
    /**
     * Track automatic app update
     */
    trackAppUpdate(previousVersion: string, currentVersion: string): Promise<void>;
    /**
     * Track revenue event (purchases, subscriptions)
     */
    trackRevenueEvent(eventName: string, properties?: Record<string, any>): Promise<void>;
    /**
     * Track custom automatic event (called by SDK)
     */
    onEvent(eventName: string): Promise<void>;
    /**
     * Get current session info
     */
    getCurrentSession(): SessionData | null;
    /**
     * Force end current session
     */
    forceEndSession(): Promise<void>;
    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<AutoEventConfig>): void;
    /**
     * Cleanup and destroy
     */
    destroy(): void;
}
export declare let autoEventsManager: AutoEventsManager | null;
export declare const createAutoEventsManager: (trackEvent: (eventName: string, properties: Record<string, any>) => Promise<void>, config?: Partial<AutoEventConfig>) => AutoEventsManager;
export {};
