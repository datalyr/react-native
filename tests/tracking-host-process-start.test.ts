// iOS lifts its block on the privacy manifest's tracking domain (tracking.datalyr.com) only
// for app PROCESSES STARTED AFTER the user allowed tracking. Proved on a real iPhone
// (2026-11-25): in the launch where the user taps "Allow", requests to the tracking host still
// fail (NSURLErrorDomain -1009) although the status reads authorized; after a relaunch they
// succeed. Choosing the host from the live status alone sent every event of that first launch
// to a host it could not reach, and it reached ingest only after two failures and a backoff,
// without the IDFA.
//
// Rule now: the tracking host is used only when tracking was ALREADY authorized when this
// process started AND is authorized now AND the event carries a real IDFA. Otherwise the event
// goes to ingest at once, with the IDFA removed. The next process re-sends `$att_status` once,
// so the IDFA still reaches the server.
//
// Each "process" here is a fresh module registry (jest.isolateModules): the SDK, its bridges
// and its in-memory state are created again, as in a new app launch. AsyncStorage is shared,
// as on a real device. The native module is a fake whose status the test changes.

import AsyncStorageShared from '@react-native-async-storage/async-storage';
import { HttpClient } from '../src/http-client';
import { EventQueue } from '../src/event-queue';
import type { EventPayload } from '../src/types';

const INGEST = 'https://ingest.datalyr.com/track';
const TRACKING = 'https://tracking.datalyr.com/track';
const IDFA = '6D92078A-8246-4BA4-AE5B-76104861E7DC';

type Sent = { url: string; body: any };
let sent: Sent[] = [];

// The phone. `status` is the live ATT status. `startStatus` is what iOS saw when the current
// process started: the tracking host answers only when both are authorized.
const phone = { status: 0 as number, startStatus: 0 as number, readable: true, platform: 'ios' as 'ios' | 'android' };
let trackingHostFails = false;
let nativeReads = 0;

const ok = () => ({ ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => ({}) });
const answer = (status: number) => ({ ok: status < 400, status, statusText: String(status), headers: { get: () => null }, json: async () => ({}) });

const installFetch = () => {
  (globalThis as any).fetch = async (url: string, init: any) => {
    const u = String(url);
    if (u.startsWith(INGEST) || u.startsWith(TRACKING)) {
      sent.push({ url: u, body: JSON.parse(init.body) });
      if (u.startsWith(TRACKING) && (trackingHostFails || !(phone.startStatus === 3 && phone.status === 3))) {
        return Promise.reject(new TypeError('Network request failed'));
      }
    }
    return ok();
  };
};

/**
 * Start a new app process. `nativeStartField` = the native module reports the status it saw
 * when the process started (this release's native code); false = an older native binary
 * (for example new JS through an over-the-air update), where the JS side reads it at load.
 */
const startProcess = (opts: { nativeStartField?: boolean } = {}) => {
  const nativeStartField = opts.nativeStartField !== false;
  phone.startStatus = phone.status;
  const startStatus = phone.status;
  const fakeNative: any = {
    getAdvertiserInfo: async () => {
      nativeReads++;
      if (!phone.readable) throw new Error('native read failed (test)');
      if (phone.platform === 'android') {
        return { gaid: 'GAID-TEST', att_status: 3, advertiser_tracking_enabled: true };
      }
      return {
        idfv: 'IDFV-TEST',
        att_status: phone.status,
        advertiser_tracking_enabled: phone.status === 3,
        ...(phone.status === 3 ? { idfa: IDFA } : {}),
        ...(nativeStartField ? { att_status_at_process_start: startStatus } : {}),
      };
    },
    getAppleSearchAdsAttribution: async () => null,
    getSDKAvailability: async () => ({ appleSearchAds: false }),
  };
  let mod: any;
  jest.isolateModules(() => {
    jest.doMock('@react-native-async-storage/async-storage', () => AsyncStorageShared);
    jest.doMock('react-native', () => {
      const rn = jest.requireActual('../test-mocks/react-native.js');
      return {
        ...rn,
        Platform: { ...rn.Platform, OS: phone.platform },
        NativeModules: phone.platform === 'android' ? { DatalyrNative: fakeNative } : {},
        AppState: { ...rn.AppState, addEventListener: () => ({ remove: () => {} }) },
      };
    });
    jest.doMock('expo-modules-core', () => ({
      ...jest.requireActual('../test-mocks/expo-modules-core.js'),
      requireNativeModule: (name: string) => {
        if (name === 'DatalyrNative') return fakeNative;
        throw new Error('native module unavailable (test)');
      },
    }));
    mod = require('../src/datalyr-sdk');
  });
  return new mod.DatalyrSDK();
};

const init = async (sdk: any) => {
  await sdk.initialize({ apiKey: 'dk_test', flushInterval: 999999, enableAutoEvents: false, enableWebToAppAttribution: false });
};
// Drain until empty or stuck. A drain started by track() may still be running (flush()
// returns at once then), so wait for it between tries.
const flush = async (sdk: any) => {
  const q = sdk.eventQueue;
  for (let i = 0; i < 50 && q.getStats().queueSize > 0; i++) {
    q.retryNotBefore = 0;
    await q.flush();
    await new Promise((r) => setTimeout(r, 5));
  }
};
const named = (name: string) => sent.filter((s) => s.body.event === name);
const expectNoIdOnIngest = () => {
  for (const s of sent) if (s.url === INGEST) expect(s.body.properties.idfa).toBeUndefined();
};

beforeEach(async () => {
  await (AsyncStorageShared as any).clear();
  sent = [];
  phone.status = 0;
  phone.startStatus = 0;
  phone.readable = true;
  phone.platform = 'ios';
  trackingHostFails = false;
  nativeReads = 0;
  installFetch();
});

describe.each([
  ['native reports the process-start status', true],
  ['older native binary (JS reads it at load)', false],
])('iOS, %s', (_name, nativeStartField) => {
  test('not authorized at start, user allows mid-session → ingest at once, IDFA removed, no failed request first', async () => {
    const sdk = startProcess({ nativeStartField });
    try {
      await init(sdk);
      await sdk.track('paywall_viewed');
      phone.status = 3; // the user taps "Allow"
      await sdk.updateTrackingAuthorization(true);
      await sdk.track('purchase', { value: 9 });
      await flush(sdk);

      expect(sent.filter((s) => s.url === TRACKING)).toHaveLength(0);
      for (const name of ['$att_status', 'purchase']) {
        const copies = named(name);
        expect(copies).toHaveLength(1); // delivered on the first attempt
        expect(copies[0].url).toBe(INGEST);
        expect(copies[0].body.properties.idfa).toBeUndefined();
        // The status itself is true: the user did allow tracking.
        expect(copies[0].body.properties.att_status).toBe(3);
      }
      expect(named('purchase')[0].body.properties.value).toBe(9);
      expect(sdk.eventQueue.getStats().queueSize).toBe(0);
      expectNoIdOnIngest();
    } finally {
      sdk.destroy();
    }
  });

  test('authorized at start and still authorized → tracking host with the IDFA', async () => {
    phone.status = 3;
    const sdk = startProcess({ nativeStartField });
    try {
      await init(sdk);
      await sdk.track('purchase', { value: 2 });
      await flush(sdk);
      const purchase = named('purchase');
      expect(purchase).toHaveLength(1);
      expect(purchase[0].url).toBe(TRACKING);
      expect(purchase[0].body.properties.idfa).toBe(IDFA);
      expectNoIdOnIngest();
    } finally {
      sdk.destroy();
    }
  });

  test('authorized at start, revoked mid-session → ingest, IDFA removed', async () => {
    phone.status = 3;
    const sdk = startProcess({ nativeStartField });
    try {
      await init(sdk);
      sdk.eventQueue.isOnline = false;
      await sdk.track('purchase', { value: 4 });
      phone.status = 2; // Settings → tracking off
      sdk.eventQueue.isOnline = true;
      await flush(sdk);
      const purchase = named('purchase');
      expect(purchase).toHaveLength(1);
      expect(purchase[0].url).toBe(INGEST);
      expect(purchase[0].body.properties.idfa).toBeUndefined();
      expect(purchase[0].body.properties.att_status).toBe(2);
    } finally {
      sdk.destroy();
    }
  });

  test('a new process after allowing → tracking host, and $att_status re-sent once with the IDFA', async () => {
    const first = startProcess({ nativeStartField });
    try {
      await init(first);
      phone.status = 3;
      await first.updateTrackingAuthorization(true);
      await flush(first);
    } finally {
      first.destroy();
    }
    expect(sent.filter((s) => s.url === TRACKING)).toHaveLength(0);

    sent = [];
    const second = startProcess({ nativeStartField }); // kill and relaunch
    try {
      await init(second);
      await second.track('screen_viewed');
      await flush(second);
      const att = named('$att_status');
      expect(att).toHaveLength(1);
      expect(att[0].url).toBe(TRACKING);
      expect(att[0].body.properties.idfa).toBe(IDFA);
      expect(att[0].body.properties.att_status).toBe(3);
      expect(named('screen_viewed')[0].url).toBe(TRACKING);
      expect(sent.every((s) => s.url === TRACKING)).toBe(true);
    } finally {
      second.destroy();
    }

    // Only once: a third launch sends no extra $att_status.
    sent = [];
    const third = startProcess({ nativeStartField });
    try {
      await init(third);
      await flush(third);
      expect(named('$att_status')).toHaveLength(0);
    } finally {
      third.destroy();
    }
  });
});

test('iOS: status unreadable at start → treated as not authorized at start (ingest, IDFA removed)', async () => {
  phone.status = 3;
  phone.readable = false;
  const sdk = startProcess({ nativeStartField: false });
  phone.readable = true; // later reads work and say authorized
  try {
    await init(sdk);
    await sdk.track('purchase', { value: 1 });
    await flush(sdk);
    const purchase = named('purchase');
    expect(purchase).toHaveLength(1);
    expect(purchase[0].url).toBe(INGEST);
    expect(purchase[0].body.properties.idfa).toBeUndefined();
    expect(sent.filter((s) => s.url === TRACKING)).toHaveLength(0);
  } finally {
    sdk.destroy();
  }
});

test('Android: unchanged (ingest, GAID kept, no process-start or per-send status reads)', async () => {
  phone.platform = 'android';
  const sdk = startProcess();
  try {
    await init(sdk);
    const reads = nativeReads;
    await sdk.track('purchase', { value: 1 });
    await flush(sdk);
    const purchase = named('purchase');
    expect(purchase).toHaveLength(1);
    expect(purchase[0].url).toBe(INGEST);
    expect(purchase[0].body.properties.gaid).toBe('GAID-TEST');
    expect(purchase[0].body.properties.att_status).toBe(3);
    expect(nativeReads).toBe(reads);
    expect(named('$att_status')).toHaveLength(0);
  } finally {
    sdk.destroy();
  }
});

// Second line of defence (from 1.9.0's send-time fix): the tracking host fails for an
// authorized user (a DNS or company filter, a zone problem) while ingest works.
describe('tracking host unreachable while authorized', () => {
  const payload = (name: string): EventPayload => ({
    workspaceId: 'ws_test', visitorId: 'anon', anonymousId: 'anon', sessionId: 'sess',
    eventId: `evt_${name}`, eventName: name, source: 'mobile_app', timestamp: new Date(0).toISOString(),
    eventData: { idfa: IDFA, idfv: 'IDFV-TEST', att_status: 3, advertiser_tracking_enabled: true },
  });
  const newClient = () => {
    const client = new HttpClient(INGEST, { apiKey: 'test_key_not_real', maxRetries: 0, retryDelay: 1, timeout: 50, debug: false, useServerTracking: true });
    client.setTrackingAuthorizationProvider(async () => phone.status);
    (client as any).setTrackingStatusAtProcessStartProvider?.(async () => phone.startStatus);
    return client;
  };
  const newQueue = async (client: HttpClient) => {
    const q = new EventQueue(client, { maxQueueSize: 100, batchSize: 10, flushInterval: 999999, maxRetryCount: 3 });
    await new Promise((r) => setTimeout(r, 10));
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

  beforeEach(() => {
    phone.status = 3;
    phone.startStatus = 3;
  });

  test('the counter is "two in a row": an answer from the tracking host resets it', async () => {
    const q = await newQueue(newClient());
    await enqueueQuiet(q, payload('purchase'));
    const replies: Array<'fail' | number> = ['fail', 503, 'fail'];
    (globalThis as any).fetch = async (url: string, init: any) => {
      sent.push({ url: String(url), body: JSON.parse(init.body) });
      if (String(url).startsWith(INGEST)) return ok();
      const r = replies.shift() ?? 'fail';
      return r === 'fail' ? Promise.reject(new TypeError('Network request failed')) : answer(r);
    };
    for (let i = 0; i < 3; i++) await flushNow(q);
    // fail (1), 503 (host answered: reset), fail (1): no fallback yet, the IDFA is kept.
    expect(sent.map((s) => s.url)).toEqual([TRACKING, TRACKING, TRACKING]);
    expect(q.getStats().queueSize).toBe(1);
    expect((q as any).queue[0].payload.eventData.idfa).toBe(IDFA);
  });

  test('after one fallback, IDFA events go straight to ingest for a cool-down, then the tracking host is tried again', async () => {
    trackingHostFails = true;
    const q = await newQueue(newClient());
    await enqueueQuiet(q, payload('a'));
    await flushNow(q);
    await flushNow(q); // second failure → fallback to ingest, delivered
    expect(sent.map((s) => [s.body.event, s.url])).toEqual([['a', TRACKING], ['a', TRACKING], ['a', INGEST]]);

    sent = [];
    await enqueueQuiet(q, payload('b'));
    await enqueueQuiet(q, payload('c'));
    await flushNow(q);
    // No tracking-host attempt during the cool-down: each delivered at once, without the IDFA.
    expect(sent.map((s) => [s.body.event, s.url])).toEqual([['b', INGEST], ['c', INGEST]]);
    expect(sent.every((s) => s.body.properties.idfa === undefined)).toBe(true);
    expect(sent.every((s) => s.body.properties.att_status === 3)).toBe(true);
    expect(q.getStats().queueSize).toBe(0);

    // After the cool-down the tracking host is tried again (here it works again).
    const realNow = Date.now;
    const later = realNow() + 11 * 60 * 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => later);
    try {
      trackingHostFails = false;
      sent = [];
      await enqueueQuiet(q, payload('d'));
      await flushNow(q);
      expect(sent.map((s) => [s.body.event, s.url])).toEqual([['d', TRACKING]]);
      expect(sent[0].body.properties.idfa).toBe(IDFA);
    } finally {
      (Date.now as jest.Mock).mockRestore?.();
    }
  });

  test('both hosts down (offline-like) does not start the cool-down', async () => {
    const q = await newQueue(newClient());
    await enqueueQuiet(q, payload('a'));
    (globalThis as any).fetch = async (url: string, init: any) => {
      sent.push({ url: String(url), body: JSON.parse(init.body) });
      return Promise.reject(new TypeError('Network request failed'));
    };
    for (let i = 0; i < 3; i++) await flushNow(q);
    installFetch();
    sent = [];
    await flushNow(q);
    expect(sent.map((s) => s.url)).toEqual([TRACKING]);
    expect(sent[0].body.properties.idfa).toBe(IDFA);
  });
});
