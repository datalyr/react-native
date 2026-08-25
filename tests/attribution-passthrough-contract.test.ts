// A CLASS of bug, pinned.
//
// Three separate times this codebase has lost attribution at a boundary that
// re-lists fields by hand: the Play referrer's getAttributionData(), the
// webhook handlers' event builders, and the Superwall/RevenueCat attribute
// helpers. Each one parsed or received the data correctly and then dropped it
// while copying it into a fixed-shape object. Nothing failed; the field was
// just absent downstream, which is invisible until someone reads a report.
//
// These tests assert the CONTRACT rather than any one call site: whatever the
// SDK has persisted, the paywall-provider helpers must carry through. Adding a
// field to AttributionData without threading it here now fails a test instead
// of silently degrading a customer's spend join months later.

// The Expo build imports optional peers that are not installed in this repo.
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

import { attributionManager } from '../src/attribution';
import { DatalyrSDK } from '../src/datalyr-sdk';
import { DatalyrSDKExpo } from '../src/datalyr-sdk-expo';

const variants: Array<[string, () => any]> = [
  ['bare React Native', () => new DatalyrSDK()],
  ['Expo', () => new DatalyrSDKExpo()],
];

/** Every field that must survive the hop to a paywall provider. */
const AD_IDENTITY = {
  campaign_id: '6012345678901',
  adset_id: '23851234567890123',
  ad_id: '120244025322880772',
  placement: 'Feed',
  site_source_name: 'ig',
};

beforeEach(async () => {
  await attributionManager.clearAttributionData();
  await attributionManager.setAttributionData({
    utm_source: 'facebook',
    utm_campaign: 'Summer CBO',
    ...AD_IDENTITY,
  });
});

for (const [variant, createSDK] of variants) {
  describe(`${variant} — attribution passthrough contract`, () => {
    it('getSuperwallAttributes carries every ad entity id', () => {
      const attrs = createSDK().getSuperwallAttributes();
      for (const [key, value] of Object.entries(AD_IDENTITY)) {
        expect(attrs[key]).toBe(value);
      }
    });

    it('getRevenueCatAttributes carries every ad entity id', () => {
      const attrs = createSDK().getRevenueCatAttributes();
      for (const [key, value] of Object.entries(AD_IDENTITY)) {
        expect(attrs[key]).toBe(value);
      }
    });

    it('campaign_id survives even though no provider reserved key exists for it', () => {
      // $campaign / `campaign` are the NAME. A conversion that can only be
      // joined by campaign name loses its spend row the moment the buyer
      // renames the campaign — which is the whole reason ids are carried.
      const sdk = createSDK();
      expect(sdk.getRevenueCatAttributes().campaign_id).toBe(AD_IDENTITY.campaign_id);
      expect(sdk.getSuperwallAttributes().campaign_id).toBe(AD_IDENTITY.campaign_id);
    });

    it('emits no key at all for attribution the SDK does not have', async () => {
      // These objects are handed to a third party. An empty-string or "undefined"
      // value would be written onto the customer's subscriber record as if it
      // were real, and would then come back on the webhook as fake attribution.
      await attributionManager.clearAttributionData();
      const attrs = createSDK().getSuperwallAttributes();
      for (const key of Object.keys(AD_IDENTITY)) {
        expect(key in attrs).toBe(false);
      }
    });
  });
}
