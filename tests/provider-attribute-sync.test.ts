// syncRevenueCatAttributes / syncSuperwallAttributes: the handler is re-called whenever
// datalyr_id (the anonymous id) can change, so the provider never keeps a stale id after
// reset(). Bare RN AND Expo.

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

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DatalyrSDK, Datalyr } from '../src/datalyr-sdk';
import { DatalyrSDKExpo, DatalyrExpo } from '../src/datalyr-sdk-expo';
import { EventQueue } from '../src/event-queue';
import { attributionManager } from '../src/attribution';
import { journeyManager } from '../src/journey';

const variants: Array<[string, () => any]> = [
  ['bare React Native', () => new DatalyrSDK()],
  ['Expo', () => new DatalyrSDKExpo()],
];

const providers: Array<['syncRevenueCatAttributes' | 'syncSuperwallAttributes', string]> = [
  ['syncRevenueCatAttributes', 'getRevenueCatAttributes'],
  ['syncSuperwallAttributes', 'getSuperwallAttributes'],
];

async function initSDK(sdk: any) {
  await sdk.initialize({
    apiKey: 'dk_test',
    flushInterval: 999999,
    enableWebToAppAttribution: false,
    enableAutoEvents: false,
  });
}

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(async () => {
  await (AsyncStorage as any).clear();
  const { networkStatusManager } = require('../src/network-status');
  networkStatusManager.destroy();
  await attributionManager.clearAttributionData();
  (attributionManager as any).initialized = false;
  await journeyManager.clearJourney();
  (globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  jest.spyOn(EventQueue.prototype, 'enqueue').mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

for (const [variant, createSDK] of variants) {
  for (const [syncMethod, getMethod] of providers) {
    describe(`${variant} — ${syncMethod}`, () => {
      test('registered before initialize(): first call once initialize() finishes', async () => {
        const sdk = createSDK();
        try {
          const calls: Array<Record<string, string>> = [];
          sdk[syncMethod]((attrs: Record<string, string>) => { calls.push(attrs); });
          expect(calls).toHaveLength(0);

          await initSDK(sdk);
          expect(calls).toHaveLength(1);
          expect(calls[0].datalyr_id).toBe(sdk.getStatus().anonymousId);
          expect(calls[0]).toEqual(sdk[getMethod]());
        } finally {
          sdk.destroy();
        }
      });

      test('registered after initialize(): called right after registration', async () => {
        const sdk = createSDK();
        try {
          await initSDK(sdk);
          const handler = jest.fn();
          sdk[syncMethod](handler);
          // Scheduled, not inline: runs on a microtask after registration.
          expect(handler).not.toHaveBeenCalled();
          await flushMicrotasks();
          expect(handler).toHaveBeenCalledTimes(1);
          expect(handler.mock.calls[0][0].datalyr_id).toBe(sdk.getStatus().anonymousId);
        } finally {
          sdk.destroy();
        }
      });

      test('re-called with the rotated datalyr_id after reset()', async () => {
        const sdk = createSDK();
        try {
          await initSDK(sdk);
          const handler = jest.fn();
          sdk[syncMethod](handler);
          await flushMicrotasks();
          const oldId = sdk.getStatus().anonymousId;

          await sdk.reset();
          const newId = sdk.getStatus().anonymousId;
          expect(newId).not.toBe(oldId);
          expect(handler).toHaveBeenCalledTimes(2);
          expect(handler.mock.calls[1][0].datalyr_id).toBe(newId);
        } finally {
          sdk.destroy();
        }
      });

      test('re-called after an identify that emitted, not after a redundant one', async () => {
        const sdk = createSDK();
        try {
          await initSDK(sdk);
          const handler = jest.fn();
          sdk[syncMethod](handler);
          await flushMicrotasks();

          await sdk.identify('user_A');
          expect(handler).toHaveBeenCalledTimes(2);
          await sdk.identify('user_A');
          expect(handler).toHaveBeenCalledTimes(2);
        } finally {
          sdk.destroy();
        }
      });

      test('the account-switch reset inside identify() pushes the new datalyr_id', async () => {
        const sdk = createSDK();
        try {
          await initSDK(sdk);
          await sdk.identify('user_A');
          const handler = jest.fn();
          sdk[syncMethod](handler);
          await flushMicrotasks();
          handler.mockClear();

          await sdk.identify('user_B');
          await flushMicrotasks();
          const newId = sdk.getStatus().anonymousId;
          // Exactly one push for the whole switch (reset + $identify), with the new id.
          expect(handler).toHaveBeenCalledTimes(1);
          expect(handler.mock.calls[0][0].datalyr_id).toBe(newId);
        } finally {
          sdk.destroy();
        }
      });

      test('re-called after bindProviderIdentity()', async () => {
        const sdk = createSDK();
        try {
          await initSDK(sdk);
          const handler = jest.fn();
          sdk[syncMethod](handler);
          await flushMicrotasks();
          await sdk.bindProviderIdentity('revenuecat', 'rc_user_1');
          expect(handler).toHaveBeenCalledTimes(2);
        } finally {
          sdk.destroy();
        }
      });

      test('a throwing or rejecting handler is logged, never thrown into the SDK', async () => {
        const sdk = createSDK();
        try {
          await initSDK(sdk);
          const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

          expect(() => sdk[syncMethod](() => { throw new Error('boom'); })).not.toThrow();
          await flushMicrotasks();
          await expect(sdk.reset()).resolves.toBeUndefined();
          await expect(sdk.identify('user_A')).resolves.toBeUndefined();
          expect(sdk.getStatus().currentUserId).toBe('user_A');

          sdk[syncMethod](async () => { throw new Error('async boom'); });
          await sdk.reset();
          await flushMicrotasks();
          expect(sdk.getStatus().currentUserId).toBeUndefined();
          errorSpy.mockRestore();
        } finally {
          sdk.destroy();
        }
      });

      test('registering again replaces the handler; unsubscribe stops calls', async () => {
        const sdk = createSDK();
        try {
          await initSDK(sdk);
          const first = jest.fn();
          const second = jest.fn();
          const unsubscribeFirst = sdk[syncMethod](first);
          const unsubscribeSecond = sdk[syncMethod](second);
          await flushMicrotasks();
          first.mockClear();
          second.mockClear();

          // Unsubscribing the replaced handler does not remove the current one.
          unsubscribeFirst();
          await sdk.reset();
          expect(first).not.toHaveBeenCalled();
          expect(second).toHaveBeenCalledTimes(1);

          unsubscribeSecond();
          await sdk.reset();
          expect(second).toHaveBeenCalledTimes(1);
        } finally {
          sdk.destroy();
        }
      });

      test('an old unsubscribe handle does not remove a re-registration of the same function', async () => {
        const sdk = createSDK();
        try {
          await initSDK(sdk);
          const handler = jest.fn();
          const oldUnsubscribe = sdk[syncMethod](handler);
          sdk[syncMethod](handler);
          await flushMicrotasks();
          handler.mockClear();

          oldUnsubscribe();
          await sdk.reset();
          expect(handler).toHaveBeenCalledTimes(1);
        } finally {
          sdk.destroy();
        }
      });

      test('a handler that calls back into DATALYR runs after reset() finished', async () => {
        const sdk = createSDK();
        try {
          await initSDK(sdk);
          const seen: Array<{ datalyrId: string; anonymousId: string; sessionId: string }> = [];
          sdk[syncMethod](async (attrs: Record<string, string>) => {
            seen.push({ datalyrId: attrs.datalyr_id, anonymousId: sdk.getStatus().anonymousId, sessionId: sdk.getStatus().sessionId });
            await sdk.track('from_handler');
          });
          await flushMicrotasks();
          seen.length = 0;

          await sdk.reset();
          await flushMicrotasks();
          const status = sdk.getStatus();
          expect(seen).toEqual([{ datalyrId: status.anonymousId, anonymousId: status.anonymousId, sessionId: status.sessionId }]);
        } finally {
          sdk.destroy();
        }
      });

      test('identify pushes after the web-attribution merge, and on a redundant identify that merged', async () => {
        const sdk = createSDK();
        try {
          let webFound = false;
          (globalThis as any).fetch = async (url: string) => {
            if (String(url).includes('/attribution/lookup') && webFound) {
              return {
                ok: true,
                status: 200,
                json: async () => ({ found: true, attribution: { visitor_id: 'web_visitor', fbclid: 'FB_WEB', utm_source: 'facebook' } }),
              };
            }
            if (String(url).includes('/attribution/lookup')) return { ok: false, status: 503, json: async () => ({}) };
            return { ok: true, status: 200, json: async () => ({}) };
          };
          await sdk.initialize({ apiKey: 'dk_test', flushInterval: 999999, enableAutoEvents: false });
          const handler = jest.fn();
          sdk[syncMethod](handler);
          await flushMicrotasks();
          handler.mockClear();

          // Emits $identify; the lookup fails (503): one push, no fbclid yet.
          await sdk.identify('user_A', { email: 'a@example.com' });
          await flushMicrotasks();
          expect(handler).toHaveBeenCalledTimes(1);
          expect(handler.mock.calls[0][0].fbclid).toBeUndefined();

          // Redundant identify, but the retried lookup merges: push again, with the click.
          webFound = true;
          await sdk.identify('user_A', { email: 'a@example.com' });
          await flushMicrotasks();
          expect(handler).toHaveBeenCalledTimes(2);
          expect(handler.mock.calls[1][0].fbclid).toBe('FB_WEB');

          // Redundant and nothing merged (already checked): no push.
          await sdk.identify('user_A', { email: 'a@example.com' });
          await flushMicrotasks();
          expect(handler).toHaveBeenCalledTimes(2);
        } finally {
          sdk.destroy();
        }
      });
    });
  }

  test(`${variant} — RevenueCat and Superwall handlers are independent`, async () => {
    const sdk = createSDK();
    try {
      await initSDK(sdk);
      const rc = jest.fn();
      const sw = jest.fn();
      sdk.syncRevenueCatAttributes(rc);
      sdk.syncSuperwallAttributes(sw);
      await flushMicrotasks();
      await sdk.reset();
      expect(rc).toHaveBeenCalledTimes(2);
      expect(sw).toHaveBeenCalledTimes(2);
      expect(rc.mock.calls[1][0].datalyr_id).toBe(sw.mock.calls[1][0].datalyr_id);
    } finally {
      sdk.destroy();
    }
  });
}

describe('static wrappers return the unsubscribe function', () => {
  test.each([
    ['bare React Native', Datalyr, require('../src/datalyr-sdk').default],
    ['Expo', DatalyrExpo, require('../src/datalyr-sdk-expo').default],
  ])('%s', (_name, Facade: any, singleton: any) => {
    const unsubscribe = () => undefined;
    const rc = jest.spyOn(singleton, 'syncRevenueCatAttributes').mockReturnValue(unsubscribe);
    const sw = jest.spyOn(singleton, 'syncSuperwallAttributes').mockReturnValue(unsubscribe);
    const handler = () => undefined;
    expect(Facade.syncRevenueCatAttributes(handler)).toBe(unsubscribe);
    expect(Facade.syncSuperwallAttributes(handler)).toBe(unsubscribe);
    expect(rc).toHaveBeenCalledWith(handler);
    expect(sw).toHaveBeenCalledWith(handler);
  });
});
