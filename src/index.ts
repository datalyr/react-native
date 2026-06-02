// Main entry point for React Native CLI
// Import with: import { Datalyr } from '@datalyr/react-native';

import datalyrSingleton, { DatalyrSDK, Datalyr } from './datalyr-sdk';

// Re-export the CANONICAL singleton (datalyr-sdk.ts default export) — the same
// instance the `Datalyr` static facade and screen-tracking already use. Previously
// this did `new DatalyrSDK()`, creating a SECOND, never-initialized instance, so
// mixing `import { datalyr }` with `Datalyr.*` stranded events in a pre-init queue.
export const datalyr = datalyrSingleton;

// Export enhanced static class for SKAdNetwork usage
export { Datalyr };

// Export types and utilities
export * from './types';
export { attributionManager } from './attribution';
export { journeyManager } from './journey';
export type { TouchAttribution, TouchPoint } from './journey';
export { createAutoEventsManager, AutoEventsManager } from './auto-events';

// Re-export utilities for advanced usage
export * from './utils';
export * from './http-client';
export * from './event-queue';

// Also export the SDK class for advanced usage
export { DatalyrSDK };

// Export automatic screen tracking for React Navigation
export {
  datalyrScreenTracking,
  createScreenTrackingListeners,
} from './screen-tracking';
export type { ScreenTrackingConfig, NavigationContainerRef } from './screen-tracking';

// Export SKAdNetwork components
export { ConversionValueEncoder, ConversionTemplates } from './ConversionValueEncoder';
export { SKAdNetworkBridge } from './native/SKAdNetworkBridge';

// Export platform integrations
export { appleSearchAdsIntegration, playInstallReferrerIntegration } from './integrations';

// Export network status manager
export { networkStatusManager } from './network-status';
export type { NetworkState, NetworkStateListener } from './network-status';

// Export native bridge types
export type { AppleSearchAdsAttribution } from './native/DatalyrNativeBridge';

// Default export for compatibility
export default DatalyrSDK; 