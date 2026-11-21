// FX-047 piece 1 (React Native): events survive temporary errors.
//
// What ingest's /track answers mean (pinned in the monorepo at
// infra/cloudflare/tests/ingest-answer-contract.test.js, commit 2bf7c1af5):
//   200            stored (a repeat eventId also answers 200, success:false "Duplicate")
//   204, no body   filtered on purpose (IP blocklist) — accepted, must not be re-sent
//   400            missing event/identity, unreadable body — final
//   401            key refused — the SDK's existing 10-minute hold, then dead-letter
//   413            too large — parked permanently (existing)
//   429            over the rate limit, Retry-After: 1 (or 60) — try again
//   500            queue outage, dedup claim released so the retry is not a duplicate
//   503            ingest's own fault, Retry-After: 5 — try again
// So: any 2xx is success; 5xx, 429, 408, a timeout or a network error keep the event
// (same eventId, no retry budget spent) and back off, honouring Retry-After; only a final
// 4xx drops it; every event the SDK gives up on is counted.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Storage, STORAGE_KEYS } from '../src/utils';
import { EventQueue } from '../src/event-queue';
import { createHttpClient } from '../src/http-client';
import type { EventPayload } from '../src/types';

const makePayload = (name: string, id = `evt_${name}`): EventPayload => ({
  workspaceId: 'ws_test',
  visitorId: 'anon_test',
  anonymousId: 'anon_test',
  sessionId: 'sess_test',
  eventId: id,
  eventName: name,
  source: 'mobile_app',
  timestamp: new Date(0).toISOString(),
});

type Answer = { status: number; body?: any; retryAfter?: string } | 'network' | 'timeout';
let answers: Answer[] = [];
let sent: any[] = [];

const headers = (a: { retryAfter?: string }) => ({ get: (h: string) => (h.toLowerCase() === 'retry-after' ? a.retryAfter ?? null : null) });

const installFetch = () => {
  (globalThis as any).fetch = (_url: string, init: any) => {
    sent.push(JSON.parse(init.body));
    const a = answers.length > 1 ? answers.shift()! : answers[0];
    if (a === 'network') return Promise.reject(new TypeError('Network request failed'));
    if (a === 'timeout') {
      return new Promise((_res, rej) => init.signal.addEventListener('abort', () => {
        const e = new Error('Aborted'); (e as any).name = 'AbortError'; rej(e);
      }));
    }
    return Promise.resolve({
      ok: a.status >= 200 && a.status < 300,
      status: a.status,
      statusText: '',
      headers: headers(a),
      json: async () => {
        if (a.body === undefined) throw new SyntaxError('Unexpected end of JSON input');
        return a.body;
      },
    });
  };
};

const client = () => createHttpClient('', { apiKey: 'test_key_not_real', maxRetries: 2, retryDelay: 1, timeout: 30 });

const newQueue = async (over: Record<string, number> = {}) => {
  const q = new EventQueue(client(), { maxQueueSize: 100, batchSize: 10, flushInterval: 999999, maxRetryCount: 3, ...over });
  await new Promise((r) => setTimeout(r, 10)); // initializeQueue settles
  return q;
};

/** Enqueue without the immediate drain, then drain once with any backoff skipped. */
const enqueueQuiet = async (q: EventQueue, p: EventPayload) => {
  (q as any).isOnline = false;
  await q.enqueue(p);
  (q as any).isOnline = true;
};
const flushNow = async (q: EventQueue) => {
  (q as any).retryNotBefore = 0;
  await q.flush();
};
const liveQueue = async () => (await Storage.getItem<any[]>(STORAGE_KEYS.EVENT_QUEUE)) || [];
const deadLetters = async () => (await Storage.getItem<any[]>(STORAGE_KEYS.DEAD_LETTER_QUEUE)) || [];
const dropped = async () => (await Storage.getItem<any>(STORAGE_KEYS.DROPPED_EVENT_COUNTS)) || {};

beforeEach(async () => {
  await (AsyncStorage as any).clear();
  answers = [];
  sent = [];
  installFetch();
  jest.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => jest.restoreAllMocks());

describe('HttpClient: what counts as accepted, temporary, or final', () => {
  it('a 2xx with no JSON body (ingest\'s 204) is accepted and sent once', async () => {
    answers = [{ status: 204 }];
    const res = await client().sendEvent(makePayload('purchase'));
    expect(res.success).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('a 503 is retried in-request with the SAME eventId, and stops at the first 2xx', async () => {
    answers = [{ status: 503, body: {}, retryAfter: '0' }, { status: 503, body: {}, retryAfter: '0' }, { status: 200, body: { success: true } }];
    const res = await client().sendEvent(makePayload('purchase', 'evt_fixed_id'));
    expect(res.success).toBe(true);
    expect(sent.map((b) => b.eventId)).toEqual(['evt_fixed_id', 'evt_fixed_id', 'evt_fixed_id']);
  });

  it('a 503 Retry-After longer than the in-request cap is not cut short: one send, the wait goes to the queue', async () => {
    answers = [{ status: 503, body: {}, retryAfter: '120' }];
    const res = await client().sendEvent(makePayload('purchase'));
    expect(sent).toHaveLength(1);
    expect(res).toMatchObject({ success: false, status: 503, transient: true, retryAfterMs: 120000 });
  });

  it.each([
    ['500', { status: 500, body: {} }],
    ['429', { status: 429, body: {}, retryAfter: '0' }],
    ['408', { status: 408, body: {} }],
    ['network error', 'network'],
    ['timeout', 'timeout'],
  ] as Array<[string, Answer]>)('%s is temporary', async (_n, a) => {
    answers = [a];
    const res = await client().sendEvent(makePayload('purchase'));
    expect(res.success).toBe(false);
    expect(res.transient).toBe(true);
    expect(res.rejected).toBeFalsy();
  });

  it.each([400, 403, 404, 415, 422])('%s is a final refusal', async (status) => {
    answers = [{ status, body: {} }];
    const res = await client().sendEvent(makePayload('purchase'));
    expect(sent).toHaveLength(1);
    expect(res).toMatchObject({ success: false, status, rejected: true });
    expect(res.transient).toBeFalsy();
  });
});

describe('EventQueue: kept on temporary errors, dropped only on a final 4xx, every drop counted', () => {
  it.each([
    ['503', { status: 503, body: {}, retryAfter: '0' }],
    ['500', { status: 500, body: {} }],
    ['429', { status: 429, body: {}, retryAfter: '0' }],
    ['network error', 'network'],
    ['timeout', 'timeout'],
  ] as Array<[string, Answer]>)('%s: the event stays queued through more flushes than maxRetryCount, never dead-lettered', async (_n, a) => {
    answers = [a];
    const q = await newQueue({ maxRetryCount: 3 });
    try {
      await enqueueQuiet(q, makePayload('purchase', 'evt_keep'));
      for (let i = 0; i < 6; i++) await flushNow(q);
      const live = await liveQueue();
      expect(live.map((e) => e.payload.eventId)).toEqual(['evt_keep']);
      expect(live[0].retryCount).toBe(0);
      expect(await deadLetters()).toHaveLength(0);
      expect(new Set(sent.map((b) => b.eventId))).toEqual(new Set(['evt_keep']));

      // The outage ends: delivered once, then never re-sent.
      answers = [{ status: 200, body: { success: true } }];
      await flushNow(q);
      const before = sent.length;
      await flushNow(q);
      expect(sent.length).toBe(before);
      expect(await liveQueue()).toHaveLength(0);
    } finally { q.destroy(); }
  });

  it('honours Retry-After at the queue: no send before it passes', async () => {
    answers = [{ status: 503, body: {}, retryAfter: '120' }];
    const q = await newQueue();
    try {
      await enqueueQuiet(q, makePayload('purchase'));
      await q.flush();
      expect(sent).toHaveLength(1);
      expect(q.getStats().retryInMs).toBeGreaterThan(110000);
      await q.flush(); // still inside Retry-After
      expect(sent).toHaveLength(1);
    } finally { q.destroy(); }
  });

  it('backs off between temporary failures (no hammering), exponentially and capped', async () => {
    answers = [{ status: 500, body: {} }];
    const q = await newQueue();
    try {
      await enqueueQuiet(q, makePayload('purchase'));
      await q.flush();
      const first = q.getStats().retryInMs;
      expect(first).toBeGreaterThanOrEqual(3000);
      const sends = sent.length;
      await q.flush();
      expect(sent.length).toBe(sends);
      for (let i = 0; i < 20; i++) await flushNow(q);
      expect(q.getStats().retryInMs).toBeLessThanOrEqual(5 * 60 * 1000);
      expect(q.getStats().retryInMs).toBeGreaterThan(first);
    } finally { q.destroy(); }
  });

  it('a temporary failure stops the drain: the rest of the batch is not sent into the outage', async () => {
    answers = [{ status: 503, body: {}, retryAfter: '0' }];
    const q = await newQueue();
    try {
      for (let i = 0; i < 5; i++) await enqueueQuiet(q, makePayload('e' + i, 'evt_' + i));
      await q.flush();
      expect(new Set(sent.map((b) => b.eventId))).toEqual(new Set(['evt_0']));
      expect(await liveQueue()).toHaveLength(5);
    } finally { q.destroy(); }
  });

  it('a final 4xx drops the event at once (not retried, not dead-lettered) and counts it', async () => {
    answers = [{ status: 400, body: { success: false } }];
    const q = await newQueue();
    try {
      await enqueueQuiet(q, makePayload('bad'));
      await flushNow(q);
      await flushNow(q);
      expect(sent).toHaveLength(1);
      expect(await liveQueue()).toHaveLength(0);
      expect(await deadLetters()).toHaveLength(0);
      expect(await dropped()).toEqual({ rejected: 1 });
      expect(q.getStats().dropped).toEqual({ rejected: 1 });
    } finally { q.destroy(); }
  });

  it('a 2xx with no body removes the event (no re-send)', async () => {
    answers = [{ status: 204 }];
    const q = await newQueue();
    try {
      await enqueueQuiet(q, makePayload('purchase'));
      await flushNow(q);
      await flushNow(q);
      expect(sent).toHaveLength(1);
      expect(await liveQueue()).toHaveLength(0);
    } finally { q.destroy(); }
  });

  it('storage is capped: the queue overflows into the dead-letter store, whose cap drops are counted', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ payload: makePayload('old' + i, 'old_' + i), timestamp: Date.now(), retryCount: 3, replayCount: 3 }));
    const q = await newQueue({ maxQueueSize: 2 });
    try {
      await Storage.setItem(STORAGE_KEYS.DEAD_LETTER_QUEUE, full);
      (q as any).isOnline = false;
      for (let i = 0; i < 5; i++) await q.enqueue(makePayload('e' + i, 'evt_' + i));
      expect(await liveQueue()).toHaveLength(2);
      const dl = await deadLetters();
      expect(dl).toHaveLength(100);
      expect(dl.slice(-3).map((e: any) => e.payload.eventId)).toEqual(['evt_0', 'evt_1', 'evt_2']);
      expect(await dropped()).toEqual({ dead_letter_full: 3 });
    } finally { q.destroy(); }
  });

  it('dead letters past their replay limit or age are counted when they are dropped', async () => {
    await Storage.setItem(STORAGE_KEYS.DEAD_LETTER_QUEUE, [
      { payload: makePayload('a', 'a'), timestamp: Date.now(), retryCount: 3, replayCount: 3 },
      { payload: makePayload('b', 'b'), timestamp: Date.now() - 8 * 24 * 3600 * 1000, retryCount: 3 },
      { payload: makePayload('c', 'c'), timestamp: Date.now(), retryCount: 3 },
    ]);
    answers = [{ status: 200, body: { success: true } }];
    const q = await newQueue();
    try {
      await new Promise((r) => setTimeout(r, 20));
      expect(await dropped()).toEqual({ dead_letter_expired: 2 });
      expect(sent.map((b) => b.eventId)).toEqual(['c']);
    } finally { q.destroy(); }
  });

  it('drop counts survive a relaunch', async () => {
    await Storage.setItem(STORAGE_KEYS.DROPPED_EVENT_COUNTS, { rejected: 4 });
    const q = await newQueue();
    try {
      expect(q.getStats().dropped).toEqual({ rejected: 4 });
    } finally { q.destroy(); }
  });
});
