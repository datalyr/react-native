/**
 * Google Play Install Referrer Integration
 *
 * Provides Android install attribution via the Google Play Install Referrer API.
 * This captures UTM parameters and click IDs passed through Google Play Store.
 *
 * How it works:
 * 1. User clicks ad/link with UTM parameters
 * 2. Google Play Store stores the referrer URL
 * 3. On first app launch, SDK retrieves the referrer
 * 4. Attribution data (utm_source, utm_medium, gclid, etc.) is extracted
 *
 * Requirements:
 * - Android only (returns null on iOS)
 * - Requires Google Play Install Referrer Library in build.gradle:
 *   implementation 'com.android.installreferrer:installreferrer:2.2'
 *
 * Attribution data captured:
 * - referrer_url: Full referrer URL from Play Store
 * - referrer_click_timestamp: When the referrer link was clicked
 * - install_begin_timestamp: When the install began
 * - gclid: Google Ads click ID (standard)
 * - gbraid: Google Ads privacy-safe click ID (iOS App campaigns)
 * - wbraid: Google Ads privacy-safe click ID (Web-to-App campaigns)
 * - utm_source, utm_medium, utm_campaign, etc.
 */

import { Platform, NativeModules } from 'react-native';
import { debugLog, errorLog } from '../utils';

export interface PlayInstallReferrer {
  // Raw referrer URL from Play Store
  referrerUrl: string;
  // Timestamp when the referrer link was clicked (ms)
  referrerClickTimestamp: number;
  // Timestamp when the install began (ms)
  installBeginTimestamp: number;
  // Timestamp when install was completed (ms)
  installCompleteTimestamp?: number;
  // Google Ads click ID
  gclid?: string;
  // Google Ads privacy-safe click IDs (iOS App campaigns)
  gbraid?: string;
  // Google Ads privacy-safe click IDs (Web-to-App campaigns)
  wbraid?: string;
  // UTM Parameters
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  // Additional parameters
  [key: string]: any;
}

interface PlayInstallReferrerModule {
  getInstallReferrer(): Promise<PlayInstallReferrer | null>;
  isAvailable(): Promise<boolean>;
}

const { DatalyrPlayInstallReferrer } = NativeModules as {
  DatalyrPlayInstallReferrer?: PlayInstallReferrerModule;
};

/**
 * Google Play Install Referrer Integration
 *
 * Retrieves install attribution data from Google Play Store.
 * Only available on Android.
 */
class PlayInstallReferrerIntegration {
  private referrerData: PlayInstallReferrer | null = null;
  private initialized = false;

  /**
   * Check if Play Install Referrer is available
   */
  isAvailable(): boolean {
    return Platform.OS === 'android' && !!DatalyrPlayInstallReferrer;
  }

  /**
   * Initialize and fetch install referrer data
   * Should be called once on first app launch
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!this.isAvailable()) {
      debugLog('[PlayInstallReferrer] Not available (iOS or native module missing)');
      return;
    }

    try {
      this.referrerData = await this.fetchInstallReferrer();
      this.initialized = true;

      if (this.referrerData) {
        debugLog('[PlayInstallReferrer] Install referrer fetched:', {
          utmSource: this.referrerData.utmSource,
          utmMedium: this.referrerData.utmMedium,
          hasGclid: !!this.referrerData.gclid,
          hasGbraid: !!this.referrerData.gbraid,
          hasWbraid: !!this.referrerData.wbraid,
        });
      }
    } catch (error) {
      errorLog('[PlayInstallReferrer] Failed to initialize:', error as Error);
    }
  }

  /**
   * Fetch install referrer from Play Store
   */
  async fetchInstallReferrer(): Promise<PlayInstallReferrer | null> {
    if (!this.isAvailable()) {
      return null;
    }

    try {
      const referrer = await DatalyrPlayInstallReferrer!.getInstallReferrer();

      if (!referrer) {
        return null;
      }

      // Parse UTM parameters from referrer URL
      const parsed = this.parseReferrerUrl(referrer.referrerUrl);

      return {
        ...referrer,
        ...parsed,
      };
    } catch (error) {
      errorLog('[PlayInstallReferrer] Error fetching referrer:', error as Error);
      return null;
    }
  }

  /**
   * Parse referrer URL to extract UTM parameters and click IDs
   */
  private parseReferrerUrl(referrerUrl: string): Partial<PlayInstallReferrer> {
    const params: Partial<PlayInstallReferrer> = {};

    if (!referrerUrl) return params;

    try {
      // Referrer URL is URL-encoded, decode it first
      const decoded = decodeURIComponent(referrerUrl);
      const searchParams = new URLSearchParams(decoded);

      // Extract UTM parameters
      params.utmSource = searchParams.get('utm_source') || undefined;
      params.utmMedium = searchParams.get('utm_medium') || undefined;
      params.utmCampaign = searchParams.get('utm_campaign') || undefined;
      params.utmTerm = searchParams.get('utm_term') || undefined;
      params.utmContent = searchParams.get('utm_content') || undefined;

      // Extract click IDs (gclid, gbraid, wbraid)
      params.gclid = searchParams.get('gclid') || undefined;
      params.gbraid = searchParams.get('gbraid') || undefined;
      params.wbraid = searchParams.get('wbraid') || undefined;

      // Store any additional parameters
      const knownParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid'];
      searchParams.forEach((value, key) => {
        if (!knownParams.includes(key) && !key.startsWith('utm_')) {
          params[key] = value;
        }
      });

      debugLog('[PlayInstallReferrer] Parsed referrer URL:', params);
    } catch (error) {
      errorLog('[PlayInstallReferrer] Error parsing referrer URL:', error as Error);
    }

    return params;
  }

  /**
   * Get cached install referrer data
   */
  getReferrerData(): PlayInstallReferrer | null {
    return this.referrerData;
  }

  /**
   * Get attribution data in standard format
   */
  getAttributionData(): Record<string, any> {
    if (!this.referrerData) return {};

    return {
      // Install referrer specific
      install_referrer_url: this.referrerData.referrerUrl,
      referrer_click_timestamp: this.referrerData.referrerClickTimestamp,
      install_begin_timestamp: this.referrerData.installBeginTimestamp,

      // Google Ads click IDs (gclid is standard, gbraid/wbraid are privacy-safe alternatives)
      gclid: this.referrerData.gclid,
      gbraid: this.referrerData.gbraid,
      wbraid: this.referrerData.wbraid,

      // UTM parameters
      utm_source: this.referrerData.utmSource,
      utm_medium: this.referrerData.utmMedium,
      utm_campaign: this.referrerData.utmCampaign,
      utm_term: this.referrerData.utmTerm,
      utm_content: this.referrerData.utmContent,

      // Source indicators
      attribution_source: 'play_install_referrer',
    };
  }
}

export const playInstallReferrerIntegration = new PlayInstallReferrerIntegration();
