import { Linking } from 'react-native';
import { Storage, STORAGE_KEYS, debugLog, errorLog, generateUUID } from './utils';
// Attribution parameter mapping
const ATTRIBUTION_PARAMS = [
    // Datalyr LYR tags (CRITICAL for your system!)
    'lyr', 'datalyr', 'dl_tag', 'dl_campaign',
    // Facebook/Meta
    'fbclid', 'fb_click_id', 'fb_action_ids', 'fb_action_types',
    // TikTok
    'ttclid', 'tt_click_id', 'tiktok_click_id',
    // Google Ads
    'gclid', 'wbraid', 'gbraid', 'dclid',
    // UTM Parameters (Standard)
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
    // Partner tracking parameters
    'partner_id', 'affiliate_id', 'referrer_id', 'source_id',
    // Other platforms
    'twclid', 'li_click_id', 'msclkid', 'irclickid',
    // Custom attribution parameters
    'click_id', 'campaign_id', 'ad_id', 'adset_id', 'creative_id',
    'placement_id', 'keyword', 'matchtype', 'network', 'device',
];
export class AttributionManager {
    constructor() {
        this.attributionData = {};
        this.isFirstLaunch = false;
    }
    /**
     * Initialize attribution tracking
     */
    async initialize() {
        try {
            debugLog('Initializing attribution manager...');
            // Check if this is first launch
            await this.checkFirstLaunch();
            // Load existing attribution data
            await this.loadAttributionData();
            // Set up deep link listener
            this.setupDeepLinkListener();
            // Handle initial deep link (if app was opened from one)
            await this.handleInitialDeepLink();
            debugLog('Attribution manager initialized', this.attributionData);
        }
        catch (error) {
            errorLog('Failed to initialize attribution manager:', error);
        }
    }
    /**
     * Check if this is the first launch and track install
     */
    async checkFirstLaunch() {
        try {
            const firstLaunchTime = await Storage.getItem('@datalyr/first_launch_time');
            if (!firstLaunchTime) {
                // This is the first launch
                this.isFirstLaunch = true;
                const installTime = new Date().toISOString();
                this.attributionData.install_time = installTime;
                this.attributionData.first_open_time = installTime;
                await Storage.setItem('@datalyr/first_launch_time', installTime);
                debugLog('First launch detected, install time:', installTime);
            }
            else {
                this.isFirstLaunch = false;
                this.attributionData.install_time = firstLaunchTime;
                debugLog('Returning user, install time:', firstLaunchTime);
            }
        }
        catch (error) {
            errorLog('Error checking first launch:', error);
        }
    }
    /**
     * Load persisted attribution data
     */
    async loadAttributionData() {
        try {
            const savedData = await Storage.getItem(STORAGE_KEYS.ATTRIBUTION_DATA);
            if (savedData) {
                this.attributionData = { ...this.attributionData, ...savedData };
                debugLog('Loaded attribution data:', this.attributionData);
            }
        }
        catch (error) {
            errorLog('Error loading attribution data:', error);
        }
    }
    /**
     * Save attribution data to storage
     */
    async saveAttributionData() {
        try {
            await Storage.setItem(STORAGE_KEYS.ATTRIBUTION_DATA, this.attributionData);
            debugLog('Attribution data saved');
        }
        catch (error) {
            errorLog('Error saving attribution data:', error);
        }
    }
    /**
     * Set up deep link listener for when app is already running
     */
    setupDeepLinkListener() {
        try {
            Linking.addEventListener('url', this.handleDeepLink.bind(this));
            debugLog('Deep link listener set up');
        }
        catch (error) {
            errorLog('Error setting up deep link listener:', error);
        }
    }
    /**
     * Handle initial deep link when app is opened from background
     */
    async handleInitialDeepLink() {
        try {
            const initialUrl = await Linking.getInitialURL();
            if (initialUrl) {
                await this.handleDeepLink({ url: initialUrl });
                debugLog('Handled initial deep link:', initialUrl);
            }
        }
        catch (error) {
            errorLog('Error handling initial deep link:', error);
        }
    }
    /**
     * Handle deep link URL and extract attribution parameters
     */
    async handleDeepLink(event) {
        try {
            const url = event.url;
            debugLog('Processing deep link:', url);
            // Store the deep link URL
            this.attributionData.deep_link_url = url;
            // Extract parameters from URL
            const urlParams = this.extractUrlParameters(url);
            // Process attribution parameters
            await this.processAttributionParameters(urlParams);
            // Save updated attribution data
            await this.saveAttributionData();
        }
        catch (error) {
            errorLog('Error handling deep link:', error);
        }
    }
    /**
     * Extract parameters from URL
     */
    extractUrlParameters(url) {
        const params = {};
        try {
            const urlObj = new URL(url);
            // Extract query parameters
            urlObj.searchParams.forEach((value, key) => {
                params[key.toLowerCase()] = value;
            });
            // Also check fragment for parameters (some platforms use #)
            if (urlObj.hash) {
                const hashParams = new URLSearchParams(urlObj.hash.substring(1));
                hashParams.forEach((value, key) => {
                    params[key.toLowerCase()] = value;
                });
            }
            debugLog('Extracted URL parameters:', params);
            return params;
        }
        catch (error) {
            errorLog('Error extracting URL parameters:', error);
            return {};
        }
    }
    /**
     * Process and store attribution parameters
     */
    async processAttributionParameters(params) {
        try {
            let hasNewAttribution = false;
            // Process each attribution parameter
            ATTRIBUTION_PARAMS.forEach(paramName => {
                const value = params[paramName.toLowerCase()];
                if (value) {
                    // Map to standard attribution fields
                    switch (paramName.toLowerCase()) {
                        // Datalyr LYR System (PRIORITY!)
                        case 'lyr':
                        case 'datalyr':
                        case 'dl_tag':
                            this.attributionData.lyr = value;
                            debugLog(`🎯 LYR tag captured: ${value}`);
                            break;
                        case 'dl_campaign':
                            this.attributionData.dl_campaign = value;
                            break;
                        // UTM Parameters (store both raw and mapped)
                        case 'utm_source':
                            this.attributionData.utm_source = value;
                            this.attributionData.campaign_source = value; // Also map to standard field
                            break;
                        case 'utm_medium':
                            this.attributionData.utm_medium = value;
                            this.attributionData.campaign_medium = value;
                            break;
                        case 'utm_campaign':
                            this.attributionData.utm_campaign = value;
                            this.attributionData.campaign_name = value;
                            break;
                        case 'utm_term':
                            this.attributionData.utm_term = value;
                            this.attributionData.campaign_term = value;
                            break;
                        case 'utm_content':
                            this.attributionData.utm_content = value;
                            this.attributionData.campaign_content = value;
                            break;
                        case 'utm_id':
                            this.attributionData.utm_id = value;
                            break;
                        case 'utm_source_platform':
                            this.attributionData.utm_source_platform = value;
                            break;
                        case 'utm_creative_format':
                            this.attributionData.utm_creative_format = value;
                            break;
                        case 'utm_marketing_tactic':
                            this.attributionData.utm_marketing_tactic = value;
                            break;
                        // Platform Click IDs
                        case 'fbclid':
                        case 'fb_click_id':
                            this.attributionData.fbclid = value;
                            break;
                        case 'ttclid':
                        case 'tt_click_id':
                        case 'tiktok_click_id':
                            this.attributionData.ttclid = value;
                            break;
                        case 'gclid':
                            this.attributionData.gclid = value;
                            break;
                        case 'twclid':
                            this.attributionData.twclid = value;
                            break;
                        case 'li_click_id':
                            this.attributionData.li_click_id = value;
                            break;
                        case 'msclkid':
                            this.attributionData.msclkid = value;
                            break;
                        // Partner & Affiliate
                        case 'partner_id':
                            this.attributionData.partner_id = value;
                            break;
                        case 'affiliate_id':
                            this.attributionData.affiliate_id = value;
                            break;
                        case 'referrer_id':
                            this.attributionData.referrer_id = value;
                            break;
                        case 'source_id':
                            this.attributionData.source_id = value;
                            break;
                        // Campaign Details
                        case 'campaign_id':
                            this.attributionData.campaign_id = value;
                            break;
                        case 'ad_id':
                            this.attributionData.ad_id = value;
                            break;
                        case 'adset_id':
                            this.attributionData.adset_id = value;
                            break;
                        case 'creative_id':
                            this.attributionData.creative_id = value;
                            break;
                        case 'placement_id':
                            this.attributionData.placement_id = value;
                            break;
                        case 'keyword':
                            this.attributionData.keyword = value;
                            break;
                        case 'matchtype':
                            this.attributionData.matchtype = value;
                            break;
                        case 'network':
                            this.attributionData.network = value;
                            break;
                        case 'device':
                            this.attributionData.device = value;
                            break;
                        default:
                            // Store other parameters as-is (for custom tracking)
                            this.attributionData[paramName] = value;
                    }
                    hasNewAttribution = true;
                    debugLog(`Attribution parameter captured: ${paramName} = ${value}`);
                }
            });
            if (hasNewAttribution) {
                // Store timestamp of when attribution was captured
                this.attributionData.attribution_timestamp = new Date().toISOString();
                debugLog('Updated attribution data:', this.attributionData);
            }
        }
        catch (error) {
            errorLog('Error processing attribution parameters:', error);
        }
    }
    /**
     * Get current attribution data
     */
    getAttributionData() {
        return { ...this.attributionData };
    }
    /**
     * Check if this is a first launch (install)
     */
    isInstall() {
        return this.isFirstLaunch;
    }
    /**
     * Track install event with attribution data
     */
    async trackInstall() {
        if (this.isFirstLaunch) {
            debugLog('Tracking app install with attribution:', this.attributionData);
            // Add install-specific data
            const installData = {
                ...this.attributionData,
                event_type: 'install',
                install_id: generateUUID(),
            };
            return installData;
        }
        return this.attributionData;
    }
    /**
     * Set custom attribution data
     */
    async setAttributionData(data) {
        this.attributionData = { ...this.attributionData, ...data };
        await this.saveAttributionData();
        debugLog('Custom attribution data set:', data);
    }
    /**
     * Clear attribution data (for testing)
     */
    async clearAttributionData() {
        this.attributionData = {};
        await Storage.removeItem(STORAGE_KEYS.ATTRIBUTION_DATA);
        await Storage.removeItem('@datalyr/first_launch_time');
        debugLog('Attribution data cleared');
    }
    /**
     * Get attribution summary for debugging
     */
    getAttributionSummary() {
        const clickIds = [];
        if (this.attributionData.fbclid)
            clickIds.push(`fbclid: ${this.attributionData.fbclid}`);
        if (this.attributionData.ttclid)
            clickIds.push(`ttclid: ${this.attributionData.ttclid}`);
        if (this.attributionData.gclid)
            clickIds.push(`gclid: ${this.attributionData.gclid}`);
        return {
            hasAttribution: Object.keys(this.attributionData).length > 2, // More than just install times
            isInstall: this.isFirstLaunch,
            source: this.attributionData.campaign_source || 'unknown',
            campaign: this.attributionData.campaign_name || 'unknown',
            clickIds,
        };
    }
}
// Export singleton instance
export const attributionManager = new AttributionManager();
