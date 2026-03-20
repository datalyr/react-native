/**
 * Automatic screen tracking for React Navigation (v5+ / v6+).
 *
 * The simplest integration — just spread onto your NavigationContainer:
 *
 * ```tsx
 * import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
 * import { datalyrScreenTracking } from '@datalyr/react-native';
 *
 * function App() {
 *   const navigationRef = useNavigationContainerRef();
 *   const screenTracking = datalyrScreenTracking(navigationRef);
 *
 *   return (
 *     <NavigationContainer
 *       ref={navigationRef}
 *       onReady={screenTracking.onReady}
 *       onStateChange={screenTracking.onStateChange}
 *     >
 *       {/* screens */}
 *     </NavigationContainer>
 *   );
 * }
 * ```
 *
 * Note: If you enable automatic screen tracking, avoid also calling
 * `Datalyr.screen()` / `datalyr.screen()` manually for the same screens,
 * as this will produce duplicate events.
 *
 * For Expo Router (file-based routing), automatic tracking is not needed —
 * Expo Router uses React Navigation internally but does not expose
 * NavigationContainer. Use the `datalyr.screen()` method in your layout
 * files instead.
 */

import { debugLog, errorLog } from './utils';

// ---------------------------------------------------------------------------
// Minimal React Navigation types — avoids adding @react-navigation as a
// peer dependency. Only the methods we actually call are listed here.
// ---------------------------------------------------------------------------

/** Minimal subset of React Navigation's NavigationContainerRef that we need. */
export interface NavigationContainerRef {
  getCurrentRoute(): { name: string; params?: Record<string, any> } | undefined;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ScreenTrackingConfig {
  /**
   * Transform the route name before tracking.
   * Useful for cleaning up or grouping screen names.
   * @example (name) => name.replace('Screen', '')
   */
  transformScreenName?: (routeName: string) => string;

  /**
   * Filter which screens should be tracked.
   * Return false to skip tracking for a given screen.
   * @example (name) => !['Loading', 'Splash'].includes(name)
   */
  shouldTrackScreen?: (routeName: string) => boolean;

  /**
   * Extract additional properties from the route to include in the screen event.
   * @example (name, params) => ({ product_id: params?.productId })
   */
  extractProperties?: (routeName: string, params?: Record<string, any>) => Record<string, any>;
}

// ---------------------------------------------------------------------------
// Core implementation
// ---------------------------------------------------------------------------

/**
 * Create `onReady` and `onStateChange` callbacks that automatically
 * fire screen events through the Datalyr SDK whenever the active
 * React Navigation route changes.
 *
 * @param navigationRef  A React Navigation `NavigationContainerRef`
 *                       (from `useNavigationContainerRef()` or
 *                       `createNavigationContainerRef()`).
 * @param trackScreen    The function that records a screen event.
 *                       Pass `datalyr.screen.bind(datalyr)` or the
 *                       Datalyr static class's `Datalyr.screen`.
 *                       If omitted, the default singleton is used.
 * @param config         Optional filtering / transform config.
 */
export function createScreenTrackingListeners(
  navigationRef: NavigationContainerRef,
  trackScreen: (screenName: string, properties?: Record<string, any>) => Promise<void>,
  config?: ScreenTrackingConfig,
): { onReady: () => void; onStateChange: () => void } {
  let currentRouteName: string | undefined;

  const resolveScreenName = (routeName: string): string =>
    config?.transformScreenName ? config.transformScreenName(routeName) : routeName;

  const buildProperties = (
    routeName: string,
    params?: Record<string, any>,
    previousRouteName?: string,
  ): Record<string, any> => {
    const props: Record<string, any> = { source: 'auto_navigation' };

    if (previousRouteName) {
      props.previous_screen = resolveScreenName(previousRouteName);
    }

    if (config?.extractProperties) {
      Object.assign(props, config.extractProperties(routeName, params));
    }

    return props;
  };

  const shouldTrack = (routeName: string): boolean =>
    !config?.shouldTrackScreen || config.shouldTrackScreen(routeName);

  const safeTrack = (screenName: string, properties: Record<string, any>) => {
    try {
      trackScreen(screenName, properties).catch((err) => {
        errorLog('Auto screen tracking failed:', err as Error);
      });
    } catch (err) {
      errorLog('Auto screen tracking failed:', err as Error);
    }
  };

  const onReady = () => {
    const route = navigationRef.getCurrentRoute();
    if (!route) return;

    currentRouteName = route.name;

    if (shouldTrack(route.name)) {
      const screenName = resolveScreenName(route.name);
      safeTrack(screenName, buildProperties(route.name, route.params));
      debugLog('Auto screen tracking: initial screen', screenName);
    }
  };

  const onStateChange = () => {
    const route = navigationRef.getCurrentRoute();
    if (!route) return;

    const previousRouteName = currentRouteName;
    currentRouteName = route.name;

    // Don't fire for same-screen param changes
    if (previousRouteName === currentRouteName) return;

    if (!shouldTrack(route.name)) return;

    const screenName = resolveScreenName(route.name);
    safeTrack(screenName, buildProperties(route.name, route.params, previousRouteName));
    debugLog('Auto screen tracking: navigated to', screenName);
  };

  return { onReady, onStateChange };
}

// ---------------------------------------------------------------------------
// Convenience wrapper — wires to the default Datalyr singleton
// ---------------------------------------------------------------------------

/**
 * Auto-wire screen tracking to the default Datalyr singleton.
 * This is the recommended API for most users.
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
 *
 * @param navigationRef  React Navigation container ref
 * @param config         Optional screen name transforms and filters
 */
export function datalyrScreenTracking(
  navigationRef: NavigationContainerRef,
  config?: ScreenTrackingConfig,
): { onReady: () => void; onStateChange: () => void } {
  // Import singleton directly from datalyr-sdk (not index.ts) to avoid circular deps.
  // The DatalyrSDK module creates a module-level singleton — by the time onReady fires
  // the SDK will be initialized.
  const sdk = require('./datalyr-sdk').default;

  return createScreenTrackingListeners(
    navigationRef,
    (screenName, properties) => sdk.screen(screenName, properties),
    config,
  );
}
