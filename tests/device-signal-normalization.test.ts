// `Platform.Version` on Android is the SDK API LEVEL (34), not the marketing
// version (14). The server compares the device signal against a version parsed out
// of the CLICK's user agent, which is always the marketing form — so an API
// level guarantees disagreement on both the exact and the major-version
// comparison, silently killing the strongest corroborating signal for every app
// on the device-info fallback path.

import { Platform } from 'react-native';
import { deviceOsVersion, deviceModelName } from '../src/utils';

describe('device OS version normalization', () => {
  const asPlatform = (os: 'ios' | 'android') => {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  };

  it('maps an Android API level to the marketing version the click reports', () => {
    asPlatform('android');
    // The fallbacks send Platform.Version.toString(); 34 is Android 14.
    expect(deviceOsVersion('34')).toBe('14');
    expect(deviceOsVersion('33')).toBe('13');
    expect(deviceOsVersion('30')).toBe('11');
  });

  it('leaves a real Android marketing version untouched', () => {
    asPlatform('android');
    // react-native-device-info's getSystemVersion already returns this form.
    // Marketing versions in use are all <= 20 and API levels all >= 21, so the
    // ranges cannot be confused.
    expect(deviceOsVersion('14')).toBe('14');
    expect(deviceOsVersion('9')).toBe('9');
    expect(deviceOsVersion('12.1')).toBe('12.1');
  });

  it('omits an unmappable API level rather than sending a wrong one', () => {
    asPlatform('android');
    // An absent signal costs nothing; a mismatched one costs the match.
    expect(deviceOsVersion('99')).toBeUndefined();
    expect(deviceOsVersion(undefined)).toBeUndefined();
  });

  it('never rewrites iOS versions', () => {
    asPlatform('ios');
    expect(deviceOsVersion('17.5')).toBe('17.5');
    expect(deviceOsVersion('26')).toBe('26');
  });
});

describe('device model normalization', () => {
  it('drops the placeholders the device-info fallbacks emit', () => {
    // 'Android' / 'Unknown' can never match a click-side model like SM-S918B;
    // sending them is pure noise in the corroboration score.
    for (const placeholder of ['Android', 'Unknown', 'unknown', 'iPhone', 'Test Device']) {
      expect(deviceModelName(placeholder)).toBeUndefined();
    }
    expect(deviceModelName(undefined)).toBeUndefined();
  });

  it('keeps a real hardware model', () => {
    expect(deviceModelName('SM-S918B')).toBe('SM-S918B');
    expect(deviceModelName('Pixel 8')).toBe('Pixel 8');
    expect(deviceModelName('iPhone 15 Pro')).toBe('iPhone 15 Pro');
  });
});
