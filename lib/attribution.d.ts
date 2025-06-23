export interface AttributionData {
    install_time?: string;
    first_open_time?: string;
    lyr?: string;
    datalyr?: string;
    dl_tag?: string;
    dl_campaign?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_term?: string;
    utm_content?: string;
    utm_id?: string;
    utm_source_platform?: string;
    utm_creative_format?: string;
    utm_marketing_tactic?: string;
    fbclid?: string;
    ttclid?: string;
    gclid?: string;
    twclid?: string;
    li_click_id?: string;
    msclkid?: string;
    partner_id?: string;
    affiliate_id?: string;
    referrer_id?: string;
    source_id?: string;
    campaign_id?: string;
    ad_id?: string;
    adset_id?: string;
    creative_id?: string;
    placement_id?: string;
    keyword?: string;
    matchtype?: string;
    network?: string;
    device?: string;
    campaign_source?: string;
    campaign_medium?: string;
    campaign_name?: string;
    campaign_term?: string;
    campaign_content?: string;
    referrer?: string;
    deep_link_url?: string;
    install_referrer?: string;
    attribution_timestamp?: string;
    [key: string]: any;
}
export declare class AttributionManager {
    private attributionData;
    private isFirstLaunch;
    /**
     * Initialize attribution tracking
     */
    initialize(): Promise<void>;
    /**
     * Check if this is the first launch and track install
     */
    private checkFirstLaunch;
    /**
     * Load persisted attribution data
     */
    private loadAttributionData;
    /**
     * Save attribution data to storage
     */
    private saveAttributionData;
    /**
     * Set up deep link listener for when app is already running
     */
    private setupDeepLinkListener;
    /**
     * Handle initial deep link when app is opened from background
     */
    private handleInitialDeepLink;
    /**
     * Handle deep link URL and extract attribution parameters
     */
    private handleDeepLink;
    /**
     * Extract parameters from URL
     */
    private extractUrlParameters;
    /**
     * Process and store attribution parameters
     */
    private processAttributionParameters;
    /**
     * Get current attribution data
     */
    getAttributionData(): AttributionData;
    /**
     * Check if this is a first launch (install)
     */
    isInstall(): boolean;
    /**
     * Track install event with attribution data
     */
    trackInstall(): Promise<AttributionData>;
    /**
     * Set custom attribution data
     */
    setAttributionData(data: Partial<AttributionData>): Promise<void>;
    /**
     * Clear attribution data (for testing)
     */
    clearAttributionData(): Promise<void>;
    /**
     * Get attribution summary for debugging
     */
    getAttributionSummary(): {
        hasAttribution: boolean;
        isInstall: boolean;
        source: string;
        campaign: string;
        clickIds: string[];
    };
}
export declare const attributionManager: AttributionManager;
