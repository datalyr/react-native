// Runtime tests for the v2 launch-gate RN fixes 9.C.1 (reset() cross-user attribution /
// SKAN bleed) and 9.C.2 (persisted monotonic SKAN high-water guard). Exercises the REAL
// SDK source under node with RN native modules mocked (see jest.config.js).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SKAdNetworkBridge } from '../src/native/SKAdNetworkBridge';
import { attributionManager } from '../src/attribution';
import { DatalyrSDK } from '../src/datalyr-sdk';
import { Storage, STORAGE_KEYS, touchSession, normalizeEventName, validateEventName } from '../src/utils';
import * as ecom from '../src/ecommerce-properties';

const SKAN_FINE = '@datalyr/skan_high_fine';
const SKAN_COARSE = '@datalyr/skan_high_coarse';
const SKAN_LOCKED = '@datalyr/skan_window_locked';
const WEB_CHECKED = 'datalyr_web_attribution_checked';
const FIRST_LAUNCH = '@datalyr/first_launch_time';

const skan = (fineValue: number, coarseValue: 'low' | 'medium' | 'high' = 'low', lockWindow = false) =>
  ({ fineValue, coarseValue, lockWindow, priority: 0 });

// Capture every outbound wire body (transformForServerAPI output) for assertions.
const sentBodies: any[] = [];
function installFetchCapture() {
  sentBodies.length = 0;
  (globalThis as any).fetch = async (_url: string, init?: any) => {
    if (init?.body) {
      try { sentBodies.push(JSON.parse(init.body)); } catch { /* ignore */ }
    }
    return { ok: true, status: 200, json: async () => ({ found: false }), text: async () => '' };
  };
}

async function resetSingletons() {
  const { networkStatusManager } = require('../src/network-status');
  const { journeyManager } = require('../src/journey');
  networkStatusManager.destroy();
  await attributionManager.clearAttributionData();
  (attributionManager as any).initialized = false;
  await journeyManager.clearJourney();
}

beforeEach(async () => {
  await (AsyncStorage as any).clear();
  await resetSingletons();
});

// ---------------------------------------------------------------------------
// 9.C.2 — persisted monotonic SKAN high-water guard
// ---------------------------------------------------------------------------
describe('9.C.2 SKAN high-water guard', () => {
  test('a lower fine value after a higher one is suppressed (SKAN 4 allows decreases)', async () => {
    // begin_checkout-class value sends...
    expect(await SKAdNetworkBridge.applyHighWaterForTest(skan(20, 'medium'))).toBe(true);
    // ...then a view_content-class value must NOT downgrade it.
    expect(await SKAdNetworkBridge.applyHighWaterForTest(skan(3, 'low'))).toBe(false);
    // Equal value is not "higher" either.
    expect(await SKAdNetworkBridge.applyHighWaterForTest(skan(20, 'medium'))).toBe(false);
    // A genuinely higher value still goes out.
    expect(await SKAdNetworkBridge.applyHighWaterForTest(skan(35, 'high'))).toBe(true);
  });

  test('suppressed values do NOT move the stored high-water', async () => {
    await SKAdNetworkBridge.applyHighWaterForTest(skan(20, 'medium'));
    await SKAdNetworkBridge.applyHighWaterForTest(skan(3, 'low'));
    expect(await AsyncStorage.getItem(SKAN_FINE)).toBe('20');
    expect(await AsyncStorage.getItem(SKAN_COARSE)).toBe('1'); // medium rank
  });

  test('coarse rank breaks ties at equal fine value', async () => {
    expect(await SKAdNetworkBridge.applyHighWaterForTest(skan(5, 'low'))).toBe(true);
    expect(await SKAdNetworkBridge.applyHighWaterForTest(skan(5, 'high'))).toBe(true);
    expect(await SKAdNetworkBridge.applyHighWaterForTest(skan(5, 'medium'))).toBe(false);
    expect(await SKAdNetworkBridge.applyHighWaterForTest(skan(5, 'high'))).toBe(false);
  });

  test('state is PERSISTED (survives a relaunch — no in-memory cache to lose)', async () => {
    await SKAdNetworkBridge.applyHighWaterForTest(skan(30, 'high'));
    // The guard state lives only in AsyncStorage; a fresh launch reads these same keys.
    expect(await AsyncStorage.getItem(SKAN_FINE)).toBe('30');
    expect(await AsyncStorage.getItem(SKAN_COARSE)).toBe('2');
    // Simulated "next launch": the comparison still sees 30 and suppresses 10.
    expect(await SKAdNetworkBridge.applyHighWaterForTest(skan(10, 'low'))).toBe(false);
  });

  test('a persisted window-lock suppresses even higher values until reset', async () => {
    expect(await SKAdNetworkBridge.applyHighWaterForTest(skan(10, 'medium', true))).toBe(true);
    expect(await AsyncStorage.getItem(SKAN_LOCKED)).toBe('1');
    expect(await SKAdNetworkBridge.applyHighWaterForTest(skan(60, 'high'))).toBe(false);
    await SKAdNetworkBridge.resetConversionState();
    expect(await SKAdNetworkBridge.applyHighWaterForTest(skan(1, 'low'))).toBe(true);
  });

  test('resetConversionState clears all three persisted keys', async () => {
    await SKAdNetworkBridge.applyHighWaterForTest(skan(40, 'high', true));
    await SKAdNetworkBridge.resetConversionState();
    expect(await AsyncStorage.getItem(SKAN_FINE)).toBeNull();
    expect(await AsyncStorage.getItem(SKAN_COARSE)).toBeNull();
    expect(await AsyncStorage.getItem(SKAN_LOCKED)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9.C.1 — reset() clears attribution + rotates visitorId + SKAN state + marker
// ---------------------------------------------------------------------------
describe('9.C.1 reset() cross-user bleed', () => {
  test('reset clears attribution, rotates visitor id, drops SKAN + web-checked marker, keeps install marker', async () => {
    installFetchCapture();
    const sdk = new DatalyrSDK();
    await sdk.initialize({ apiKey: 'dk_test', flushInterval: 999999, enableAutoEvents: false, enableWebToAppAttribution: false } as any);

    // User A's world: identity, click-id attribution, SKAN high-water, lookup marker.
    await sdk.identify('user_A');
    await attributionManager.setAttributionData({ fbclid: 'FB_A', gclid: 'G_A', utm_source: 'facebook', lyr: 'LYR_A' });
    await SKAdNetworkBridge.applyHighWaterForTest(skan(45, 'high'));
    await Storage.setItem(WEB_CHECKED, ['someemailhash']);

    const visitorBefore = sdk.getStatus().visitorId;
    expect(visitorBefore).toBeTruthy();
    expect(await AsyncStorage.getItem(FIRST_LAUNCH)).toBeTruthy();

    await sdk.reset();

    // Visitor id rotated in state AND in storage (raw string encoding).
    const visitorAfter = sdk.getStatus().visitorId;
    expect(visitorAfter).toBeTruthy();
    expect(visitorAfter).not.toBe(visitorBefore);
    expect(await AsyncStorage.getItem(STORAGE_KEYS.VISITOR_ID)).toBe(visitorAfter);

    // Attribution wiped — memory and storage.
    const attribution = sdk.getAttributionData();
    expect(attribution.fbclid).toBeUndefined();
    expect(attribution.gclid).toBeUndefined();
    expect(attribution.utm_source).toBeUndefined();
    expect(attribution.lyr).toBeUndefined();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.ATTRIBUTION_DATA)).toBeNull();

    // SKAN high-water reset: user B starts a fresh conversion window.
    expect(await AsyncStorage.getItem(SKAN_FINE)).toBeNull();
    expect(await SKAdNetworkBridge.applyHighWaterForTest(skan(2, 'low'))).toBe(true);

    // Web-attribution-checked marker dropped so user B's identify(email) can re-resolve.
    expect(await Storage.getItem(WEB_CHECKED)).toBeNull();

    // Install marker PRESERVED — the next launch must NOT look like a fresh install
    // (that would re-run the deferred IP lookup and re-import user A's web attribution).
    expect(await AsyncStorage.getItem(FIRST_LAUNCH)).toBeTruthy();

    sdk.destroy();
  });

  test("user B's post-reset events carry neither user A's click-ids nor A's visitor id", async () => {
    installFetchCapture();
    const sdk = new DatalyrSDK();
    await sdk.initialize({ apiKey: 'dk_test', flushInterval: 999999, enableAutoEvents: false, enableWebToAppAttribution: false } as any);

    await sdk.identify('user_A');
    await attributionManager.setAttributionData({ fbclid: 'FB_A', utm_source: 'facebook' });
    await sdk.track('a_event');
    await sdk.flush();
    const aBody = sentBodies.find((b) => b?.event === 'a_event');
    expect(aBody.properties.fbclid).toBe('FB_A'); // pre-reset events DO carry it
    const aVisitor = sdk.getStatus().visitorId;

    await sdk.reset();
    await sdk.identify('user_B');
    await sdk.track('b_event');
    await sdk.flush();

    const bBody = sentBodies.find((b) => b?.event === 'b_event');
    expect(bBody).toBeTruthy();
    expect(bBody.properties.fbclid).toBeUndefined();
    expect(bBody.properties.utm_source).toBeUndefined();
    // Wire anonymousId falls back to visitorId only when unset; assert the payload's ids
    // are user B's world, not A's.
    expect(bBody.anonymousId).not.toBe(aBody.anonymousId);
    expect(sdk.getStatus().visitorId).not.toBe(aVisitor);

    sdk.destroy();
  });
});

// ---------------------------------------------------------------------------
// 9.C.2 — REAL send path with a native module present (jest's default mapping
// simulates the no-native world, so this isolates the registry and injects a
// succeeding native module + a device store that outlives "relaunches").
// Keep this describe LAST in the file: it calls jest.resetModules().
// ---------------------------------------------------------------------------
describe('9.C.2 real updatePostbackConversionValue path (native present)', () => {
  test('only increasing values reach the native layer; high-water survives relaunch; reset reopens the window', async () => {
    const device = new Map<string, string>(); // AsyncStorage — persists across relaunches
    const sentToNative: number[] = [];

    const launchApp = (): typeof SKAdNetworkBridge => {
      jest.resetModules(); // fresh module registry = fresh JS world = app relaunch
      jest.doMock('expo-modules-core', () => ({
        requireNativeModule: () => ({
          updatePostbackConversionValue: async (fineValue: number, coarseValue: string, lockWindow: boolean) => {
            sentToNative.push(fineValue);
            return { success: true, framework: 'SKAdNetwork', fineValue, coarseValue, lockWindow };
          },
          isSKAN4Available: async () => true,
        }),
      }));
      jest.doMock('@react-native-async-storage/async-storage', () => ({
        __esModule: true,
        default: {
          getItem: async (k: string) => (device.has(k) ? device.get(k)! : null),
          setItem: async (k: string, v: string) => { device.set(k, v); },
          removeItem: async (k: string) => { device.delete(k); },
        },
      }));
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('../src/native/SKAdNetworkBridge').SKAdNetworkBridge;
    };

    // LAUNCH 1: checkout-level value sends, later view_content-level value must not.
    let Bridge = launchApp();
    expect(await Bridge.updatePostbackConversionValue(skan(20, 'medium'))).toBe(true);
    expect(await Bridge.updatePostbackConversionValue(skan(3, 'low'))).toBe(false);
    expect(await Bridge.updatePostbackConversionValue(skan(40, 'high'))).toBe(true);

    // LAUNCH 2 (restart): the persisted high-water still suppresses lower values.
    Bridge = launchApp();
    expect(await Bridge.updatePostbackConversionValue(skan(10, 'low'))).toBe(false);
    expect(await Bridge.updatePostbackConversionValue(skan(41, 'high'))).toBe(true);

    // reset() (logout) reopens the conversion window for the next user.
    await Bridge.resetConversionState();
    expect(await Bridge.updatePostbackConversionValue(skan(1, 'low'))).toBe(true);

    // The advertiser's SKAN signal only ever saw increasing values (+ the post-reset one).
    expect(sentToNative).toEqual([20, 40, 41, 1]);

    jest.dontMock('expo-modules-core');
    jest.dontMock('@react-native-async-storage/async-storage');
    jest.resetModules();
  });
});

// ---------------------------------------------------------------------------
// TR-08: track() refreshes the stored session-activity time (throttled) so a
// long continuous-foreground stretch doesn't wrongly rotate the session id.
// ---------------------------------------------------------------------------
describe('TR-08: touchSession session-activity refresh', () => {
  test('an immediate second touch is throttled (does not re-write LAST_SESSION_TIME)', async () => {
    // After ANY touch, lastSessionTouchAt is <60s old, so a second touch moments later is
    // always throttled — proving track() won't hammer AsyncStorage on every event. A sentinel
    // we plant between the two calls must survive the second (throttled) call untouched.
    await touchSession();
    await AsyncStorage.setItem(STORAGE_KEYS.LAST_SESSION_TIME, 'SENTINEL');
    await touchSession();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.LAST_SESSION_TIME)).toBe('SENTINEL');
  });
});

// ---------------------------------------------------------------------------
// TR-20(a): event-name validation is unified across bare + Expo — spaces are
// normalized to underscores (not silently dropped) and the fleet charset applies.
// ---------------------------------------------------------------------------
describe('TR-20 event-name normalization + fleet-charset validation', () => {
  test('spaces normalize to underscores (was: accepted on bare, DROPPED on Expo)', () => {
    expect(normalizeEventName('Order Completed')).toBe('Order_Completed');
    expect(validateEventName(normalizeEventName('Order Completed'))).toBe(true);
  });

  test('$-prefixed system events + dots/hyphens are valid', () => {
    expect(validateEventName('$identify')).toBe(true);
    expect(validateEventName('screen.view-1')).toBe(true);
  });

  test('empty, over-long, and illegal-charset names are rejected', () => {
    expect(validateEventName('')).toBe(false);
    expect(validateEventName('a'.repeat(101))).toBe(false);
    expect(validateEventName('emoji_🎉')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TR-20(c) / A3-14c: e-commerce property builders are a SINGLE shared module
// imported by BOTH bare + Expo, so the two entry points emit one shape. Each
// builder emits the canonical Meta key AND the legacy alias (emit-both, like
// the web SDK's utm_* / FSR-13) so dashboards keyed on either spelling work.
// ---------------------------------------------------------------------------
describe('TR-20c shared e-commerce property builders (bare/Expo parity)', () => {
  test('addToCart emits content_id/content_name (canonical) + product_id/product_name (alias)', () => {
    const p = ecom.addToCartProperties(19.99, 'USD', 'SKU1', 'Widget');
    expect(p).toMatchObject({
      value: 19.99, currency: 'USD',
      content_id: 'SKU1', product_id: 'SKU1',
      content_name: 'Widget', product_name: 'Widget',
    });
  });

  test('initiateCheckout emits content_ids (canonical) + product_ids (alias)', () => {
    const p = ecom.initiateCheckoutProperties(50, 'USD', 3, ['a', 'b']);
    expect(p.content_ids).toEqual(['a', 'b']);
    expect(p.product_ids).toEqual(['a', 'b']);
    expect(p.num_items).toBe(3);
  });

  test('completeRegistration emits registration_method (Meta canonical) + method (alias)', () => {
    const p = ecom.completeRegistrationProperties('google');
    expect(p.registration_method).toBe('google');
    expect(p.method).toBe('google');
  });

  test('search emits search_string/content_ids (canonical) + query/result_ids (alias)', () => {
    const p = ecom.searchProperties('blue shoes', ['x', 'y']);
    expect(p.search_string).toBe('blue shoes');
    expect(p.query).toBe('blue shoes');
    expect(p.content_ids).toEqual(['x', 'y']);
    expect(p.result_ids).toEqual(['x', 'y']);
  });

  test('viewContent defaults content_type to "product" (was: bare defaulted, Expo did not)', () => {
    expect(ecom.viewContentProperties('SKU1').content_type).toBe('product');
    expect(ecom.viewContentProperties('SKU1', 'Widget', 'category').content_type).toBe('category');
  });

  test('purchase emits value+revenue and product_id+content_id, no $0 hole', () => {
    const p = ecom.purchaseProperties(42, 'EUR', 'SKU9');
    expect(p.value).toBe(42);
    expect(p.revenue).toBe(42);
    expect(p.currency).toBe('EUR');
    expect(p.product_id).toBe('SKU9');
    expect(p.content_id).toBe('SKU9');
  });

  test('optional ids are omitted, not emitted as undefined keys', () => {
    expect('content_id' in ecom.addToCartProperties(5, 'USD')).toBe(false);
    expect('content_ids' in ecom.initiateCheckoutProperties(5, 'USD')).toBe(false);
    expect('method' in ecom.completeRegistrationProperties()).toBe(false);
  });
});
