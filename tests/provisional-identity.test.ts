// Provisional (pre-login) user id — identify(id, props, { provisional: true }).
// Contract: datalyr-v2 docs/identity-resolution/provisional-conversion.md (§2.10). Wire
// marker: eventData.$provisional_user_id = true. No $alias is ever sent by the SDK.
// Every test runs against BOTH entry points (bare RN and Expo).

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
import type { EventPayload } from '../src/types';
import { provisionalFlagFor } from '../src/provisional-identity';

const variants: Array<[string, () => any]> = [
  ['bare React Native', () => new DatalyrSDK()],
  ['Expo', () => new DatalyrSDKExpo()],
];

let sent: EventPayload[] = [];

async function initSDK(sdk: any) {
  await sdk.initialize({
    apiKey: 'dk_test',
    flushInterval: 999999,
    enableWebToAppAttribution: false,
    enableAutoEvents: false,
  });
}

const named = (name: string) => sent.filter((p) => p.eventName === name);
const last = (name: string) => named(name)[named(name).length - 1];

beforeEach(async () => {
  await (AsyncStorage as any).clear();
  const { networkStatusManager } = require('../src/network-status');
  networkStatusManager.destroy();
  await attributionManager.clearAttributionData();
  (attributionManager as any).initialized = false;
  await journeyManager.clearJourney();
  (globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  sent = [];
  jest.spyOn(EventQueue.prototype, 'enqueue').mockImplementation(async (payload: EventPayload) => {
    sent.push(payload);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

for (const [variant, createSDK] of variants) {
  describe(`${variant} — provisional identify`, () => {
    test('$identify and every later event carry $provisional_user_id while the guest id is current', async () => {
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        await sdk.identify('guest-uuid', undefined, { provisional: true });
        await sdk.track('onboarding_step', { step: 1 });

        const identify = last('$identify');
        expect(identify.eventData.userId).toBe('guest-uuid');
        expect(identify.eventData.$provisional_user_id).toBe(true);
        const step = last('onboarding_step');
        expect(step.userId).toBe('guest-uuid');
        expect(step.eventData.$provisional_user_id).toBe(true);
        expect(named('$alias')).toHaveLength(0);
      } finally {
        sdk.destroy();
      }
    });

    test('a real identify after the guest id keeps the device ids (no reset) and drops the marker', async () => {
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        await sdk.identify('guest-uuid', undefined, { provisional: true });
        await sdk.setAttributionData({ fbclid: 'FB_GUEST' });
        const before = sdk.getStatus();

        await sdk.identify('firebase-uid');
        await sdk.track('paywall_viewed');
        const after = sdk.getStatus();

        expect(after.currentUserId).toBe('firebase-uid');
        expect(after.anonymousId).toBe(before.anonymousId);
        expect(after.visitorId).toBe(before.visitorId);
        expect(after.sessionId).toBe(before.sessionId);
        expect(sdk.getAttributionData().fbclid).toBe('FB_GUEST');

        const identify = last('$identify');
        expect(identify.eventData.userId).toBe('firebase-uid');
        expect(identify.eventData.$provisional_user_id).toBeUndefined();
        expect(last('paywall_viewed').eventData.$provisional_user_id).toBeUndefined();
        expect(named('$alias')).toHaveLength(0);
        expect(await AsyncStorage.getItem('@datalyr/user_id_provisional')).toBeNull();
      } finally {
        sdk.destroy();
      }
    });

    test('a second guest id replaces the first without a reset', async () => {
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        await sdk.identify('guest-1', undefined, { provisional: true });
        const before = sdk.getStatus();
        await sdk.identify('guest-2', undefined, { provisional: true });
        const after = sdk.getStatus();

        expect(after.currentUserId).toBe('guest-2');
        expect(after.anonymousId).toBe(before.anonymousId);
        expect(last('$identify').eventData.$provisional_user_id).toBe(true);
      } finally {
        sdk.destroy();
      }
    });

    test('a guest id is ignored while a signed-in user is current', async () => {
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        await sdk.identify('firebase-uid');
        const before = sdk.getStatus();
        const identifies = named('$identify').length;

        await sdk.identify('guest-uuid', undefined, { provisional: true });
        await sdk.track('after_guest');
        const after = sdk.getStatus();

        expect(after.currentUserId).toBe('firebase-uid');
        expect(after.anonymousId).toBe(before.anonymousId);
        expect(named('$identify')).toHaveLength(identifies);
        expect(last('after_guest').eventData.$provisional_user_id).toBeUndefined();
      } finally {
        sdk.destroy();
      }
    });

    test('real -> different real still runs the account-switch reset', async () => {
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        await sdk.identify('user_A');
        const before = sdk.getStatus();
        await sdk.identify('user_B');
        const after = sdk.getStatus();
        expect(after.currentUserId).toBe('user_B');
        expect(after.anonymousId).not.toBe(before.anonymousId);
      } finally {
        sdk.destroy();
      }
    });

    test('reset() clears the provisional state (memory and storage)', async () => {
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        await sdk.identify('guest-uuid', undefined, { provisional: true });
        expect(await AsyncStorage.getItem('@datalyr/user_id_provisional')).not.toBeNull();

        await sdk.reset();
        await sdk.track('after_reset');
        expect((sdk as any).currentUserProvisional).toBe(false);
        expect(await AsyncStorage.getItem('@datalyr/user_id_provisional')).toBeNull();
        expect(last('after_reset').eventData.$provisional_user_id).toBeUndefined();

        // After a logout a guest id is accepted again.
        await sdk.identify('guest-uuid-2', undefined, { provisional: true });
        expect(sdk.getStatus().currentUserId).toBe('guest-uuid-2');
        expect(last('$identify').eventData.$provisional_user_id).toBe(true);
      } finally {
        sdk.destroy();
      }
    });

    test('the provisional flag survives a restart, and the later real identify does not reset', async () => {
      const first = createSDK();
      await initSDK(first);
      await first.identify('guest-uuid', undefined, { provisional: true });
      first.destroy();

      sent = [];
      const second = createSDK();
      try {
        await initSDK(second);
        expect(second.getStatus().currentUserId).toBe('guest-uuid');
        await second.track('relaunch_event');
        expect(last('relaunch_event').eventData.$provisional_user_id).toBe(true);

        const anonymousId = second.getStatus().anonymousId;
        await second.identify('firebase-uid');
        expect(second.getStatus().anonymousId).toBe(anonymousId);
        expect(last('$identify').eventData.$provisional_user_id).toBeUndefined();
      } finally {
        second.destroy();
      }
    });

    test('the redundant-identify hash includes the flag', async () => {
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        await sdk.identify('same-id', undefined, { provisional: true });
        await sdk.identify('same-id', undefined, { provisional: true });
        expect(named('$identify')).toHaveLength(1);

        // Same id, now as a real account: not redundant, re-emitted without the marker.
        await sdk.identify('same-id');
        expect(named('$identify')).toHaveLength(2);
        expect(last('$identify').eventData.$provisional_user_id).toBeUndefined();
        expect((sdk as any).currentUserProvisional).toBe(false);
      } finally {
        sdk.destroy();
      }
    });

    test('a guest id identified while initialize() runs rides app_install and the replayed $identify', async () => {
      // The QUITTR shape: initialize() (not awaited), then identify(guest) right away.
      // (An identify() issued BEFORE initialize() is even called writes @datalyr/user_id
      // first, which install detection reads as a returning device: no app_install.)
      const sdk = createSDK();
      try {
        const init = initSDK(sdk);
        await sdk.identify('guest-uuid', undefined, { provisional: true });
        await init;

        const identify = last('$identify');
        expect(identify.eventData.userId).toBe('guest-uuid');
        expect(identify.eventData.$provisional_user_id).toBe(true);
        const install = last('app_install');
        expect(install).toBeDefined();
        expect(install.userId).toBe('guest-uuid');
        expect(install.eventData.$provisional_user_id).toBe(true);
      } finally {
        sdk.destroy();
      }
    });

    test('a buffered guest $identify keeps its marker when a real identify follows before initialize()', async () => {
      const sdk = createSDK();
      try {
        await sdk.identify('guest-uuid', undefined, { provisional: true });
        await sdk.identify('firebase-uid');
        await initSDK(sdk);

        const guest = named('$identify').find((p) => p.eventData.userId === 'guest-uuid');
        const real = named('$identify').find((p) => p.eventData.userId === 'firebase-uid');
        expect(guest?.eventData.$provisional_user_id).toBe(true);
        expect(real?.eventData.$provisional_user_id).toBeUndefined();
        expect(sdk.getStatus().currentUserId).toBe('firebase-uid');
      } finally {
        sdk.destroy();
      }
    });

    test('guest then real identify, not awaited: the real user wins, no reset, its $identify is sent', async () => {
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        const before = sdk.getStatus();
        const guest = sdk.identify('guest-uuid', undefined, { provisional: true });
        const real = sdk.identify('firebase-uid');
        await Promise.all([guest, real]);

        const after = sdk.getStatus();
        expect(after.currentUserId).toBe('firebase-uid');
        expect(after.anonymousId).toBe(before.anonymousId);
        expect((sdk as any).currentUserProvisional).toBe(false);
        expect(named('$identify').map((p) => p.eventData.userId)).toEqual(['firebase-uid']);
      } finally {
        sdk.destroy();
      }
    });

    test('guest then real identify before initialize(), not awaited: the real $identify survives', async () => {
      const sdk = createSDK();
      try {
        const guest = sdk.identify('guest-uuid', undefined, { provisional: true });
        const real = sdk.identify('firebase-uid');
        await Promise.all([guest, real]);
        await initSDK(sdk);

        expect(sdk.getStatus().currentUserId).toBe('firebase-uid');
        const realIdentify = named('$identify').find((p) => p.eventData.userId === 'firebase-uid');
        expect(realIdentify).toBeDefined();
        expect(realIdentify!.eventData.$provisional_user_id).toBeUndefined();
      } finally {
        sdk.destroy();
      }
    });

    test('a stale provisional flag written for another id does not mark the stored real user', async () => {
      // OTA rollback / kill between writes: user_id is the real account, the flag is
      // left over from the guest id (or a pre-1.7.24 boolean).
      for (const staleFlag of [provisionalFlagFor('guest-uuid'), true]) {
        await (AsyncStorage as any).clear();
        sent = [];
        await AsyncStorage.setItem('@datalyr/user_id', JSON.stringify('firebase-uid'));
        await AsyncStorage.setItem('@datalyr/user_id_provisional', JSON.stringify(staleFlag));

        const sdk = createSDK();
        try {
          // Pre-init check reads the same binding: the guest id is ignored.
          await sdk.identify('guest-2', undefined, { provisional: true });
          await initSDK(sdk);
          expect(sdk.getStatus().currentUserId).toBe('firebase-uid');
          expect((sdk as any).currentUserProvisional).toBe(false);
          await sdk.track('relaunch_event');
          expect(last('relaunch_event').eventData.$provisional_user_id).toBeUndefined();
        } finally {
          sdk.destroy();
        }
      }
    });

    test('the stored flag is bound to the user id (not a bare boolean)', async () => {
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        await sdk.identify('guest-uuid', undefined, { provisional: true });
        const stored = JSON.parse(String(await AsyncStorage.getItem('@datalyr/user_id_provisional')));
        expect(stored).toBe(provisionalFlagFor('guest-uuid'));
        expect(stored).not.toContain('guest-uuid');
      } finally {
        sdk.destroy();
      }
    });

    test('$provisional_user_id is SDK-owned: a caller-set value is dropped', async () => {
      const sdk = createSDK();
      try {
        await initSDK(sdk);
        await sdk.identify('firebase-uid', { $provisional_user_id: true } as any);
        await sdk.track('custom', { $provisional_user_id: true });
        expect(last('$identify').eventData.$provisional_user_id).toBeUndefined();
        expect(last('custom').eventData.$provisional_user_id).toBeUndefined();

        // A hand-made $identify naming another id gets no marker either.
        await sdk.track('$identify', { userId: 'someone-else', $provisional_user_id: true });
        expect(last('$identify').eventData.$provisional_user_id).toBeUndefined();
      } finally {
        sdk.destroy();
      }
    });

    test('a guest id identified before initialize() cannot replace the signed-in user of the previous launch', async () => {
      const first = createSDK();
      await initSDK(first);
      await first.identify('firebase-uid');
      first.destroy();

      sent = [];
      const second = createSDK();
      try {
        await second.identify('guest-uuid', undefined, { provisional: true });
        await initSDK(second);
        expect(second.getStatus().currentUserId).toBe('firebase-uid');
        expect(named('$identify')).toHaveLength(0);
      } finally {
        second.destroy();
      }
    });
  });
}

describe('static wrappers pass the provisional option through', () => {
  test.each([
    ['bare React Native', Datalyr, require('../src/datalyr-sdk').default],
    ['Expo', DatalyrExpo, require('../src/datalyr-sdk-expo').default],
  ])('%s', async (_name, Facade: any, singleton: any) => {
    const spy = jest.spyOn(singleton, 'identify').mockResolvedValue(undefined);
    await Facade.identify('guest-uuid', { a: 1 }, { provisional: true });
    expect(spy).toHaveBeenCalledWith('guest-uuid', { a: 1 }, { provisional: true });
  });
});
