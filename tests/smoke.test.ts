// Full-SDK smoke test. Exercises the REAL Datalyr class end-to-end with the native modules
// ABSENT (the no-native-build / Expo-Go path — the same environment as prod workspace
// 1e9db988). Proves the JS layer initializes and runs every main method WITHOUT THROWING
// across the actual wiring (attribution, journey, auto-events, queue, native-bridge
// degradation). NOT a substitute for a real-device test, but it catches import/wiring/throw
// crashes that the per-module tests don't. Native layer is mocked via jest moduleNameMapper.
import { Datalyr } from '../src/index';

describe('full SDK smoke (no native modules — Expo-Go-style path)', () => {
  test('initialize + track + identify + alias + screen + reset + flush never throw', async () => {
    // No real network: stub fetch so flush()/attribution-lookup resolve.
    (globalThis as any).fetch = async () => ({
      ok: true, status: 200, json: async () => ({}), text: async () => '',
    });

    // `Datalyr` is the documented static facade (import { Datalyr } from '@datalyr/react-native').
    await Datalyr.initialize({ apiKey: 'dk_test', debug: false } as any);

    // The exact methods + the fixes we changed: alias ($alias+userId), trackPurchase
    // (value+revenue), the queue drain on flush.
    await Datalyr.track('custom_event', { foo: 'bar' });
    await Datalyr.trackPurchase(9.99, 'USD');
    await Datalyr.identify('user_1', { email: 'a@b.com' });
    await Datalyr.alias('user_1', 'anon_prev');
    await Datalyr.screen('Home', { tab: 'feed' });
    await Datalyr.flush();
    await Datalyr.reset();

    // Reaching here = the full real code path ran with no native modules and didn't throw.
    expect(true).toBe(true);
  });
});
