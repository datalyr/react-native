/**
 * Expo build: the shared SDK core (sdk-core.ts) with the Expo platform utilities
 * (utils-expo.ts: expo-application, expo-device, expo-network). The bare React Native
 * build (datalyr-sdk.ts) is the same core with utils.ts.
 */

import {
  DatalyrConfig,
  EventData,
  UserProperties,
  IdentifyOptions,
  ProviderAttributesHandler,
  AutoEventConfig,
  DeferredDeepLinkResult,
} from './types';
import * as expoUtils from './utils-expo';
import { AttributionData, attributionManager } from './attribution';
import { AppleSearchAdsAttribution } from './native/DatalyrNativeBridge';
import { DatalyrSDKCore } from './sdk-core';

export class DatalyrSDKExpo extends DatalyrSDKCore {
  constructor() {
    super({ variant: 'expo', utils: expoUtils, normalizePlatformToAndroid: false });
  }

  getStatus() {
    return {
      initialized: this.state.initialized,
      workspaceId: this.state.config.workspaceId || '',
      visitorId: this.state.visitorId,
      anonymousId: this.state.anonymousId,
      sessionId: this.state.sessionId,
      currentUserId: this.state.currentUserId,
      queueStats: this.eventQueue.getStats(),
      attribution: attributionManager.getAttributionSummary(),
      variant: 'expo',
    };
  }

  // Where the Expo build differs from the bare build: SDKPlatform options only (see the
  // constructor). tests/payload-parity.test.ts lists the payload differences.

  // Expo's own signatures; the currency default comes from SDKPlatform (none on Expo).
  async trackAddToCart(value: number, currency: string, contentId?: string, contentName?: string): Promise<void> {
    await super.trackAddToCart(value, currency, contentId, contentName);
  }

  async trackViewContent(contentId: string, contentName?: string, contentType?: string, value?: number, currency?: string): Promise<void> {
    await super.trackViewContent(contentId, contentName, contentType, value, currency);
  }

  async trackInitiateCheckout(value?: number, currency?: string, numItems?: number, contentIds?: string[]): Promise<void> {
    await super.trackInitiateCheckout(value as number, currency, numItems, contentIds);
  }

  async trackAddPaymentInfo(success?: boolean): Promise<void> {
    await super.trackAddPaymentInfo(success);
  }
}

// Create singleton instance for Expo
const datalyrExpo = new DatalyrSDKExpo();

// Export static class wrapper for Expo
export class DatalyrExpo {
  static async initialize(config: DatalyrConfig): Promise<void> {
    await datalyrExpo.initialize(config);
  }

  static async trackWithSKAdNetwork(event: string, properties?: Record<string, any>): Promise<void> {
    await datalyrExpo.trackWithSKAdNetwork(event, properties);
  }

  static async trackPurchase(value: number, currency = 'USD', productId?: string): Promise<void> {
    await datalyrExpo.trackPurchase(value, currency, productId);
  }

  static async trackSubscription(value: number, currency = 'USD', plan?: string): Promise<void> {
    await datalyrExpo.trackSubscription(value, currency, plan);
  }

  static getConversionValue(event: string, properties?: Record<string, any>): number | null {
    return datalyrExpo.getConversionValue(event, properties);
  }

  static async track(eventName: string, eventData?: EventData): Promise<void> {
    await datalyrExpo.track(eventName, eventData);
  }

  static async screen(screenName: string, properties?: EventData): Promise<void> {
    await datalyrExpo.screen(screenName, properties);
  }

  static async identify(userId: string, properties?: UserProperties, options?: IdentifyOptions): Promise<void> {
    await datalyrExpo.identify(userId, properties, options);
  }

  static async alias(newUserId: string, previousId?: string): Promise<void> {
    await datalyrExpo.alias(newUserId, previousId);
  }

  static async reset(): Promise<void> {
    await datalyrExpo.reset();
  }

  static async flush(): Promise<void> {
    await datalyrExpo.flush();
  }

  static getStatus() {
    return datalyrExpo.getStatus();
  }

  static getAnonymousId(): string {
    return datalyrExpo.getAnonymousId();
  }

  static getAttributionData(): AttributionData {
    return datalyrExpo.getAttributionData();
  }

  static async setAttributionData(data: Partial<AttributionData>): Promise<void> {
    await datalyrExpo.setAttributionData(data);
  }

  static getCurrentSession() {
    return datalyrExpo.getCurrentSession();
  }

  static async endSession(): Promise<void> {
    await datalyrExpo.endSession();
  }

  static async trackAppUpdate(previousVersion: string, currentVersion: string): Promise<void> {
    await datalyrExpo.trackAppUpdate(previousVersion, currentVersion);
  }

  static updateAutoEventsConfig(config: Partial<AutoEventConfig>): void {
    datalyrExpo.updateAutoEventsConfig(config);
  }

  // Standard e-commerce events with platform forwarding

  static async trackAddToCart(value: number, currency: string, contentId?: string, contentName?: string): Promise<void> {
    await datalyrExpo.trackAddToCart(value, currency, contentId, contentName);
  }

  static async trackViewContent(contentId: string, contentName?: string, contentType?: string, value?: number, currency?: string): Promise<void> {
    await datalyrExpo.trackViewContent(contentId, contentName, contentType, value, currency);
  }

  static async trackInitiateCheckout(value?: number, currency?: string, numItems?: number, contentIds?: string[]): Promise<void> {
    await datalyrExpo.trackInitiateCheckout(value, currency, numItems, contentIds);
  }

  static async trackCompleteRegistration(registrationMethod?: string): Promise<void> {
    await datalyrExpo.trackCompleteRegistration(registrationMethod);
  }

  static async trackSearch(searchString: string, contentIds?: string[]): Promise<void> {
    await datalyrExpo.trackSearch(searchString, contentIds);
  }

  static async trackLead(value?: number, currency?: string): Promise<void> {
    await datalyrExpo.trackLead(value, currency);
  }

  static async trackAddPaymentInfo(success?: boolean): Promise<void> {
    await datalyrExpo.trackAddPaymentInfo(success);
  }

  // Platform integration methods

  static getDeferredAttributionData(): DeferredDeepLinkResult | null {
    return datalyrExpo.getDeferredAttributionData();
  }

  static getPlatformIntegrationStatus(): { appleSearchAds: boolean; playInstallReferrer: boolean } {
    return datalyrExpo.getPlatformIntegrationStatus();
  }

  static getPlayInstallReferrer(): Record<string, any> | null {
    return datalyrExpo.getPlayInstallReferrer();
  }

  static getAppleSearchAdsAttribution(): AppleSearchAdsAttribution | null {
    return datalyrExpo.getAppleSearchAdsAttribution();
  }

  static async updateTrackingAuthorization(authorized: boolean): Promise<void> {
    await datalyrExpo.updateTrackingAuthorization(authorized);
  }

  // Third-party integration methods

  static getSuperwallAttributes(): Record<string, string> {
    return datalyrExpo.getSuperwallAttributes();
  }

  static async bindProviderIdentity(namespace: string, providerUserId: string): Promise<void> {
    await datalyrExpo.bindProviderIdentity(namespace, providerUserId);
  }

  static getRevenueCatAttributes(): Record<string, string> {
    return datalyrExpo.getRevenueCatAttributes();
  }

  /** See DatalyrSDKExpo.syncRevenueCatAttributes. Login: Purchases.logIn() first, then identify(). Logout: Purchases.logOut() first, then reset(). */
  static syncRevenueCatAttributes(handler: ProviderAttributesHandler): () => void {
    return datalyrExpo.syncRevenueCatAttributes(handler);
  }

  /** See DatalyrSDKExpo.syncSuperwallAttributes. Login: Superwall identify first, then identify(). Logout: Superwall reset first, then reset(). */
  static syncSuperwallAttributes(handler: ProviderAttributesHandler): () => void {
    return datalyrExpo.syncSuperwallAttributes(handler);
  }
}

export default datalyrExpo;
