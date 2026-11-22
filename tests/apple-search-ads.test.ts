// W14: the Apple Search Ads integration — fetch once at init, cache, degrade to null when
// the native module is missing or the lookup fails, and the asa_* fields on events.

/** Load the integration with a fake DatalyrNative module (or none), in a fresh registry. */
const loadIntegration = (opts: { native?: any; os?: string }) => {
  let mod: any;
  jest.isolateModules(() => {
    jest.doMock('expo-modules-core', () => ({
      requireNativeModule: (name: string) => {
        if (name === 'DatalyrNative' && opts.native) return opts.native;
        throw new Error('native module unavailable (test)');
      },
    }));
    if (opts.os) {
      const rn = jest.requireActual('../test-mocks/react-native.js');
      jest.doMock('react-native', () => ({
        ...rn,
        NativeModules: { DatalyrNative: opts.native },
        Platform: { ...rn.Platform, OS: opts.os },
      }));
    }
    mod = require('../src/integrations/apple-search-ads-integration');
  });
  jest.dontMock('expo-modules-core');
  jest.dontMock('react-native');
  return mod.appleSearchAdsIntegration;
};

const ASA = {
  attribution: true,
  orgId: 1, orgName: 'Org',
  campaignId: 100, campaignName: 'Brand',
  adGroupId: 200, adGroupName: 'Exact',
  keywordId: 300, keyword: 'habit tracker',
  clickDate: '2026-11-01T00:00:00Z', conversionType: 'Download', countryOrRegion: 'US',
};

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('Apple Search Ads integration', () => {
  it('fetches attribution at initialize and caches it', async () => {
    const native = { getAppleSearchAdsAttribution: jest.fn().mockResolvedValue(ASA) };
    const asa = loadIntegration({ native });
    await asa.initialize();
    expect(asa.isAvailable()).toBe(true);
    expect(asa.hasFetched()).toBe(true);
    expect(asa.hasAttribution()).toBe(true);
    expect(asa.getAttributionData()).toEqual(ASA);

    expect(await asa.fetchAttribution()).toEqual(ASA);
    expect(native.getAppleSearchAdsAttribution).toHaveBeenCalledTimes(1);
  });

  it('reports no attribution for a user who did not come from a search ad', async () => {
    const native = { getAppleSearchAdsAttribution: jest.fn().mockResolvedValue({ attribution: false }) };
    const asa = loadIntegration({ native });
    await asa.initialize();
    expect(asa.hasAttribution()).toBe(false);
    expect(asa.hasFetched()).toBe(true);
  });

  it('returns null and stops retrying when the lookup fails', async () => {
    const native = { getAppleSearchAdsAttribution: jest.fn().mockRejectedValue(new Error('network')) };
    const asa = loadIntegration({ native });
    await asa.initialize();
    expect(asa.getAttributionData()).toBeNull();
    expect(asa.hasAttribution()).toBe(false);
    expect(asa.hasFetched()).toBe(true);
    await asa.fetchAttribution();
    expect(native.getAppleSearchAdsAttribution).toHaveBeenCalledTimes(1);
  });

  it('is unavailable without the native module', async () => {
    const asa = loadIntegration({});
    await asa.initialize();
    expect(asa.isAvailable()).toBe(false);
    expect(await asa.fetchAttribution()).toBeNull();
    expect(asa.getAttributionData()).toBeNull();
  });

  it('does nothing on Android', async () => {
    const native = { getAppleSearchAdsAttribution: jest.fn().mockResolvedValue(ASA) };
    const asa = loadIntegration({ native, os: 'android' });
    await asa.initialize();
    expect(asa.isAvailable()).toBe(false);
    expect(native.getAppleSearchAdsAttribution).not.toHaveBeenCalled();
  });
});

describe('asa_* fields on events', () => {
  // These use the shared module registry: the SDK reads the integration singleton.
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { DatalyrSDK } = require('../src/datalyr-sdk');
  const { appleSearchAdsIntegration } = require('../src/integrations/apple-search-ads-integration');
  /* eslint-enable @typescript-eslint/no-var-requires */

  const payloadFor = async (attribution: any) => {
    (globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    const sdk = new DatalyrSDK();
    await sdk.initialize({
      apiKey: 'dk_test', flushInterval: 999999, enableAutoEvents: false,
      enableWebToAppAttribution: false,
    });
    (appleSearchAdsIntegration as any).attributionData = attribution;
    return (await (sdk as any).createEventPayload('purchase', { value: 1 })).eventData;
  };

  afterEach(() => {
    (appleSearchAdsIntegration as any).attributionData = null;
  });

  it('adds the campaign, ad group and keyword when the install came from a search ad', async () => {
    const data = await payloadFor(ASA);
    expect(data.asa_attribution).toBe(true);
    expect(data.asa_campaign_id).toBe(100);
    expect(data.asa_campaign_name).toBe('Brand');
    expect(data.asa_adgroup_id).toBe(200);
    expect(data.asa_keyword).toBe('habit tracker');
    expect(data.asa_country_or_region).toBe('US');
  });

  it('adds no asa_* fields otherwise', async () => {
    const data = await payloadFor({ attribution: false });
    expect(Object.keys(data).filter((k) => k.startsWith('asa_'))).toEqual([]);
  });
});
