// Runtime tests for the FULL_STACK_REVIEW_2026-06-10 RN/Expo fixes (FSR-8..FSR-98).
// Exercises the REAL SDK source (utils, attribution, journey, event-queue, http-client,
// network-status, auto-events) under node with RN native modules mocked.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  parseQueryString,
  rotateAnonymousId,
  clearSession,
  getOrCreateSessionId,
  getDeviceInfo,
  clearDeviceInfoCache,
  Storage,
  STORAGE_KEYS,
} from '../src/utils';
import { AttributionManager } from '../src/attribution';
import { JourneyManager } from '../src/journey';
import { EventQueue } from '../src/event-queue';
import { HttpClient } from '../src/http-client';
import { networkStatusManager } from '../src/network-status';
import { AutoEventsManager } from '../src/auto-events';
import { DatalyrSDK } from '../src/datalyr-sdk';
import type { EventPayload } from '../src/types';

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

const makePayload = (name: string, extra: Partial<EventPayload> = {}): EventPayload => ({
  workspaceId: 'ws_1', visitorId: 'vis_1', anonymousId: 'anon_1', sessionId: 'sess_xyz',
  eventId: 'id_' + name + '_' + Math.random().toString(36).slice(2), eventName: name,
  source: 'mobile_app', timestamp: '2026-06-10T10:00:00.000Z', ...extra,
});

beforeEach(async () => { await (AsyncStorage as any).clear(); });

// ---------------------------------------------------------------------------
// FSR-8 — dependency-free query-string parser (RN URL/URLSearchParams throw stubs)
// ---------------------------------------------------------------------------
describe('FSR-8 parseQueryString', () => {
  test('extracts attribution params from a deep link query + fragment', () => {
    const p = parseQueryString('myapp://open?lyr=ABC&fbclid=fb_1&utm_source=meta#gclid=g_1');
    expect(p.lyr).toBe('ABC');
    expect(p.fbclid).toBe('fb_1');
    expect(p.utm_source).toBe('meta');
    expect(p.gclid).toBe('g_1'); // fragment params too
  });

  test('decodes per-component (encoded & / = survive in a value)', () => {
    const p = parseQueryString('x://?utm_campaign=Summer%26Sale&q=a%3Db');
    expect(p.utm_campaign).toBe('Summer&Sale');
    expect(p.q).toBe('a=b');
  });

  test('a stray % only corrupts that one value, not the whole parse', () => {
    const p = parseQueryString('x://?bad=50%off&gclid=g_ok');
    expect(p.gclid).toBe('g_ok'); // other params survive
    expect(p.bad).toBe('50%off'); // raw kept, not dropped
  });

  test('bare query string works', () => {
    expect(parseQueryString('a=1&b=2')).toEqual({ a: '1', b: '2' });
  });

  test('survives even when global URL/URLSearchParams are throwing stubs (RN core)', () => {
    // Mirror Hermes: searchParams getter / URLSearchParams.get throw "not implemented".
    const origURL = (global as any).URL;
    const origUSP = (global as any).URLSearchParams;
    (global as any).URL = function () {
      Object.defineProperty(this, 'searchParams', {
        get() { throw new Error('not implemented'); },
      });
    };
    (global as any).URLSearchParams = function () {
      throw new Error('not implemented');
    };
    try {
      // parseQueryString must NOT touch WHATWG URL — so it still returns the params.
      const p = parseQueryString('app://x?lyr=Z&ttclid=tt_9');
      expect(p.lyr).toBe('Z');
      expect(p.ttclid).toBe('tt_9');
    } finally {
      (global as any).URL = origURL;
      (global as any).URLSearchParams = origUSP;
    }
  });
});

// ---------------------------------------------------------------------------
// FSR-37 — mergeWebAttribution gap-fills gbraid/wbraid/fbp/fbc and persists
// ---------------------------------------------------------------------------
describe('FSR-37 mergeWebAttribution', () => {
  test('merges gbraid/wbraid/fbp/fbc/lyr and awaits the save', async () => {
    const mgr = new AttributionManager();
    await mgr.mergeWebAttribution({
      gbraid: 'gb_1', wbraid: 'wb_1', fbp: 'fbp_1', fbc: 'fbc_1', lyr: 'L1',
      visitor_id: 'wv_1', fbclid: 'fb_1',
    });
    const d = mgr.getAttributionData();
    expect(d.gbraid).toBe('gb_1');
    expect(d.wbraid).toBe('wb_1');
    expect(d.fbp).toBe('fbp_1');
    expect(d._fbp).toBe('fbp_1');
    expect(d.fbc).toBe('fbc_1');
    expect(d._fbc).toBe('fbc_1');
    expect(d.lyr).toBe('L1');
    expect(d.web_visitor_id).toBe('wv_1');
    // persisted (awaited save)
    const saved = await Storage.getItem<any>(STORAGE_KEYS.ATTRIBUTION_DATA);
    expect(saved.gbraid).toBe('gb_1');
  });

  test('gap-fill only: does not overwrite existing device attribution', async () => {
    const mgr = new AttributionManager();
    await mgr.setAttributionData({ fbclid: 'device_fb' });
    await mgr.mergeWebAttribution({ fbclid: 'web_fb', gbraid: 'gb_2' });
    const d = mgr.getAttributionData();
    expect(d.fbclid).toBe('device_fb'); // not clobbered
    expect(d.gbraid).toBe('gb_2');       // filled (was empty)
  });
});

// ---------------------------------------------------------------------------
// FSR-44 — journey records click-id-only attribution
// ---------------------------------------------------------------------------
describe('FSR-44 journey click-id gate', () => {
  test('records first/last touch for a click-id-only deep link (no source/campaign)', async () => {
    const jm = new JourneyManager();
    await jm.initialize();
    await jm.recordAttribution('sess_1', {
      fbclid: 'fb_only', clickIdType: 'fbclid',
    } as any);
    const first = jm.getFirstTouch();
    expect(first).toBeTruthy();
    expect(first?.fbclid).toBe('fb_only');
    expect(jm.getJourney().length).toBe(1);
  });

  test('still skips truly-empty attribution', async () => {
    const jm = new JourneyManager();
    await jm.initialize();
    await jm.recordAttribution('sess_1', {} as any);
    expect(jm.getFirstTouch()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FSR-41 — reset() rotates anonymousId + forces a new session
// ---------------------------------------------------------------------------
describe('FSR-41 reset helpers', () => {
  test('rotateAnonymousId generates+persists a fresh anon id', async () => {
    // The SDK reads anonymousId via raw AsyncStorage (getOrCreateAnonymousId), so
    // rotateAnonymousId persists via raw AsyncStorage too — read it the same way.
    await AsyncStorage.setItem(STORAGE_KEYS.ANONYMOUS_ID, 'anon_old');
    const fresh = await rotateAnonymousId();
    expect(fresh).toMatch(/^anon_/);
    expect(fresh).not.toBe('anon_old');
    expect(await AsyncStorage.getItem(STORAGE_KEYS.ANONYMOUS_ID)).toBe(fresh);
  });

  test('clearSession forces getOrCreateSessionId to create a NEW id', async () => {
    const first = await getOrCreateSessionId();
    await clearSession();
    const second = await getOrCreateSessionId();
    expect(second).not.toBe(first); // not resumed
  });
});

// ---------------------------------------------------------------------------
// FSR-45 — device-info fallback uses real locale + a STABLE persisted deviceId
// ---------------------------------------------------------------------------
describe('FSR-45 device-info fallback', () => {
  test('fallback locale is the runtime locale (not hardcoded en-US) and deviceId is stable', async () => {
    clearDeviceInfoCache();
    const a = await getDeviceInfo();
    clearDeviceInfoCache();
    const b = await getDeviceInfo();
    // Stable across launches (persisted) — the bug regenerated a UUID each call.
    expect(a.deviceId).toBe(b.deviceId);
    // Locale is whatever Intl resolves (typically 'en-US' in CI) OR undefined — but it must
    // come from the runtime, never a literal fabrication. Assert it equals the runtime value.
    const runtime = Intl.DateTimeFormat().resolvedOptions().locale || undefined;
    expect(a.locale).toBe(runtime);
  });
});

// ---------------------------------------------------------------------------
// FSR-42 — 429/408 are retryable; Retry-After honored
// ---------------------------------------------------------------------------
describe('FSR-42 429/408 retryable', () => {
  const client = new HttpClient('https://ingest.datalyr.com/track',
    { apiKey: 'dk', useServerTracking: true, maxRetries: 3, retryDelay: 1 } as any);

  test('shouldRetry returns true for 429 and 408, false for other 4xx', () => {
    expect((client as any).shouldRetry(new Error('HTTP 429: rate limited'))).toBe(true);
    expect((client as any).shouldRetry(new Error('HTTP 408: timeout'))).toBe(true);
    expect((client as any).shouldRetry(new Error('HTTP 400: bad request'))).toBe(false);
    expect((client as any).shouldRetry(new Error('HTTP 401: auth'))).toBe(false);
  });

  test('calculateRetryDelay honors an encoded Retry-After', () => {
    const d = (client as any).calculateRetryDelay(0, new Error('HTTP 429: x retry-after=2000'));
    expect(d).toBeGreaterThanOrEqual(2000);
    expect(d).toBeLessThan(2500);
  });

  test('parseRetryAfter handles delta-seconds', () => {
    expect((client as any).parseRetryAfter('1')).toBe(1000);
    expect((client as any).parseRetryAfter(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FSR-12 — network manager notifies on DERIVED isOnline change (reachability-only)
// ---------------------------------------------------------------------------
describe('FSR-12 network notify on derived isOnline', () => {
  test('reachability-only false→true (isConnected unchanged) notifies listeners', () => {
    const calls: boolean[] = [];
    const unsub = networkStatusManager.subscribe((s) =>
      calls.push(s.isConnected && s.isInternetReachable !== false));
    calls.length = 0; // ignore the immediate initial call

    // isConnected stays true; reachability flips false → true.
    (networkStatusManager as any).updateStateFromNetInfo({ isConnected: true, isInternetReachable: false, type: 'wifi' });
    (networkStatusManager as any).updateStateFromNetInfo({ isConnected: true, isInternetReachable: true, type: 'wifi' });
    unsub();

    // Old code (gated on isConnected only) would NOT have notified at all here.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[calls.length - 1]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FSR-11 / FSR-96 / FSR-97 — dead-letter replay, drain progress, corrupt-entry safety
// ---------------------------------------------------------------------------
class FakeHttp {
  mode: 'ok' | 'fail' = 'ok';
  async sendEvent(_p: any) {
    if (this.mode === 'ok') return { success: true, status: 200 };
    return { success: false, status: 500, error: 'HTTP 500: server error' };
  }
}

describe('FSR-11 dead-letter replay', () => {
  test('replays dead-lettered events on init (retryCount reset, bounded by replayCount)', async () => {
    // Seed a dead-letter store with one event.
    await Storage.setItem(STORAGE_KEYS.DEAD_LETTER_QUEUE, [
      { payload: makePayload('purchase'), timestamp: Date.now(), retryCount: 3 },
    ]);
    const http = new FakeHttp();
    const q = new EventQueue(http as any, { maxQueueSize: 100, batchSize: 10, flushInterval: 999999, maxRetryCount: 3 });
    // initializeQueue() is async (constructor fire-and-forget) — let it settle.
    await new Promise((r) => setTimeout(r, 20));
    const stats = q.getStats();
    // Replayed event was re-enqueued and (online + ok) drained, so queue is empty and the
    // dead-letter store was cleared.
    expect(stats.queueSize).toBe(0);
    expect(await Storage.getItem(STORAGE_KEYS.DEAD_LETTER_QUEUE)).toBeNull();
    q.destroy();
  });

  test('does not replay an event that already exhausted MAX_REPLAYS', async () => {
    await Storage.setItem(STORAGE_KEYS.DEAD_LETTER_QUEUE, [
      { payload: makePayload('old'), timestamp: Date.now(), retryCount: 3, replayCount: 3 },
    ]);
    const q = new EventQueue(new FakeHttp() as any, { maxQueueSize: 100, batchSize: 10, flushInterval: 999999, maxRetryCount: 3 });
    await new Promise((r) => setTimeout(r, 20));
    expect(q.getStats().queueSize).toBe(0); // dropped, not looped
    q.destroy();
  });
});

describe('FSR-97 corrupt queue entry is filtered, not jamming the head', () => {
  test('null / payload-less persisted entries are dropped on load', async () => {
    await Storage.setItem(STORAGE_KEYS.EVENT_QUEUE, [
      null,
      { timestamp: 1 }, // no payload
      { payload: makePayload('good'), timestamp: Date.now(), retryCount: 0 },
    ]);
    const http = new FakeHttp();
    http.mode = 'fail'; // keep events queued so we can inspect
    const q = new EventQueue(http as any, { maxQueueSize: 100, batchSize: 10, flushInterval: 999999, maxRetryCount: 3 });
    await new Promise((r) => setTimeout(r, 20));
    // Only the one valid entry survived the load filter.
    expect(q.getStats().queueSize).toBe(1);
    q.destroy();
  });
});

describe('FSR-96 drain progresses by removals, not total length', () => {
  test('a concurrent enqueue mid-drain does not abort the drain', async () => {
    const http = new FakeHttp(); // all ok
    const q = new EventQueue(http as any, { maxQueueSize: 100, batchSize: 10, flushInterval: 999999, maxRetryCount: 3 });
    await new Promise((r) => setTimeout(r, 10)); // let init settle
    // Enqueue two events; a healthy drain delivers BOTH (old length-based check could strand
    // the second when its enqueue lands during the first's in-flight send).
    await q.enqueue(makePayload('e1'));
    await q.enqueue(makePayload('e2'));
    await q.flush();
    expect(q.getStats().queueSize).toBe(0);
    q.destroy();
  });
});

// ---------------------------------------------------------------------------
// FSR-38 / FSR-39 — session id unification + duration/events correctness
// ---------------------------------------------------------------------------
describe('FSR-38/39 auto-events sessions', () => {
  test('session_start uses the canonical session id from the getter', async () => {
    const events: Array<{ name: string; props: any }> = [];
    const track = async (name: string, props: any) => { events.push({ name, props }); };
    const mgr = new AutoEventsManager(track, { sessionTimeoutMs: 60000 }, () => 'sess_canon');
    await mgr.initialize();
    const start = events.find((e) => e.name === 'session_start');
    expect(start?.props.session_id).toBe('sess_canon');
  });

  test('session_end duration is to lastActivity (excludes background gap) and events counts onEvent()', async () => {
    const events: Array<{ name: string; props: any }> = [];
    const track = async (name: string, props: any) => { events.push({ name, props }); };
    const mgr = new AutoEventsManager(track, { sessionTimeoutMs: 1 }, () => 'sess_dur');
    await mgr.initialize();
    const session = mgr.getCurrentSession()!;
    // Simulate 2 minutes of in-app activity then a long background gap.
    await mgr.onEvent('purchase');
    await mgr.onEvent('view');
    session.startTime = Date.now() - 5 * 60 * 1000;       // started 5 min ago
    session.lastActivity = session.startTime + 2 * 60 * 1000; // last active 2 min in
    await mgr.forceEndSession();
    const end = events.find((e) => e.name === 'session_end')!;
    // duration ~= 2 min (lastActivity - startTime), NOT 5 min (now - startTime).
    expect(end.props.duration_ms).toBe(2 * 60 * 1000);
    expect(end.props.events).toBe(2); // onEvent wired → not always 0
  });
});

// Full-SDK tests share process-wide singletons (attribution/journey/network managers).
// Reset them between tests so leaked state (e.g. a prior network subscription / persisted
// attribution) can't desync the queue's online flag or clobber assertions.
async function resetSingletons() {
  const { networkStatusManager } = require('../src/network-status');
  const { attributionManager } = require('../src/attribution');
  const { journeyManager } = require('../src/journey');
  networkStatusManager.destroy();
  await attributionManager.clearAttributionData();
  (attributionManager as any).initialized = false;
  await journeyManager.clearJourney();
}

// ---------------------------------------------------------------------------
// FSR-9 — destroy() → initialize() → track() works (no permanent brick)
// ---------------------------------------------------------------------------
describe('FSR-9 destroy→initialize lifecycle', () => {
  beforeEach(resetSingletons);

  test('SDK re-initializes after destroy() and tracks again', async () => {
    installFetchCapture();
    const sdk = new DatalyrSDK();
    await sdk.initialize({ apiKey: 'dk_test', flushInterval: 999999, enableAutoEvents: false } as any);
    await sdk.track('first');
    await sdk.flush();
    const countAfterFirst = sentBodies.filter((b) => b?.event === 'first').length;
    expect(countAfterFirst).toBe(1);

    sdk.destroy();

    // Re-initialize — the old bug left `initializing` true forever, so this early-returned
    // and every later track() rotted in the capped pre-init queue.
    await sdk.initialize({ apiKey: 'dk_test', flushInterval: 999999, enableAutoEvents: false } as any);
    await sdk.track('after_reinit');
    await sdk.flush();
    expect(sentBodies.some((b) => b?.event === 'after_reinit')).toBe(true);
    sdk.destroy();
  });
});

// ---------------------------------------------------------------------------
// FSR-10 / FSR-40 — $alias carries the NEW userId and a truthy previousId
// ---------------------------------------------------------------------------
describe('FSR-10/40 $alias identity correctness', () => {
  beforeEach(resetSingletons);

  test('$alias userId is the NEW id even when a previous user is identified', async () => {
    installFetchCapture();
    const sdk = new DatalyrSDK();
    await sdk.initialize({ apiKey: 'dk_test', flushInterval: 999999, enableWebToAppAttribution: false, enableAutoEvents: false } as any);
    // Identify an OLD user first — this sets state.currentUserId.
    await sdk.identify('OLD_USER');
    // Now alias to a NEW id. $alias fires BEFORE the internal identify(NEW).
    await sdk.alias('NEW_USER');
    await sdk.flush();

    const aliasBody = sentBodies.find((b) => b?.event === '$alias');
    expect(aliasBody).toBeTruthy();
    // ingest's link builder reads ed.userId (camelCase). It MUST be the NEW id, not OLD.
    expect(aliasBody.properties.userId).toBe('NEW_USER');
    // previousId must be truthy (server drops the link otherwise).
    expect(aliasBody.properties.previousId).toBeTruthy();
    sdk.destroy();
  });

  test('pre-init alias() ends up with a truthy previousId after replay', async () => {
    installFetchCapture();
    const sdk = new DatalyrSDK();
    // Call alias BEFORE initialize — gets queued in preInitQueue with previousId='' at call time.
    await sdk.alias('NEW_USER_2');
    await sdk.initialize({ apiKey: 'dk_test', flushInterval: 999999, enableWebToAppAttribution: false, enableAutoEvents: false } as any);
    await sdk.flush();

    const aliasBody = sentBodies.find((b) => b?.event === '$alias');
    expect(aliasBody).toBeTruthy();
    expect(aliasBody.properties.userId).toBe('NEW_USER_2');
    // FSR-40: createEventPayload backfills previousId from state.visitorId at payload time.
    expect(aliasBody.properties.previousId).toBeTruthy();
    sdk.destroy();
  });
});

// ---------------------------------------------------------------------------
// FSR-85 — caller-supplied event fields WIN over persisted attribution
// ---------------------------------------------------------------------------
describe('FSR-85 caller fields win over persisted attribution', () => {
  beforeEach(resetSingletons);

  test("track('purchase', { utm_source }) is not clobbered by persisted install attribution", async () => {
    installFetchCapture();
    const sdk = new DatalyrSDK();
    await sdk.initialize({ apiKey: 'dk_test', flushInterval: 999999, enableWebToAppAttribution: false, enableAutoEvents: false } as any);
    // Seed persisted attribution with a different utm_source.
    const { attributionManager } = require('../src/attribution');
    await attributionManager.setAttributionData({ utm_source: 'install_source' });
    await sdk.track('purchase', { utm_source: 'push_campaign' });
    await sdk.flush();
    const body = sentBodies.find((b) => b?.event === 'purchase');
    expect(body.properties.utm_source).toBe('push_campaign'); // caller wins
    sdk.destroy();
  });
});
