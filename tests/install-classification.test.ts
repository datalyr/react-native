// 1.8.0 — a real install vs an existing user's first launch after an update added the SDK.

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
import { Platform } from 'react-native';
import { DatalyrSDK } from '../src/datalyr-sdk';
import { DatalyrSDKExpo } from '../src/datalyr-sdk-expo';
import { attributionManager, INSTALL_CLASS_KEY } from '../src/attribution';
import { journeyManager } from '../src/journey';
import { classifyInstall, ageBucket, restoredOntoNewInstall, type InstallSignals } from '../src/install-classifier';
import { InstallSignalsBridge } from '../src/native/DatalyrNativeBridge';

const NOW = Date.UTC(2026, 9, 30);
const DAY = 86_400_000;

describe('classifyInstall', () => {
  const ios = (s: InstallSignals, extra: object = {}) => classifyInstall(s, { platform: 'ios', now: NOW, ...extra });
  const android = (s: InstallSignals, extra: object = {}) => classifyInstall(s, { platform: 'android', now: NOW, ...extra });

  it('iOS: update into the SDK is an existing user', () => {
    const c = ios({ ranBefore: true, bundleNewerThanContainer: true, containerCreatedAtMs: NOW - 400 * DAY,
      storeOriginalAppVersion: '201', storeOriginalPurchaseDateMs: NOW - 400 * DAY, currentBuild: '244' });
    expect(c).toEqual({ install_type: 'existing_user', detection_method: 'bundle_vs_container', prior_install_age: '>1y', original_app_version: '201' });
  });

  it('iOS: fresh install of this build is new; reinstall when the account had it earlier', () => {
    expect(ios({ ranBefore: false, containerCreatedAtMs: NOW, storeOriginalAppVersion: '244', storeOriginalPurchaseDateMs: NOW, currentBuild: '244' }).install_type).toBe('new');
    expect(ios({ ranBefore: false, containerCreatedAtMs: NOW, storeOriginalAppVersion: '150', storeOriginalPurchaseDateMs: NOW - 200 * DAY, currentBuild: '244' }))
      .toEqual({ install_type: 'reinstall', detection_method: 'app_transaction', prior_install_age: '30-365d', original_app_version: '150' });
  });

  it('iOS: late SDK start on the first build is new; no store record + ran before is existing', () => {
    expect(ios({ ranBefore: true, bundleNewerThanContainer: false, containerCreatedAtMs: NOW - 2 * DAY,
      storeOriginalAppVersion: '244', storeOriginalPurchaseDateMs: NOW - 2 * DAY, currentBuild: '244' }).install_type).toBe('new');
    expect(ios({ ranBefore: true, containerCreatedAtMs: NOW - 40 * DAY }).install_type).toBe('existing_user');
  });

  it('Android: updated in place and ran before is an existing user', () => {
    expect(android({ ranBefore: true, containerCreatedAtMs: NOW - 90 * DAY, lastUpdateTimeMs: NOW - DAY })).toEqual(
      { install_type: 'existing_user', detection_method: 'package_manager', prior_install_age: '30-365d' });
  });

  it('Android: auto-updated before the first open, preloads and late opens are new', () => {
    expect(android({ ranBefore: false, containerCreatedAtMs: NOW - 3 * DAY, lastUpdateTimeMs: NOW - DAY }).install_type).toBe('new');
    expect(android({ ranBefore: false, containerCreatedAtMs: NOW - 900 * DAY, lastUpdateTimeMs: NOW - 900 * DAY }).install_type).toBe('new');
    expect(android({ ranBefore: true, containerCreatedAtMs: NOW - 60_000, lastUpdateTimeMs: NOW - 60_000 }).install_type).toBe('reinstall');
  });

  it('an earlier run under a day before this process is unknown (sent), not an existing user', () => {
    const start = NOW;
    for (const platform of ['ios', 'android']) {
      const c = classifyInstall({ ranBefore: true, bundleNewerThanContainer: true, containerCreatedAtMs: NOW - DAY / 2,
        lastUpdateTimeMs: NOW - 60 * 60_000, earliestEvidenceMs: NOW - 10 * 60 * 60_000, processStartMs: start },
      { platform, now: NOW });
      expect(c).toEqual({ install_type: 'unknown', detection_method: 'ran_before_recent' });
    }
  });

  it('nothing known is unknown; the hint and prior DATALYR keys win', () => {
    expect(ios({}).install_type).toBe('unknown');
    expect(android({}).install_type).toBe('unknown');
    expect(ios({ ranBefore: false }, { hint: true }).detection_method).toBe('host_hint');
    expect(android({ ranBefore: false }, { priorSdk: true }).detection_method).toBe('prior_sdk');
    expect(ios({ ranBefore: false }, { hint: false }).install_type).toBe('new');
  });

  it('only buckets leave the device', () => {
    expect(ageBucket(NOW - DAY / 2, NOW)).toBe('<1d');
    expect(ageBucket(NOW - 3 * DAY, NOW)).toBe('1-7d');
    expect(ageBucket(undefined, NOW)).toBeUndefined();
    expect(Object.keys(ios({ ranBefore: true, containerCreatedAtMs: NOW - 10 * DAY })).sort())
      .toEqual(['detection_method', 'install_type', 'prior_install_age']);
  });

  it('restoredOntoNewInstall: only a missing no-backup marker on a package installed after the marker time', () => {
    const marker = NOW - 300 * DAY;
    expect(restoredOntoNewInstall({ backupMarkerPresent: false, containerCreatedAtMs: NOW - 60_000 }, marker)).toBe(true);
    expect(restoredOntoNewInstall({ backupMarkerPresent: false, containerCreatedAtMs: NOW - 400 * DAY }, marker)).toBe(false);
    expect(restoredOntoNewInstall({ backupMarkerPresent: true, containerCreatedAtMs: NOW - 60_000 }, marker)).toBe(false);
    expect(restoredOntoNewInstall({ containerCreatedAtMs: NOW - 60_000 }, marker)).toBe(false);
  });
});

const variants: Array<[string, () => any]> = [
  ['bare React Native', () => new DatalyrSDK()],
  ['Expo', () => new DatalyrSDKExpo()],
];

let signals: InstallSignals | null = null;
const live: any[] = [];
let signalReads = 0;
let markerWrites = 0;

beforeEach(async () => {
  await (AsyncStorage as any).clear();
  const { networkStatusManager } = require('../src/network-status');
  networkStatusManager.destroy();
  await attributionManager.clearAttributionData();
  Object.assign(attributionManager as any, {
    initialized: false, isFirstLaunch: false, existingUserFirstLaunch: false, installClassification: null,
  });
  await journeyManager.clearJourney();
  (globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  signals = null;
  signalReads = 0;
  markerWrites = 0;
  jest.spyOn(InstallSignalsBridge, 'getInstallSignals').mockImplementation(async () => { signalReads += 1; return signals; });
  jest.spyOn(InstallSignalsBridge, 'writeInstallMarker').mockImplementation(async () => { markerWrites += 1; });
});

afterEach(() => {
  for (const sdk of live.splice(0)) sdk.destroy();
  jest.restoreAllMocks();
});

async function launch(createSDK: () => any, config: object = {}) {
  const sdk = createSDK();
  live.push(sdk);
  const seen: Array<[string, any]> = [];
  const originalTrack = sdk.track.bind(sdk);
  sdk.track = async (name: string, data?: any) => {
    seen.push([name, data]);
    return originalTrack(name, data);
  };
  await sdk.initialize({ apiKey: 'dk_test', flushInterval: 999999, enableAutoEvents: false,
    enableWebToAppAttribution: false, enableAttribution: false, ...config });
  return seen;
}
const named = (seen: Array<[string, any]>, name: string) => seen.filter(([n]) => n === name).map(([, d]) => d);

for (const [variant, createSDK] of variants) {
  describe(`${variant} — first SDK launch`, () => {
    it('an existing user sends $sdk_first_launch_existing, never app_install, and the lookup is terminal', async () => {
      signals = { ranBefore: true, bundleNewerThanContainer: true, containerCreatedAtMs: Date.now() - 300 * DAY };
      const seen = await launch(createSDK);
      expect(named(seen, 'app_install')).toHaveLength(0);
      const [existing] = named(seen, '$sdk_first_launch_existing');
      expect(existing).toMatchObject({ install_type: 'existing_user', detection_method: 'bundle_vs_container', prior_install_age: '30-365d' });
      expect(await AsyncStorage.getItem('@datalyr/deferred_lookup_resolved')).toBe('true');
      expect(await AsyncStorage.getItem('@datalyr/first_launch_time')).not.toBeNull();
      expect(await AsyncStorage.getItem(INSTALL_CLASS_KEY)).toBeNull();

      Object.assign(attributionManager as any, { existingUserFirstLaunch: false, installClassification: null, isFirstLaunch: false });
      const again = await launch(createSDK);
      expect(named(again, 'app_install')).toHaveLength(0);
      expect(named(again, '$sdk_first_launch_existing')).toHaveLength(0);
    });

    it('a new install is labelled', async () => {
      signals = { ranBefore: false, containerCreatedAtMs: Date.now(), storeOriginalAppVersion: '1', storeOriginalPurchaseDateMs: Date.now(), currentBuild: '1' };
      const seen = await launch(createSDK);
      expect(named(seen, 'app_install')[0]).toMatchObject({ install_type: 'new', detection_method: 'app_transaction' });
      expect(markerWrites).toBeGreaterThan(0);
    });

    it('a stored class is reused after a kill before app_install was queued (fixes the RN-24 race)', async () => {
      // The killed launch classified "new" and created its ids; a fresh read would now
      // see those ids (RN-24) and files from that run.
      await AsyncStorage.setItem(INSTALL_CLASS_KEY, JSON.stringify({ install_type: 'new', detection_method: 'app_transaction' }));
      await AsyncStorage.setItem('@datalyr/visitor_id', 'visitor-from-the-killed-launch');
      signals = { ranBefore: true, bundleNewerThanContainer: true };
      const seen = await launch(createSDK);
      expect(named(seen, 'app_install')[0]).toMatchObject({ install_type: 'new' });
      expect(signalReads).toBe(0);
    });

    it('the host hint is read once and wins', async () => {
      signals = { ranBefore: false };
      let calls = 0;
      const seen = await launch(createSDK, { existingUserHint: () => { calls += 1; return true; } });
      expect(named(seen, '$sdk_first_launch_existing')[0]).toMatchObject({ detection_method: 'host_hint' });
      expect(calls).toBe(1);
    });

    it('an old native module (no signals) keeps sending app_install, labelled unknown', async () => {
      signals = null;
      const seen = await launch(createSDK);
      expect(named(seen, 'app_install')[0]).toMatchObject({ install_type: 'unknown', detection_method: 'none' });
    });
  });
}

describe('Android Auto Backup restore', () => {
  const originalOS = Platform.OS;
  afterEach(() => { (Platform as any).OS = originalOS; });

  it('a restored marker on a fresh install is a reinstall; an upgrade just gets the no-backup marker', async () => {
    (Platform as any).OS = 'android';
    await AsyncStorage.setItem('@datalyr/first_launch_time', JSON.stringify(new Date(Date.now() - 300 * DAY).toISOString()));
    signals = { backupMarkerPresent: false, containerCreatedAtMs: Date.now() - 60_000 };
    await attributionManager.detectInstall();
    expect(attributionManager.isInstall()).toBe(true);
    expect(attributionManager.getInstallClassification()).toEqual({ install_type: 'reinstall', detection_method: 'backup_marker' });

    Object.assign(attributionManager as any, { isFirstLaunch: false, installClassification: null });
    signals = { backupMarkerPresent: false, containerCreatedAtMs: Date.now() - 400 * DAY };
    await attributionManager.detectInstall();
    expect(attributionManager.isInstall()).toBe(false);
    expect(markerWrites).toBe(1);
  });
});
