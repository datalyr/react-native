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
import { DatalyrSDK } from '../src/datalyr-sdk';
import { DatalyrSDKExpo } from '../src/datalyr-sdk-expo';
import { attributionManager } from '../src/attribution';
import { journeyManager } from '../src/journey';

type IdentitySDK = Pick<
  DatalyrSDK,
  'initialize' | 'identify' | 'alias' | 'setAttributionData' | 'getAttributionData' | 'getStatus' | 'destroy'
>;

const variants: Array<[string, () => IdentitySDK]> = [
  ['bare React Native', () => new DatalyrSDK()],
  ['Expo', () => new DatalyrSDKExpo()],
];

beforeEach(async () => {
  await (AsyncStorage as any).clear();
  const { networkStatusManager } = require('../src/network-status');
  networkStatusManager.destroy();
  await attributionManager.clearAttributionData();
  (attributionManager as any).initialized = false;
  await journeyManager.clearJourney();
});

for (const [variant, createSDK] of variants) {
  describe(`${variant} identity transitions`, () => {
    test('a switch during startup discards the previous user\'s buffered identify event', async () => {
      const sdk = createSDK();
      try {
        await sdk.identify('startup_user_A');
        await sdk.identify('startup_user_B');

        const buffered = (sdk as any).preInitQueue;
        expect(buffered).toHaveLength(1);
        expect(buffered[0].eventName).toBe('$identify');
        expect(buffered[0].eventData.userId).toBe('startup_user_B');
        expect(sdk.getStatus().currentUserId).toBe('startup_user_B');
      } finally {
        sdk.destroy();
      }
    });

    test('directly identifying a different user resets visitor identity and attribution', async () => {
      const sdk = createSDK();
      try {
        await sdk.initialize({
          apiKey: 'dk_test',
          flushInterval: 999999,
          enableAutoEvents: false,
          enableWebToAppAttribution: false,
        } as any);

        await sdk.identify('user_A', { plan: 'legacy' });
        await sdk.setAttributionData({ fbclid: 'FB_USER_A', utm_source: 'facebook' });
        const before = sdk.getStatus();

        await sdk.identify('user_B');
        const after = sdk.getStatus();

        expect(after.currentUserId).toBe('user_B');
        expect(after.visitorId).not.toBe(before.visitorId);
        expect(after.anonymousId).not.toBe(before.anonymousId);
        expect(after.sessionId).not.toBe(before.sessionId);
        expect(sdk.getAttributionData().fbclid).toBeUndefined();
        expect(sdk.getAttributionData().utm_source).toBeUndefined();
      } finally {
        sdk.destroy();
      }
    });

    test('an explicit same-person alias adopts the new ID without resetting attribution', async () => {
      const sdk = createSDK();
      try {
        await sdk.initialize({
          apiKey: 'dk_test',
          flushInterval: 999999,
          enableAutoEvents: false,
          enableWebToAppAttribution: false,
        } as any);

        await sdk.identify('legacy_user_id');
        await sdk.setAttributionData({ fbclid: 'FB_SAME_PERSON', utm_source: 'facebook' });
        const before = sdk.getStatus();

        await sdk.alias('canonical_user_id', 'legacy_user_id');
        const after = sdk.getStatus();

        expect(after.currentUserId).toBe('canonical_user_id');
        expect(after.visitorId).toBe(before.visitorId);
        expect(after.anonymousId).toBe(before.anonymousId);
        expect(after.sessionId).toBe(before.sessionId);
        expect(sdk.getAttributionData().fbclid).toBe('FB_SAME_PERSON');
        expect(sdk.getAttributionData().utm_source).toBe('facebook');
      } finally {
        sdk.destroy();
      }
    });
  });
}
