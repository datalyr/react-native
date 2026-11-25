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
import type { InstallSignals } from '../install-classifier';
import { sdkDebugLog } from '../debug-log';

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
    // iOS, 1.9.0+ native code: the status when this app process started.
    att_status_at_process_start?: number;
  } | null>;

  // Apple Search Ads Methods (iOS only)
  getAppleSearchAdsAttribution(): Promise<AppleSearchAdsAttribution | null>;

  // First-launch install signals (1.8.0+ native code; absent on older builds)
  getInstallSignals?(): Promise<InstallSignals | null>;
  // Android: only the no-backup marker and the install/update times (cheap, every launch)
  getRestoreSignals?(): Promise<InstallSignals | null>;
  // Android: mark this install in noBackupFilesDir (never restored by Auto Backup)
  writeInstallMarker?(): Promise<boolean>;

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
      sdkDebugLog('[Datalyr/AppleSearchAds] Get attribution failed:', error);
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
      sdkDebugLog('[Datalyr/AdvertiserInfo] Get advertiser info failed:', error);
      return null;
    }
  },
};

// MARK: - ATT status at process start (iOS only)

// iOS lifts its block on the privacy manifest's tracking domains only for app processes
// started AFTER the user allowed tracking: in the launch where the user taps "Allow",
// requests to tracking.datalyr.com still fail although the status reads authorized. So the
// tracking host may be used only when tracking was already authorized at process start.
// Kept in memory only, never stored: the next process reads its own.
let processStartRead: Promise<number | undefined> | null = null;
const asAttStatus = (v: unknown): number | undefined => (v === 0 || v === 1 || v === 2 || v === 3 ? v : undefined);

export const TrackingStartBridge = {
  /**
   * The ATT status when this process started, or undefined when unknown (never authorized).
   * Prefers the native module's own value (captured when the module was created at app
   * start, and it survives JS reloads). An older native binary lacks it: then the first read
   * this JS runtime made, started when this file was loaded.
   */
  statusAtProcessStart(): Promise<number | undefined> {
    if (!processStartRead) {
      processStartRead = (async () => {
        if (Platform.OS !== 'ios' || !DatalyrNative) return undefined;
        try {
          const info: any = await DatalyrNative.getAdvertiserInfo();
          if (!info) return undefined;
          return info.att_status_at_process_start !== undefined
            ? asAttStatus(info.att_status_at_process_start)
            : asAttStatus(info.att_status);
        } catch {
          return undefined;
        }
      })();
    }
    return processStartRead;
  },
};

// As early as the JS side can: when the SDK's code is first loaded.
if (Platform.OS === 'ios') void TrackingStartBridge.statusAtProcessStart();

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
      sdkDebugLog('[Datalyr/PlayInstallReferrer] Get referrer failed:', error);
      return null;
    }
  },
};

// MARK: - Install Signals Bridge

export const InstallSignalsBridge = {
  /**
   * What the OS says about this install, read on the first SDK launch only:
   * whether app files predate this process, the install/update times (Android),
   * the App Store record (iOS 16+, production). Null when the native module is
   * missing or older than 1.8.0, in which case the launch is classified unknown.
   */
  async getInstallSignals(): Promise<InstallSignals | null> {
    if (!DatalyrNative?.getInstallSignals) return null;
    try {
      return await DatalyrNative.getInstallSignals();
    } catch {
      return null;
    }
  },

  /**
   * Android, on launches after the install was tracked: only the no-backup marker and
   * the install/update times (no file scan). Null elsewhere or on older native builds.
   */
  async getRestoreSignals(): Promise<InstallSignals | null> {
    if (Platform.OS !== 'android' || !DatalyrNative?.getRestoreSignals) return null;
    try {
      return await DatalyrNative.getRestoreSignals();
    } catch {
      return null;
    }
  },

  /** Android: write the no-backup install marker. No-op elsewhere. */
  async writeInstallMarker(): Promise<void> {
    if (Platform.OS !== 'android' || !DatalyrNative?.writeInstallMarker) return;
    try {
      await DatalyrNative.writeInstallMarker();
    } catch {
      // best effort: a missing marker only means a later restore is not labelled
    }
  },
};
