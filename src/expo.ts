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

// Export journey tracking
export { journeyManager } from './journey';
export type { TouchAttribution, TouchPoint } from './journey';

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

// Export automatic screen tracking for React Navigation
export { createScreenTrackingListeners } from './screen-tracking';
export type { ScreenTrackingConfig, NavigationContainerRef } from './screen-tracking';

// Expo-specific convenience: auto-wires to the Expo singleton
import { createScreenTrackingListeners as _createListeners } from './screen-tracking';
import type { NavigationContainerRef as _NavRef, ScreenTrackingConfig as _Config } from './screen-tracking';

/**
 * Auto-wire screen tracking to the Expo Datalyr singleton.
 *
 * ```tsx
 * const navigationRef = useNavigationContainerRef();
 * const screenTracking = datalyrScreenTracking(navigationRef);
 *
 * <NavigationContainer
 *   ref={navigationRef}
 *   onReady={screenTracking.onReady}
 *   onStateChange={screenTracking.onStateChange}
 * />
 * ```
 */
export function datalyrScreenTracking(
  navigationRef: _NavRef,
  config?: _Config,
): { onReady: () => void; onStateChange: () => void } {
  return _createListeners(
    navigationRef,
    (screenName, properties) => datalyrExpo.screen(screenName, properties),
    config,
  );
}

// Export automatic screen tracking for Expo Router
export { useExpoRouterTracking } from './expo-router-tracking';
export type { ExpoRouterTrackingConfig } from './expo-router-tracking';

import { useExpoRouterTracking as _useExpoRouterTracking } from './expo-router-tracking';
import type { ExpoRouterTrackingConfig as _ExpoRouterConfig } from './expo-router-tracking';

// Lazy-resolved expo-router hook. Resolved once at first call, not inside the
// hook body, so that hook call count stays stable across renders.
let _usePathname: (() => string) | null = null;
function getUsePathname(): () => string {
  if (!_usePathname) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _usePathname = (require('expo-router') as { usePathname: () => string }).usePathname;
  }
  return _usePathname;
}

/**
 * Drop-in screen tracking for Expo Router — wires to the Expo Datalyr singleton.
 *
 * ```tsx
 * // app/_layout.tsx
 * import { useDatalyrScreenTracking } from '@datalyr/react-native/expo';
 *
 * export default function RootLayout() {
 *   useDatalyrScreenTracking();
 *   return <Stack />;
 * }
 * ```
 *
 * Screen names are raw pathnames (e.g. "/onboarding/paywall").
 *
 * @param config  Optional path transforms and filters.
 */
export function useDatalyrScreenTracking(config?: _ExpoRouterConfig): void {
  _useExpoRouterTracking(
    (screenName, properties) => datalyrExpo.screen(screenName, properties),
    getUsePathname(),
    config,
  );
}

// Export platform integrations
export { appleSearchAdsIntegration } from './integrations';
export type { AppleSearchAdsAttribution } from './native/DatalyrNativeBridge';

// Default export
export default datalyrExpo;
