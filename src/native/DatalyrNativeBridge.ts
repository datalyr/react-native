/**
 * Native Bridge for Meta and TikTok SDKs
 * Uses bundled native modules instead of separate npm packages
 */

import { NativeModules, Platform } from 'react-native';

interface DatalyrNativeModule {
  // Meta SDK Methods
  initializeMetaSDK(
    appId: string,
    clientToken: string | null,
    advertiserTrackingEnabled: boolean
  ): Promise<boolean>;
  fetchDeferredAppLink(): Promise<string | null>;
  logMetaEvent(
    eventName: string,
    valueToSum: number | null,
    parameters: Record<string, any> | null
  ): Promise<boolean>;
  logMetaPurchase(
    amount: number,
    currency: string,
    parameters: Record<string, any> | null
  ): Promise<boolean>;
  setMetaUserData(userData: Record<string, string | undefined>): Promise<boolean>;
  clearMetaUserData(): Promise<boolean>;
  updateMetaTrackingAuthorization(enabled: boolean): Promise<boolean>;

  // TikTok SDK Methods
  initializeTikTokSDK(
    appId: string,
    tiktokAppId: string,
    accessToken: string | null,
    debug: boolean
  ): Promise<boolean>;
  trackTikTokEvent(
    eventName: string,
    eventId: string | null,
    properties: Record<string, any> | null
  ): Promise<boolean>;
  identifyTikTokUser(
    externalId: string,
    externalUserName: string,
    phoneNumber: string,
    email: string
  ): Promise<boolean>;
  logoutTikTok(): Promise<boolean>;
  updateTikTokTrackingAuthorization(enabled: boolean): Promise<boolean>;

  // SDK Availability
  getSDKAvailability(): Promise<{ meta: boolean; tiktok: boolean }>;
}

// Native module is only available on iOS
const DatalyrNative: DatalyrNativeModule | null =
  Platform.OS === 'ios' ? NativeModules.DatalyrNative : null;

/**
 * Check if native module is available
 */
export const isNativeModuleAvailable = (): boolean => {
  return DatalyrNative !== null;
};

/**
 * Get SDK availability status
 */
export const getSDKAvailability = async (): Promise<{
  meta: boolean;
  tiktok: boolean;
}> => {
  if (!DatalyrNative) {
    return { meta: false, tiktok: false };
  }

  try {
    return await DatalyrNative.getSDKAvailability();
  } catch {
    return { meta: false, tiktok: false };
  }
};

// MARK: - Meta SDK Bridge

export const MetaNativeBridge = {
  async initialize(
    appId: string,
    clientToken?: string,
    advertiserTrackingEnabled: boolean = false
  ): Promise<boolean> {
    if (!DatalyrNative) return false;

    try {
      return await DatalyrNative.initializeMetaSDK(
        appId,
        clientToken || null,
        advertiserTrackingEnabled
      );
    } catch (error) {
      console.error('[Datalyr/MetaNative] Initialize failed:', error);
      return false;
    }
  },

  async fetchDeferredAppLink(): Promise<string | null> {
    if (!DatalyrNative) return null;

    try {
      return await DatalyrNative.fetchDeferredAppLink();
    } catch {
      return null;
    }
  },

  async logEvent(
    eventName: string,
    valueToSum?: number,
    parameters?: Record<string, any>
  ): Promise<boolean> {
    if (!DatalyrNative) return false;

    try {
      return await DatalyrNative.logMetaEvent(
        eventName,
        valueToSum ?? null,
        parameters || null
      );
    } catch (error) {
      console.error('[Datalyr/MetaNative] Log event failed:', error);
      return false;
    }
  },

  async logPurchase(
    amount: number,
    currency: string,
    parameters?: Record<string, any>
  ): Promise<boolean> {
    if (!DatalyrNative) return false;

    try {
      return await DatalyrNative.logMetaPurchase(amount, currency, parameters || null);
    } catch (error) {
      console.error('[Datalyr/MetaNative] Log purchase failed:', error);
      return false;
    }
  },

  async setUserData(userData: Record<string, string | undefined>): Promise<boolean> {
    if (!DatalyrNative) return false;

    try {
      return await DatalyrNative.setMetaUserData(userData);
    } catch (error) {
      console.error('[Datalyr/MetaNative] Set user data failed:', error);
      return false;
    }
  },

  async clearUserData(): Promise<boolean> {
    if (!DatalyrNative) return false;

    try {
      return await DatalyrNative.clearMetaUserData();
    } catch (error) {
      console.error('[Datalyr/MetaNative] Clear user data failed:', error);
      return false;
    }
  },

  async updateTrackingAuthorization(enabled: boolean): Promise<boolean> {
    if (!DatalyrNative) return false;

    try {
      return await DatalyrNative.updateMetaTrackingAuthorization(enabled);
    } catch (error) {
      console.error('[Datalyr/MetaNative] Update tracking failed:', error);
      return false;
    }
  },
};

// MARK: - TikTok SDK Bridge

export const TikTokNativeBridge = {
  async initialize(
    appId: string,
    tiktokAppId: string,
    accessToken?: string,
    debug: boolean = false
  ): Promise<boolean> {
    if (!DatalyrNative) return false;

    try {
      return await DatalyrNative.initializeTikTokSDK(
        appId,
        tiktokAppId,
        accessToken || null,
        debug
      );
    } catch (error) {
      console.error('[Datalyr/TikTokNative] Initialize failed:', error);
      return false;
    }
  },

  async trackEvent(
    eventName: string,
    eventId?: string,
    properties?: Record<string, any>
  ): Promise<boolean> {
    if (!DatalyrNative) return false;

    try {
      return await DatalyrNative.trackTikTokEvent(
        eventName,
        eventId || null,
        properties || null
      );
    } catch (error) {
      console.error('[Datalyr/TikTokNative] Track event failed:', error);
      return false;
    }
  },

  async identify(
    externalId?: string,
    email?: string,
    phone?: string
  ): Promise<boolean> {
    if (!DatalyrNative) return false;

    // Only call if we have at least one value
    if (!externalId && !email && !phone) return false;

    try {
      return await DatalyrNative.identifyTikTokUser(
        externalId || '',
        '', // externalUserName - not typically available
        phone || '',
        email || ''
      );
    } catch (error) {
      console.error('[Datalyr/TikTokNative] Identify failed:', error);
      return false;
    }
  },

  async logout(): Promise<boolean> {
    if (!DatalyrNative) return false;

    try {
      return await DatalyrNative.logoutTikTok();
    } catch (error) {
      console.error('[Datalyr/TikTokNative] Logout failed:', error);
      return false;
    }
  },

  async updateTrackingAuthorization(enabled: boolean): Promise<boolean> {
    if (!DatalyrNative) return false;

    try {
      return await DatalyrNative.updateTikTokTrackingAuthorization(enabled);
    } catch (error) {
      console.error('[Datalyr/TikTokNative] Update tracking failed:', error);
      return false;
    }
  },
};
