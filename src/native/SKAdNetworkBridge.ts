import { NativeModules, Platform } from 'react-native';

// SKAN 4.0 coarse value type
export type SKANCoarseValue = 'low' | 'medium' | 'high';

// SKAN 4.0 conversion result
export interface SKANConversionResult {
  fineValue: number;      // 0-63
  coarseValue: SKANCoarseValue;
  lockWindow: boolean;
  priority: number;
}

interface SKAdNetworkModule {
  updateConversionValue(value: number): Promise<boolean>;
  updatePostbackConversionValue(
    fineValue: number,
    coarseValue: string,
    lockWindow: boolean
  ): Promise<boolean>;
  isSKAN4Available(): Promise<boolean>;
}

const { DatalyrSKAdNetwork } = NativeModules as {
  DatalyrSKAdNetwork?: SKAdNetworkModule
};

export class SKAdNetworkBridge {
  private static _isSKAN4Available: boolean | null = null;

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
   */
  static async updatePostbackConversionValue(
    result: SKANConversionResult
  ): Promise<boolean> {
    if (Platform.OS !== 'ios') {
      return false; // Android doesn't support SKAdNetwork
    }

    if (!DatalyrSKAdNetwork) {
      console.warn('[Datalyr] SKAdNetwork native module not found. Ensure native bridge is properly configured.');
      return false;
    }

    try {
      const success = await DatalyrSKAdNetwork.updatePostbackConversionValue(
        result.fineValue,
        result.coarseValue,
        result.lockWindow
      );

      const isSKAN4 = await this.isSKAN4Available();
      if (isSKAN4) {
        console.log(`[Datalyr] SKAN 4.0 postback updated: fineValue=${result.fineValue}, coarseValue=${result.coarseValue}, lockWindow=${result.lockWindow}`);
      } else {
        console.log(`[Datalyr] SKAN 3.0 fallback: conversionValue=${result.fineValue}`);
      }

      return success;
    } catch (error) {
      console.warn('[Datalyr] Failed to update SKAdNetwork postback conversion value:', error);
      return false;
    }
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
} 