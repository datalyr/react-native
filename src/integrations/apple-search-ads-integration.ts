/**
 * Apple Search Ads Attribution Integration
 * Uses AdServices framework (iOS 14.3+) to capture attribution from App Store search ads
 */

import { Platform } from 'react-native';
import { AppleSearchAdsNativeBridge, AppleSearchAdsAttribution, isNativeModuleAvailable } from '../native/DatalyrNativeBridge';

/**
 * Apple Search Ads Integration class
 * Fetches attribution data for users who installed via Apple Search Ads
 */
export class AppleSearchAdsIntegration {
  private attributionData: AppleSearchAdsAttribution | null = null;
  private fetched: boolean = false;
  private available: boolean = false;
  private debug: boolean = false;

  /**
   * Initialize and fetch Apple Search Ads attribution
   */
  async initialize(debug: boolean = false): Promise<void> {
    this.debug = debug;

    // Only available on iOS via native module
    if (Platform.OS !== 'ios') {
      this.log('Apple Search Ads only available on iOS');
      return;
    }

    this.available = isNativeModuleAvailable();

    if (!this.available) {
      this.log('Apple Search Ads native module not available');
      return;
    }

    // Automatically fetch attribution on init
    await this.fetchAttribution();
  }

  /**
   * Fetch attribution data from Apple's AdServices API
   * Call this during app initialization
   */
  async fetchAttribution(): Promise<AppleSearchAdsAttribution | null> {
    if (!this.available) {
      return null;
    }

    // Only fetch once
    if (this.fetched) {
      return this.attributionData;
    }

    try {
      this.attributionData = await AppleSearchAdsNativeBridge.getAttribution();
      this.fetched = true;

      if (this.attributionData?.attribution) {
        this.log('Apple Search Ads attribution found:', {
          campaignId: this.attributionData.campaignId,
          campaignName: this.attributionData.campaignName,
          adGroupId: this.attributionData.adGroupId,
          keyword: this.attributionData.keyword,
        });
      } else {
        this.log('No Apple Search Ads attribution (user did not come from search ad)');
      }

      return this.attributionData;
    } catch (error) {
      this.logError('Failed to fetch Apple Search Ads attribution:', error);
      this.fetched = true;
      return null;
    }
  }

  /**
   * Get cached attribution data
   */
  getAttributionData(): AppleSearchAdsAttribution | null {
    return this.attributionData;
  }

  /**
   * Check if user came from Apple Search Ads
   */
  hasAttribution(): boolean {
    return this.attributionData?.attribution === true;
  }

  /**
   * Check if Apple Search Ads is available (iOS 14.3+)
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Check if attribution has been fetched
   */
  hasFetched(): boolean {
    return this.fetched;
  }

  private log(message: string, data?: any): void {
    if (this.debug) {
      console.log(`[Datalyr/AppleSearchAds] ${message}`, data || '');
    }
  }

  private logError(message: string, error: any): void {
    console.error(`[Datalyr/AppleSearchAds] ${message}`, error);
  }
}

// Export singleton instance
export const appleSearchAdsIntegration = new AppleSearchAdsIntegration();
