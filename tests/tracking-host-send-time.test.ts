// iOS fails every request to a domain the privacy manifest lists under
// NSPrivacyTrackingDomains (tracking.datalyr.com) while the app's App Tracking Transparency
// status is not "authorized", checked when the request is SENT. The host used to be chosen
// from the IDFA copied into the event when it was BUILT, so an event queued while tracking
// was allowed and sent after the user turned it off went to a blocked host. The failure is a
// network error: no retry is spent, the drain backs off, and every later event from the
// device waits behind it for as long as tracking stays off.
//
// Now: the tracking host is used only when the event has an IDFA AND the live ATT status,
// read at send time, is authorized (3). Otherwise the event goes to ingest.datalyr.com with
// the IDFA and the other tracking-only fields removed. A tracking-host request that keeps
// failing with a network error falls back to ingest (without the IDFA) so it cannot hold the
// queue. Android has no tracking-domain block and is unchanged.

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
import { EventQueue } from '../src/event-queue';
import { HttpClient } from '../src/http-client';
import { DatalyrSDK } from '../src/datalyr-sdk';
import { DatalyrSDKExpo } from '../src/datalyr-sdk-expo';
import { attributionManager } from '../src/attribution';
import { journeyManager } from '../src/journey';
import { AdvertiserInfoBridge } from '../src/native/DatalyrNativeBridge';
import type { EventPayload } from '../src/types';

const INGEST = 'https://ingest.datalyr.com/track';
const TRACKING = 'https://tracking.datalyr.com/track';
const IDFA = '6D92078A-8246-4BA4-AE5B-76104861E7DC';

type Sent = { url: string; body: any };
let sent: Sent[] = [];
// The live ATT status the provider reports (undefined = unknown / no native module).
let liveStatus: number | undefined = 3;
let providerCalls = 0;
// When true, every request to the tracking host fails the way iOS fails a blocked
// tracking domain: React Native's fetch rejects with TypeError('Network request failed').
let trackingHostFails = false;

const ok = () => ({ ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => ({}) });

const installFetch = () => {
  (globalThis as any).fetch = async (url: string, init: any) => {
    const u = String(url);
    if (u.startsWith(INGEST) || u.startsWith(TRACKING)) {
      sent.push({ url: u, body: JSON.parse(init.body) });
      // iOS blocks the declared tracking domain unless ATT is authorized at send time.
      if (u.startsWith(TRACKING) && (trackingHostFails || liveStatus !== 3)) {
        return Promise.reject(new TypeError('Network request failed'));
      }
    }
    return ok();
  };
};

const makePayload = (name: string, data: Record<string, any> = {}): EventPayload => ({
  workspaceId: 'ws_test',
  visitorId: 'anon_test',
  anonymousId: 'anon_test',
  sessionId: 'sess_test',
  eventId: `evt_${name}`,
  eventName: name,
  eventData: data,
  source: 'mobile_app',
  timestamp: new Date(0).toISOString(),
});

// What the SDK copies onto every event while ATT is authorized.
const authorizedFields = (extra: Record<string, any> = {}) => ({
  idfa: IDFA,
  idfv: 'IDFV-TEST',
  att_status: 3,
  advertiser_tracking_enabled: true,
  ...extra,
});

const newClient = () => {
  const client = new HttpClient(INGEST, { apiKey: 'test_key_not_real', maxRetries: 0, retryDelay: 1, timeout: 50, debug: false, useServerTracking: true });
  (client as any).setTrackingAuthorizationProvider?.(async () => { providerCalls++; return liveStatus; });
  // Tracking was already authorized when this process started (see
  // tracking-host-process-start.test.ts for the other case).
  (client as any).setTrackingStatusAtProcessStartProvider?.(async () => 3);
  return client;
};

const newQueue = async (client: HttpClient) => {
  const q = new EventQueue(client, { maxQueueSize: 100, batchSize: 10, flushInterval: 999999, maxRetryCount: 3 });
  await new Promise((r) => setTimeout(r, 10)); // initializeQueue settles
  return q;
};
const enqueueQuiet = async (q: EventQueue, p: EventPayload) => {
  (q as any).isOnline = false;
  await q.enqueue(p);
  (q as any).isOnline = true;
};
const flushNow = async (q: EventQueue) => {
  (q as any).retryNotBefore = 0;
  await q.flush();
};

/** Neither leak: tracking host only with an IDFA and authorized; never an IDFA on ingest. */
const expectNoLeak = () => {
  for (const s of sent) {
    if (s.url === TRACKING) {
      expect(s.body.properties.idfa).toBe(IDFA);
    } else {
      expect(s.body.properties.idfa).toBeUndefined();
    }
  }
};

beforeEach(async () => {
  await (AsyncStorage as any).clear();
  sent = [];
  liveStatus = 3;
  providerCalls = 0;
  trackingHostFails = false;
  installFetch();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('host chosen from the live ATT status at send time', () => {
  test('authorized + IDFA → tracking host, IDFA kept', async () => {
    const client = newClient();
    const res = await client.sendEvent(makePayload('purchase', authorizedFields({ value: 5 })));
    expect(res.success).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(TRACKING);
    expect(sent[0].body.properties.idfa).toBe(IDFA);
    expect(sent[0].body.properties.att_status).toBe(3);
    expect(sent[0].body.properties.advertiser_tracking_enabled).toBe(true);
  });

  test.each([
    ['denied', 2],
    ['restricted', 1],
    ['not determined', 0],
  ])('%s + stale IDFA → ingest, IDFA and tracking-only fields removed', async (_name, status) => {
    liveStatus = status;
    const client = newClient();
    const res = await client.sendEvent(makePayload('app_install', authorizedFields({ alart: 'applovin_user_1', value: 5 })));
    expect(res.success).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(INGEST);
    const props = sent[0].body.properties;
    expect(props.idfa).toBeUndefined();
    expect(props.alart).toBeUndefined();
    // The event no longer claims tracking is allowed.
    expect(props.att_status).toBe(status);
    expect(props.advertiser_tracking_enabled).toBe(false);
    // Everything else is kept.
    expect(props.idfv).toBe('IDFV-TEST');
    expect(props.value).toBe(5);
  });

  test('status unknown (native read failed) + stale IDFA → ingest, IDFA removed', async () => {
    liveStatus = undefined;
    const client = newClient();
    await client.sendEvent(makePayload('purchase', authorizedFields()));
    expect(sent[0].url).toBe(INGEST);
    expect(sent[0].body.properties.idfa).toBeUndefined();
    expect(sent[0].body.properties.advertiser_tracking_enabled).toBe(false);
  });

  test('the stored event is not changed by the strip (a later authorized send keeps the IDFA)', async () => {
    liveStatus = 2;
    const client = newClient();
    const payload = makePayload('purchase', authorizedFields());
    await client.sendEvent(payload);
    expect(payload.eventData!.idfa).toBe(IDFA);
  });

  test('no IDFA → ingest, and no native status read', async () => {
    const client = newClient();
    await client.sendEvent(makePayload('screen', { screen: 'home', att_status: 2, advertiser_tracking_enabled: false }));
    expect(sent[0].url).toBe(INGEST);
    expect(sent[0].body.properties.att_status).toBe(2);
    expect(providerCalls).toBe(0);
  });
});

describe('queue', () => {
  test('queued while authorized, sent after tracking was turned off → ingest, no IDFA, later events not held', async () => {
    const q = await newQueue(newClient());
    await enqueueQuiet(q, makePayload('purchase', authorizedFields({ value: 9 })));
    liveStatus = 2; // user turns tracking off in Settings
    await enqueueQuiet(q, makePayload('screen', { att_status: 2, advertiser_tracking_enabled: false }));
    await flushNow(q);

    expect(q.getStats().queueSize).toBe(0);
    expect(sent.map((s) => s.url)).toEqual([INGEST, INGEST]);
    expect(sent[0].body.event).toBe('purchase');
    expect(sent[0].body.properties.value).toBe(9);
    expectNoLeak();
  });

  test('mixed batch, not authorized: nothing goes to the tracking host, no IDFA on ingest', async () => {
    const q = await newQueue(newClient());
    await enqueueQuiet(q, makePayload('a', authorizedFields()));
    await enqueueQuiet(q, makePayload('b', { screen: 'home' }));
    await enqueueQuiet(q, makePayload('c', authorizedFields()));
    liveStatus = 1;
    await flushNow(q);

    expect(q.getStats().queueSize).toBe(0);
    expect(sent.map((s) => s.body.event)).toEqual(['a', 'b', 'c']);
    expect(sent.every((s) => s.url === INGEST)).toBe(true);
    expectNoLeak();
  });

  test('mixed batch, authorized: IDFA events to the tracking host, the rest to ingest', async () => {
    const q = await newQueue(newClient());
    await enqueueQuiet(q, makePayload('a', authorizedFields()));
    await enqueueQuiet(q, makePayload('b', { screen: 'home' }));
    await enqueueQuiet(q, makePayload('c', authorizedFields()));
    await flushNow(q);

    expect(q.getStats().queueSize).toBe(0);
    expect(sent.map((s) => [s.body.event, s.url])).toEqual([['a', TRACKING], ['b', INGEST], ['c', TRACKING]]);
    expectNoLeak();
  });

  test('a tracking-host request that keeps failing does not hold later events', async () => {
    // Authorized, but the tracking host fails every time (a block we cannot see, DNS, a
    // zone rule). The ingest host works.
    trackingHostFails = true;
    const q = await newQueue(newClient());
    await enqueueQuiet(q, makePayload('purchase', authorizedFields({ value: 3 })));
    await enqueueQuiet(q, makePayload('later_1', { screen: 'a' }));
    await enqueueQuiet(q, makePayload('later_2', { screen: 'b' }));

    for (let i = 0; i < 4 && q.getStats().queueSize > 0; i++) await flushNow(q);

    expect(q.getStats().queueSize).toBe(0);
    const delivered = sent.filter((s) => s.url === INGEST).map((s) => s.body.event);
    expect(delivered).toEqual(['purchase', 'later_1', 'later_2']);
    // Delivered without the IDFA, same eventId (ingest de-duplicates a lost answer).
    const purchase = sent.find((s) => s.url === INGEST && s.body.event === 'purchase')!;
    expect(purchase.body.properties.idfa).toBeUndefined();
    expect(purchase.body.properties.value).toBe(3);
    expect(purchase.body.eventId).toBe('evt_purchase');
    expectNoLeak();
  });

  test('a real outage (both hosts down) keeps the event with its IDFA; delivered to the tracking host once back', async () => {
    const q = await newQueue(newClient());
    await enqueueQuiet(q, makePayload('purchase', authorizedFields()));
    (globalThis as any).fetch = async (url: string, init: any) => {
      sent.push({ url: String(url), body: JSON.parse(init.body) });
      return Promise.reject(new TypeError('Network request failed'));
    };
    for (let i = 0; i < 4; i++) await flushNow(q);
    expect(q.getStats().queueSize).toBe(1);
    expect((q as any).queue[0].payload.eventData.idfa).toBe(IDFA);

    sent = [];
    installFetch();
    await flushNow(q);
    expect(q.getStats().queueSize).toBe(0);
    expect(sent.map((s) => s.url)).toEqual([TRACKING]);
    expect(sent[0].body.properties.idfa).toBe(IDFA);
  });
});

// SDK wiring: the live status comes from the native module at send time on iOS; Android
// keeps its delivery exactly as before.
const sdkVariants: Array<[string, () => any]> = [
  ['bare React Native', () => new DatalyrSDK()],
  ['Expo', () => new DatalyrSDKExpo()],
];

describe.each(sdkVariants)('%s SDK', (_variant, createSDK) => {
  let native: any;
  const resetManagers = async () => {
    const { networkStatusManager } = require('../src/network-status');
    networkStatusManager.destroy();
    await attributionManager.clearAttributionData();
    (attributionManager as any).initialized = false;
    (attributionManager as any).isFirstLaunch = false;
    await journeyManager.clearJourney();
  };

  beforeEach(async () => {
    await resetManagers();
    (AppState as any).addEventListener = () => ({ remove: () => {} });
    jest.spyOn(AdvertiserInfoBridge, 'getAdvertiserInfo').mockImplementation(async () => native);
  });

  const init = async (sdk: any) => {
    await sdk.initialize({ apiKey: 'dk_test', flushInterval: 999999, enableAutoEvents: false, enableWebToAppAttribution: false });
  };

  test('iOS: event built while authorized, tracking turned off before the send → ingest without the IDFA', async () => {
    native = { idfa: IDFA, idfv: 'IDFV-TEST', att_status: 3, advertiser_tracking_enabled: true };
    const sdk = createSDK();
    try {
      await init(sdk);
      const q = (sdk as any).eventQueue;
      q.isOnline = false;
      await sdk.track('purchase', { value: 1 });
      // Settings → tracking off. The app's cached advertiser info still says authorized.
      native = { idfv: 'IDFV-TEST', att_status: 2, advertiser_tracking_enabled: false };
      liveStatus = 2;
      sent = [];
      q.isOnline = true;
      q.retryNotBefore = 0;
      await q.flush();

      const purchase = sent.filter((s) => s.body.event === 'purchase');
      expect(purchase).toHaveLength(1);
      expect(purchase[0].url).toBe(INGEST);
      expect(purchase[0].body.properties.idfa).toBeUndefined();
      expect(purchase[0].body.properties.att_status).toBe(2);
      expect(q.getStats().queueSize).toBe(0);
    } finally {
      sdk.destroy();
    }
  });

  test('Android: unchanged (GAID kept, ingest host, no extra native reads per send)', async () => {
    const original = Platform.OS;
    (Platform as any).OS = 'android';
    native = { gaid: 'GAID-TEST', att_status: 3, advertiser_tracking_enabled: true };
    const sdk = createSDK();
    try {
      await init(sdk);
      const reads = (AdvertiserInfoBridge.getAdvertiserInfo as jest.Mock).mock.calls.length;
      sent = [];
      await sdk.track('purchase', { value: 1 });
      await (sdk as any).eventQueue.flush();
      const purchase = sent.filter((s) => s.body.event === 'purchase');
      expect(purchase).toHaveLength(1);
      expect(purchase[0].url).toBe(INGEST);
      expect(purchase[0].body.properties.gaid).toBe('GAID-TEST');
      expect(purchase[0].body.properties.att_status).toBe(3);
      expect(purchase[0].body.properties.advertiser_tracking_enabled).toBe(true);
      expect((AdvertiserInfoBridge.getAdvertiserInfo as jest.Mock).mock.calls.length).toBe(reads);
    } finally {
      sdk.destroy();
      (Platform as any).OS = original;
    }
  });
});
