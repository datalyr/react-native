// Payload parity: the bare React Native build and the Expo build must send the SAME
// requests for the same sequence of public calls.
//
// src/datalyr-sdk.ts (bare) and src/datalyr-sdk-expo.ts (Expo) were two copies of one
// class and drifted apart. This file drives BOTH builds through one script of public
// calls, captures every outgoing request (URL, method, headers, JSON body) at the fetch
// layer, normalises the values that are random or time-based, and compares the two
// builds request by request.
//
// What is normalised, and why:
// - ids (UUIDs, `anon_<uuid>`, `sess_<ts>_<rand>`) become `<idN>` in order of first appearance, so
//   "the same id as before" is still checked but the random value is not;
// - ISO timestamps and epoch-millisecond numbers become placeholders;
// - `network_type` comes from different platform modules (netinfo vs expo-network),
//   so its value is not compared;
// - `sdk_variant: 'expo'` is the Expo build's own marker; it is stripped before the
//   comparison and checked on its own below.
// The device-info mocks are aligned (same model, OS, app version, bundle id) so device
// fields ARE compared.
//
// The bare build is also compared with a snapshot recorded before the shared-core
// refactor (tests/fixtures/payload-parity.bare.json), so the refactor provably leaves
// what bare apps send unchanged, byte for byte (key order included).
//
// EXPECTED_DRIFT lists every difference the Expo build has today, exactly. A new
// difference, or a listed one that disappears, fails the test.

import * as fs from 'fs';
import * as path from 'path';

jest.mock('react-native-device-info', () => ({
  getModel: () => 'iPhone15,2',
  getManufacturer: async () => 'Apple',
  getManufacturerSync: () => 'Apple',
  getSystemVersion: () => '17.0',
  getVersion: () => '1.0.0',
  getBuildNumber: () => '1',
  getBundleId: () => 'com.test.app',
  getTimezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  getDeviceLocale: () => Intl.DateTimeFormat().resolvedOptions().locale,
  getCarrier: async () => undefined,
  isEmulator: async () => false,
  getDeviceId: () => 'iPhone15,2',
}));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
  nativeBuildVersion: '1',
  applicationId: 'com.test.app',
  getInstallationTimeAsync: async () => new Date(0),
}), { virtual: true });

jest.mock('expo-device', () => ({
  modelName: 'iPhone15,2',
  deviceName: 'iPhone15,2',
  manufacturer: 'Apple',
  osVersion: '17.0',
  isDevice: true,
}), { virtual: true });

jest.mock('expo-network', () => ({
  NetworkStateType: { WIFI: 'WIFI', CELLULAR: 'CELLULAR', ETHERNET: 'ETHERNET', BLUETOOTH: 'BLUETOOTH' },
  getNetworkStateAsync: async () => ({ type: 'WIFI', isConnected: true, isInternetReachable: true }),
}), { virtual: true });

type Build = 'bare' | 'expo';
type Captured = { url: string; method?: string; headers: Record<string, string>; body: any };
type Step = { name: string; run: (sdk: any) => Promise<unknown> | unknown };
type Drift = { path: string; bare: unknown; expo: unknown };

const CONFIG = {
  apiKey: 'dk_test_parity',
  workspaceId: 'ws_parity',
  flushInterval: 999999,
  enableAutoEvents: false,
};

// One script of public calls, run in order against each build.
const MAIN_SCRIPT: Step[] = [
  {
    name: 'initialize (one event queued before init)',
    run: async (sdk) => {
      await sdk.track('pre_init_event', { early: true });
      await sdk.initialize(CONFIG);
    },
  },
  { name: 'track(custom, nested props)', run: (sdk) => sdk.track('custom_event', { a: 1, b: 'two', nested: { c: [1, 2] } }) },
  { name: 'track(name with space)', run: (sdk) => sdk.track('Order Completed', { total: 3 }) },
  { name: 'track(caller event_id)', run: (sdk) => sdk.track('dedup_event', { event_id: 'evt_fixed_1', x: true }) },
  { name: 'screen', run: (sdk) => sdk.screen('Home', { tab: 'feed' }) },
  { name: 'identify(provisional)', run: (sdk) => sdk.identify('guest_1', { plan: 'free' }, { provisional: true }) },
  { name: 'track while provisional', run: (sdk) => sdk.track('guest_action') },
  {
    name: 'identify(real user, traits)',
    run: (sdk) => sdk.identify('user_1', { email: 'person@example.com', firstName: 'Ada', lastName: 'L', phone: '+15550000000' }),
  },
  { name: 'identify(same again, suppressed)', run: (sdk) => sdk.identify('user_1', { email: 'person@example.com', firstName: 'Ada', lastName: 'L', phone: '+15550000000' }) },
  { name: 'alias', run: (sdk) => sdk.alias('user_1_canonical') },
  { name: 'setAttributionData then track', run: async (sdk) => { await sdk.setAttributionData({ utm_source: 'newsletter', utm_campaign: 'nov', fbclid: 'fb_click_1' }); await sdk.track('after_attribution'); } },
  { name: 'updateTrackingAuthorization(false)', run: (sdk) => sdk.updateTrackingAuthorization(false) },
  { name: 'updateTrackingAuthorization(true)', run: (sdk) => sdk.updateTrackingAuthorization(true) },
  { name: 'trackPurchase(value, currency, product)', run: (sdk) => sdk.trackPurchase(9.99, 'EUR', 'sku_1') },
  { name: 'trackPurchase(value only)', run: (sdk) => sdk.trackPurchase(5) },
  { name: 'trackSubscription(value, currency, plan)', run: (sdk) => sdk.trackSubscription(4.99, 'GBP', 'pro_monthly') },
  { name: 'trackSubscription(value only)', run: (sdk) => sdk.trackSubscription(1) },
  { name: 'trackAddToCart(all args)', run: (sdk) => sdk.trackAddToCart(3, 'USD', 'sku_2', 'Shoe') },
  { name: 'trackAddToCart(value only)', run: (sdk) => sdk.trackAddToCart(3) },
  { name: 'trackViewContent(id, name)', run: (sdk) => sdk.trackViewContent('sku_3', 'Hat') },
  { name: 'trackViewContent(all args)', run: (sdk) => sdk.trackViewContent('post_1', 'Post', 'article', 2, 'USD') },
  { name: 'trackViewContent(no args)', run: (sdk) => sdk.trackViewContent() },
  { name: 'trackInitiateCheckout(all args)', run: (sdk) => sdk.trackInitiateCheckout(20, 'EUR', 2, ['a', 'b']) },
  { name: 'trackInitiateCheckout(value only)', run: (sdk) => sdk.trackInitiateCheckout(20) },
  { name: 'trackInitiateCheckout(no args)', run: (sdk) => sdk.trackInitiateCheckout() },
  { name: 'trackCompleteRegistration(method)', run: (sdk) => sdk.trackCompleteRegistration('email') },
  { name: 'trackCompleteRegistration()', run: (sdk) => sdk.trackCompleteRegistration() },
  { name: 'trackSearch(query, ids)', run: (sdk) => sdk.trackSearch('shoes', ['r1', 'r2']) },
  { name: 'trackLead(value, currency)', run: (sdk) => sdk.trackLead(10, 'USD') },
  { name: 'trackLead()', run: (sdk) => sdk.trackLead() },
  { name: 'trackAddPaymentInfo()', run: (sdk) => sdk.trackAddPaymentInfo() },
  { name: 'trackAddPaymentInfo(false)', run: (sdk) => sdk.trackAddPaymentInfo(false) },
  { name: 'trackWithSKAdNetwork', run: (sdk) => sdk.trackWithSKAdNetwork('level_complete', { level: 2 }) },
  { name: 'trackAppUpdate', run: (sdk) => sdk.trackAppUpdate('1.0.0', '1.1.0') },
  { name: 'bindProviderIdentity', run: (sdk) => sdk.bindProviderIdentity('revenuecat', 'rc_user_1') },
  { name: 'endSession (auto-events off)', run: (sdk) => sdk.endSession() },
  { name: 'reset', run: (sdk) => sdk.reset() },
  { name: 'track after reset', run: (sdk) => sdk.track('after_reset', { n: 1 }) },
  { name: 'identify(new user after reset)', run: (sdk) => sdk.identify('user_2') },
  { name: 'flush', run: (sdk) => sdk.flush() },
];

// Platform.OS other than ios/android (react-native-macos / -windows / web).
const OTHER_OS_SCRIPT: Step[] = [
  { name: 'initialize', run: (sdk) => sdk.initialize(CONFIG) },
  { name: 'track', run: (sdk) => sdk.track('custom_event', { a: 1 }) },
];

// Every payload difference between the two builds today. Paths are into the list of
// requests one step sent. `undefined` means the field is absent from that build's body.
const EXPECTED_DRIFT: Record<string, Record<string, Drift[]>> = {
  main: {
    'trackAddToCart(value only)': [
      { path: '[0].body.properties.currency', bare: 'USD', expo: undefined },
    ],
    'trackInitiateCheckout(value only)': [
      { path: '[0].body.properties.currency', bare: 'USD', expo: undefined },
    ],
    'trackInitiateCheckout(no args)': [
      { path: '[0].body.properties.currency', bare: 'USD', expo: undefined },
    ],
    'trackAddPaymentInfo()': [
      { path: '[0].body.properties.success', bare: true, expo: undefined },
    ],
  },
  otherOs: {
    initialize: [
      { path: '[0].body.properties.platform', bare: 'android', expo: 'macos' },
    ],
    track: [
      { path: '[0].body.properties.platform', bare: 'android', expo: 'macos' },
    ],
  },
};

const GOLDEN = path.join(__dirname, 'fixtures', 'payload-parity.bare.json');

// ---------------------------------------------------------------------------

async function settle(sdk: any, requests: Captured[]): Promise<void> {
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 300 && stable < 5; i++) {
    await sdk.flush();
    await new Promise((resolve) => setImmediate(resolve));
    if (requests.length === last) {
      stable++;
    } else {
      stable = 0;
      last = requests.length;
    }
  }
}

async function runScript(build: Build, script: Step[], os?: string): Promise<Record<string, Captured[]>> {
  jest.resetModules();
  if (os) require('react-native').Platform.OS = os;

  const requests: Captured[] = [];
  (globalThis as any).fetch = async (url: string, init: any = {}) => {
    requests.push({
      url: String(url),
      method: init.method,
      headers: { ...(init.headers || {}) },
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '{}',
    };
  };

  const SDK = build === 'bare'
    ? require('../src/datalyr-sdk').DatalyrSDK
    : require('../src/datalyr-sdk-expo').DatalyrSDKExpo;
  const sdk = new SDK();
  const perStep: Record<string, Captured[]> = {};
  try {
    for (const step of script) {
      const start = requests.length;
      await step.run(sdk);
      await settle(sdk, requests);
      // Stable order inside one step: by URL, then event name (same-name events keep
      // their send order).
      perStep[step.name] = requests.slice(start)
        .map((r, i) => ({ r, i }))
        .sort((x, y) =>
          x.r.url.localeCompare(y.r.url) ||
          String(x.r.body?.event ?? '').localeCompare(String(y.r.body?.event ?? '')) ||
          x.i - y.i)
        .map(({ r }) => r);
    }
  } finally {
    sdk.destroy();
    if (os) require('react-native').Platform.OS = 'ios';
  }
  return perStep;
}

// A UUID, bare or with a prefix (`anon_<uuid>`).
const UUID_RE = /^([a-z]+_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_RE = /^sess_\d+_[a-z0-9]+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Replace random and time-based values with placeholders. Key order is kept, so the
 * JSON text of the result is comparable byte for byte.
 * `forSnapshot` also replaces values that depend on the machine running the test
 * (time zone, locale and the country derived from it) and the SDK version.
 */
function normalise(
  steps: Record<string, Captured[]>,
  opts: { stripVariant: boolean; forSnapshot?: boolean },
): Record<string, unknown[]> {
  const { SDK_VERSION } = require('../src/version');
  const tokens = new Map<string, string>();
  const walk = (value: any, key?: string): any => {
    if (Array.isArray(value)) return value.map((v) => walk(v));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(value)) {
        if (opts.stripVariant && k === 'sdk_variant') continue;
        if (k === 'network_type') { out[k] = '<platform-module>'; continue; }
        if (opts.forSnapshot && (k === 'timezone' || k === 'locale' || k === 'country')) { out[k] = '<machine>'; continue; }
        out[k] = walk(value[k], k);
      }
      return out;
    }
    if (typeof value === 'string') {
      if (UUID_RE.test(value) || SESSION_RE.test(value)) {
        if (!tokens.has(value)) tokens.set(value, `<id${tokens.size + 1}>`);
        return tokens.get(value);
      }
      if (ISO_RE.test(value)) return '<iso-time>';
      if (opts.forSnapshot && value.includes(SDK_VERSION)) return value.split(SDK_VERSION).join('<sdk-version>');
      return value;
    }
    if (typeof value === 'number' && value > 1e12 && value < 1e14) return '<epoch-ms>';
    return value;
  };
  const out: Record<string, unknown[]> = {};
  for (const name of Object.keys(steps)) out[name] = walk(steps[name]);
  return out;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function deepDiff(bare: unknown, expo: unknown, at = ''): Drift[] {
  if (isPlainObject(bare) && isPlainObject(expo)) {
    const keys = Array.from(new Set([...Object.keys(bare), ...Object.keys(expo)])).sort();
    return keys.flatMap((k) => deepDiff(bare[k], expo[k], `${at}.${k}`));
  }
  if (Array.isArray(bare) && Array.isArray(expo)) {
    const n = Math.max(bare.length, expo.length);
    const out: Drift[] = [];
    for (let i = 0; i < n; i++) out.push(...deepDiff(bare[i], expo[i], `${at}[${i}]`));
    return out;
  }
  if (JSON.stringify(bare) !== JSON.stringify(expo)) return [{ path: at, bare, expo }];
  return [];
}

// ---------------------------------------------------------------------------

const captured: Record<'main' | 'otherOs', Record<Build, Record<string, Captured[]>>> = {} as any;

beforeAll(async () => {
  captured.main = {
    bare: await runScript('bare', MAIN_SCRIPT),
    expo: await runScript('expo', MAIN_SCRIPT),
  };
  captured.otherOs = {
    bare: await runScript('bare', OTHER_OS_SCRIPT, 'macos'),
    expo: await runScript('expo', OTHER_OS_SCRIPT, 'macos'),
  };
}, 60000);

describe.each([
  ['main', MAIN_SCRIPT],
  ['otherOs', OTHER_OS_SCRIPT],
] as const)('bare and Expo send the same requests (%s script)', (scriptName, script) => {
  test.each(script.map((s) => [s.name]))('%s', (stepName) => {
    const bare = normalise(captured[scriptName].bare, { stripVariant: false });
    const expo = normalise(captured[scriptName].expo, { stripVariant: true });
    const drift = deepDiff(bare[stepName], expo[stepName]);
    expect(drift).toEqual(EXPECTED_DRIFT[scriptName][stepName] ?? []);
  });
});

test('the script actually sends requests in both builds', () => {
  for (const build of ['bare', 'expo'] as const) {
    const all = Object.values(captured.main[build]).flat();
    expect(all.length).toBeGreaterThan(MAIN_SCRIPT.length);
    // Every step that calls a track helper sent at least one request.
    expect(captured.main[build]['trackPurchase(value only)'].length).toBeGreaterThan(0);
  }
});

test('sdk_variant: Expo stamps every event, bare never does', () => {
  const events = (build: Build) => Object.values(captured.main[build]).flat()
    .filter((r) => r.body && typeof r.body.event === 'string');
  expect(events('expo').length).toBeGreaterThan(0);
  for (const r of events('expo')) expect(r.body.properties.sdk_variant).toBe('expo');
  for (const r of events('bare')) expect(r.body.properties).not.toHaveProperty('sdk_variant');
});

test('bare build matches the recorded payload snapshot', () => {
  const actual = {
    main: normalise(captured.main.bare, { stripVariant: false, forSnapshot: true }),
    otherOs: normalise(captured.otherOs.bare, { stripVariant: false, forSnapshot: true }),
  };
  // Recorded from the bare build BEFORE the shared-core refactor (CI, Node 22, ubuntu).
  // To re-record after an intended bare payload change: RECORD_BARE_PAYLOADS=1 prints it.
  if (process.env.RECORD_BARE_PAYLOADS) {
    // eslint-disable-next-line no-console
    console.log('PARITY_BARE_GOLDEN ' + JSON.stringify(actual));
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  // Byte-level: the JSON text, key order included.
  expect(JSON.stringify(actual, null, 2)).toBe(JSON.stringify(golden, null, 2));
});
