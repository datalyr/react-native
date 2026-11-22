// M4: the bare `Datalyr` static facade had no getPlayInstallReferrer(), although the
// instance and the Expo facade did. W5: getDeferredAttributionData() is deprecated but
// must keep working (it always returned null).

import datalyr, { Datalyr } from '../src/datalyr-sdk';
import { playInstallReferrerIntegration } from '../src/integrations/play-install-referrer';

const REFERRER = 'utm_source=google&utm_medium=cpc&utm_campaign=spring&gclid=Cj0KCQ';

const seed = (referrerUrl: string) => {
  (playInstallReferrerIntegration as any).referrerData = {
    referrerUrl,
    referrerClickTimestamp: 1,
    installBeginTimestamp: 2,
    ...(playInstallReferrerIntegration as any)['parseReferrerUrl'].call(
      playInstallReferrerIntegration,
      referrerUrl,
    ),
  };
};

afterEach(() => {
  (playInstallReferrerIntegration as any).referrerData = null;
});

describe('Datalyr.getPlayInstallReferrer (static facade)', () => {
  it('exists on the static facade', () => {
    expect(typeof (Datalyr as any).getPlayInstallReferrer).toBe('function');
  });

  it('returns null when there is no referrer', () => {
    expect(Datalyr.getPlayInstallReferrer()).toBeNull();
  });

  it('returns the same data as the instance method', () => {
    seed(REFERRER);
    const fromFacade = Datalyr.getPlayInstallReferrer();
    expect(fromFacade).toEqual(datalyr.getPlayInstallReferrer());
    expect(fromFacade?.utm_source).toBe('google');
    expect(fromFacade?.gclid).toBe('Cj0KCQ');
  });
});

describe('getDeferredAttributionData (deprecated)', () => {
  it('still works and returns null on the instance and the facade', () => {
    expect(datalyr.getDeferredAttributionData()).toBeNull();
    expect(Datalyr.getDeferredAttributionData()).toBeNull();
  });
});
