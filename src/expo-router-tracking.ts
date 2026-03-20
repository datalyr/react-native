/**
 * Automatic screen tracking for Expo Router.
 *
 * Expo Router uses file-based routing and does not expose a
 * NavigationContainerRef, so we use the `usePathname()` hook to
 * detect route changes and fire pageview events automatically.
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
 * Screen names are the raw pathname (e.g. "/onboarding/paywall", "/(app)/chat").
 * These are consistent and easy to filter in the Datalyr dashboard.
 */

import { useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ExpoRouterTrackingConfig {
  /**
   * Map specific pathnames to friendly screen names.
   * Paths not in this map use the raw pathname (or `transformPathname` if set).
   * @example { '/onboarding/paywall': 'Paywall', '/(app)/chat': 'Chat' }
   */
  screenNames?: Record<string, string>;

  /**
   * Transform the pathname before tracking.
   * Applied only when the path is NOT in `screenNames`.
   * @example (path) => path.replace(/\(.*?\)\//g, '')  // strip route groups
   */
  transformPathname?: (pathname: string) => string;

  /**
   * Filter which paths should be tracked.
   * Return false to skip tracking for a given path.
   * @example (path) => !path.startsWith('/modal')
   */
  shouldTrackPath?: (pathname: string) => boolean;
}

// ---------------------------------------------------------------------------
// Core hook
// ---------------------------------------------------------------------------

/**
 * React hook that automatically tracks screen views when the Expo Router
 * pathname changes. Drop this into your root `_layout.tsx`.
 *
 * @param trackScreen  The function that records a screen event.
 *                     Receives `(pathname, properties)`.
 * @param usePathname  The `usePathname` hook from `expo-router`.
 *                     Passed in to avoid a hard dependency on expo-router.
 * @param config       Optional filtering / transform config.
 */
export function useExpoRouterTracking(
  trackScreen: (screenName: string, properties?: Record<string, any>) => Promise<void>,
  usePathname: () => string,
  config?: ExpoRouterTrackingConfig,
): void {
  const pathname = usePathname();
  const previousPathname = useRef<string | undefined>(undefined);

  // Keep mutable refs so the effect always sees the latest values
  // without needing them in the dependency array (which would re-fire on every render).
  const trackScreenRef = useRef(trackScreen);
  trackScreenRef.current = trackScreen;
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    if (!pathname) return;
    if (previousPathname.current === pathname) return;

    const prevPath = previousPathname.current;
    previousPathname.current = pathname;

    const cfg = configRef.current;

    // Apply filter
    if (cfg?.shouldTrackPath && !cfg.shouldTrackPath(pathname)) return;

    // Resolve screen name: screenNames map → transformPathname → raw pathname
    const resolve = (path: string): string =>
      cfg?.screenNames?.[path]
        ?? (cfg?.transformPathname ? cfg.transformPathname(path) : path);

    const screenName = resolve(pathname);

    const properties: Record<string, any> = { source: 'auto_expo_router' };
    if (prevPath) {
      properties.previous_screen = resolve(prevPath);
    }

    trackScreenRef.current(screenName, properties).catch(() => {
      // Silently ignore — SDK logs internally
    });
  }, [pathname]);
}
