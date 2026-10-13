// ATT and the deferred web→app lookup (1.7.23).
//
// The server matches iOS installs only with ATT authorized when the workspace asks for
// that, and answers `{found:false, reason:'att_not_authorized'}` otherwise. The SDK sends
// the live native ATT status, treats that answer as "not yet" rather than "no", and
// re-runs the lookup once ATT is granted.

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
import { AppState, Platform } from 'react-native';
import { DatalyrSDK } from '../src/datalyr-sdk';
import { DatalyrSDKExpo } from '../src/datalyr-sdk-expo';
import { attributionManager } from '../src/attribution';
import { journeyManager } from '../src/journey';
import { AdvertiserInfoBridge } from '../src/native/DatalyrNativeBridge';
import { HttpClient } from '../src/http-client';
import { STORAGE_KEYS, getOrCreateDeviceId, clearDeviceInfoCache, getDeviceInfo } from '../src/utils';

const DEFERRED_URL = 'https://api.datalyr.com/attribution/deferred-lookup';

const variants: Array<[string, () => any]> = [
  ['bare React Native', () => new DatalyrSDK()],
  ['Expo', () => new DatalyrSDKExpo()],
];

let deferredBodies: any[] = [];
let respond: (body: any) => Promise<any>;
let trackedEvents: Array<{ name: string; data: any }> = [];
// The native ATT status getAdvertiserInfo() reports; null = native module unavailable.
let nativeAttStatus: number | null = 0;
let appStateHandler: ((state: string) => Promise<void> | void) | null = null;

const ok = (json: any) => ({ ok: true, status: 200, json: async () => json });

const installFetchMock = () => {
  (globalThis as any).fetch = async (url: string, init?: any) => {
    if (typeof url === 'string' && url.startsWith(DEFERRED_URL)) {
      const body = JSON.parse(init?.body ?? '{}');
      deferredBodies.push(body);
      return respond(body);
    }
    return ok({});
  };
};

const initSDK = async (sdk: any) => {
  const realTrack = sdk.track.bind(sdk);
  sdk.track = async (name: string, data?: any) => {
    trackedEvents.push({ name, data });
    return realTrack(name, data);
  };
  await sdk.initialize({
    apiKey: 'dk_test',
    flushInterval: 999999,
    enableAutoEvents: false,
    enableWebToAppAttribution: false,
  });
  // App-state monitoring is set up on a timer after init; wire it now.
  sdk.setupAppStateMonitoring();
};

const relaunch = () => {
  (attributionManager as any).initialized = false;
  (attributionManager as any).isFirstLaunch = false;
  (attributionManager as any).installTimeMs = null;
  const { networkStatusManager } = require('../src/network-status');
  networkStatusManager.destroy();
};

/** Wait for fire-and-forget work (re-run after a grant) to settle. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
};

const attMatchEvents = (reason: string) =>
  trackedEvents.filter((e) => e.name === '$attribution_match' && e.data?.reason === reason);

/** Server in strict mode: only att_status 3 gets evaluated. */
const strictServer = (onAuthorized: any = { found: false, reason: 'no_web_traffic' }) =>
  async (body: any) => ok(body.att_status === 3 ? onAuthorized : { found: false, reason: 'att_not_authorized' });

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
  nativeAttStatus = 0;
  respond = async () => ok({ found: false });
  installFetchMock();
  jest.spyOn(AdvertiserInfoBridge, 'getAdvertiserInfo').mockImplementation(async () =>
    nativeAttStatus === null ? null : { att_status: nativeAttStatus, advertiser_tracking_enabled: nativeAttStatus === 3 } as any);
  appStateHandler = null;
  (AppState as any).addEventListener = (_: string, cb: any) => {
    appStateHandler = cb;
    return { remove: () => {} };
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

for (const [variant, createSDK] of variants) {
  describe(`${variant} — att_status in the deferred lookup`, () => {
    it('sends the live native ATT status, read right before the request', async () => {
      const sdk = createSDK();
      // Launch-time cache says 0; the native module says 3 by the time the lookup runs.
      const getInfo = AdvertiserInfoBridge.getAdvertiserInfo as jest.Mock;
      let calls = 0;
      getInfo.mockImplementation(async () => ({ att_status: calls++ === 0 ? 0 : 3 } as any));
      try { await initSDK(sdk); } finally { sdk.destroy(); }

      expect(deferredBodies).toHaveLength(1);
      expect(deferredBodies[0].att_status).toBe(3);
    });

    it('sends every status value as a number (0-3)', async () => {
      for (const status of [0, 1, 2, 3]) {
        await (AsyncStorage as any).clear();
        relaunch();
        deferredBodies = [];
        nativeAttStatus = status;
        const sdk = createSDK();
        try { await initSDK(sdk); } finally { sdk.destroy(); }
        expect(deferredBodies[0].att_status).toBe(status);
      }
    });

    it('omits att_status when the native module is unavailable', async () => {
      nativeAttStatus = null;
      const sdk = createSDK();
      try { await initSDK(sdk); } finally { sdk.destroy(); }
      expect(deferredBodies).toHaveLength(1);
      expect('att_status' in deferredBodies[0]).toBe(false);
    });
  });

  describe(`${variant} — att_not_authorized is not final`, () => {
    it('does not resolve, does not spend an attempt, and reports the miss once per launch', async () => {
      respond = strictServer();
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        expect(deferredBodies).toHaveLength(1);
        expect(await AsyncStorage.getItem(STORAGE_KEYS.DEFERRED_LOOKUP_RESOLVED)).toBeNull();
        expect(await AsyncStorage.getItem(STORAGE_KEYS.DEFERRED_LOOKUP_ATTEMPTS)).toBe('0');
        expect(attMatchEvents('att_not_authorized')).toHaveLength(1);

        // A second declined run in the same launch (e.g. a foreground with no grant
        // path, forced here) does not report again.
        await sdk.runDeferredLookupIfEligible();
        expect(deferredBodies).toHaveLength(2);
        expect(attMatchEvents('att_not_authorized')).toHaveLength(1);
      } finally { sdk.destroy(); }

      // Still eligible on the next launch, and reported again there (once).
      relaunch();
      trackedEvents = [];
      const next = createSDK();
      try { await initSDK(next); } finally { next.destroy(); }
      expect(deferredBodies).toHaveLength(3);
      expect(attMatchEvents('att_not_authorized')).toHaveLength(1);
      expect(await attributionManager.shouldAttemptDeferredLookup()).toBe(true);
    });

    it('declines never use up the attempt cap', async () => {
      respond = strictServer();
      for (let i = 0; i < 5; i++) {
        relaunch();
        const sdk = createSDK();
        try { await initSDK(sdk); } finally { sdk.destroy(); }
      }
      expect(deferredBodies).toHaveLength(5);
      expect(await attributionManager.shouldAttemptDeferredLookup()).toBe(true);
    });
  });

  describe(`${variant} — re-run after ATT is granted`, () => {
    it('updateTrackingAuthorization(true) re-runs a declined lookup with att_status 3', async () => {
      respond = strictServer({ found: false, reason: 'no_web_traffic' });
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        expect(deferredBodies).toHaveLength(1);
        expect(deferredBodies[0].att_status).toBe(0);

        nativeAttStatus = 3;
        await sdk.updateTrackingAuthorization(true);
        await settle();

        expect(deferredBodies).toHaveLength(2);
        expect(deferredBodies[1].att_status).toBe(3);
        // That answer was definitive.
        expect(await AsyncStorage.getItem(STORAGE_KEYS.DEFERRED_LOOKUP_RESOLVED)).toBe('true');
        expect(attMatchEvents('no_web_traffic')).toHaveLength(1);
      } finally { sdk.destroy(); }
    });

    it('a foreground after a grant in Settings re-runs the lookup', async () => {
      respond = strictServer();
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        expect(deferredBodies).toHaveLength(1);

        // Foreground without a change: nothing.
        await appStateHandler!('active');
        await settle();
        expect(deferredBodies).toHaveLength(1);

        nativeAttStatus = 3;
        await appStateHandler!('active');
        await settle();
        expect(deferredBodies).toHaveLength(2);
        expect(deferredBodies[1].att_status).toBe(3);
      } finally { sdk.destroy(); }
    });

    it('a grant reported twice (foreground then updateTrackingAuthorization) runs one lookup', async () => {
      respond = strictServer();
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        nativeAttStatus = 3;
        await appStateHandler!('active');
        await sdk.updateTrackingAuthorization(true);
        await settle();
        expect(deferredBodies).toHaveLength(2);
      } finally { sdk.destroy(); }
    });

    it('never runs two lookups at once', async () => {
      respond = strictServer();
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        // The re-run hangs in flight; further grants/foregrounds join it.
        let release: () => void = () => {};
        respond = () => new Promise((resolve) => { release = () => resolve(ok({ found: false, reason: 'no_web_traffic' })); });
        nativeAttStatus = 3;
        await sdk.updateTrackingAuthorization(true);
        await settle();
        expect(deferredBodies).toHaveLength(2);

        void sdk.runDeferredLookupIfEligible();
        await appStateHandler!('active');
        await settle();
        expect(deferredBodies).toHaveLength(2);

        release();
        await settle();
        expect(deferredBodies).toHaveLength(2);
      } finally { sdk.destroy(); }
    });

    it('a grant does not re-run a lookup that was already answered', async () => {
      // Non-strict workspace: the launch lookup (status 0) gets a definitive answer.
      respond = async () => ok({ found: false, reason: 'no_web_traffic' });
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        expect(await AsyncStorage.getItem(STORAGE_KEYS.DEFERRED_LOOKUP_RESOLVED)).toBe('true');
        nativeAttStatus = 3;
        await sdk.updateTrackingAuthorization(true);
        await settle();
        expect(deferredBodies).toHaveLength(1);
      } finally { sdk.destroy(); }
    });

    it('a grant does not re-run outside the 7-day window', async () => {
      respond = strictServer();
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        expect(deferredBodies).toHaveLength(1);
        (attributionManager as any).installTimeMs = Date.now() - 8 * 24 * 3600 * 1000;
        nativeAttStatus = 3;
        await sdk.updateTrackingAuthorization(true);
        await settle();
        expect(deferredBodies).toHaveLength(1);
      } finally { sdk.destroy(); }
    });

    it('a denial does not re-run the lookup', async () => {
      respond = strictServer();
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        nativeAttStatus = 2;
        await sdk.updateTrackingAuthorization(false);
        await settle();
        expect(deferredBodies).toHaveLength(1);
      } finally { sdk.destroy(); }
    });
  });

  describe(`${variant} — $att_status reports the real native status`, () => {
    it.each([
      [0, 'notDetermined'],
      [1, 'restricted'],
      [2, 'denied'],
      [3, 'authorized'],
    ])('native %i → %s', async (status, name) => {
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        nativeAttStatus = status;
        await sdk.updateTrackingAuthorization(status === 3);
        const event = trackedEvents.find((e) => e.name === '$att_status');
        expect(event?.data).toEqual({
          authorized: status === 3,
          status,
          status_name: name,
          att_status: status,
        });
      } finally { sdk.destroy(); }
    });

    it('falls back to the argument when the native module is unavailable', async () => {
      nativeAttStatus = null;
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        await sdk.updateTrackingAuthorization(false);
        const event = trackedEvents.find((e) => e.name === '$att_status');
        expect(event?.data.att_status).toBe(2);
        expect(event?.data.status_name).toBe('denied');
      } finally { sdk.destroy(); }
    });
  });
}

describe('Android', () => {
  it('runs no deferred lookup and refreshes nothing on foreground for ATT', async () => {
    const original = Platform.OS;
    (Platform as any).OS = 'android';
    try {
      const sdk = new DatalyrSDK();
      try {
        await initSDK(sdk);
        nativeAttStatus = 3;
        await sdk.updateTrackingAuthorization(true);
        await settle();
      } finally { sdk.destroy(); }
      expect(deferredBodies).toHaveLength(0);
    } finally {
      (Platform as any).OS = original;
    }
  });
});

describe('device context on the wire', () => {
  it('is sent as properties.device_context, not properties.fingerprint', () => {
    const client = new HttpClient('https://ingest.datalyr.com/track',
      { apiKey: 'dk_test', useServerTracking: true } as any);
    const wire = (client as any).transformForServerAPI({
      workspaceId: 'ws_1', visitorId: 'vis_1', anonymousId: 'anon_1', sessionId: 'sess_1',
      eventId: 'e1', eventName: 'test', source: 'mobile_app', timestamp: '2026-10-13T00:00:00.000Z',
      deviceContext: { deviceId: 'dev_1', deviceInfo: { model: 'iPhone15', manufacturer: 'Apple', osVersion: '17.0', screenSize: '390x844', timezone: 'UTC' } },
    });
    expect(wire.properties.device_context.deviceId).toBe('dev_1');
    expect(wire.properties.device_context.deviceInfo.model).toBe('iPhone15');
    expect('fingerprint' in wire.properties).toBe(false);
  });
});

describe('device id', () => {
  beforeEach(() => clearDeviceInfoCache());

  it('is a stored random UUID, not react-native-device-info getUniqueId()', async () => {
    const DeviceInfo = require('react-native-device-info');
    const getUniqueId = jest.fn(async () => 'IDFV-FROM-KEYCHAIN');
    DeviceInfo.getUniqueId = getUniqueId;
    try {
      const info = await getDeviceInfo();
      expect(info.deviceId).not.toBe('IDFV-FROM-KEYCHAIN');
      expect(info.deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(getUniqueId).not.toHaveBeenCalled();
      expect(await AsyncStorage.getItem('@datalyr/fallback_device_id')).toBe(info.deviceId);
    } finally {
      delete DeviceInfo.getUniqueId;
    }
  });

  it('is stable across launches and keeps an id an install already stored', async () => {
    await AsyncStorage.setItem('@datalyr/fallback_device_id', 'existing-install-id');
    expect(await getOrCreateDeviceId()).toBe('existing-install-id');
    expect(await getOrCreateDeviceId()).toBe('existing-install-id');
  });

  it('is new after a reinstall (storage cleared)', async () => {
    const first = await getOrCreateDeviceId();
    await (AsyncStorage as any).clear();
    const second = await getOrCreateDeviceId();
    expect(second).not.toBe(first);
  });
});
