// Runtime tests for the 2026-06-03 e2e-review fixes. Exercises the REAL HttpClient +
// EventQueue source (RN native modules mocked via jest moduleNameMapper). Previously the
// SDK had no runtime tests — only tsc.
import { HttpClient } from '../src/http-client';
import { EventQueue } from '../src/event-queue';
import { Storage, STORAGE_KEYS } from '../src/utils';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ConversionValueEncoder, ConversionTemplates } from '../src/ConversionValueEncoder';
import type { EventPayload } from '../src/types';

const makePayload = (name: string, extra: Partial<EventPayload> = {}): EventPayload => ({
  workspaceId: 'ws_1', visitorId: 'vis_1', anonymousId: 'anon_1', sessionId: 'sess_xyz',
  eventId: 'id_' + name, eventName: name, source: 'mobile_app',
  timestamp: '2026-06-03T10:00:00.000Z', ...extra,
});

beforeEach(async () => { await (AsyncStorage as any).clear(); });

describe('wire contract — transformForServerAPI', () => {
  test('session_id is in context (not just properties), version is current, click-ids survive', () => {
    const client = new HttpClient('https://ingest.datalyr.com/track',
      { apiKey: 'dk_test', useServerTracking: true } as any);
    const payload = makePayload('$web_attribution_matched', {
      eventData: { _fbp: 'fb.1.2.3', fbclid: 'fb_abc', revenue: 9.99 } as any,
    });

    const wire = (client as any).transformForServerAPI(payload);

    // IOS-31 equivalent: ingest's server-track handler reads context.session_id.
    expect(wire.context.session_id).toBe('sess_xyz');
    // stale-version fix (was a hardcoded stale '1.7.5'); tracks package version.
    expect(wire.context.version).toBe('1.7.11');
    expect(wire.context.source).toBe('mobile_app');
    // properties still carry sessionId + the eventData (handleServerTrack spreads ...props).
    expect(wire.properties.sessionId).toBe('sess_xyz');
    expect(wire.properties._fbp).toBe('fb.1.2.3');
    expect(wire.properties.fbclid).toBe('fb_abc');
    expect(wire.event).toBe('$web_attribution_matched');
    expect(wire.timestamp).toBe('2026-06-03T10:00:00.000Z');
  });
});

describe('event queue', () => {
  const cfg = { maxQueueSize: 1000, batchSize: 10, flushInterval: 600000, maxRetryCount: 3 };

  test('flush() drains the WHOLE backlog, not just one batchSize batch (drain loop)', async () => {
    const sent: string[] = [];
    const client = { sendEvent: async (p: EventPayload) => { sent.push(p.eventName); return { success: true }; } } as any;
    const q = new EventQueue(client, cfg);
    try {
      q.setOnlineStatus(false);
      for (let i = 0; i < 25; i++) await q.enqueue(makePayload('evt' + i));
      // Set online WITHOUT setOnlineStatus() (which fires its own un-awaited processQueue),
      // so the awaited flush() is the sole drainer and the assertion isn't racing it.
      (q as any).isOnline = true;
      await q.flush();
      expect(sent.length).toBe(25); // all 25 (>2 batches), not 10
    } finally { q.destroy(); }
  });

  test('events that exhaust retries go to the dead-letter store, not silently dropped', async () => {
    const client = { sendEvent: async () => ({ success: false, error: '500' }) } as any;
    const q = new EventQueue(client, { ...cfg, maxRetryCount: 2 });
    try {
      q.setOnlineStatus(false);
      await q.enqueue(makePayload('revenue_evt'));
      (q as any).isOnline = true;
      // Each flush advances retryCount by one (drain loop breaks on no-progress).
      for (let i = 0; i < 4; i++) await q.flush();
      const dl = await Storage.getItem<any[]>(STORAGE_KEYS.DEAD_LETTER_QUEUE);
      expect(Array.isArray(dl)).toBe(true);
      expect(dl!.length).toBe(1);
      expect(dl![0].payload.eventName).toBe('revenue_evt');
      // and it's no longer in the live queue
      const live = await Storage.getItem<any[]>(STORAGE_KEYS.EVENT_QUEUE);
      expect((live || []).length).toBe(0);
    } finally { q.destroy(); }
  });

  test('queue overflow evicts the OLDEST event to dead-letter, not a silent drop', async () => {
    const client = { sendEvent: async () => ({ success: false, error: 'offline' }) } as any;
    const q = new EventQueue(client, { ...cfg, maxQueueSize: 3 });
    try {
      q.setOnlineStatus(false); // stay offline so nothing drains — force pure overflow
      for (let i = 0; i < 5; i++) await q.enqueue(makePayload('evt' + i)); // evt0..evt4
      // Oldest two evicted (queue cap 3) — surfaced + recoverable, NOT silently shifted away.
      const dl = (await Storage.getItem<any[]>(STORAGE_KEYS.DEAD_LETTER_QUEUE)) || [];
      expect(dl.map((e: any) => e.payload.eventName)).toEqual(['evt0', 'evt1']);
      const live = (await Storage.getItem<any[]>(STORAGE_KEYS.EVENT_QUEUE)) || [];
      expect(live.map((e: any) => e.payload.eventName)).toEqual(['evt2', 'evt3', 'evt4']);
    } finally { q.destroy(); }
  });
});

describe('cold-start auth race — an empty API key must NOT 401/dead-letter events', () => {
  const cfg = { maxQueueSize: 1000, batchSize: 10, flushInterval: 600000, maxRetryCount: 3 };
  const keylessClient = () => new HttpClient('https://ingest.datalyr.com/track',
    { apiKey: '', useServerTracking: true, maxRetries: 3, retryDelay: 1, timeout: 1000, debug: false } as any);

  test('HttpClient with no apiKey returns authPending and never hits the network', async () => {
    const fetchSpy = jest.fn();
    (global as any).fetch = fetchSpy;
    const res = await keylessClient().sendEvent(makePayload('session_start'));
    expect(res.success).toBe(false);
    expect((res as any).authPending).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('queue keeps keyless events (no retry burn, no dead-letter), then delivers once the key is set', async () => {
    const fetchSpy = jest.fn();
    (global as any).fetch = fetchSpy;
    const client = keylessClient();
    const q = new EventQueue(client, cfg);
    try {
      q.setOnlineStatus(false);
      await q.enqueue(makePayload('session_start'));
      (q as any).isOnline = true;

      // Repeated flushes while keyless — the exact cold-start condition. Must NOT 401/dead-letter.
      for (let i = 0; i < 5; i++) await q.flush();
      expect(((await Storage.getItem<any[]>(STORAGE_KEYS.DEAD_LETTER_QUEUE)) || []).length).toBe(0);
      const live = (await Storage.getItem<any[]>(STORAGE_KEYS.EVENT_QUEUE)) || [];
      expect(live.length).toBe(1);          // still queued...
      expect(live[0].retryCount).toBe(0);   // ...with retries untouched
      expect(fetchSpy).not.toHaveBeenCalled();

      // Key arrives (initialize() applies it to the SAME client) → event delivers.
      fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
      client.updateConfig({ apiKey: 'dk_real' });
      await q.flush();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(((await Storage.getItem<any[]>(STORAGE_KEYS.EVENT_QUEUE)) || []).length).toBe(0);
    } finally { q.destroy(); }
  });

  test('destroy() is final — a late initializeQueue() cannot revive the orphan timer/queue', async () => {
    const sendEvent = jest.fn(async () => ({ success: true }));
    // A previous session left events behind — what the orphan used to flush with an empty key.
    await Storage.setItem(STORAGE_KEYS.EVENT_QUEUE, [
      { payload: makePayload('session_start'), timestamp: 1, retryCount: 0 },
    ]);
    const q = new EventQueue({ sendEvent } as any, cfg);
    q.destroy();                          // SDK initialize() tears the orphan down...
    await (q as any).initializeQueue();   // ...but its async storage-load resolves afterwards (the race)
    (q as any).isOnline = true;
    await q.flush();
    expect((q as any).queue.length).toBe(0);   // load was rejected
    expect((q as any).flushTimer).toBeNull();  // timer not revived
    expect(sendEvent).not.toHaveBeenCalled();  // leftover never sent
  });
});

describe('SKAN conversion-value encoder (mixed model: 0-63, upward-only safe)', () => {
  const enc = () => new ConversionValueEncoder(ConversionTemplates.ecommerce);

  test('values fit 0-63 and down-funnel events outrank up-funnel (the old bug: signup=63 > purchase)', () => {
    const e = enc();
    const viewItem = e.encode('view_item');
    const signup = e.encode('signup');
    const addToCart = e.encode('add_to_cart');
    const checkout = e.encode('begin_checkout');
    const purchaseLow = e.encode('purchase', { revenue: 0 });
    const purchaseHigh = e.encode('purchase', { revenue: 1000 });

    for (const v of [viewItem, signup, addToCart, checkout, purchaseLow, purchaseHigh]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(63);
    }
    expect(viewItem).toBe(8);
    expect(signup).toBe(16);     // was 63 (bit-6 overflow)
    expect(addToCart).toBe(24);
    expect(checkout).toBe(32);
    expect(purchaseLow).toBe(56);
    expect(purchaseHigh).toBe(63);
    // The invariant the old scheme violated — purchase MUST outrank signup so a signup
    // can't lock the value and block the purchase under SKAN's upward-only revision.
    expect(purchaseLow).toBeGreaterThan(signup);
    expect(viewItem).toBeLessThan(addToCart);
    expect(addToCart).toBeLessThan(checkout);
    expect(checkout).toBeLessThan(purchaseLow);
  });

  test('revenue tier fills the low 3 bits for monetary events', () => {
    const e = enc();
    expect(e.encode('purchase', { revenue: 5 })).toBe(58);    // 56 | tier 2
    expect(e.encode('purchase', { value: 25 })).toBe(60);     // 56 | tier 4 (value alias)
    expect(e.encode('purchase', { revenue: 300 })).toBe(63);  // 56 | tier 7
    expect(e.encode('subscribe', { revenue: 50 })).toBe(53);  // 48 | tier 5
  });

  test('unknown event → 0', () => {
    expect(enc().encode('not_a_real_event')).toBe(0);
  });
});
