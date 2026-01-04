import { DatalyrConfig, EventData, UserProperties, AutoEventConfig, DeferredDeepLinkResult } from './types';
import { AttributionData } from './attribution';
import { SessionData } from './auto-events';
import { AppleSearchAdsAttribution } from './native/DatalyrNativeBridge';
export declare class DatalyrSDK {
    private state;
    private httpClient;
    private eventQueue;
    private autoEventsManager;
    private appStateSubscription;
    private static conversionEncoder?;
    private static debugEnabled;
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
     * Fetch web attribution data for user and merge into mobile session
     * Called automatically during identify() if email is provided
     */
    private fetchAndMergeWebAttribution;
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
        anonymousId: string;
        sessionId: string;
        currentUserId?: string;
        queueStats: any;
        attribution: any;
        journey: any;
    };
    /**
     * Get the persistent anonymous ID
     */
    getAnonymousId(): string;
    /**
     * Get detailed attribution data (includes journey tracking data)
     */
    getAttributionData(): AttributionData & Record<string, any>;
    /**
     * Get journey tracking summary
     */
    getJourneySummary(): {
        hasFirstTouch: boolean;
        hasLastTouch: boolean;
        touchpointCount: number;
        daysSinceFirstTouch: number;
        sources: string[];
    };
    /**
     * Get full customer journey (all touchpoints)
     */
    getJourney(): import("./journey").TouchPoint[];
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
     * Track event with automatic SKAdNetwork conversion value encoding
     * Uses SKAN 4.0 on iOS 16.1+ with coarse values and lock window support
     */
    trackWithSKAdNetwork(event: string, properties?: EventData): Promise<void>;
    /**
     * Track purchase with automatic revenue encoding and platform forwarding
     */
    trackPurchase(value: number, currency?: string, productId?: string): Promise<void>;
    /**
     * Track subscription with automatic revenue encoding and platform forwarding
     */
    trackSubscription(value: number, currency?: string, plan?: string): Promise<void>;
    /**
     * Track add to cart event
     */
    trackAddToCart(value: number, currency?: string, productId?: string, productName?: string): Promise<void>;
    /**
     * Track view content/product event
     */
    trackViewContent(contentId?: string, contentName?: string, contentType?: string, value?: number, currency?: string): Promise<void>;
    /**
     * Track initiate checkout event
     */
    trackInitiateCheckout(value: number, currency?: string, numItems?: number, productIds?: string[]): Promise<void>;
    /**
     * Track complete registration event
     */
    trackCompleteRegistration(method?: string): Promise<void>;
    /**
     * Track search event
     */
    trackSearch(query: string, resultIds?: string[]): Promise<void>;
    /**
     * Track lead/contact form submission
     */
    trackLead(value?: number, currency?: string): Promise<void>;
    /**
     * Track add payment info event
     */
    trackAddPaymentInfo(success?: boolean): Promise<void>;
    /**
     * Get deferred attribution data from platform SDKs
     */
    getDeferredAttributionData(): DeferredDeepLinkResult | null;
    /**
     * Get platform integration status
     */
    getPlatformIntegrationStatus(): {
        meta: boolean;
        tiktok: boolean;
        appleSearchAds: boolean;
        playInstallReferrer: boolean;
    };
    /**
     * Get Apple Search Ads attribution data
     * Returns attribution if user installed via Apple Search Ads, null otherwise
     */
    getAppleSearchAdsAttribution(): AppleSearchAdsAttribution | null;
    /**
     * Get Google Play Install Referrer attribution data (Android only)
     * Returns referrer data if available, null otherwise
     */
    getPlayInstallReferrer(): Record<string, any> | null;
    /**
     * Update tracking authorization status on all platform SDKs
     * Call this AFTER the user responds to the ATT permission dialog
     */
    updateTrackingAuthorization(enabled: boolean): Promise<void>;
    /**
     * Handle deferred deep link data from platform SDKs
     */
    private handleDeferredDeepLink;
    /**
     * Get conversion value for testing (doesn't send to Apple)
     */
    getConversionValue(event: string, properties?: Record<string, any>): number | null;
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
declare const datalyr: DatalyrSDK;
export declare class Datalyr {
    /**
     * Initialize Datalyr with SKAdNetwork conversion value encoding
     */
    static initialize(config: DatalyrConfig): Promise<void>;
    /**
     * Track event with automatic SKAdNetwork conversion value encoding
     */
    static trackWithSKAdNetwork(event: string, properties?: Record<string, any>): Promise<void>;
    /**
     * Track purchase with automatic revenue encoding
     */
    static trackPurchase(value: number, currency?: string, productId?: string): Promise<void>;
    /**
     * Track subscription with automatic revenue encoding
     */
    static trackSubscription(value: number, currency?: string, plan?: string): Promise<void>;
    /**
     * Get conversion value for testing (doesn't send to Apple)
     */
    static getConversionValue(event: string, properties?: Record<string, any>): number | null;
    static track(eventName: string, eventData?: EventData): Promise<void>;
    static screen(screenName: string, properties?: EventData): Promise<void>;
    static identify(userId: string, properties?: UserProperties): Promise<void>;
    static alias(newUserId: string, previousId?: string): Promise<void>;
    static reset(): Promise<void>;
    static flush(): Promise<void>;
    static getStatus(): {
        initialized: boolean;
        workspaceId: string;
        visitorId: string;
        anonymousId: string;
        sessionId: string;
        currentUserId?: string;
        queueStats: any;
        attribution: any;
        journey: any;
    };
    static getAnonymousId(): string;
    static getAttributionData(): AttributionData;
    static setAttributionData(data: Partial<AttributionData>): Promise<void>;
    static getCurrentSession(): SessionData | null;
    static endSession(): Promise<void>;
    static trackAppUpdate(previousVersion: string, currentVersion: string): Promise<void>;
    static trackRevenue(eventName: string, properties?: EventData): Promise<void>;
    static updateAutoEventsConfig(config: Partial<AutoEventConfig>): void;
    static trackAddToCart(value: number, currency?: string, productId?: string, productName?: string): Promise<void>;
    static trackViewContent(contentId?: string, contentName?: string, contentType?: string, value?: number, currency?: string): Promise<void>;
    static trackInitiateCheckout(value: number, currency?: string, numItems?: number, productIds?: string[]): Promise<void>;
    static trackCompleteRegistration(method?: string): Promise<void>;
    static trackSearch(query: string, resultIds?: string[]): Promise<void>;
    static trackLead(value?: number, currency?: string): Promise<void>;
    static trackAddPaymentInfo(success?: boolean): Promise<void>;
    static getDeferredAttributionData(): DeferredDeepLinkResult | null;
    static getPlatformIntegrationStatus(): {
        meta: boolean;
        tiktok: boolean;
        appleSearchAds: boolean;
    };
    static getAppleSearchAdsAttribution(): AppleSearchAdsAttribution | null;
    static updateTrackingAuthorization(enabled: boolean): Promise<void>;
}
export default datalyr;
