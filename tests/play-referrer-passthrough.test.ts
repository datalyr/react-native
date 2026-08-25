// The Play install referrer is the ONE deterministic Android install bridge, so it is
// also the only place an Android install can learn its ad entity ids — and, since the
// edge redirect packs dl_click_id there, its Meta/TikTok click id — without the
// probabilistic IP match. parseReferrerUrl kept these params on referrerData, but
// getAttributionData()'s fixed-shape return dropped them: the deterministic bridge
// delivered names and Google ids while everything else died at that boundary.

import { playInstallReferrerIntegration } from '../src/integrations/play-install-referrer';

/** What the edge worker's appendPlayReferrer actually emits (values pre-encoded). */
const EDGE_REFERRER =
  'dl_click_id=fb.1.123.AbCdEf&dl_click_id_type=fbclid' +
  '&utm_source=facebook&utm_medium=cpc&utm_campaign=Summer%20CBO' +
  '&campaign_id=6012345678901&adset_id=23851234567890123&ad_id=120244025322880772' +
  '&placement=Feed&site_source_name=ig&lyr=summer';

const seed = (referrerUrl: string, extra: Record<string, any> = {}) => {
  (playInstallReferrerIntegration as any).referrerData = {
    referrerUrl,
    referrerClickTimestamp: 1,
    installBeginTimestamp: 2,
    ...(playInstallReferrerIntegration as any)['parseReferrerUrl'].call(
      playInstallReferrerIntegration,
      referrerUrl,
    ),
    ...extra,
  };
};

afterEach(() => {
  (playInstallReferrerIntegration as any).referrerData = null;
});

describe('Play referrer → event attribution passthrough', () => {
  it('forwards the ad entity ids the spend join keys on', () => {
    seed(EDGE_REFERRER);
    const data = playInstallReferrerIntegration.getAttributionData();

    expect(data.campaign_id).toBe('6012345678901');
    expect(data.adset_id).toBe('23851234567890123');
    expect(data.ad_id).toBe('120244025322880772');
    expect(data.placement).toBe('Feed');
    expect(data.site_source_name).toBe('ig');
  });

  it('forwards dl_click_id in the clickId/clickIdType wire shape ingest maps to fbclid', () => {
    seed(EDGE_REFERRER);
    const data = playInstallReferrerIntegration.getAttributionData();

    expect(data.clickId).toBe('fb.1.123.AbCdEf');
    expect(data.clickIdType).toBe('fbclid');
  });

  it('keeps the long-standing keys exactly as they were', () => {
    seed(EDGE_REFERRER);
    const data = playInstallReferrerIntegration.getAttributionData();

    expect(data.utm_source).toBe('facebook');
    expect(data.utm_campaign).toBe('Summer CBO');
    expect(data.install_referrer_url).toBe(EDGE_REFERRER);
    expect(data.attribution_source).toBe('play_install_referrer');
  });

  it('emits NO key for an absent param — an explicit undefined would erase attribution', () => {
    // This object is spread into event payloads AFTER persisted attribution, so
    // `clickId: undefined` from an organic install would wipe a click id the deep
    // link or web bridge already recovered.
    seed('utm_source=google&gclid=Cj0KCQ');
    const data = playInstallReferrerIntegration.getAttributionData();

    expect('clickId' in data).toBe(false);
    expect('clickIdType' in data).toBe(false);
    expect('ad_id' in data).toBe(false);
    expect('campaign_id' in data).toBe(false);
    expect(data.gclid).toBe('Cj0KCQ');
  });
});
