import { NativeModules, Platform } from 'react-native';

interface SKAdNetworkModule {
  updateConversionValue(value: number): Promise<boolean>;
}

const { DatalyrSKAdNetwork } = NativeModules as { 
  DatalyrSKAdNetwork?: SKAdNetworkModule 
};

export class SKAdNetworkBridge {
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

  static isAvailable(): boolean {
    return Platform.OS === 'ios' && !!DatalyrSKAdNetwork;
  }
} 