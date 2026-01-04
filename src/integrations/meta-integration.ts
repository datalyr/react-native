/**
 * Meta (Facebook) SDK Integration
 * Uses bundled native iOS SDK for deferred deep linking, event forwarding, and Advanced Matching
 */

import { Platform } from 'react-native';
import { MetaConfig, DeferredDeepLinkResult } from '../types';
import { MetaNativeBridge, isNativeModuleAvailable } from '../native/DatalyrNativeBridge';

/**
 * Meta Integration class for handling Facebook SDK operations
 * Uses native iOS SDK bundled via CocoaPods (no additional npm packages required)
 */
export class MetaIntegration {
  private config: MetaConfig | null = null;
  private initialized: boolean = false;
  private available: boolean = false;
  private debug: boolean = false;
  private deferredDeepLinkData: DeferredDeepLinkResult | null = null;

  /**
   * Initialize Meta SDK with configuration
   * Supported on both iOS and Android via native modules
   */
  async initialize(config: MetaConfig, debug: boolean = false): Promise<void> {
    this.debug = debug;
    this.config = config;

    // Only available on iOS and Android via native modules
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      this.log('Meta SDK only available on iOS and Android');
      return;
    }

    this.available = isNativeModuleAvailable();

    if (!this.available) {
      this.log('Meta native module not available');
      return;
    }

    try {
      const success = await MetaNativeBridge.initialize(
        config.appId,
        config.clientToken,
        config.advertiserTrackingEnabled ?? false
      );

      if (success) {
        this.initialized = true;
        this.log(`Meta SDK initialized with App ID: ${config.appId}`);
      }
    } catch (error) {
      this.logError('Failed to initialize Meta SDK:', error);
    }
  }

  /**
   * Update tracking authorization status (call after ATT prompt)
   */
  async updateTrackingAuthorization(enabled: boolean): Promise<void> {
    if (!this.available || !this.initialized) return;

    try {
      await MetaNativeBridge.updateTrackingAuthorization(enabled);
      this.log(`Meta ATT status updated: ${enabled ? 'authorized' : 'not authorized'}`);
    } catch (error) {
      this.logError('Failed to update Meta tracking authorization:', error);
    }
  }

  /**
   * Fetch deferred deep link from Meta SDK
   * This captures fbclid for installs that went through App Store
   */
  async fetchDeferredDeepLink(): Promise<DeferredDeepLinkResult | null> {
    if (!this.available || !this.initialized) {
      return null;
    }

    if (this.config?.enableDeferredDeepLink === false) {
      return null;
    }

    try {
      const url = await MetaNativeBridge.fetchDeferredAppLink();

      if (!url) {
        this.log('No deferred deep link available from Meta');
        return null;
      }

      // Parse the URL for attribution parameters
      const result = this.parseDeepLinkUrl(url);
      this.deferredDeepLinkData = result;

      this.log(`Meta deferred deep link fetched: ${url}`);
      return result;
    } catch (error) {
      // This is expected to fail in some scenarios - log but don't treat as error
      this.log('Could not fetch Meta deferred deep link (may not be available)');
      return null;
    }
  }

  /**
   * Parse deep link URL to extract attribution parameters
   */
  private parseDeepLinkUrl(urlString: string): DeferredDeepLinkResult {
    const result: DeferredDeepLinkResult = {
      url: urlString,
      source: 'meta',
    };

    try {
      const url = new URL(urlString);
      const params = url.searchParams;

      // Extract known parameters
      if (params.get('fbclid')) result.fbclid = params.get('fbclid')!;
      if (params.get('utm_source')) result.utmSource = params.get('utm_source')!;
      if (params.get('utm_medium')) result.utmMedium = params.get('utm_medium')!;
      if (params.get('utm_campaign')) result.utmCampaign = params.get('utm_campaign')!;
      if (params.get('utm_content')) result.utmContent = params.get('utm_content')!;
      if (params.get('utm_term')) result.utmTerm = params.get('utm_term')!;
      if (params.get('campaign_id')) result.campaignId = params.get('campaign_id')!;
      if (params.get('adset_id')) result.adsetId = params.get('adset_id')!;
      if (params.get('ad_id')) result.adId = params.get('ad_id')!;
    } catch (error) {
      this.logError('Failed to parse deep link URL:', error);
    }

    return result;
  }

  /**
   * Log purchase event to Meta
   */
  async logPurchase(value: number, currency: string, parameters?: Record<string, any>): Promise<void> {
    if (!this.available || !this.initialized) return;
    if (this.config?.enableAppEvents === false) return;

    try {
      await MetaNativeBridge.logPurchase(value, currency, parameters);
      this.log(`Meta purchase event logged: ${value} ${currency}`);
    } catch (error) {
      this.logError('Failed to log Meta purchase:', error);
    }
  }

  /**
   * Log custom event to Meta
   */
  async logEvent(eventName: string, valueToSum?: number, parameters?: Record<string, any>): Promise<void> {
    if (!this.available || !this.initialized) return;
    if (this.config?.enableAppEvents === false) return;

    try {
      await MetaNativeBridge.logEvent(eventName, valueToSum, parameters);
      this.log(`Meta event logged: ${eventName}`);
    } catch (error) {
      this.logError('Failed to log Meta event:', error);
    }
  }

  /**
   * Set user data for Advanced Matching (improves conversion attribution)
   * Note: Meta's Advanced Matching uses these specific fields - externalId is not supported
   */
  async setUserData(userData: {
    email?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    dateOfBirth?: string;
    gender?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  }): Promise<void> {
    if (!this.available || !this.initialized) return;

    try {
      await MetaNativeBridge.setUserData(userData);
      this.log('Meta user data set for Advanced Matching');
    } catch (error) {
      this.logError('Failed to set Meta user data:', error);
    }
  }

  /**
   * Clear user data (call on logout)
   */
  async clearUserData(): Promise<void> {
    if (!this.available || !this.initialized) return;

    try {
      await MetaNativeBridge.clearUserData();
      this.log('Meta user data cleared');
    } catch (error) {
      this.logError('Failed to clear Meta user data:', error);
    }
  }

  /**
   * Get cached deferred deep link data
   */
  getDeferredDeepLinkData(): DeferredDeepLinkResult | null {
    return this.deferredDeepLinkData;
  }

  /**
   * Check if Meta SDK is available and initialized
   */
  isAvailable(): boolean {
    return this.available && this.initialized;
  }

  /**
   * Check if Meta SDK native module is installed
   */
  isInstalled(): boolean {
    return this.available;
  }

  private log(message: string, data?: any): void {
    if (this.debug) {
      console.log(`[Datalyr/Meta] ${message}`, data || '');
    }
  }

  private logError(message: string, error: any): void {
    console.error(`[Datalyr/Meta] ${message}`, error);
  }
}

// Export singleton instance
export const metaIntegration = new MetaIntegration();
