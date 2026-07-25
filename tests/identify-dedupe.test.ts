// Redundant-identify suppression (1.7.15) — bare RN AND Expo.
//
// Why this file exists: 1.7.15 shipped the suppression with NO test. On Expo it
// was dead code — `STORAGE_KEYS.LAST_IDENTITY_FINGERPRINT` was missing from
// utils-expo.ts, so `Storage.getItem(undefined)`/`setItem(undefined, …)` no-opped
// and every identify still emitted. Three TS2339 errors said so, but
// tsconfig.json excluded the entire Expo half from `tsc`, jest strips types via
// babel, and the AsyncStorage mock accepted `undefined` keys.
//
// Every test below runs against BOTH entry points. Divergence between the bare
// and Expo builds is the highest-yield defect class in this package, so the
// suppression must be proven on each rather than assumed to be shared.

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
  NetworkStateType: { WIFI: 'WIFI', CELLULAR: 'CELLULAR', ETHERNET: 'ETHERNET', BLUETOOTH: 'BLUETOOTH' },
  getNetworkStateAsync: async () => ({ type: 'WIFI', isConnected: true, isInternetReachable: true }),
}), { virtual: true });

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DatalyrSDK } from '../src/datalyr-sdk';
import { DatalyrSDKExpo } from '../src/datalyr-sdk-expo';
import { attributionManager } from '../src/attribution';
import { journeyManager } from '../src/journey';

const variants: Array<[string, () => any]> = [
  ['bare React Native', () => new DatalyrSDK()],
  ['Expo', () => new DatalyrSDKExpo()],
];

/** Capture every event name the SDK enqueues, without touching the network. */
function captureTrackedEvents(sdk: any): string[] {
  const seen: string[] = [];
  const originalTrack = sdk.track.bind(sdk);
  sdk.track = async (eventName: string, ...rest: any[]) => {
    seen.push(eventName);
    return originalTrack(eventName, ...rest);
  };
  return seen;
}

async function initSDK(sdk: any) {
  await sdk.initialize({
    apiKey: 'dk_test',
    flushInterval: 999999,
    enableWebToAppAttribution: false,
    enableAutoEvents: false,
  });
}

beforeEach(async () => {
  await (AsyncStorage as any).clear();
  const { networkStatusManager } = require('../src/network-status');
  networkStatusManager.destroy();
  await attributionManager.clearAttributionData();
  (attributionManager as any).initialized = false;
  await journeyManager.clearJourney();
  (globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
});

for (const [variant, createSDK] of variants) {
  describe(`${variant} — redundant identify suppression`, () => {
    test('an unchanged repeat identify emits $identify exactly once', async () => {
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        const events = captureTrackedEvents(sdk);

        await sdk.identify('user_1', { email: 'a@example.com' });
        await sdk.identify('user_1', { email: 'a@example.com' });
        await sdk.identify('user_1', { email: 'a@example.com' });

        expect(events.filter((e) => e === '$identify')).toHaveLength(1);
      } finally {
        sdk.destroy();
      }
    });

    test('the fingerprint is actually persisted under a real string key', async () => {
      // The Expo regression was invisible precisely because nothing asserted
      // the key existed. Read the store directly.
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        await sdk.identify('user_1', { email: 'a@example.com' });

        const stored = await AsyncStorage.getItem('@datalyr/last_identity_fingerprint');
        expect(stored).not.toBeNull();

        // RN-23: the stored value must be a HASH, never the raw identity. The
        // first version of this test asserted `toContain('user_1')`, which pinned
        // the PII-bearing plaintext in place — the suppression feature would have
        // written `visitor|user@example.com|email=user@example.com` to disk and a
        // green test would have said that was correct. iOS and web both hash.
        expect(String(stored)).not.toContain('user_1');
        expect(String(stored)).not.toContain('a@example.com');
        // Storage.setItem JSON-encodes, so the raw AsyncStorage value is a
        // quoted string ("e803a782"). Assert on the decoded value.
        expect(JSON.parse(String(stored))).toMatch(/^[0-9a-f]+$/);

        const keys = Array.from((AsyncStorage as any).__store.keys());
        expect(keys.every((k) => typeof k === 'string')).toBe(true);
        expect(keys).not.toContain(undefined);
      } finally {
        sdk.destroy();
      }
    });

    test('a changed trait still emits', async () => {
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        const events = captureTrackedEvents(sdk);

        await sdk.identify('user_1', { email: 'a@example.com' });
        await sdk.identify('user_1', { email: 'b@example.com' });

        expect(events.filter((e) => e === '$identify')).toHaveLength(2);
      } finally {
        sdk.destroy();
      }
    });

    test('trait order does not defeat suppression', async () => {
      // Keys are sorted before hashing, so {a,b} and {b,a} are one identity.
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        const events = captureTrackedEvents(sdk);

        await sdk.identify('user_1', { email: 'a@example.com', name: 'A' });
        await sdk.identify('user_1', { name: 'A', email: 'a@example.com' });

        expect(events.filter((e) => e === '$identify')).toHaveLength(1);
      } finally {
        sdk.destroy();
      }
    });

    test('suppression survives a restart — it is persisted, not in-memory', async () => {
      // A host calling identify() once per launch is the exact pattern that
      // produced 6.8 identifies/visitor/day in production. A memory-only
      // fingerprint would not damp it at all.
      const first = createSDK();
      try {
        await initSDK(first);
        const firstEvents = captureTrackedEvents(first);
        await first.identify('user_1', { email: 'a@example.com' });
        expect(firstEvents.filter((e) => e === '$identify')).toHaveLength(1);
      } finally {
        first.destroy();
      }

      const second = createSDK();
      try {
        await initSDK(second);
        const secondEvents = captureTrackedEvents(second);
        await second.identify('user_1', { email: 'a@example.com' });
        expect(secondEvents.filter((e) => e === '$identify')).toHaveLength(0);
      } finally {
        second.destroy();
      }
    });

    test('a different user always emits — suppression never blocks a real switch', async () => {
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        const events = captureTrackedEvents(sdk);

        await sdk.identify('user_1', { email: 'a@example.com' });
        await sdk.identify('user_2', { email: 'b@example.com' });

        expect(events.filter((e) => e === '$identify')).toHaveLength(2);
      } finally {
        sdk.destroy();
      }
    });
  });
}

// RN-19 — suppression must not block the web-attribution lookup retry.
//
// The bug 1.7.15 introduced: the redundant-identify early return sat BEFORE the
// only call site of fetchAndMergeWebAttribution. That function marks an email
// hash "checked" only after a definitive HTTP 200, specifically so a transient
// failure retries on the next identify — which suppression made unreachable. A
// single 5xx therefore lost web→app attribution for the lifetime of the install.
for (const [variant, createSDK] of variants) {
  describe(`${variant} — web-attribution lookup vs identify suppression`, () => {
    let lookupCalls: number;

    /** Install a fetch stub; `status` drives the lookup response code. */
    function stubFetch(status: () => number) {
      lookupCalls = 0;
      (globalThis as any).fetch = async (url: string) => {
        if (typeof url === 'string' && url.includes('/attribution/lookup')) {
          lookupCalls += 1;
          return {
            ok: status() === 200,
            status: status(),
            json: async () => ({ found: false }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      };
    }

    async function initWithLookup(sdk: any) {
      await sdk.initialize({
        apiKey: 'dk_test',
        flushInterval: 999999,
        enableAutoEvents: false,
        // left enabled on purpose — this is the path under test
        enableWebToAppAttribution: true,
      });
    }

    test('a transient failure RETRIES on the next (suppressed) identify', async () => {
      // The regression. Before the fix this asserted 1 and stayed 1 forever.
      let code = 500;
      stubFetch(() => code);

      const sdk = createSDK();
      try {
        await initWithLookup(sdk);

        await sdk.identify('user_1', { email: 'a@example.com' });
        expect(lookupCalls).toBe(1);

        // Identical identity → $identify is suppressed, but because the first
        // lookup never got a 200 it must be retried.
        await sdk.identify('user_1', { email: 'a@example.com' });
        expect(lookupCalls).toBe(2);

        // Now let it succeed; the marker should finally latch.
        code = 200;
        await sdk.identify('user_1', { email: 'a@example.com' });
        expect(lookupCalls).toBe(3);

        // …and stop.
        await sdk.identify('user_1', { email: 'a@example.com' });
        expect(lookupCalls).toBe(3);
      } finally {
        sdk.destroy();
      }
    });

    test('after a 200 a redundant identify makes NO network request', async () => {
      // The waste 1.7.15 set out to remove must stay removed: the marker
      // short-circuits before any I/O, so unconditional calling is free.
      stubFetch(() => 200);

      const sdk = createSDK();
      try {
        await initWithLookup(sdk);

        await sdk.identify('user_1', { email: 'a@example.com' });
        expect(lookupCalls).toBe(1);

        await sdk.identify('user_1', { email: 'a@example.com' });
        await sdk.identify('user_1', { email: 'a@example.com' });
        expect(lookupCalls).toBe(1);
      } finally {
        sdk.destroy();
      }
    });

    test('the $identify event is still suppressed while the lookup runs', async () => {
      // Both properties must hold at once — fixing the lookup must not
      // resurrect the event storm.
      let code = 500;
      stubFetch(() => code);

      const sdk = createSDK();
      try {
        await initWithLookup(sdk);
        const events = captureTrackedEvents(sdk);

        await sdk.identify('user_1', { email: 'a@example.com' });
        await sdk.identify('user_1', { email: 'a@example.com' });
        await sdk.identify('user_1', { email: 'a@example.com' });

        expect(events.filter((e) => e === '$identify')).toHaveLength(1);
        expect(lookupCalls).toBe(3);
      } finally {
        sdk.destroy();
      }
    });
  });
}

describe('STORAGE_KEYS parity between the two utils implementations', () => {
  test('every key in utils.ts exists in utils-expo.ts with the same value', () => {
    // The structural guard, and it earned its keep immediately: on first run it
    // caught DEAD_LETTER_QUEUE missing from utils-expo.ts as well.
    //
    // Deliberately ONE-directional (utils.ts ⊆ utils-expo.ts). The shared modules
    // — event-queue, attribution, journey — all import STORAGE_KEYS from
    // './utils' regardless of build, so every bare key is live on Expo too and
    // must not diverge. utils-expo legitimately carries Expo-only extras
    // (SESSION_START, INSTALL_TIME, LAST_APP_VERSION, DEVICE_ID) that have no
    // business in the bare build, so the reverse assertion would be wrong.
    //
    // Both builds also share ONE AsyncStorage namespace, so a same-name/
    // different-value key would silently split identity for an app that moves
    // between entry points.
    const bare = require('../src/utils').STORAGE_KEYS;
    const expo = require('../src/utils-expo').STORAGE_KEYS;

    for (const [name, value] of Object.entries(bare)) {
      expect(expo[name]).toBe(value);
    }
  });
});
