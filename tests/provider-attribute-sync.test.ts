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

      test('registered after initialize(): called immediately', async () => {
        const sdk = createSDK();
        try {
          await initSDK(sdk);
          const handler = jest.fn();
          sdk[syncMethod](handler);
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
          handler.mockClear();

          await sdk.identify('user_B');
          const newId = sdk.getStatus().anonymousId;
          expect(handler).toHaveBeenCalled();
          const lastCall = handler.mock.calls[handler.mock.calls.length - 1][0];
          expect(lastCall.datalyr_id).toBe(newId);
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
