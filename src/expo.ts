// Expo entry point - uses Expo-compatible utilities
// Import this with: import { datalyr } from '@datalyr/react-native-sdk/expo';

// Note: This is a placeholder - you'd need to create a version of DatalyrSDK
// that imports from utils-expo.ts instead of utils.ts

export { DatalyrSDK as datalyr } from './datalyr-sdk';
export * from './types';
export { attributionManager } from './attribution';
export { createAutoEventsManager, AutoEventsManager } from './auto-events';

// Re-export Expo-specific utilities
export { 
  debugLog, 
  errorLog, 
  generateUUID, 
  Storage, 
  getOrCreateVisitorId, 
  getOrCreateSessionId,
  createFingerprintData,
  getNetworkType,
  validateEventName,
  validateEventData,
  isFirstLaunch,
  checkAppVersion
} from './utils-expo';

export * from './http-client';
export * from './event-queue';

// Default export for compatibility
import { DatalyrSDK } from './datalyr-sdk';
export default DatalyrSDK;

// TODO: Create expo-specific version that uses utils-expo.ts
// This would require creating datalyr-sdk-expo.ts that imports utils-expo instead of utils 