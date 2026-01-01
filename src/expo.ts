/**
 * Expo entry point - uses Expo-compatible utilities
 * Import with: import { Datalyr } from '@datalyr/react-native/expo';
 *
 * Uses Expo-specific packages:
 * - expo-application (app version, bundle ID)
 * - expo-device (device model, manufacturer)
 * - expo-network (network type detection)
 *
 * For React Native CLI, use:
 * import { Datalyr } from '@datalyr/react-native';
 */

// Export Expo-specific SDK (uses utils-expo.ts)
export { DatalyrSDKExpo as DatalyrSDK, DatalyrExpo as Datalyr } from './datalyr-sdk-expo';
import datalyrExpo from './datalyr-sdk-expo';
export { datalyrExpo as datalyr };

// Export types
export * from './types';

// Export attribution manager
export { attributionManager } from './attribution';

// Export auto-events
export { createAutoEventsManager, AutoEventsManager } from './auto-events';

// Re-export Expo-specific utilities for advanced usage
export {
  debugLog,
  errorLog,
  generateUUID,
  Storage,
  getOrCreateVisitorId,
  getOrCreateAnonymousId,
  getOrCreateSessionId,
  createFingerprintData,
  getNetworkType,
  validateEventName,
  validateEventData,
  isFirstLaunch,
  checkAppVersion,
  getDeviceInfo,
  STORAGE_KEYS,
} from './utils-expo';

// Export HTTP client and event queue
export * from './http-client';
export * from './event-queue';

// Export SKAdNetwork components
export { ConversionValueEncoder, ConversionTemplates } from './ConversionValueEncoder';
export { SKAdNetworkBridge } from './native/SKAdNetworkBridge';

// Export platform integrations
export { appleSearchAdsIntegration } from './integrations';
export type { AppleSearchAdsAttribution } from './native/DatalyrNativeBridge';

// Default export
export default datalyrExpo;
