// FX-052 (SDK part) and INST-01 (SDK slice): the deferred install lookup
// (POST /attribution/deferred-lookup) sends the install's anonymous_id, so the api can
// record a click claim as owned by this device (DEFERRED_IP_CLAIM_CHECK); and every
// failed lookup reports WHY on its `$attribution_match` / `request_failed` event —
// error_class (timeout, network, http_4xx, http_5xx, decode) and elapsed_ms — without
// any URL or identifier in the failure fields.

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
  nativeBuildVersion: '1',
  applicationId: 'com.example.test',
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
import { sendDeferredLookup, DEFERRED_LOOKUP_TIMEOUT_MS } from '../src/deferred-lookup-request';

const DEFERRED_URL = 'https://api.datalyr.com/attribution/deferred-lookup';

const variants: Array<[string, () => any]> = [
  ['bare React Native', () => new DatalyrSDK()],
  ['Expo', () => new DatalyrSDKExpo()],
];

let deferredBodies: any[] = [];
let respond: (init: any) => Promise<any>;
let trackedEvents: Array<{ name: string; data: any }> = [];

const installFetchMock = () => {
  (globalThis as any).fetch = async (url: string, init?: any) => {
    if (typeof url === 'string' && url.startsWith(DEFERRED_URL)) {
      deferredBodies.push(JSON.parse(init?.body ?? '{}'));
      return respond(init);
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
};

const initSDK = async (sdk: any) => {
  const realTrack = sdk.track.bind(sdk);
  sdk.track = async (name: string, data?: any) => {
    trackedEvents.push({ name, data });
    return realTrack(name, data);
  };
  await sdk.initialize({
    apiKey: 'test_key_not_real',
    flushInterval: 999999,
    enableAutoEvents: false,
    enableWebToAppAttribution: false,
  });
};

const failureEvents = () =>
  trackedEvents.filter((e) => e.name === '$attribution_match' && e.data?.reason === 'request_failed');

/** The failure event carries the class and the time, and nothing that names a URL. */
const expectFailure = (cls: string) => {
  const events = failureEvents();
  expect(events).toHaveLength(1);
  const data = events[0].data;
  expect(data.matched).toBe(false);
  expect(data.error_class).toBe(cls);
  expect(typeof data.elapsed_ms).toBe('number');
  expect(data.elapsed_ms).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(data)).not.toMatch(/https?:|datalyr\.com|deferred-lookup/);
  return data;
};

beforeEach(async () => {
  await (AsyncStorage as any).clear();
  const { networkStatusManager } = require('../src/network-status');
  networkStatusManager.destroy();
  await attributionManager.clearAttributionData();
  (attributionManager as any).initialized = false;
  (attributionManager as any).isFirstLaunch = false;
  await journeyManager.clearJourney();
  deferredBodies = [];
  trackedEvents = [];
  respond = async () => ({ ok: true, status: 200, json: async () => ({ found: false }) });
  installFetchMock();
});

afterEach(() => {
  jest.restoreAllMocks();
});

for (const [variant, createSDK] of variants) {
  describe(`${variant} — install lookup sends anonymous_id and reports why it failed`, () => {
    it('sends the install\'s anonymous_id on the deferred lookup', async () => {
      const sdk = createSDK();
      try { await initSDK(sdk); } finally { sdk.destroy(); }
      expect(deferredBodies).toHaveLength(1);
      const anonymousId = (sdk as any).state.anonymousId;
      expect(typeof anonymousId).toBe('string');
      expect(anonymousId.length).toBeGreaterThan(0);
      expect(anonymousId.length).toBeLessThanOrEqual(128); // the api ignores longer ids
      expect(deferredBodies[0].anonymous_id).toBe(anonymousId);
    });

    it('network error: error_class network, lookup stays eligible', async () => {
      respond = async () => { throw new TypeError('Network request failed'); };
      const sdk = createSDK();
      try { await initSDK(sdk); } finally { sdk.destroy(); }
      const data = expectFailure('network');
      expect(data.http_status).toBeUndefined();
      expect(await AsyncStorage.getItem(STORAGE_KEYS.DEFERRED_LOOKUP_RESOLVED)).toBeNull();
    });

    it('timeout: no answer within the bound is error_class timeout', async () => {
      // Shrink only the lookup's 10 s timer so the test does not wait 10 s.
      const realSetTimeout = global.setTimeout;
      jest.spyOn(global, 'setTimeout').mockImplementation(((fn: any, ms?: number, ...args: any[]) =>
        realSetTimeout(fn, ms === DEFERRED_LOOKUP_TIMEOUT_MS ? 20 : ms, ...args)) as any);
      // A server that never answers; the request ends only when the SDK aborts it.
      respond = (init: any) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const e = new Error('Aborted'); (e as any).name = 'AbortError'; reject(e);
        });
      });
      const sdk = createSDK();
      try { await initSDK(sdk); } finally { sdk.destroy(); }
      const data = expectFailure('timeout');
      expect(data.elapsed_ms).toBeGreaterThanOrEqual(15);
      expect(await AsyncStorage.getItem(STORAGE_KEYS.DEFERRED_LOOKUP_RESOLVED)).toBeNull();
    });

    it('5xx: error_class http_5xx with the status, lookup stays eligible', async () => {
      respond = async () => ({ ok: false, status: 503, json: async () => ({}) });
      const sdk = createSDK();
      try { await initSDK(sdk); } finally { sdk.destroy(); }
      const data = expectFailure('http_5xx');
      expect(data.http_status).toBe(503);
      expect(await AsyncStorage.getItem(STORAGE_KEYS.DEFERRED_LOOKUP_RESOLVED)).toBeNull();
    });

    it('4xx: error_class http_4xx with the status, lookup resolved as before', async () => {
      respond = async () => ({ ok: false, status: 410, json: async () => ({}) });
      const sdk = createSDK();
      try { await initSDK(sdk); } finally { sdk.destroy(); }
      const data = expectFailure('http_4xx');
      expect(data.http_status).toBe(410);
      expect(await AsyncStorage.getItem(STORAGE_KEYS.DEFERRED_LOOKUP_RESOLVED)).toBe('true');
    });

    it('2xx with a body that will not parse: error_class decode', async () => {
      respond = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
      const sdk = createSDK();
      try { await initSDK(sdk); } finally { sdk.destroy(); }
      const data = expectFailure('decode');
      expect(data.http_status).toBeUndefined();
      expect(await AsyncStorage.getItem(STORAGE_KEYS.DEFERRED_LOOKUP_RESOLVED)).toBeNull();
    });

    it('failed lookups stop after 3 attempts per install, across launches, each one reported', async () => {
      respond = async () => { throw new TypeError('Network request failed'); };
      for (let launch = 0; launch < 5; launch++) {
        if (launch > 0) {
          (attributionManager as any).initialized = false;
          (attributionManager as any).isFirstLaunch = false;
          (attributionManager as any).installTimeMs = null;
          require('../src/network-status').networkStatusManager.destroy();
        }
        const sdk = createSDK();
        try { await initSDK(sdk); } finally { sdk.destroy(); }
      }
      expect(deferredBodies).toHaveLength(3);
      expect(failureEvents()).toHaveLength(3);
      expect(failureEvents().every((e) => e.data.error_class === 'network')).toBe(true);
    });

    it('an answer is not reported as a failure', async () => {
      const sdk = createSDK();
      try { await initSDK(sdk); } finally { sdk.destroy(); }
      expect(failureEvents()).toHaveLength(0);
    });
  });
}

describe('sendDeferredLookup timing (slow success is not a failure)', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('the timeout today is 10 s to the response headers', () => {
    expect(DEFERRED_LOOKUP_TIMEOUT_MS).toBe(10000);
  });

  it('headers just inside the bound are a success, even when the body arrives after it', async () => {
    (globalThis as any).fetch = async () => {
      await sleep(40);
      return { ok: true, status: 200, json: async () => { await sleep(120); return { found: false }; } };
    };
    const out = await sendDeferredLookup('https://example.invalid/x', { method: 'POST' }, 100);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Body read finishes at ~160 ms, past the 100 ms bound: still an answer.
    await expect(out.response.json()).resolves.toEqual({ found: false });
  });

  it('headers past the bound are a timeout, not a network error', async () => {
    (globalThis as any).fetch = (_url: string, init: any) => new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ ok: true, status: 200 }), 300);
      init.signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Aborted')); });
    });
    const out = await sendDeferredLookup('https://example.invalid/x', { method: 'POST' }, 30);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.failure.error_class).toBe('timeout');
    expect(out.failure.elapsed_ms).toBeGreaterThanOrEqual(25);
  });

  it('an immediate rejection is a network error', async () => {
    (globalThis as any).fetch = async () => { throw new TypeError('Network request failed'); };
    const out = await sendDeferredLookup('https://example.invalid/x', { method: 'POST' }, 1000);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.failure.error_class).toBe('network');
  });
});
