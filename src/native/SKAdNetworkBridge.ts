import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 9.C.2: persisted SKAN high-water state (cross-launch monotonic guard). SKAN 4 accepts
// DECREASING conversion values, so an unguarded low-funnel event after a high-funnel one
// (view_content after begin_checkout) silently downgrades the postback the ad platform
// receives. Keys mirror the iOS SDK's UnifiedAttributionTracker (datalyr_skan_high_*),
// namespaced with the SDK's AsyncStorage prefix. Values are raw strings (not JSON) —
// this module is shared by the RN and Expo builds and must not import utils/utils-expo.
const SKAN_HIGH_FINE_KEY = '@datalyr/skan_high_fine';
const SKAN_HIGH_COARSE_KEY = '@datalyr/skan_high_coarse'; // rank: 0=low 1=medium 2=high
const SKAN_WINDOW_LOCKED_KEY = '@datalyr/skan_window_locked';

const coarseRank = (coarse: string): number => {
  switch ((coarse || '').toLowerCase()) {
    case 'high': return 2;
    case 'medium': return 1;
    default: return 0;
  }
};

// SKAN 4.0 / AdAttributionKit coarse value type
export type SKANCoarseValue = 'low' | 'medium' | 'high';

// SKAN 4.0 / AdAttributionKit conversion result
export interface SKANConversionResult {
  fineValue: number;      // 0-63
  coarseValue: SKANCoarseValue;
  lockWindow: boolean;
  priority: number;
}

// Response from native postback update
export interface PostbackUpdateResponse {
  success: boolean;
  framework: 'AdAttributionKit' | 'SKAdNetwork';
  fineValue: number;
  coarseValue: string;
  lockWindow: boolean;
  type?: 'reengagement';  // Only for re-engagement updates
}

// Attribution framework info returned by native module
export interface AttributionFrameworkInfo {
  framework: 'AdAttributionKit' | 'SKAdNetwork' | 'none';
  version: string;
  reengagement_available: boolean;
  overlapping_windows: boolean;
  fine_value_range: { min: number; max: number };
  coarse_values: string[];
}

// Enhanced attribution info for iOS 18.4+ with geo and dev postback support
export interface EnhancedAttributionInfo extends AttributionFrameworkInfo {
  geo_postback_available: boolean;
  development_postbacks: boolean;
  features: string[];
}

// Postback environment configuration response
export interface PostbackEnvironmentResponse {
  environment: 'production' | 'sandbox';
  isSandbox: boolean;
  note: string;
}

// Overlapping window postback response (iOS 18.4+)
export interface OverlappingWindowPostbackResponse {
  success: boolean;
  framework: string;
  version: string;
  fineValue: number;
  coarseValue: string;
  lockWindow: boolean;
  windowIndex: number;
  overlappingWindows: boolean;
  note?: string;
}

interface SKAdNetworkModule {
  updateConversionValue(value: number): Promise<boolean>;
  updatePostbackConversionValue(
    fineValue: number,
    coarseValue: string,
    lockWindow: boolean
  ): Promise<PostbackUpdateResponse>;
  updateReengagementConversionValue(
    fineValue: number,
    coarseValue: string,
    lockWindow: boolean
  ): Promise<PostbackUpdateResponse>;
  isSKAN4Available(): Promise<boolean>;
  isAdAttributionKitAvailable(): Promise<boolean>;
  isOverlappingWindowsAvailable(): Promise<boolean>;
  registerForAttribution(): Promise<{ framework: string; registered: boolean }>;
  getAttributionInfo(): Promise<AttributionFrameworkInfo>;
  // iOS 18.4+ methods
  isGeoPostbackAvailable(): Promise<boolean>;
  setPostbackEnvironment(environment: string): Promise<PostbackEnvironmentResponse>;
  getEnhancedAttributionInfo(): Promise<EnhancedAttributionInfo>;
  updatePostbackWithWindow(
    fineValue: number,
    coarseValue: string,
    lockWindow: boolean,
    windowIndex: number
  ): Promise<OverlappingWindowPostbackResponse>;
}

// SKAdNetwork is iOS-only, use Expo Modules for new arch compatibility
let DatalyrSKAdNetwork: SKAdNetworkModule | undefined;
if (Platform.OS === 'ios') {
  try {
    DatalyrSKAdNetwork = requireNativeModule<SKAdNetworkModule>('DatalyrSKAdNetwork');
  } catch {
    // Module not available
  }
}

export class SKAdNetworkBridge {
  private static _isSKAN4Available: boolean | null = null;

  // 9.C.2: serializes guard→send→commit (and reset) so two concurrent updates can't both
  // pass the comparison against the same stale high-water and both send.
  private static highWaterChain: Promise<unknown> = Promise.resolve();

  /** Read the persisted high-water state. Fails open to zeros on storage errors. */
  private static async readConversionState(): Promise<{ fine: number; coarseRank: number; locked: boolean }> {
    try {
      const [fine, coarse, locked] = await Promise.all([
        AsyncStorage.getItem(SKAN_HIGH_FINE_KEY),
        AsyncStorage.getItem(SKAN_HIGH_COARSE_KEY),
        AsyncStorage.getItem(SKAN_WINDOW_LOCKED_KEY),
      ]);
      return {
        fine: fine ? parseInt(fine, 10) || 0 : 0,
        coarseRank: coarse ? parseInt(coarse, 10) || 0 : 0,
        locked: locked === '1',
      };
    } catch {
      return { fine: 0, coarseRank: 0, locked: false };
    }
  }

  /**
   * Monotonic guard: should this candidate value be sent? Skips when the persisted
   * window-lock is set, or when the value isn't strictly higher (fine first, coarse rank
   * as tie-break) than the persisted high-water. Same ordering as the iOS SDK.
   */
  private static async passesHighWater(result: SKANConversionResult): Promise<boolean> {
    const state = await this.readConversionState();
    if (state.locked) {
      console.log('[Datalyr] SKAN: skipping update (conversion window locked)');
      return false;
    }
    const newRank = coarseRank(result.coarseValue);
    const isHigher =
      result.fineValue > state.fine ||
      (result.fineValue === state.fine && newRank > state.coarseRank);
    if (!isHigher) {
      console.log(`[Datalyr] SKAN: skipping update (fine=${result.fineValue}, coarse=${result.coarseValue} not higher than persisted high-water fine=${state.fine})`);
    }
    return isHigher;
  }

  /** Persist a sent value as the new high-water (called only after a successful send). */
  private static async commitHighWater(result: SKANConversionResult): Promise<void> {
    try {
      await AsyncStorage.setItem(SKAN_HIGH_FINE_KEY, String(result.fineValue));
      await AsyncStorage.setItem(SKAN_HIGH_COARSE_KEY, String(coarseRank(result.coarseValue)));
      if (result.lockWindow) {
        await AsyncStorage.setItem(SKAN_WINDOW_LOCKED_KEY, '1');
      }
    } catch (error) {
      console.warn('[Datalyr] SKAN: failed to persist high-water state:', error);
    }
  }

  /**
   * Reset the persisted high-water state (fine + coarse + window-lock). Called from
   * SDK.reset() (logout) so a new user identity starts a fresh conversion-value window —
   * without this the previous user's high-water suppresses ALL of the next user's SKAN
   * updates. (Mirrors iOS UnifiedAttributionTracker.resetConversionState.)
   */
  static async resetConversionState(): Promise<void> {
    const run = this.highWaterChain.then(async () => {
      try {
        await Promise.all([
          AsyncStorage.removeItem(SKAN_HIGH_FINE_KEY),
          AsyncStorage.removeItem(SKAN_HIGH_COARSE_KEY),
          AsyncStorage.removeItem(SKAN_WINDOW_LOCKED_KEY),
        ]);
      } catch (error) {
        console.warn('[Datalyr] SKAN: failed to reset conversion state:', error);
      }
    });
    this.highWaterChain = run.catch(() => undefined);
    await run;
  }

  /**
   * Test-only: exercise just the persisted monotonic guard without the native
   * SKAdNetwork round-trip (unavailable under jest / the simulator). Returns whether the
   * value WOULD be sent, committing the high-water exactly as the real path does after a
   * successful send. (Mirrors the iOS SDK's applyHighWaterForTest.)
   */
  static async applyHighWaterForTest(result: SKANConversionResult): Promise<boolean> {
    const run = this.highWaterChain.then(async () => {
      if (!(await this.passesHighWater(result))) return false;
      await this.commitHighWater(result);
      return true;
    });
    this.highWaterChain = run.catch(() => false);
    return run;
  }

  /**
   * SKAN 3.0 - Update conversion value (0-63)
   * @deprecated Use updatePostbackConversionValue for iOS 16.1+
   */
  static async updateConversionValue(value: number): Promise<boolean> {
    if (Platform.OS !== 'ios') {
      return false; // Android doesn't support SKAdNetwork
    }

    if (!DatalyrSKAdNetwork) {
      console.warn('[Datalyr] SKAdNetwork native module not found. Ensure native bridge is properly configured.');
      return false;
    }

    try {
      const success = await DatalyrSKAdNetwork.updateConversionValue(value);
      console.log(`[Datalyr] SKAdNetwork conversion value updated: ${value}`);
      return success;
    } catch (error) {
      console.warn('[Datalyr] Failed to update SKAdNetwork conversion value:', error);
      return false;
    }
  }

  /**
   * SKAN 4.0 - Update postback conversion value with coarse value and lock window
   * Falls back to SKAN 3.0 on iOS 14.0-16.0
   *
   * 9.C.2: guarded by a PERSISTED monotonic high-water mark (AsyncStorage — survives app
   * restarts). Only strictly-higher values are sent; the high-water commits AFTER a
   * successful native send (a failed send leaves it unchanged so a retry can succeed),
   * and a persisted window-lock is honored across launches. reset() clears the state via
   * resetConversionState().
   */
  static async updatePostbackConversionValue(
    result: SKANConversionResult
  ): Promise<boolean> {
    if (Platform.OS !== 'ios') {
      return false; // Android doesn't support SKAdNetwork
    }

    const native = DatalyrSKAdNetwork;
    if (!native) {
      console.warn('[Datalyr] SKAdNetwork native module not found. Ensure native bridge is properly configured.');
      return false;
    }

    const run = this.highWaterChain.then(async () => {
      if (!(await SKAdNetworkBridge.passesHighWater(result))) {
        return false;
      }

      try {
        const response = await native.updatePostbackConversionValue(
          result.fineValue,
          result.coarseValue,
          result.lockWindow
        );

        const isSKAN4 = await SKAdNetworkBridge.isSKAN4Available();
        if (isSKAN4) {
          console.log(`[Datalyr] SKAN 4.0 postback updated: fineValue=${result.fineValue}, coarseValue=${result.coarseValue}, lockWindow=${result.lockWindow}`);
        } else {
          console.log(`[Datalyr] SKAN 3.0 fallback: conversionValue=${result.fineValue}`);
        }

        if (response.success) {
          await SKAdNetworkBridge.commitHighWater(result);
        }

        return response.success;
      } catch (error) {
        console.warn('[Datalyr] Failed to update SKAdNetwork postback conversion value:', error);
        return false;
      }
    });
    this.highWaterChain = run.catch(() => undefined);
    return run;
  }

  /**
   * Check if SKAN 4.0 is available (iOS 16.1+)
   */
  static async isSKAN4Available(): Promise<boolean> {
    if (Platform.OS !== 'ios') {
      return false;
    }

    if (this._isSKAN4Available !== null) {
      return this._isSKAN4Available;
    }

    if (!DatalyrSKAdNetwork?.isSKAN4Available) {
      return false;
    }

    try {
      this._isSKAN4Available = await DatalyrSKAdNetwork.isSKAN4Available();
      return this._isSKAN4Available;
    } catch {
      return false;
    }
  }

  static isAvailable(): boolean {
    return Platform.OS === 'ios' && !!DatalyrSKAdNetwork;
  }

  /**
   * Check if AdAttributionKit is available (iOS 17.4+)
   * AdAttributionKit is Apple's replacement for SKAdNetwork with enhanced features
   */
  private static _isAdAttributionKitAvailable: boolean | null = null;

  static async isAdAttributionKitAvailable(): Promise<boolean> {
    if (Platform.OS !== 'ios') {
      return false;
    }

    if (this._isAdAttributionKitAvailable !== null) {
      return this._isAdAttributionKitAvailable;
    }

    if (!DatalyrSKAdNetwork?.isAdAttributionKitAvailable) {
      return false;
    }

    try {
      this._isAdAttributionKitAvailable = await DatalyrSKAdNetwork.isAdAttributionKitAvailable();
      return this._isAdAttributionKitAvailable;
    } catch {
      return false;
    }
  }

  /**
   * Register for ad network attribution
   * Uses AdAttributionKit on iOS 17.4+, SKAdNetwork on earlier versions
   */
  static async registerForAttribution(): Promise<{ framework: string; registered: boolean } | null> {
    if (Platform.OS !== 'ios') {
      return null;
    }

    if (!DatalyrSKAdNetwork?.registerForAttribution) {
      console.warn('[Datalyr] Attribution registration not available');
      return null;
    }

    try {
      const result = await DatalyrSKAdNetwork.registerForAttribution();
      console.log(`[Datalyr] Registered for attribution: ${result.framework}`);
      return result;
    } catch (error) {
      console.warn('[Datalyr] Failed to register for attribution:', error);
      return null;
    }
  }

  /**
   * Get attribution framework info
   * Returns details about which framework is being used and its capabilities
   */
  static async getAttributionInfo(): Promise<AttributionFrameworkInfo | null> {
    if (Platform.OS !== 'ios') {
      return {
        framework: 'none',
        version: '0',
        reengagement_available: false,
        overlapping_windows: false,
        fine_value_range: { min: 0, max: 0 },
        coarse_values: [],
      };
    }

    if (!DatalyrSKAdNetwork?.getAttributionInfo) {
      return null;
    }

    try {
      return await DatalyrSKAdNetwork.getAttributionInfo();
    } catch (error) {
      console.warn('[Datalyr] Failed to get attribution info:', error);
      return null;
    }
  }

  /**
   * Check if overlapping conversion windows are available (iOS 18.4+)
   * Overlapping windows allow multiple conversion windows to be active simultaneously
   */
  private static _isOverlappingWindowsAvailable: boolean | null = null;

  static async isOverlappingWindowsAvailable(): Promise<boolean> {
    if (Platform.OS !== 'ios') {
      return false;
    }

    if (this._isOverlappingWindowsAvailable !== null) {
      return this._isOverlappingWindowsAvailable;
    }

    if (!DatalyrSKAdNetwork?.isOverlappingWindowsAvailable) {
      return false;
    }

    try {
      this._isOverlappingWindowsAvailable = await DatalyrSKAdNetwork.isOverlappingWindowsAvailable();
      return this._isOverlappingWindowsAvailable;
    } catch {
      return false;
    }
  }

  /**
   * Update conversion value for re-engagement attribution (AdAttributionKit iOS 17.4+ only)
   * Re-engagement tracks users who return to the app via an ad after initial install.
   *
   * @param result - Conversion result with fine value (0-63), coarse value, and lock window
   * @returns Response with framework info, or null if not supported
   */
  static async updateReengagementConversionValue(
    result: SKANConversionResult
  ): Promise<PostbackUpdateResponse | null> {
    if (Platform.OS !== 'ios') {
      return null; // Android doesn't support AdAttributionKit
    }

    // Check if AdAttributionKit is available (required for re-engagement)
    const isAAKAvailable = await this.isAdAttributionKitAvailable();
    if (!isAAKAvailable) {
      console.warn('[Datalyr] Re-engagement attribution requires iOS 17.4+ (AdAttributionKit)');
      return null;
    }

    if (!DatalyrSKAdNetwork?.updateReengagementConversionValue) {
      console.warn('[Datalyr] Re-engagement native module not available');
      return null;
    }

    try {
      const response = await DatalyrSKAdNetwork.updateReengagementConversionValue(
        result.fineValue,
        result.coarseValue,
        result.lockWindow
      );

      console.log(`[Datalyr] AdAttributionKit re-engagement updated: fineValue=${result.fineValue}, coarseValue=${result.coarseValue}, lockWindow=${result.lockWindow}`);
      return response;
    } catch (error) {
      console.warn('[Datalyr] Failed to update re-engagement conversion value:', error);
      return null;
    }
  }

  /**
   * Get a summary of attribution capabilities for the current device
   */
  static async getCapabilitiesSummary(): Promise<{
    skadnetwork3: boolean;
    skadnetwork4: boolean;
    adAttributionKit: boolean;
    reengagement: boolean;
    overlappingWindows: boolean;
    geoPostback: boolean;
    developmentPostbacks: boolean;
    framework: string;
  }> {
    const info = await this.getAttributionInfo();
    const isSKAN4 = await this.isSKAN4Available();
    const isAAK = await this.isAdAttributionKitAvailable();
    const isOverlapping = await this.isOverlappingWindowsAvailable();
    const isGeo = await this.isGeoPostbackAvailable();

    return {
      skadnetwork3: Platform.OS === 'ios',
      skadnetwork4: isSKAN4,
      adAttributionKit: isAAK,
      reengagement: info?.reengagement_available ?? false,
      overlappingWindows: isOverlapping,
      geoPostback: isGeo,
      developmentPostbacks: isGeo, // Same iOS version requirement
      framework: info?.framework ?? 'none',
    };
  }

  // ===== iOS 18.4+ Features =====

  /**
   * Check if geo-level postback data is available (iOS 18.4+)
   * Geo postbacks include country code information for regional analytics
   */
  private static _isGeoPostbackAvailable: boolean | null = null;

  static async isGeoPostbackAvailable(): Promise<boolean> {
    if (Platform.OS !== 'ios') {
      return false;
    }

    if (this._isGeoPostbackAvailable !== null) {
      return this._isGeoPostbackAvailable;
    }

    if (!DatalyrSKAdNetwork?.isGeoPostbackAvailable) {
      return false;
    }

    try {
      this._isGeoPostbackAvailable = await DatalyrSKAdNetwork.isGeoPostbackAvailable();
      return this._isGeoPostbackAvailable;
    } catch {
      return false;
    }
  }

  /**
   * Set postback environment for testing (iOS 18.4+)
   * Note: Actual sandbox mode requires Developer Mode enabled in iOS Settings
   *
   * @param environment - 'production' or 'sandbox'
   */
  static async setPostbackEnvironment(
    environment: 'production' | 'sandbox'
  ): Promise<PostbackEnvironmentResponse | null> {
    if (Platform.OS !== 'ios') {
      return null;
    }

    if (!DatalyrSKAdNetwork?.setPostbackEnvironment) {
      console.warn('[Datalyr] Development postbacks require iOS 18.4+');
      return null;
    }

    try {
      const result = await DatalyrSKAdNetwork.setPostbackEnvironment(environment);
      console.log(`[Datalyr] Postback environment: ${result.environment}`);
      return result;
    } catch (error) {
      console.warn('[Datalyr] Failed to set postback environment:', error);
      return null;
    }
  }

  /**
   * Get enhanced attribution info including iOS 18.4+ features
   * Returns details about geo postbacks, development mode, and all available features
   */
  static async getEnhancedAttributionInfo(): Promise<EnhancedAttributionInfo | null> {
    if (Platform.OS !== 'ios') {
      return {
        framework: 'none',
        version: '0',
        reengagement_available: false,
        overlapping_windows: false,
        geo_postback_available: false,
        development_postbacks: false,
        fine_value_range: { min: 0, max: 0 },
        coarse_values: [],
        features: [],
      };
    }

    if (!DatalyrSKAdNetwork?.getEnhancedAttributionInfo) {
      // Fallback to basic info if enhanced not available
      const basicInfo = await this.getAttributionInfo();
      if (basicInfo) {
        return {
          ...basicInfo,
          geo_postback_available: false,
          development_postbacks: false,
          features: [],
        };
      }
      return null;
    }

    try {
      return await DatalyrSKAdNetwork.getEnhancedAttributionInfo();
    } catch (error) {
      console.warn('[Datalyr] Failed to get enhanced attribution info:', error);
      return null;
    }
  }

  /**
   * Update postback with overlapping window support (iOS 18.4+)
   * Allows tracking conversions across multiple time windows simultaneously
   *
   * @param result - Conversion result with fine value, coarse value, and lock window
   * @param windowIndex - Window index: 0 (0-2 days), 1 (3-7 days), 2 (8-35 days)
   */
  static async updatePostbackWithWindow(
    result: SKANConversionResult,
    windowIndex: 0 | 1 | 2
  ): Promise<OverlappingWindowPostbackResponse | null> {
    if (Platform.OS !== 'ios') {
      return null;
    }

    if (!DatalyrSKAdNetwork?.updatePostbackWithWindow) {
      console.warn('[Datalyr] Overlapping windows require iOS 16.1+ (full support on iOS 18.4+)');
      return null;
    }

    try {
      const response = await DatalyrSKAdNetwork.updatePostbackWithWindow(
        result.fineValue,
        result.coarseValue,
        result.lockWindow,
        windowIndex
      );

      console.log(`[Datalyr] Postback updated for window ${windowIndex}: fineValue=${result.fineValue}, overlapping=${response.overlappingWindows}`);
      return response;
    } catch (error) {
      console.warn('[Datalyr] Failed to update postback with window:', error);
      return null;
    }
  }

  /**
   * Enable development/sandbox mode for testing attribution
   * Convenience method that sets sandbox environment
   */
  static async enableDevelopmentMode(): Promise<boolean> {
    const result = await this.setPostbackEnvironment('sandbox');
    return result?.isSandbox ?? false;
  }

  /**
   * Disable development mode (switch to production)
   */
  static async disableDevelopmentMode(): Promise<boolean> {
    const result = await this.setPostbackEnvironment('production');
    return result !== null && !result.isSandbox;
  }
} 