// W14: automatic screen tracking — the React Navigation listeners (screen-tracking.ts)
// and the Expo Router hook (expo-router-tracking.ts).

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1',
  applicationId: 'com.datalyr.test', getInstallationTimeAsync: async () => new Date(0),
}), { virtual: true });
jest.mock('expo-device', () => ({
  modelName: 'Test Device', deviceName: 'Test Device', manufacturer: 'Test',
  osVersion: '17.0', isDevice: true,
}), { virtual: true });
jest.mock('expo-network', () => ({
  NetworkStateType: { WIFI: 'WIFI' },
  getNetworkStateAsync: async () => ({ type: 'WIFI', isConnected: true }),
}), { virtual: true });
jest.mock('expo-router', () => ({ usePathname: () => mockPathname.current }), { virtual: true });

// A minimal hook runtime: useRef keeps its object across renders, useEffect runs when a
// dependency changes. Enough to drive useExpoRouterTracking without a React renderer.
jest.mock('react', () => {
  const hooks = { slot: 0, refs: new Map<number, any>(), deps: new Map<number, any[]>() };
  return {
    __hooks: hooks,
    useRef: (initial: any) => {
      const slot = hooks.slot++;
      if (!hooks.refs.has(slot)) hooks.refs.set(slot, { current: initial });
      return hooks.refs.get(slot);
    },
    useEffect: (effect: () => void, deps: any[]) => {
      const slot = hooks.slot++;
      const prev = hooks.deps.get(slot);
      if (!prev || deps.some((d, i) => d !== prev[i])) {
        hooks.deps.set(slot, deps);
        effect();
      }
    },
  };
});

const mockPathname = { current: '/' };

import * as React from 'react';
import {
  createScreenTrackingListeners,
  datalyrScreenTracking,
  NavigationContainerRef,
} from '../src/screen-tracking';
import { useExpoRouterTracking } from '../src/expo-router-tracking';
import datalyr from '../src/datalyr-sdk';

type Route = { name: string; params?: Record<string, any> } | undefined;

const navRef = (initial: Route) => {
  let route = initial;
  const ref: NavigationContainerRef & { go: (r: Route) => void } = {
    getCurrentRoute: () => route,
    go: (r: Route) => { route = r; },
  };
  return ref;
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('React Navigation — createScreenTrackingListeners', () => {
  it('tracks the initial screen on onReady, with no previous_screen', () => {
    const track = jest.fn().mockResolvedValue(undefined);
    const ref = navRef({ name: 'Home' });
    createScreenTrackingListeners(ref, track).onReady();
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('Home', { source: 'auto_navigation' });
  });

  it('tracks each route change with the previous screen', () => {
    const track = jest.fn().mockResolvedValue(undefined);
    const ref = navRef({ name: 'Home' });
    const listeners = createScreenTrackingListeners(ref, track);
    listeners.onReady();
    ref.go({ name: 'Product', params: { id: 7 } });
    listeners.onStateChange();
    expect(track).toHaveBeenLastCalledWith('Product', {
      source: 'auto_navigation', previous_screen: 'Home',
    });
  });

  it('does not track a param change on the same screen', () => {
    const track = jest.fn().mockResolvedValue(undefined);
    const ref = navRef({ name: 'Product', params: { id: 1 } });
    const listeners = createScreenTrackingListeners(ref, track);
    listeners.onReady();
    ref.go({ name: 'Product', params: { id: 2 } });
    listeners.onStateChange();
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is no current route', () => {
    const track = jest.fn().mockResolvedValue(undefined);
    const listeners = createScreenTrackingListeners(navRef(undefined), track);
    listeners.onReady();
    listeners.onStateChange();
    expect(track).not.toHaveBeenCalled();
  });

  it('applies transformScreenName to the screen and the previous screen', () => {
    const track = jest.fn().mockResolvedValue(undefined);
    const ref = navRef({ name: 'HomeScreen' });
    const listeners = createScreenTrackingListeners(ref, track, {
      transformScreenName: (name) => name.replace('Screen', ''),
    });
    listeners.onReady();
    ref.go({ name: 'CartScreen' });
    listeners.onStateChange();
    expect(track).toHaveBeenNthCalledWith(1, 'Home', { source: 'auto_navigation' });
    expect(track).toHaveBeenNthCalledWith(2, 'Cart', {
      source: 'auto_navigation', previous_screen: 'Home',
    });
  });

  it('skips screens that shouldTrackScreen rejects', () => {
    const track = jest.fn().mockResolvedValue(undefined);
    const ref = navRef({ name: 'Splash' });
    const listeners = createScreenTrackingListeners(ref, track, {
      shouldTrackScreen: (name) => name !== 'Splash',
    });
    listeners.onReady();
    expect(track).not.toHaveBeenCalled();
    ref.go({ name: 'Home' });
    listeners.onStateChange();
    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0][0]).toBe('Home');
  });

  it('merges extractProperties into the event properties', () => {
    const track = jest.fn().mockResolvedValue(undefined);
    const ref = navRef({ name: 'Product', params: { productId: 'p1' } });
    createScreenTrackingListeners(ref, track, {
      extractProperties: (_name, params) => ({ product_id: params?.productId }),
    }).onReady();
    expect(track).toHaveBeenCalledWith('Product', {
      source: 'auto_navigation', product_id: 'p1',
    });
  });

  it('does not throw when tracking fails', async () => {
    const rejecting = jest.fn().mockRejectedValue(new Error('down'));
    const throwing = jest.fn(() => { throw new Error('sync'); });
    expect(() => createScreenTrackingListeners(navRef({ name: 'A' }), rejecting).onReady()).not.toThrow();
    expect(() => createScreenTrackingListeners(navRef({ name: 'A' }), throwing as any).onReady()).not.toThrow();
    await flush();
    expect(console.warn).toHaveBeenCalled();
  });

  it('datalyrScreenTracking sends through the default SDK instance', () => {
    const screen = jest.spyOn(datalyr, 'screen').mockResolvedValue(undefined);
    datalyrScreenTracking(navRef({ name: 'Home' })).onReady();
    expect(screen).toHaveBeenCalledWith('Home', { source: 'auto_navigation' });
  });
});

describe('Expo Router — useExpoRouterTracking', () => {
  const hooks = (React as any).__hooks;

  beforeEach(() => {
    hooks.refs.clear();
    hooks.deps.clear();
  });

  /** Render the hook once with the given pathname. */
  const render = (
    pathname: string,
    track: (name: string, props?: Record<string, any>) => Promise<void>,
    config?: Parameters<typeof useExpoRouterTracking>[2],
  ) => {
    hooks.slot = 0;
    useExpoRouterTracking(track, () => pathname, config);
  };

  it('tracks the first pathname, then each change with the previous screen', () => {
    const track = jest.fn().mockResolvedValue(undefined);
    render('/home', track);
    render('/settings', track);
    expect(track).toHaveBeenNthCalledWith(1, '/home', { source: 'auto_expo_router' });
    expect(track).toHaveBeenNthCalledWith(2, '/settings', {
      source: 'auto_expo_router', previous_screen: '/home',
    });
  });

  it('does not track a re-render on the same pathname', () => {
    const track = jest.fn().mockResolvedValue(undefined);
    render('/home', track);
    render('/home', track);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('does not track an empty pathname', () => {
    const track = jest.fn().mockResolvedValue(undefined);
    render('', track);
    expect(track).not.toHaveBeenCalled();
  });

  it('uses screenNames first, then transformPathname', () => {
    const track = jest.fn().mockResolvedValue(undefined);
    const config = {
      screenNames: { '/onboarding/paywall': 'Paywall' },
      transformPathname: (p: string) => p.replace(/\(.*?\)\//g, ''),
    };
    render('/onboarding/paywall', track, config);
    render('/(app)/chat', track, config);
    expect(track).toHaveBeenNthCalledWith(1, 'Paywall', { source: 'auto_expo_router' });
    expect(track).toHaveBeenNthCalledWith(2, '/chat', {
      source: 'auto_expo_router', previous_screen: 'Paywall',
    });
  });

  it('skips paths that shouldTrackPath rejects', () => {
    const track = jest.fn().mockResolvedValue(undefined);
    const config = { shouldTrackPath: (p: string) => !p.startsWith('/modal') };
    render('/modal/share', track, config);
    expect(track).not.toHaveBeenCalled();
    render('/home', track, config);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0][0]).toBe('/home');
  });

  it('does not throw when tracking rejects', async () => {
    const track = jest.fn().mockRejectedValue(new Error('down'));
    expect(() => render('/home', track)).not.toThrow();
    await flush();
  });

  it('useDatalyrScreenTracking sends through the Expo SDK instance', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const expo = require('../src/expo');
    const screen = jest.spyOn(expo.default, 'screen').mockResolvedValue(undefined);
    mockPathname.current = '/welcome';
    hooks.slot = 0;
    expo.useDatalyrScreenTracking();
    expect(screen).toHaveBeenCalledWith('/welcome', { source: 'auto_expo_router' });
  });
});
