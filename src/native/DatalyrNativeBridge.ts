/**
 * Native Bridge for Meta, TikTok, Apple Search Ads, and Play Install Referrer
 * Uses bundled native modules instead of separate npm packages
 *
 * Supported Platforms:
 * - iOS: Meta SDK, TikTok SDK, Apple Search Ads (AdServices)
 * - Android: Meta SDK, TikTok SDK, Play Install Referrer
 */

import { NativeModules, Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

/**
 * Apple Search Ads attribution data returned from AdServices API (iOS only)
 */
export interface AppleSearchAdsAttribution {
  attribution: boolean;
  orgId?: number;
  orgName?: string;
  campaignId?: number;
  campaignName?: string;
  adGroupId?: number;
  adGroupName?: string;
  keywordId?: number;
  keyword?: string;
  clickDate?: string;
  conversionType?: string;
  countryOrRegion?: string;
}

/**
 * Play Install Referrer data (Android only)
 */
export interface PlayInstallReferrerData {
  referrerUrl: string;
  referrerClickTimestamp: number;
  installBeginTimestamp: number;
  installCompleteTimestamp?: number;
  gclid?: string;
  fbclid?: string;
  ttclid?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  referrer?: string;
}

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

  // Apple Search Ads Methods (iOS only)
  getAppleSearchAdsAttribution(): Promise<AppleSearchAdsAttribution | null>;

  // SDK Availability
  getSDKAvailability(): Promise<{
    meta: boolean;
    tiktok: boolean;
    appleSearchAds: boolean;
    playInstallReferrer?: boolean;
  }>;
}

interface PlayInstallReferrerModule {
  isAvailable(): Promise<boolean>;
  getInstallReferrer(): Promise<PlayInstallReferrerData | null>;
}

// Native modules - available on both iOS and Android
// iOS uses Expo Modules (new arch compatible), Android uses NativeModules (interop layer)
let DatalyrNative: DatalyrNativeModule | null = null;
if (Platform.OS === 'ios') {
  try {
    DatalyrNative = requireNativeModule<DatalyrNativeModule>('DatalyrNative');
  } catch {
    // Native module not available
  }
} else if (Platform.OS === 'android') {
  DatalyrNative = NativeModules.DatalyrNative ?? null;
}

// Play Install Referrer - Android only (stays on NativeModules)
let DatalyrPlayInstallReferrer: PlayInstallReferrerModule | null = null;
if (Platform.OS === 'android') {
  DatalyrPlayInstallReferrer = NativeModules.DatalyrPlayInstallReferrer ?? null;
}

/**
 * Check if native module is available
 */
export const isNativeModuleAvailable = (): boolean => {
  return DatalyrNative !== null;
};

/**
 * Get SDK availability status for all platforms
 */
export const getSDKAvailability = async (): Promise<{
  meta: boolean;
  tiktok: boolean;
  appleSearchAds: boolean;
  playInstallReferrer: boolean;
}> => {
  const defaultAvailability = {
    meta: false,
    tiktok: false,
    appleSearchAds: false,
    playInstallReferrer: false,
  };

  if (!DatalyrNative) {
    return defaultAvailability;
  }

  try {
    const result = await DatalyrNative.getSDKAvailability();
    return {
      ...defaultAvailability,
      ...result,
      playInstallReferrer: Platform.OS === 'android' && DatalyrPlayInstallReferrer !== null,
    };
  } catch {
    return defaultAvailability;
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

// MARK: - Apple Search Ads Bridge (iOS only)

export const AppleSearchAdsNativeBridge = {
  /**
   * Get Apple Search Ads attribution data
   * Uses AdServices framework (iOS 14.3+)
   * Returns null if user didn't come from Apple Search Ads or on older iOS
   */
  async getAttribution(): Promise<AppleSearchAdsAttribution | null> {
    if (!DatalyrNative || Platform.OS !== 'ios') return null;

    try {
      return await DatalyrNative.getAppleSearchAdsAttribution();
    } catch (error) {
      console.error('[Datalyr/AppleSearchAds] Get attribution failed:', error);
      return null;
    }
  },
};

// MARK: - Play Install Referrer Bridge (Android only)

export const PlayInstallReferrerNativeBridge = {
  /**
   * Check if Play Install Referrer is available
   * Only available on Android with Google Play Services
   */
  async isAvailable(): Promise<boolean> {
    if (!DatalyrPlayInstallReferrer || Platform.OS !== 'android') return false;

    try {
      return await DatalyrPlayInstallReferrer.isAvailable();
    } catch {
      return false;
    }
  },

  /**
   * Get install referrer data from Google Play
   *
   * Returns UTM parameters, click IDs (gclid, fbclid, ttclid), and timestamps
   * from the Google Play Store referrer.
   *
   * Call this on first app launch to capture install attribution.
   */
  async getInstallReferrer(): Promise<PlayInstallReferrerData | null> {
    if (!DatalyrPlayInstallReferrer || Platform.OS !== 'android') return null;

    try {
      return await DatalyrPlayInstallReferrer.getInstallReferrer();
    } catch (error) {
      console.error('[Datalyr/PlayInstallReferrer] Get referrer failed:', error);
      return null;
    }
  },
};
