// W3: `debug: true` must turn on the SDK's debug logs (debugLog used to print only under
// __DEV__, so the option did nothing in a release build), and SKAdNetwork success
// messages and native-bridge lookup failures must stay quiet unless debug logging is on.
// jest-setup sets __DEV__ = false, i.e. a release build.

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1',
  applicationId: 'com.datalyr.test', getInstallationTimeAsync: async () => new Date(0),
}), { virtual: true });
jest.mock('expo-device', () => ({
  modelName: 'Test Device', deviceName: 'Test Device', manufacturer: 'Test',
  osVersion: '17.0', isDevice: true,
}), { virtual: true });
jest.mock('expo-network', () => ({
  NetworkStateType: { WIFI: 'WIFI' },
  getNetworkStateAsync: async () => ({ type: 'WIFI', isConnected: true }),
}), { virtual: true });

import { DatalyrSDK } from '../src/datalyr-sdk';
import { DatalyrSDKExpo } from '../src/datalyr-sdk-expo';
import { debugLog } from '../src/utils';
import { debugLog as expoDebugLog } from '../src/utils-expo';
import { setDebugLogging, isDebugLogging } from '../src/debug-log';

let log: jest.SpyInstance;

beforeEach(() => {
  (globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  setDebugLogging(false);
  jest.restoreAllMocks();
});

const loggedWith = (text: string) =>
  log.mock.calls.some((args) => String(args[0]).includes(text));

describe('debugLog in a release build', () => {
  it('is silent by default', () => {
    debugLog('quiet-bare');
    expoDebugLog('quiet-expo');
    expect(loggedWith('quiet-bare')).toBe(false);
    expect(loggedWith('quiet-expo')).toBe(false);
  });

  it('prints in both builds when debug logging is on', () => {
    setDebugLogging(true);
    debugLog('loud-bare');
    expoDebugLog('loud-expo');
    expect(loggedWith('loud-bare')).toBe(true);
    expect(loggedWith('loud-expo')).toBe(true);
  });
});

const variants: Array<[string, () => any]> = [
  ['bare React Native', () => new DatalyrSDK()],
  ['Expo', () => new DatalyrSDKExpo()],
];

const CONFIG = {
  apiKey: 'dk_test', flushInterval: 999999, enableAutoEvents: false,
  enableWebToAppAttribution: false,
};

for (const [variant, createSDK] of variants) {
  describe(`${variant} — initialize() and the debug option`, () => {
    it('debug: true turns debug logs on', async () => {
      await createSDK().initialize({ ...CONFIG, debug: true });
      expect(isDebugLogging()).toBe(true);
      debugLog(`after-init-${variant}`);
      expect(loggedWith(`after-init-${variant}`)).toBe(true);
    });

    it('without debug, debug logs stay off', async () => {
      setDebugLogging(true);
      await createSDK().initialize({ ...CONFIG });
      expect(isDebugLogging()).toBe(false);
    });
  });
}

/** Load the native bridges with fake native modules, in a fresh module registry. */
const loadBridges = (fakes: Record<string, any>) => {
  const mods: any = {};
  jest.isolateModules(() => {
    jest.doMock('expo-modules-core', () => ({
      requireNativeModule: (name: string) => {
        if (fakes[name]) return fakes[name];
        throw new Error('native module unavailable (test)');
      },
    }));
    mods.debug = require('../src/debug-log');
    mods.skan = require('../src/native/SKAdNetworkBridge');
    mods.native = require('../src/native/DatalyrNativeBridge');
  });
  jest.dontMock('expo-modules-core');
  return mods;
};

describe('SKAdNetwork success messages', () => {
  const fakeSkan = {
    updateConversionValue: async () => true,
    setPostbackEnvironment: async (environment: string) => ({
      environment, isSandbox: environment === 'sandbox',
    }),
  };

  it('are silent by default', async () => {
    const { skan } = loadBridges({ DatalyrSKAdNetwork: fakeSkan });
    expect(await skan.SKAdNetworkBridge.updateConversionValue(5)).toBe(true);
    await skan.SKAdNetworkBridge.setPostbackEnvironment('sandbox');
    expect(loggedWith('conversion value updated')).toBe(false);
    expect(loggedWith('Postback environment')).toBe(false);
  });

  it('print with debug logging on', async () => {
    const { skan, debug } = loadBridges({ DatalyrSKAdNetwork: fakeSkan });
    debug.setDebugLogging(true);
    await skan.SKAdNetworkBridge.updateConversionValue(5);
    await skan.SKAdNetworkBridge.setPostbackEnvironment('sandbox');
    expect(loggedWith('conversion value updated: 5')).toBe(true);
    expect(loggedWith('Postback environment: sandbox')).toBe(true);
  });
});

describe('native bridge lookup failures', () => {
  const failingNative = {
    getAppleSearchAdsAttribution: async () => { throw new Error('no attribution'); },
    getAdvertiserInfo: async () => { throw new Error('unavailable'); },
  };

  it('return null without console.error', async () => {
    const { native } = loadBridges({ DatalyrNative: failingNative });
    expect(await native.AppleSearchAdsNativeBridge.getAttribution()).toBeNull();
    expect(await native.AdvertiserInfoBridge.getAdvertiserInfo()).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
    expect(loggedWith('Get attribution failed')).toBe(false);
  });

  it('are logged with debug logging on', async () => {
    const { native, debug } = loadBridges({ DatalyrNative: failingNative });
    debug.setDebugLogging(true);
    await native.AppleSearchAdsNativeBridge.getAttribution();
    expect(loggedWith('Get attribution failed')).toBe(true);
  });
});
