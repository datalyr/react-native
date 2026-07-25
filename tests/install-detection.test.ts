// RN-22 — `enableAttribution: false` must not silently kill app_install.
//
// Install detection lived only inside attributionManager.initialize(), which the
// SDK skips entirely when the flag is off. The result was silent and permanent:
// checkFirstLaunch() never ran, isFirstLaunch stayed false, isInstall() returned
// false, and app_install never fired for ANY user. markInstallTracked() then
// never wrote @datalyr/first_launch_time either, so re-enabling attribution
// months later would fire app_install dated to that day rather than the real
// install.

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
  nativeBuildVersion: '1',
  applicationId: 'com.datalyr.test',
  getInstallationTimeAsync: async () => new Date(0),
}), { virtual: true });

jest.mock('expo-device', () => ({
  modelName: 'Test Device', deviceName: 'Test Device',
  manufacturer: 'Test', osVersion: '17.0', isDevice: true,
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

const variants: Array<[string, () => any]> = [
  ['bare React Native', () => new DatalyrSDK()],
  ['Expo', () => new DatalyrSDKExpo()],
];

beforeEach(async () => {
  await (AsyncStorage as any).clear();
  const { networkStatusManager } = require('../src/network-status');
  networkStatusManager.destroy();
  await attributionManager.clearAttributionData();
  (attributionManager as any).initialized = false;
  (attributionManager as any).isFirstLaunch = false;
  await journeyManager.clearJourney();
  (globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
});

for (const [variant, createSDK] of variants) {
  describe(`${variant} — app_install with enableAttribution: false`, () => {
    it('still fires app_install on a first launch', async () => {
      const sdk = createSDK();
      const seen: string[] = [];
      const originalTrack = sdk.track.bind(sdk);
      sdk.track = async (name: string, ...rest: any[]) => {
        seen.push(name);
        return originalTrack(name, ...rest);
      };

      try {
        await sdk.initialize({
          apiKey: 'dk_test',
          flushInterval: 999999,
          enableAutoEvents: false,
          enableWebToAppAttribution: false,
          enableAttribution: false,
        });

        expect(seen).toContain('app_install');
      } finally {
        sdk.destroy();
      }
    });

    it('writes the first-launch marker, so the install date stays truthful', async () => {
      // The second-order bug: without the marker, re-enabling attribution later
      // would re-detect a "new" install and date it wrong.
      const sdk = createSDK();
      try {
        await sdk.initialize({
          apiKey: 'dk_test',
          flushInterval: 999999,
          enableAutoEvents: false,
          enableWebToAppAttribution: false,
          enableAttribution: false,
        });

        const marker = await AsyncStorage.getItem('@datalyr/first_launch_time');
        expect(marker).not.toBeNull();
      } finally {
        sdk.destroy();
      }
    });

    it('does not fire app_install again on a later launch', async () => {
      const first = createSDK();
      try {
        await first.initialize({
          apiKey: 'dk_test', flushInterval: 999999, enableAutoEvents: false,
          enableWebToAppAttribution: false, enableAttribution: false,
        });
      } finally {
        first.destroy();
      }

      (attributionManager as any).initialized = false;
      (attributionManager as any).isFirstLaunch = false;

      const second = createSDK();
      const seen: string[] = [];
      const originalTrack = second.track.bind(second);
      second.track = async (name: string, ...rest: any[]) => {
        seen.push(name);
        return originalTrack(name, ...rest);
      };
      try {
        await second.initialize({
          apiKey: 'dk_test', flushInterval: 999999, enableAutoEvents: false,
          enableWebToAppAttribution: false, enableAttribution: false,
        });
        expect(seen).not.toContain('app_install');
      } finally {
        second.destroy();
      }
    });
  });
}

for (const [variant, createSDK] of variants) {
  describe(`${variant} — RN-24: upgrading an existing install must not re-fire app_install`, () => {
    it('suppresses app_install for a device that already ran an older build', async () => {
      // The regression this guards: an `enableAttribution: false` app never wrote
      // @datalyr/first_launch_time, so without a guard EVERY existing device would
      // look like a fresh install on the first launch after upgrading — firing
      // app_install dated today for the whole install base at once.
      await AsyncStorage.setItem('@datalyr/visitor_id', 'visitor_from_old_build');
      await AsyncStorage.setItem('@datalyr/anonymous_id', 'anon_from_old_build');

      const sdk = createSDK();
      const seen: string[] = [];
      const originalTrack = sdk.track.bind(sdk);
      sdk.track = async (name: string, ...rest: any[]) => { seen.push(name); return originalTrack(name, ...rest); };
      try {
        await sdk.initialize({
          apiKey: 'dk_test', flushInterval: 999999, enableAutoEvents: false,
          enableWebToAppAttribution: false, enableAttribution: false,
        });
        expect(seen).not.toContain('app_install');
        // …and the marker is written, so it can never fire retroactively later.
        expect(await AsyncStorage.getItem('@datalyr/first_launch_time')).not.toBeNull();
      } finally {
        sdk.destroy();
      }
    });

    it('still fires for a genuinely fresh install (no evidence present)', async () => {
      // The guard must not swallow real installs. Storage is empty here, and
      // detectInstall() runs BEFORE the SDK creates its own visitor/anonymous
      // ids — if it ran after, this test would fail.
      const sdk = createSDK();
      const seen: string[] = [];
      const originalTrack = sdk.track.bind(sdk);
      sdk.track = async (name: string, ...rest: any[]) => { seen.push(name); return originalTrack(name, ...rest); };
      try {
        await sdk.initialize({
          apiKey: 'dk_test', flushInterval: 999999, enableAutoEvents: false,
          enableWebToAppAttribution: false, enableAttribution: false,
        });
        expect(seen).toContain('app_install');
      } finally {
        sdk.destroy();
      }
    });
  });
}
