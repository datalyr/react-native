// Bare React Native build: the shared SDK core (sdk-core.ts) with the bare platform
// utilities (utils.ts: react-native-device-info, netinfo). The Expo build
// (datalyr-sdk-expo.ts) is the same core with utils-expo.ts.
import {
  DatalyrConfig,
  EventData,
  UserProperties,
  IdentifyOptions,
  ProviderAttributesHandler,
  AutoEventConfig,
  DeferredDeepLinkResult,
} from './types';
import * as bareUtils from './utils';
import { AttributionData, attributionManager } from './attribution';
import { journeyManager } from './journey';
import { AppleSearchAdsAttribution } from './native/DatalyrNativeBridge';
import { DatalyrSDKCore } from './sdk-core';

export class DatalyrSDK extends DatalyrSDKCore {
  constructor() {
    super({ variant: 'bare', utils: bareUtils, normalizePlatformToAndroid: true, defaultCommerceCurrency: 'USD' });
  }

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
  } {
    return {
      initialized: this.state.initialized,
      workspaceId: this.state.config.workspaceId || '',
      visitorId: this.state.visitorId,
      anonymousId: this.state.anonymousId,
      sessionId: this.state.sessionId,
      currentUserId: this.state.currentUserId,
      queueStats: this.eventQueue.getStats(),
      attribution: attributionManager.getAttributionSummary(),
      journey: journeyManager.getJourneySummary(),
    };
  }
}

// Create singleton instance
const datalyr = new DatalyrSDK();

// Export enhanced Datalyr class with static methods
export class Datalyr {
  /**
   * Initialize Datalyr with SKAdNetwork conversion value encoding
   */
  static async initialize(config: DatalyrConfig): Promise<void> {
    await datalyr.initialize(config);
  }

  /**
   * Track event with automatic SKAdNetwork conversion value encoding
   */
  static async trackWithSKAdNetwork(
    event: string, 
    properties?: Record<string, any>
  ): Promise<void> {
    await datalyr.trackWithSKAdNetwork(event, properties);
  }

  /**
   * Track purchase with automatic revenue encoding
   */
  static async trackPurchase(
    value: number, 
    currency = 'USD', 
    productId?: string
  ): Promise<void> {
    await datalyr.trackPurchase(value, currency, productId);
  }

  /**
   * Track subscription with automatic revenue encoding
   */
  static async trackSubscription(
    value: number, 
    currency = 'USD', 
    plan?: string
  ): Promise<void> {
    await datalyr.trackSubscription(value, currency, plan);
  }

  /**
   * Get conversion value for testing (doesn't send to Apple)
   */
  static getConversionValue(event: string, properties?: Record<string, any>): number | null {
    return datalyr.getConversionValue(event, properties);
  }

  // Standard SDK methods
  static async track(eventName: string, eventData?: EventData): Promise<void> {
    await datalyr.track(eventName, eventData);
  }

  static async screen(screenName: string, properties?: EventData): Promise<void> {
    await datalyr.screen(screenName, properties);
  }

  static async identify(userId: string, properties?: UserProperties, options?: IdentifyOptions): Promise<void> {
    await datalyr.identify(userId, properties, options);
  }

  static async alias(newUserId: string, previousId?: string): Promise<void> {
    await datalyr.alias(newUserId, previousId);
  }

  static async bindProviderIdentity(namespace: string, providerUserId: string): Promise<void> {
    await datalyr.bindProviderIdentity(namespace, providerUserId);
  }

  static async reset(): Promise<void> {
    await datalyr.reset();
  }

  static async flush(): Promise<void> {
    await datalyr.flush();
  }

  static getStatus() {
    return datalyr.getStatus();
  }

  static getAnonymousId(): string {
    return datalyr.getAnonymousId();
  }

  static getAttributionData(): AttributionData {
    return datalyr.getAttributionData();
  }

  static async setAttributionData(data: Partial<AttributionData>): Promise<void> {
    await datalyr.setAttributionData(data);
  }

  static getCurrentSession() {
    return datalyr.getCurrentSession();
  }

  static async endSession(): Promise<void> {
    await datalyr.endSession();
  }

  static async trackAppUpdate(previousVersion: string, currentVersion: string): Promise<void> {
    await datalyr.trackAppUpdate(previousVersion, currentVersion);
  }

  static updateAutoEventsConfig(config: Partial<AutoEventConfig>): void {
    datalyr.updateAutoEventsConfig(config);
  }

  // Standard e-commerce events
  static async trackAddToCart(
    value: number,
    currency = 'USD',
    productId?: string,
    productName?: string
  ): Promise<void> {
    await datalyr.trackAddToCart(value, currency, productId, productName);
  }

  static async trackViewContent(
    contentId?: string,
    contentName?: string,
    contentType = 'product',
    value?: number,
    currency?: string
  ): Promise<void> {
    await datalyr.trackViewContent(contentId, contentName, contentType, value, currency);
  }

  static async trackInitiateCheckout(
    value: number,
    currency = 'USD',
    numItems?: number,
    productIds?: string[]
  ): Promise<void> {
    await datalyr.trackInitiateCheckout(value, currency, numItems, productIds);
  }

  static async trackCompleteRegistration(method?: string): Promise<void> {
    await datalyr.trackCompleteRegistration(method);
  }

  static async trackSearch(query: string, resultIds?: string[]): Promise<void> {
    await datalyr.trackSearch(query, resultIds);
  }

  static async trackLead(value?: number, currency?: string): Promise<void> {
    await datalyr.trackLead(value, currency);
  }

  static async trackAddPaymentInfo(success = true): Promise<void> {
    await datalyr.trackAddPaymentInfo(success);
  }

  // Platform integration methods
  /**
   * @deprecated Always returns null. Deferred web attribution is applied automatically at
   * install; read it with getAttributionData().
   */
  static getDeferredAttributionData(): DeferredDeepLinkResult | null {
    return datalyr.getDeferredAttributionData();
  }

  static getPlatformIntegrationStatus(): { appleSearchAds: boolean; playInstallReferrer: boolean } {
    return datalyr.getPlatformIntegrationStatus();
  }

  static getAppleSearchAdsAttribution(): AppleSearchAdsAttribution | null {
    return datalyr.getAppleSearchAdsAttribution();
  }

  /**
   * Get Google Play Install Referrer attribution data (Android only)
   * Returns referrer data if available, null otherwise
   */
  static getPlayInstallReferrer(): Record<string, any> | null {
    return datalyr.getPlayInstallReferrer();
  }

  static async updateTrackingAuthorization(enabled: boolean): Promise<void> {
    await datalyr.updateTrackingAuthorization(enabled);
  }

  // Third-party integration methods

  static getSuperwallAttributes(): Record<string, string> {
    return datalyr.getSuperwallAttributes();
  }

  static getRevenueCatAttributes(): Record<string, string> {
    return datalyr.getRevenueCatAttributes();
  }

  /** See DatalyrSDK.syncRevenueCatAttributes. Login: Purchases.logIn() first, then identify(). Logout: Purchases.logOut() first, then reset(). */
  static syncRevenueCatAttributes(handler: ProviderAttributesHandler): () => void {
    return datalyr.syncRevenueCatAttributes(handler);
  }

  /** See DatalyrSDK.syncSuperwallAttributes. Login: Superwall identify first, then identify(). Logout: Superwall reset first, then reset(). */
  static syncSuperwallAttributes(handler: ProviderAttributesHandler): () => void {
    return datalyr.syncSuperwallAttributes(handler);
  }
}

// Export default instance for backward compatibility
export default datalyr;
