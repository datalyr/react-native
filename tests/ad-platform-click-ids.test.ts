// LinkedIn (li_fat_id), Snapchat (ScCid/sccid → sclid), AppLovin (aleid, alart) and X
// (twclid) click ids: deep-link capture and persistence, the legacy li_click_id read, the
// touch clickIdType for every id, and the web-attribution match response.

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

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AttributionManager,
  attributionManager,
  CLICK_ID_PRIMARY_ORDER,
  WEB_MATCH_PLATFORM_CLICK_IDS,
  presentWebMatchClickIds,
  primaryClickIdType,
} from '../src/attribution';
import { journeyManager } from '../src/journey';
import { DatalyrSDK } from '../src/datalyr-sdk';
import { DatalyrSDKExpo } from '../src/datalyr-sdk-expo';
import { Storage, STORAGE_KEYS } from '../src/utils';

const deepLink = async (mgr: AttributionManager, url: string) => {
  await (mgr as any).handleDeepLink({ url });
  return mgr.getAttributionData();
};

beforeEach(async () => {
  await (AsyncStorage as any).clear();
});

describe('Snapchat: ScCid / sccid / sclid persist as sclid', () => {
  test('ScCid (the param Snap appends) is stored as sclid and persisted', async () => {
    const mgr = new AttributionManager();
    const d = await deepLink(mgr, 'https://app.example.com/p?ScCid=SNAP_1');
    expect(d.sclid).toBe('SNAP_1');
    expect(d.ScCid).toBeUndefined();
    expect(d.sccid).toBeUndefined();
    const saved = await Storage.getItem<any>(STORAGE_KEYS.ATTRIBUTION_DATA);
    expect(saved.sclid).toBe('SNAP_1');
  });

  test('lowercase sccid and canonical sclid are stored as sclid', async () => {
    expect((await deepLink(new AttributionManager(), 'myapp://open?sccid=SNAP_2')).sclid).toBe('SNAP_2');
    expect((await deepLink(new AttributionManager(), 'myapp://open?sclid=SNAP_3')).sclid).toBe('SNAP_3');
  });

  test("Snap's own param wins over sclid when both are present", async () => {
    expect((await deepLink(new AttributionManager(), 'myapp://open?sclid=CANON&ScCid=REAL')).sclid).toBe('REAL');
    expect((await deepLink(new AttributionManager(), 'myapp://open?ScCid=REAL&sclid=CANON')).sclid).toBe('REAL');
  });
});

describe('LinkedIn: li_fat_id kept, legacy li_click_id still read', () => {
  test('li_fat_id is captured and persisted', async () => {
    const mgr = new AttributionManager();
    const d = await deepLink(mgr, 'myapp://open?li_fat_id=LI_FAT&utm_source=linkedin');
    expect(d.li_fat_id).toBe('LI_FAT');
    expect((await Storage.getItem<any>(STORAGE_KEYS.ATTRIBUTION_DATA)).li_fat_id).toBe('LI_FAT');
  });

  test('a legacy li_click_id deep link still fills li_fat_id (unchanged behaviour)', async () => {
    const d = await deepLink(new AttributionManager(), 'myapp://open?li_click_id=LI_OLD');
    expect(d.li_click_id).toBe('LI_OLD');
    expect(d.li_fat_id).toBe('LI_OLD');
  });

  test('a persisted li_click_id-only record fills li_fat_id on load', async () => {
    await Storage.setItem(STORAGE_KEYS.ATTRIBUTION_DATA, { li_click_id: 'LI_STORED', fbclid: 'FB' });
    const mgr = new AttributionManager();
    await mgr.initialize();
    const d = mgr.getAttributionData();
    expect(d.li_fat_id).toBe('LI_STORED');
    expect(d.li_click_id).toBe('LI_STORED');
    expect(d.fbclid).toBe('FB');
  });

  test('a persisted li_fat_id is not replaced by a legacy li_click_id', async () => {
    await Storage.setItem(STORAGE_KEYS.ATTRIBUTION_DATA, { li_click_id: 'OLD', li_fat_id: 'NEW' });
    const mgr = new AttributionManager();
    await mgr.initialize();
    expect(mgr.getAttributionData().li_fat_id).toBe('NEW');
  });
});

describe('AppLovin: aleid / alart', () => {
  test('captured verbatim and persisted', async () => {
    const mgr = new AttributionManager();
    const d = await deepLink(mgr, 'myapp://open?aleid=AbC-123_xyz%3D%3D&alart=Usr_9-Q');
    expect(d.aleid).toBe('AbC-123_xyz==');
    expect(d.alart).toBe('Usr_9-Q');
    const saved = await Storage.getItem<any>(STORAGE_KEYS.ATTRIBUTION_DATA);
    expect(saved.aleid).toBe('AbC-123_xyz==');
    expect(saved.alart).toBe('Usr_9-Q');
  });
});

describe('$deep_link fires for the new ids', () => {
  test.each([
    ['twclid=X1'], ['li_fat_id=L1'], ['ScCid=S1'], ['sccid=S2'], ['sclid=S3'], ['aleid=A1'], ['alart=A2'],
  ])('%s is attributable', async (query) => {
    const mgr = new AttributionManager();
    const seen: Array<Record<string, string>> = [];
    mgr.setDeepLinkHandler((params) => { seen.push(params); });
    await (mgr as any).handleDeepLink({ url: `myapp://open?${query}` });
    expect(seen).toHaveLength(1);
  });

  test('a link with no attribution params still does not fire', async () => {
    const mgr = new AttributionManager();
    const seen: unknown[] = [];
    mgr.setDeepLinkHandler((params) => { seen.push(params); });
    await (mgr as any).handleDeepLink({ url: 'myapp://open?screen=home' });
    expect(seen).toHaveLength(0);
  });
});

describe('clickIdType for every click id', () => {
  test('fbclid > gclid > ttclid precedence is unchanged', () => {
    const all = { fbclid: 'f', gclid: 'g', ttclid: 't', twclid: 'x', aleid: 'a' };
    expect(primaryClickIdType(all)).toBe('fbclid');
    expect(primaryClickIdType({ ...all, fbclid: undefined })).toBe('gclid');
    expect(primaryClickIdType({ ...all, fbclid: undefined, gclid: undefined })).toBe('ttclid');
  });

  test('each click id alone is its own type; alart and nothing give undefined', () => {
    for (const key of CLICK_ID_PRIMARY_ORDER) {
      expect(primaryClickIdType({ [key]: 'v' })).toBe(key);
    }
    expect(primaryClickIdType({ alart: 'app_user' })).toBeUndefined();
    expect(primaryClickIdType({})).toBeUndefined();
  });

  test('new platforms follow the web SDK order, AppLovin last', () => {
    expect(primaryClickIdType({ twclid: 'x', li_fat_id: 'l', sclid: 's', aleid: 'a' })).toBe('twclid');
    expect(primaryClickIdType({ li_fat_id: 'l', sclid: 's', aleid: 'a' })).toBe('li_fat_id');
    expect(primaryClickIdType({ sclid: 's', aleid: 'a' })).toBe('sclid');
  });
});

describe('web-attribution match response', () => {
  /** The API's lookup answer as formatAttributionResponse shapes it: absent ids are null. */
  const lookup = (ids: Record<string, any>) => ({
    visitor_id: 'web_visitor_1', fbclid: null, gclid: null, ttclid: null,
    twclid: null, li_fat_id: null, sclid: null, utm_source: 'linkedin', ...ids,
  });

  test('mergeWebAttribution gap-fills twclid / li_fat_id / sclid / aleid', async () => {
    const mgr = new AttributionManager();
    await mgr.mergeWebAttribution(lookup({ twclid: 'TW_W', li_fat_id: 'LI_W', sclid: 'SC_W', aleid: 'AL_W' }));
    const d = mgr.getAttributionData();
    expect(d.twclid).toBe('TW_W');
    expect(d.li_fat_id).toBe('LI_W');
    expect(d.sclid).toBe('SC_W');
    expect(d.aleid).toBe('AL_W');
    expect(d.fbclid).toBeUndefined();
    const saved = await Storage.getItem<any>(STORAGE_KEYS.ATTRIBUTION_DATA);
    expect(saved.sclid).toBe('SC_W');
  });

  test('device ids are not overwritten; empty slots are filled', async () => {
    const mgr = new AttributionManager();
    await deepLink(mgr, 'myapp://open?twclid=TW_DEVICE&li_fat_id=LI_DEVICE');
    await mgr.mergeWebAttribution(lookup({ twclid: 'TW_WEB', li_fat_id: 'LI_WEB', sclid: 'SC_WEB' }));
    const d = mgr.getAttributionData();
    expect(d.twclid).toBe('TW_DEVICE');
    expect(d.li_fat_id).toBe('LI_DEVICE');
    expect(d.sclid).toBe('SC_WEB');
  });

  test('presentWebMatchClickIds keeps only non-empty strings', () => {
    expect([...WEB_MATCH_PLATFORM_CLICK_IDS]).toEqual(['twclid', 'li_fat_id', 'sclid', 'aleid']);
    expect(presentWebMatchClickIds(lookup({ twclid: 'TW', sclid: '', aleid: 'AL' })))
      .toEqual({ twclid: 'TW', aleid: 'AL' });
    expect(presentWebMatchClickIds(lookup({}))).toEqual({});
    expect(presentWebMatchClickIds(undefined)).toEqual({});
  });
});

// End to end through the deferred IP lookup: the matched response's new ids reach the
// $web_attribution_matched event and the persisted attribution (so every later event).
const DEFERRED_URL = 'https://api.datalyr.com/attribution/deferred-lookup';
const variants: Array<[string, () => any]> = [
  ['bare React Native', () => new DatalyrSDK()],
  ['Expo', () => new DatalyrSDKExpo()],
];

for (const [variant, createSDK] of variants) {
  describe(`${variant} — deferred lookup match carries the new click ids`, () => {
    beforeEach(async () => {
      const { networkStatusManager } = require('../src/network-status');
      networkStatusManager.destroy();
      await attributionManager.clearAttributionData();
      (attributionManager as any).initialized = false;
      (attributionManager as any).isFirstLaunch = false;
      await journeyManager.clearJourney();
      (globalThis as any).fetch = async (url: string) => {
        if (typeof url === 'string' && url.startsWith(DEFERRED_URL)) {
          return {
            ok: true, status: 200,
            json: async () => ({
              found: true,
              attribution: {
                visitor_id: 'web_visitor_1', fbclid: null, gclid: null, ttclid: null,
                twclid: 'TW_MATCH', li_fat_id: 'LI_MATCH', sclid: 'SC_MATCH', aleid: 'AL_MATCH',
                utm_source: 'x', match_window_minutes: 180,
              },
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      };
    });

    it('sends them on $web_attribution_matched and persists them', async () => {
      const sdk = createSDK();
      const trackSpy = jest.spyOn(sdk, 'track');
      try {
        await sdk.initialize({
          apiKey: 'dk_test', flushInterval: 999999, enableAutoEvents: false,
          enableWebToAppAttribution: false,
        });
      } finally {
        sdk.destroy();
      }
      const call = trackSpy.mock.calls.find((c: any[]) => c[0] === '$web_attribution_matched');
      expect(call).toBeDefined();
      const props = call![1] as Record<string, any>;
      expect(props.match_method).toBe('ip');
      expect(props.twclid).toBe('TW_MATCH');
      expect(props.li_fat_id).toBe('LI_MATCH');
      expect(props.sclid).toBe('SC_MATCH');
      expect(props.aleid).toBe('AL_MATCH');

      const d = attributionManager.getAttributionData();
      expect(d.twclid).toBe('TW_MATCH');
      expect(d.li_fat_id).toBe('LI_MATCH');
      expect(d.sclid).toBe('SC_MATCH');
      expect(d.aleid).toBe('AL_MATCH');
    });

    it('records the touch with clickIdType for a new-platform click id', async () => {
      await Storage.setItem(STORAGE_KEYS.ATTRIBUTION_DATA, {
        utm_source: 'linkedin', li_fat_id: 'LI_TOUCH', aleid: 'AL_TOUCH',
      });
      const sdk = createSDK();
      try {
        await sdk.initialize({
          apiKey: 'dk_test', flushInterval: 999999, enableAutoEvents: false,
          enableWebToAppAttribution: false,
        });
      } finally {
        sdk.destroy();
      }
      const touch = journeyManager.getFirstTouch() as any;
      expect(touch.clickIdType).toBe('li_fat_id');
      expect(touch.li_fat_id).toBe('LI_TOUCH');
      expect(touch.aleid).toBe('AL_TOUCH');
    });

    // No utm_source / lyr seeded: a bare click-id link must still record the touch.
    it.each([
      ['li_fat_id'], ['sclid'], ['twclid'], ['aleid'], ['fbclid'], ['ttclid'], ['oppref'], ['msclkid'],
    ])('records a touch for a bare %s link (no utm_source)', async (key) => {
      await Storage.setItem(STORAGE_KEYS.ATTRIBUTION_DATA, { [key]: `${key}_BARE` });
      const sdk = createSDK();
      try {
        await sdk.initialize({
          apiKey: 'dk_test', flushInterval: 999999, enableAutoEvents: false,
          enableWebToAppAttribution: false,
        });
      } finally {
        sdk.destroy();
      }
      const first = journeyManager.getFirstTouch() as any;
      const last = journeyManager.getLastTouch() as any;
      expect(first?.clickIdType).toBe(key);
      expect(last?.clickIdType).toBe(key);
      expect(first?.source).toBeUndefined();
    });

    it('records no touch for an alart-only link (app-user id, not a click)', async () => {
      await Storage.setItem(STORAGE_KEYS.ATTRIBUTION_DATA, { alart: 'APP_USER' });
      const sdk = createSDK();
      try {
        await sdk.initialize({
          apiKey: 'dk_test', flushInterval: 999999, enableAutoEvents: false,
          enableWebToAppAttribution: false,
        });
      } finally {
        sdk.destroy();
      }
      expect(journeyManager.getFirstTouch()).toBeNull();
    });
  });
}

describe('journey gate accepts the new click ids', () => {
  test.each([['twclid'], ['li_fat_id'], ['sclid'], ['aleid']])(
    'recordAttribution stores a %s-only touch',
    async (key) => {
      await journeyManager.clearJourney();
      await journeyManager.recordAttribution('sess_1', { [key]: 'v', clickIdType: key } as any);
      expect((journeyManager.getFirstTouch() as any)?.[key]).toBe('v');
    },
  );

  test('a touch with only an untyped-field click id (oppref) passes via clickIdType', async () => {
    await journeyManager.clearJourney();
    await journeyManager.recordAttribution('sess_1', { clickIdType: 'oppref' } as any);
    expect(journeyManager.getFirstTouch()?.clickIdType).toBe('oppref');
  });
});
