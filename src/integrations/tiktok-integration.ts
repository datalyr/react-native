/**
 * TikTok Business SDK Integration
 * Uses bundled native iOS SDK for event forwarding and user identification
 */

import { Platform } from 'react-native';
import { TikTokConfig } from '../types';
import { TikTokNativeBridge, isNativeModuleAvailable } from '../native/DatalyrNativeBridge';

/**
 * TikTok standard event names (current as of 2025)
 * Note: CompletePayment and SubmitForm are legacy, use Purchase and Lead instead
 */
const TikTokEvents = {
  // Commerce events
  PURCHASE: 'Purchase',
  ADD_TO_CART: 'AddToCart',
  ADD_TO_WISHLIST: 'AddToWishlist',
  INITIATE_CHECKOUT: 'InitiateCheckout',
  ADD_PAYMENT_INFO: 'AddPaymentInfo',
  VIEW_CONTENT: 'ViewContent',
  SEARCH: 'Search',

  // User events
  COMPLETE_REGISTRATION: 'CompleteRegistration',
  SUBSCRIBE: 'Subscribe',
  START_TRIAL: 'StartTrial',
  LEAD: 'Lead',
  CONTACT: 'Contact',

  // App events
  DOWNLOAD: 'Download',
  SCHEDULE: 'Schedule',
  SUBMIT_APPLICATION: 'SubmitApplication',
} as const;

/**
 * TikTok Integration class for handling TikTok Business SDK operations
 * Uses native iOS SDK bundled via CocoaPods (no additional npm packages required)
 */
export class TikTokIntegration {
  private config: TikTokConfig | null = null;
  private initialized: boolean = false;
  private available: boolean = false;
  private debug: boolean = false;

  /**
   * Initialize TikTok SDK with configuration
   * Supported on both iOS and Android via native modules
   */
  async initialize(config: TikTokConfig, debug: boolean = false): Promise<void> {
    this.debug = debug;
    this.config = config;

    // Only available on iOS and Android via native modules
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      this.log('TikTok SDK only available on iOS and Android');
      return;
    }

    this.available = isNativeModuleAvailable();

    if (!this.available) {
      this.log('TikTok native module not available');
      return;
    }

    try {
      const success = await TikTokNativeBridge.initialize(
        config.appId,
        config.tiktokAppId,
        config.accessToken,
        debug
      );

      if (success) {
        this.initialized = true;
        this.log(`TikTok SDK initialized with App ID: ${config.tiktokAppId}`);
      } else {
        console.warn('[Datalyr/TikTok] TikTok SDK not initialized (accessToken may be missing). Events will still be sent server-side via Datalyr postbacks.');
      }
    } catch (error) {
      console.warn('[Datalyr/TikTok] TikTok SDK init failed. Events will still be sent server-side via Datalyr postbacks.', error);
    }
  }

  /**
   * Update tracking authorization status (call after ATT prompt)
   */
  async updateTrackingAuthorization(enabled: boolean): Promise<void> {
    if (!this.available || !this.initialized) return;

    try {
      // TikTok SDK auto-handles ATT, but we track the event
      if (enabled) {
        await this.trackEvent('ATTAuthorized');
      }
      await TikTokNativeBridge.updateTrackingAuthorization(enabled);
      this.log(`TikTok ATT status: ${enabled ? 'authorized' : 'not authorized'}`);
    } catch (error) {
      this.logError('Failed to update TikTok tracking authorization:', error);
    }
  }

  /**
   * Log purchase event to TikTok (uses Purchase - TikTok's current standard event)
   */
  async logPurchase(
    value: number,
    currency: string,
    contentId?: string,
    contentType?: string,
    parameters?: Record<string, any>
  ): Promise<void> {
    if (!this.available || !this.initialized) return;
    if (this.config?.enableAppEvents === false) return;

    try {
      const properties: Record<string, any> = {
        value,
        currency,
        ...parameters,
      };

      if (contentId) properties.content_id = contentId;
      if (contentType) properties.content_type = contentType;

      await TikTokNativeBridge.trackEvent(TikTokEvents.PURCHASE, undefined, properties);
      this.log(`TikTok Purchase event logged: ${value} ${currency}`);
    } catch (error) {
      this.logError('Failed to log TikTok purchase:', error);
    }
  }

  /**
   * Log subscription event to TikTok
   */
  async logSubscription(value: number, currency: string, plan?: string): Promise<void> {
    if (!this.available || !this.initialized) return;
    if (this.config?.enableAppEvents === false) return;

    try {
      const properties: Record<string, any> = {
        value,
        currency,
      };

      if (plan) {
        properties.content_id = plan;
        properties.content_type = 'subscription';
      }

      await TikTokNativeBridge.trackEvent(TikTokEvents.SUBSCRIBE, undefined, properties);
      this.log(`TikTok subscription event logged: ${value} ${currency}`);
    } catch (error) {
      this.logError('Failed to log TikTok subscription:', error);
    }
  }

  /**
   * Log add to cart event
   */
  async logAddToCart(value: number, currency: string, contentId?: string, contentType?: string): Promise<void> {
    if (!this.available || !this.initialized) return;
    if (this.config?.enableAppEvents === false) return;

    try {
      const properties: Record<string, any> = {
        value,
        currency,
      };

      if (contentId) properties.content_id = contentId;
      if (contentType) properties.content_type = contentType;

      await TikTokNativeBridge.trackEvent(TikTokEvents.ADD_TO_CART, undefined, properties);
      this.log('TikTok add to cart event logged');
    } catch (error) {
      this.logError('Failed to log TikTok add to cart:', error);
    }
  }

  /**
   * Log view content event
   */
  async logViewContent(contentId?: string, contentName?: string, contentType?: string): Promise<void> {
    if (!this.available || !this.initialized) return;
    if (this.config?.enableAppEvents === false) return;

    try {
      const properties: Record<string, any> = {};
      if (contentId) properties.content_id = contentId;
      if (contentName) properties.content_name = contentName;
      if (contentType) properties.content_type = contentType;

      await TikTokNativeBridge.trackEvent(TikTokEvents.VIEW_CONTENT, undefined, properties);
      this.log('TikTok view content event logged');
    } catch (error) {
      this.logError('Failed to log TikTok view content:', error);
    }
  }

  /**
   * Log initiate checkout event
   */
  async logInitiateCheckout(value: number, currency: string, numItems?: number): Promise<void> {
    if (!this.available || !this.initialized) return;
    if (this.config?.enableAppEvents === false) return;

    try {
      const properties: Record<string, any> = {
        value,
        currency,
      };
      if (numItems) properties.quantity = numItems;

      await TikTokNativeBridge.trackEvent(TikTokEvents.INITIATE_CHECKOUT, undefined, properties);
      this.log('TikTok initiate checkout event logged');
    } catch (error) {
      this.logError('Failed to log TikTok initiate checkout:', error);
    }
  }

  /**
   * Log complete registration event
   */
  async logCompleteRegistration(method?: string): Promise<void> {
    if (!this.available || !this.initialized) return;
    if (this.config?.enableAppEvents === false) return;

    try {
      const properties: Record<string, any> = {};
      if (method) properties.registration_method = method;

      await TikTokNativeBridge.trackEvent(TikTokEvents.COMPLETE_REGISTRATION, undefined, properties);
      this.log('TikTok complete registration event logged');
    } catch (error) {
      this.logError('Failed to log TikTok complete registration:', error);
    }
  }

  /**
   * Log search event
   */
  async logSearch(query: string): Promise<void> {
    if (!this.available || !this.initialized) return;
    if (this.config?.enableAppEvents === false) return;

    try {
      await TikTokNativeBridge.trackEvent(TikTokEvents.SEARCH, undefined, { query });
      this.log('TikTok search event logged');
    } catch (error) {
      this.logError('Failed to log TikTok search:', error);
    }
  }

  /**
   * Log lead event (uses Lead - current standard, SubmitForm is legacy)
   */
  async logLead(value?: number, currency?: string): Promise<void> {
    if (!this.available || !this.initialized) return;
    if (this.config?.enableAppEvents === false) return;

    try {
      const properties: Record<string, any> = {};
      if (value !== undefined) properties.value = value;
      if (currency) properties.currency = currency;

      await TikTokNativeBridge.trackEvent(TikTokEvents.LEAD, undefined, properties);
      this.log('TikTok lead event logged');
    } catch (error) {
      this.logError('Failed to log TikTok lead:', error);
    }
  }

  /**
   * Log add payment info event
   */
  async logAddPaymentInfo(success: boolean): Promise<void> {
    if (!this.available || !this.initialized) return;
    if (this.config?.enableAppEvents === false) return;

    try {
      await TikTokNativeBridge.trackEvent(TikTokEvents.ADD_PAYMENT_INFO, undefined, { success });
      this.log('TikTok add payment info event logged');
    } catch (error) {
      this.logError('Failed to log TikTok add payment info:', error);
    }
  }

  /**
   * Log custom event to TikTok
   */
  async trackEvent(eventName: string, properties?: Record<string, any>): Promise<void> {
    if (!this.available || !this.initialized) return;
    if (this.config?.enableAppEvents === false) return;

    try {
      await TikTokNativeBridge.trackEvent(eventName, undefined, properties || {});
      this.log(`TikTok event logged: ${eventName}`);
    } catch (error) {
      this.logError('Failed to log TikTok event:', error);
    }
  }

  /**
   * Identify user for improved attribution matching
   */
  async identify(email?: string, phone?: string, externalId?: string): Promise<void> {
    if (!this.available || !this.initialized) return;

    // Only call identify if we have at least one value
    if (!email && !phone && !externalId) return;

    try {
      await TikTokNativeBridge.identify(externalId, email, phone);
      this.log('TikTok user identification set');
    } catch (error) {
      this.logError('Failed to identify TikTok user:', error);
    }
  }

  /**
   * Clear user session (call on logout)
   */
  async logout(): Promise<void> {
    if (!this.available || !this.initialized) return;

    try {
      await TikTokNativeBridge.logout();
      this.log('TikTok user logged out');
    } catch (error) {
      this.logError('Failed to logout TikTok user:', error);
    }
  }

  /**
   * Check if TikTok SDK is available and initialized
   */
  isAvailable(): boolean {
    return this.available && this.initialized;
  }

  /**
   * Check if TikTok SDK native module is installed
   */
  isInstalled(): boolean {
    return this.available;
  }

  private log(message: string, data?: any): void {
    if (this.debug) {
      console.log(`[Datalyr/TikTok] ${message}`, data || '');
    }
  }

  private logError(message: string, error: any): void {
    console.error(`[Datalyr/TikTok] ${message}`, error);
  }
}

// Export singleton instance
export const tiktokIntegration = new TikTokIntegration();
