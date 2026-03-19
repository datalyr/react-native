/**
 * Native Bridge for Apple Search Ads, Play Install Referrer, and Advertiser Info
 *
 * Conversion event routing to ad platforms (Meta, TikTok, Google) is handled
 * server-side via the postback system — no client-side ad SDKs needed.
 *
 * Supported Platforms:
 * - iOS: Apple Search Ads (AdServices), IDFA/ATT
 * - Android: Play Install Referrer, GAID
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
  // Advertiser Info (IDFA, IDFV, GAID, ATT Status)
  getAdvertiserInfo(): Promise<{
    idfa?: string;
    idfv?: string;
    gaid?: string;
    att_status: number;
    advertiser_tracking_enabled: boolean;
  } | null>;

  // Apple Search Ads Methods (iOS only)
  getAppleSearchAdsAttribution(): Promise<AppleSearchAdsAttribution | null>;

  // SDK Availability
  getSDKAvailability(): Promise<{
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
  appleSearchAds: boolean;
  playInstallReferrer: boolean;
}> => {
  const defaultAvailability = {
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

// MARK: - Advertiser Info Bridge

export interface AdvertiserInfo {
  idfa?: string;
  idfv?: string;
  gaid?: string;
  att_status: number;
  advertiser_tracking_enabled: boolean;
}

export const AdvertiserInfoBridge = {
  /**
   * Get advertiser info (IDFA, IDFV, ATT status)
   * IDFA is only available when ATT is authorized (iOS 14+)
   * IDFV is always available on iOS
   */
  async getAdvertiserInfo(): Promise<AdvertiserInfo | null> {
    if (!DatalyrNative) return null;

    try {
      return await DatalyrNative.getAdvertiserInfo();
    } catch (error) {
      console.error('[Datalyr/AdvertiserInfo] Get advertiser info failed:', error);
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
