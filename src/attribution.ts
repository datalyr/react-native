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

export interface AttributionData {
  // Install Attribution
  install_time?: string;
  first_open_time?: string;
  
  // Datalyr LYR System (CRITICAL!)
  lyr?: string;                    // Main LYR tag for campaign tracking
  datalyr?: string;               // Alternative LYR parameter
  dl_tag?: string;                // Datalyr tag variant
  dl_campaign?: string;           // Datalyr campaign identifier
  
  // Campaign Attribution (UTM)
  utm_source?: string;            // Traffic source (facebook, google, tiktok)
  utm_medium?: string;            // Marketing medium (cpc, social, email)
  utm_campaign?: string;          // Campaign name
  utm_term?: string;              // Paid keywords
  utm_content?: string;           // Ad content/creative
  utm_id?: string;                // Campaign ID
  utm_source_platform?: string;  // Source platform details
  utm_creative_format?: string;   // Creative format
  utm_marketing_tactic?: string;  // Marketing tactic
  
  // Platform Click IDs
  fbclid?: string;                // Facebook Click ID
  ttclid?: string;                // TikTok Click ID  
  gclid?: string;                 // Google Click ID
  twclid?: string;                // Twitter Click ID
  li_click_id?: string;           // LinkedIn Click ID
  msclkid?: string;               // Microsoft Click ID
  
  // Partner & Affiliate Tracking
  partner_id?: string;            // Partner identifier
  affiliate_id?: string;          // Affiliate identifier
  referrer_id?: string;           // Referrer identifier
  source_id?: string;             // Source identifier
  
  // Campaign Details
  campaign_id?: string;           // Campaign ID
  ad_id?: string;                 // Ad ID
  adset_id?: string;              // Ad Set ID
  creative_id?: string;           // Creative ID
  placement_id?: string;          // Placement ID
  keyword?: string;               // Keyword (for search)
  matchtype?: string;             // Match type
  network?: string;               // Ad network
  device?: string;                // Device targeting
  
  // Standard Attribution Fields (mapped from UTM)
  campaign_source?: string;       // Mapped from utm_source
  campaign_medium?: string;       // Mapped from utm_medium
  campaign_name?: string;         // Mapped from utm_campaign
  campaign_term?: string;         // Mapped from utm_term
  campaign_content?: string;      // Mapped from utm_content
  
  // Additional attribution data
  referrer?: string;              // HTTP referrer
  deep_link_url?: string;         // Full deep link URL
  install_referrer?: string;      // Install referrer (Android)
  attribution_timestamp?: string; // When attribution was captured
  
  // Custom parameters
  [key: string]: any;
}

export class AttributionManager {
  private attributionData: AttributionData = {};
  private isFirstLaunch: boolean = false;

  /**
   * Initialize attribution tracking
   */
  async initialize(): Promise<void> {
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
      
    } catch (error) {
      errorLog('Failed to initialize attribution manager:', error as Error);
    }
  }

  /**
   * Check if this is the first launch and track install
   */
  private async checkFirstLaunch(): Promise<void> {
    try {
      const firstLaunchTime = await Storage.getItem<string>('@datalyr/first_launch_time');
      
      if (!firstLaunchTime) {
        // This is the first launch
        this.isFirstLaunch = true;
        const installTime = new Date().toISOString();
        
        this.attributionData.install_time = installTime;
        this.attributionData.first_open_time = installTime;
        
        await Storage.setItem('@datalyr/first_launch_time', installTime);
        debugLog('First launch detected, install time:', installTime);
      } else {
        this.isFirstLaunch = false;
        this.attributionData.install_time = firstLaunchTime;
        debugLog('Returning user, install time:', firstLaunchTime);
      }
    } catch (error) {
      errorLog('Error checking first launch:', error as Error);
    }
  }

  /**
   * Load persisted attribution data
   */
  private async loadAttributionData(): Promise<void> {
    try {
      const savedData = await Storage.getItem<AttributionData>(STORAGE_KEYS.ATTRIBUTION_DATA);
      if (savedData) {
        this.attributionData = { ...this.attributionData, ...savedData };
        debugLog('Loaded attribution data:', this.attributionData);
      }
    } catch (error) {
      errorLog('Error loading attribution data:', error as Error);
    }
  }

  /**
   * Save attribution data to storage
   */
  private async saveAttributionData(): Promise<void> {
    try {
      await Storage.setItem(STORAGE_KEYS.ATTRIBUTION_DATA, this.attributionData);
      debugLog('Attribution data saved');
    } catch (error) {
      errorLog('Error saving attribution data:', error as Error);
    }
  }

  /**
   * Set up deep link listener for when app is already running
   */
  private setupDeepLinkListener(): void {
    try {
      Linking.addEventListener('url', this.handleDeepLink.bind(this));
      debugLog('Deep link listener set up');
    } catch (error) {
      errorLog('Error setting up deep link listener:', error as Error);
    }
  }

  /**
   * Handle initial deep link when app is opened from background
   */
  private async handleInitialDeepLink(): Promise<void> {
    try {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl) {
        await this.handleDeepLink({ url: initialUrl });
        debugLog('Handled initial deep link:', initialUrl);
      }
    } catch (error) {
      errorLog('Error handling initial deep link:', error as Error);
    }
  }

  /**
   * Handle deep link URL and extract attribution parameters
   */
  private async handleDeepLink(event: { url: string }): Promise<void> {
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
      
    } catch (error) {
      errorLog('Error handling deep link:', error as Error);
    }
  }

  /**
   * Extract parameters from URL
   */
  private extractUrlParameters(url: string): Record<string, string> {
    const params: Record<string, string> = {};
    
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
      
    } catch (error) {
      errorLog('Error extracting URL parameters:', error as Error);
      return {};
    }
  }

  /**
   * Process and store attribution parameters
   */
  private async processAttributionParameters(params: Record<string, string>): Promise<void> {
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
      
    } catch (error) {
      errorLog('Error processing attribution parameters:', error as Error);
    }
  }

  /**
   * Get current attribution data
   */
  getAttributionData(): AttributionData {
    return { ...this.attributionData };
  }

  /**
   * Check if this is a first launch (install)
   */
  isInstall(): boolean {
    return this.isFirstLaunch;
  }

  /**
   * Track install event with attribution data
   */
  async trackInstall(): Promise<AttributionData> {
    if (this.isFirstLaunch) {
      debugLog('Tracking app install with attribution:', this.attributionData);
      
      // Add install-specific data
      const installData: AttributionData = {
        ...this.attributionData,
        event_type: 'install',
        install_id: generateUUID(),
      };
      
      return installData;
    }
    
    return this.attributionData;
  }

  /**
   * Merge web attribution data into mobile session
   * Called when web-to-app attribution is resolved via email
   */
  mergeWebAttribution(webAttribution: any): void {
    debugLog('Merging web attribution data:', webAttribution);

    // Only merge if we don't already have attribution data
    // Web attribution takes precedence for first-touch
    if (!this.attributionData.fbclid && webAttribution.fbclid) {
      this.attributionData.fbclid = webAttribution.fbclid;
    }
    if (!this.attributionData.gclid && webAttribution.gclid) {
      this.attributionData.gclid = webAttribution.gclid;
    }
    if (!this.attributionData.ttclid && webAttribution.ttclid) {
      this.attributionData.ttclid = webAttribution.ttclid;
    }

    // Merge UTM parameters
    if (!this.attributionData.utm_source && webAttribution.utm_source) {
      this.attributionData.utm_source = webAttribution.utm_source;
    }
    if (!this.attributionData.utm_medium && webAttribution.utm_medium) {
      this.attributionData.utm_medium = webAttribution.utm_medium;
    }
    if (!this.attributionData.utm_campaign && webAttribution.utm_campaign) {
      this.attributionData.utm_campaign = webAttribution.utm_campaign;
    }
    if (!this.attributionData.utm_content && webAttribution.utm_content) {
      this.attributionData.utm_content = webAttribution.utm_content;
    }
    if (!this.attributionData.utm_term && webAttribution.utm_term) {
      this.attributionData.utm_term = webAttribution.utm_term;
    }

    // Store web visitor ID for cross-device tracking
    this.attributionData.web_visitor_id = webAttribution.visitor_id;

    // Save merged attribution data
    this.saveAttributionData();

    debugLog('Web attribution merged successfully');
  }

  /**
   * Set custom attribution data
   */
  async setAttributionData(data: Partial<AttributionData>): Promise<void> {
    this.attributionData = { ...this.attributionData, ...data };
    await this.saveAttributionData();
    debugLog('Custom attribution data set:', data);
  }

  /**
   * Clear attribution data (for testing)
   */
  async clearAttributionData(): Promise<void> {
    this.attributionData = {};
    await Storage.removeItem(STORAGE_KEYS.ATTRIBUTION_DATA);
    await Storage.removeItem('@datalyr/first_launch_time');
    debugLog('Attribution data cleared');
  }

  /**
   * Get attribution summary for debugging
   */
  getAttributionSummary(): {
    hasAttribution: boolean;
    isInstall: boolean;
    source: string;
    campaign: string;
    clickIds: string[];
  } {
    const clickIds = [];
    if (this.attributionData.fbclid) clickIds.push(`fbclid: ${this.attributionData.fbclid}`);
    if (this.attributionData.ttclid) clickIds.push(`ttclid: ${this.attributionData.ttclid}`);
    if (this.attributionData.gclid) clickIds.push(`gclid: ${this.attributionData.gclid}`);
    
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