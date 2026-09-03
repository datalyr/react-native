// Expo config plugin (app.plugin.js). `expo/config-plugins` is mocked so the test needs no
// real Expo dependency: withInfoPlist hands the plugin a `modResults` object seeded from
// config.ios.infoPlist and writes it back, mirroring what the real mod does at prebuild.
jest.mock(
  'expo/config-plugins',
  () => ({
    withInfoPlist: (config: any, action: (c: any) => any) => {
      const ios = config.ios || (config.ios = {});
      const modResults = ios.infoPlist || (ios.infoPlist = {});
      const result = action({ ...config, modResults });
      ios.infoPlist = result.modResults;
      return config;
    },
    createRunOncePlugin: (plugin: any) => plugin,
  }),
  { virtual: true }
);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const withDatalyr = require('../app.plugin.js');

const idsOf = (config: any): string[] =>
  (config.ios.infoPlist.SKAdNetworkItems || []).map((i: any) => i.SKAdNetworkIdentifier);

describe('Expo config plugin (app.plugin.js)', () => {
  test('merges network defaults + explicit ids into SKAdNetworkItems and sets the ATT string', () => {
    const config: any = { ios: { infoPlist: {} } };
    const out = withDatalyr(config, {
      networks: ['meta', 'tiktok', 'apple'],
      skAdNetworkIds: ['custom123.skadnetwork'],
      trackingUsageDescription: 'We measure ad performance.',
      attributionCopyEndpoint: 'https://attribution.example.com/',
      reengagementPostbackCopies: true,
    });
    expect(out.ios.infoPlist.AttributionCopyEndpoint).toBe('https://attribution.example.com');
    expect(out.ios.infoPlist.EligibleForAdAttributionKitReengagementPostbackCopies).toBe(true);

    expect(idsOf(out)).toEqual([
      'v9wttpbfk9.skadnetwork',
      'n38lu8286q.skadnetwork',
      '238da6jt44.skadnetwork',
      '22mmun2rn5.skadnetwork',
      'custom123.skadnetwork',
    ]);
    expect(out.ios.infoPlist.NSUserTrackingUsageDescription).toBe('We measure ad performance.');
  });

  test('dedupes against existing entries (case-insensitive) and never removes them', () => {
    const config: any = {
      ios: {
        infoPlist: {
          SKAdNetworkItems: [
            { SKAdNetworkIdentifier: 'existing00.skadnetwork' },
            { SKAdNetworkIdentifier: 'V9WTTPBFK9.skadnetwork' }, // Meta id, different case
          ],
          NSUserTrackingUsageDescription: 'Already set by the app.',
        },
      },
    };
    const out = withDatalyr(config, {
      networks: ['meta', 'google'],
      skAdNetworkIds: ['cstr6suwn9.skadnetwork'], // duplicates a google default
      trackingUsageDescription: 'Should NOT overwrite.',
    });

    expect(idsOf(out)).toEqual([
      'existing00.skadnetwork',
      'V9WTTPBFK9.skadnetwork', // kept verbatim
      'n38lu8286q.skadnetwork', // only the missing Meta id added
      'cstr6suwn9.skadnetwork',
      '4fzdc2evr5.skadnetwork',
      '4pfyvq9l8r.skadnetwork',
    ]);
    expect(out.ios.infoPlist.NSUserTrackingUsageDescription).toBe('Already set by the app.');
  });

  test('apple contributes no ids; no options leaves the plist untouched; unknown network throws', () => {
    expect(idsOf(withDatalyr({ ios: { infoPlist: {} } }, { networks: ['apple'] }))).toEqual([]);

    const untouched: any = withDatalyr({ ios: { infoPlist: {} } }, {});
    expect(untouched.ios.infoPlist.SKAdNetworkItems).toBeUndefined();
    expect(untouched.ios.infoPlist.NSUserTrackingUsageDescription).toBeUndefined();

    expect(() => withDatalyr({ ios: { infoPlist: {} } }, { networks: ['bing'] })).toThrow(/Unknown network 'bing'/);
  });
});
