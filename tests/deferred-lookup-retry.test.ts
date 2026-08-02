// The deferred IP lookup is the ONLY web→app bridge for web-ad → app-install campaigns:
// a click on a Meta/TikTok WEB ad is recorded against the visitor's IP by dl.js, and the
// install is matched back to it by this one request. Gating it on first launch forfeited
// that bridge for any install whose first cold start had no network — the ordinary state
// right after a store install — because the first-launch flag records that a launch was
// OBSERVED, not that the lookup was ANSWERED.

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
  nativeBuildVersion: '1',
  applicationId: 'com.datalyr.test',
  getInstallationTimeAsync: async () => new Date(0),
}), { virtual: true });

jest.mock('expo-device', () => ({
  modelName: 'Test Device',
  deviceName: 'Test Device',
  manufacturer: 'Test',
  osVersion: '17.0',
  isDevice: true,
}), { virtual: true });

jest.mock('expo-network', () => ({
  NetworkStateType: { WIFI: 'WIFI' },
  getNetworkStateAsync: async () => ({ type: 'WIFI', isConnected: true }),
}), { virtual: true });

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DatalyrSDK } from '../src/datalyr-sdk';
import { DatalyrSDKExpo } from '../src/datalyr-sdk-expo';
import { attributionManager } from '../src/attribution';
import { journeyManager } from '../src/journey';
import { STORAGE_KEYS } from '../src/utils';

const DEFERRED_URL = 'https://api.datalyr.com/attribution/deferred-lookup';

const variants: Array<[string, () => any]> = [
  ['bare React Native', () => new DatalyrSDK()],
  ['Expo', () => new DatalyrSDKExpo()],
];

/** Count of deferred-lookup requests issued, plus a programmable responder. */
let deferredCalls = 0;
let respond: () => Promise<any> = async () => ({ ok: true, status: 200, json: async () => ({ found: false }) });

const installFetchMock = () => {
  (globalThis as any).fetch = async (url: string, _init?: any) => {
    if (typeof url === 'string' && url.startsWith(DEFERRED_URL)) {
      deferredCalls += 1;
      return respond();
    }
    // Event ingest and everything else: succeed quietly.
    return { ok: true, status: 200, json: async () => ({}) };
  };
};

const initSDK = async (sdk: any) => {
  await sdk.initialize({
    apiKey: 'dk_test',
    flushInterval: 999999,
    enableAutoEvents: false,
    enableWebToAppAttribution: false, // isolate the IP path from the identify(email) path
  });
};

/** Simulate a relaunch: the singletons are per-process, storage persists. */
const relaunch = () => {
  (attributionManager as any).initialized = false;
  (attributionManager as any).isFirstLaunch = false;
  (attributionManager as any).installTimeMs = null;
  const { networkStatusManager } = require('../src/network-status');
  networkStatusManager.destroy();
};

beforeEach(async () => {
  await (AsyncStorage as any).clear();
  const { networkStatusManager } = require('../src/network-status');
  networkStatusManager.destroy();
  await attributionManager.clearAttributionData();
  (attributionManager as any).initialized = false;
  (attributionManager as any).isFirstLaunch = false;
  await journeyManager.clearJourney();
  deferredCalls = 0;
  respond = async () => ({ ok: true, status: 200, json: async () => ({ found: false }) });
  installFetchMock();
});

for (const [variant, createSDK] of variants) {
  describe(`${variant} — deferred web→app lookup retries until answered`, () => {
    it('retries on a later launch when the first attempt never reached the server', async () => {
      respond = async () => { throw new Error('Network request failed'); };

      const first = createSDK();
      try { await initSDK(first); } finally { first.destroy(); }
      expect(deferredCalls).toBe(1);

      // Launch 2 is no longer a first launch, but nothing was ever answered.
      relaunch();
      const second = createSDK();
      try { await initSDK(second); } finally { second.destroy(); }

      expect(deferredCalls).toBe(2);
    });

    it('treats a parsed 200 reporting no match as terminal', async () => {
      const first = createSDK();
      try { await initSDK(first); } finally { first.destroy(); }
      expect(deferredCalls).toBe(1);
      expect(await AsyncStorage.getItem(STORAGE_KEYS.DEFERRED_LOOKUP_RESOLVED)).toBe('true');

      relaunch();
      const second = createSDK();
      try { await initSDK(second); } finally { second.destroy(); }

      expect(deferredCalls).toBe(1);
    });

    it('keeps a 5xx eligible and makes a 4xx terminal', async () => {
      respond = async () => ({ ok: false, status: 503, json: async () => ({}) });
      const first = createSDK();
      try { await initSDK(first); } finally { first.destroy(); }
      expect(await AsyncStorage.getItem(STORAGE_KEYS.DEFERRED_LOOKUP_RESOLVED)).toBeNull();

      respond = async () => ({ ok: false, status: 401, json: async () => ({}) });
      relaunch();
      const second = createSDK();
      try { await initSDK(second); } finally { second.destroy(); }
      expect(deferredCalls).toBe(2);
      expect(await AsyncStorage.getItem(STORAGE_KEYS.DEFERRED_LOOKUP_RESOLVED)).toBe('true');

      relaunch();
      const third = createSDK();
      try { await initSDK(third); } finally { third.destroy(); }
      expect(deferredCalls).toBe(2);
    });

    it('does not burn the install on a 200 whose body will not parse', async () => {
      respond = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });

      const first = createSDK();
      try { await initSDK(first); } finally { first.destroy(); }
      expect(await AsyncStorage.getItem(STORAGE_KEYS.DEFERRED_LOOKUP_RESOLVED)).toBeNull();

      relaunch();
      const second = createSDK();
      try { await initSDK(second); } finally { second.destroy(); }
      expect(deferredCalls).toBe(2);
    });
  });
}

describe('deferred web→app lookup bounds', () => {
  it('stops at the attempt cap when every attempt fails', async () => {
    respond = async () => { throw new Error('Network request failed'); };

    // Only the attempt counter can stop this loop — nothing is ever answered.
    let launches = 0;
    while (await attributionManager.shouldAttemptDeferredLookup() || launches === 0) {
      const sdk = new DatalyrSDK();
      try { await initSDK(sdk); } finally { sdk.destroy(); }
      launches += 1;
      relaunch();
      await attributionManager.detectInstall();
      if (launches > 10) break;
    }

    expect(deferredCalls).toBe(3);
    expect(await attributionManager.shouldAttemptDeferredLookup()).toBe(false);
  });

  it('spends the attempt before the request is issued, so a killed request still costs budget', async () => {
    // The request never settles — the app is killed mid-flight. The counter must already
    // be persisted, otherwise an install could re-issue forever.
    respond = () => new Promise(() => {});

    const sdk = new DatalyrSDK();
    const init = initSDK(sdk);
    // Let initialize() reach the fetch and park there.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await AsyncStorage.getItem(STORAGE_KEYS.DEFERRED_LOOKUP_ATTEMPTS)).toBe('1');

    sdk.destroy();
    void init.catch(() => {});
  });

  it('is not eligible once the server match window has elapsed', async () => {
    // Past the backend's IP match window (DEFERRED_IP_MATCH_WINDOW_MINUTES, 60 by default)
    // no web touch can match this device, so elapsed time is a hard stop that never
    // shrinks back.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await AsyncStorage.setItem('@datalyr/first_launch_time', JSON.stringify(twoHoursAgo));
    await AsyncStorage.setItem('@datalyr/visitor_id', 'visitor_from_earlier_launch');

    await attributionManager.detectInstall();

    expect(await attributionManager.shouldAttemptDeferredLookup()).toBe(false);

    const sdk = new DatalyrSDK();
    try { await initSDK(sdk); } finally { sdk.destroy(); }
    expect(deferredCalls).toBe(0);
  });

  it('does not re-open on reset(): the IP match is a per-install device fact', async () => {
    // Clearing it on logout would re-import one user's web touch into the next user's
    // identity — the same cross-user bleed reset() exists to prevent.
    const sdk = new DatalyrSDK();
    try {
      await initSDK(sdk);
      expect(deferredCalls).toBe(1);

      await sdk.reset();

      expect(await AsyncStorage.getItem(STORAGE_KEYS.DEFERRED_LOOKUP_RESOLVED)).toBe('true');
      expect(await attributionManager.shouldAttemptDeferredLookup()).toBe(false);
    } finally {
      sdk.destroy();
    }
  });
});
