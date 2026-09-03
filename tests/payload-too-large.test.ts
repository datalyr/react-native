// 413 handling: a server "payload too large" is permanent — dead-letter immediately (no retry
// budget burned, loud log), mark non-replayable, and never replay it. Plus the client-side
// guard in track(): oversized eventData is dropped before it can ever be enqueued.
jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
  nativeBuildVersion: '1',
  applicationId: 'com.datalyr.test',
  getInstallationTimeAsync: async () => new Date(0),
}), { virtual: true });

jest.mock('expo-device', () => ({
  modelName: 'Test Device',
  deviceName: 'Test Device',
  manufacturer: 'Test',
  osVersion: '17.0',
  isDevice: true,
}), { virtual: true });

import { HttpClient } from '../src/http-client';
import { EventQueue } from '../src/event-queue';
import { Storage, STORAGE_KEYS } from '../src/utils';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EventPayload } from '../src/types';

const makePayload = (name: string, extra: Partial<EventPayload> = {}): EventPayload => ({
  workspaceId: 'ws_1', visitorId: 'vis_1', anonymousId: 'anon_1', sessionId: 'sess_xyz',
  eventId: 'id_' + name, eventName: name, source: 'mobile_app',
  timestamp: '2026-09-03T10:00:00.000Z', ...extra,
});

const cfg = { maxQueueSize: 1000, batchSize: 10, flushInterval: 600000, maxRetryCount: 3 };

beforeEach(async () => { await (AsyncStorage as any).clear(); });

describe('HTTP 413 → permanent dead-letter', () => {
  test('http-client returns payloadTooLarge (no retry) and logs the event + byte size', async () => {
    const fetchSpy = jest.fn(async () => ({ ok: false, status: 413, statusText: 'Payload Too Large', headers: { get: () => null } }));
    (global as any).fetch = fetchSpy;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const client = new HttpClient('https://ingest.datalyr.com/track',
        { apiKey: 'dk_test', useServerTracking: true, maxRetries: 3, retryDelay: 1, timeout: 1000, debug: false });
      const res = await client.sendEvent(makePayload('big_purchase', { eventData: { blob: 'x'.repeat(5000) } as any }));

      expect(res.success).toBe(false);
      expect(res.status).toBe(413);
      expect(res.payloadTooLarge).toBe(true);
      expect(res.bodyBytes).toBeGreaterThan(5000);
      expect(fetchSpy).toHaveBeenCalledTimes(1); // NOT retried
      const line = warn.mock.calls.map((c) => String(c[0])).find((m) => m.includes('413'));
      expect(line).toContain('big_purchase');
      expect(line).toContain(`${res.bodyBytes} bytes`);
    } finally { warn.mockRestore(); }
  });

  test('queue dead-letters a 413 immediately with permanent:true and never replays it', async () => {
    const sendEvent = jest.fn(async (p: EventPayload) =>
      p.eventName === 'too_big'
        ? { success: false, status: 413, error: 'HTTP 413', payloadTooLarge: true, bodyBytes: 250000 }
        : { success: true, status: 200 });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const q = new EventQueue({ sendEvent } as any, cfg);
    try {
      q.setOnlineStatus(false);
      await q.enqueue(makePayload('too_big'));
      await q.enqueue(makePayload('fine'));
      (q as any).isOnline = true;
      await q.flush();

      // Exactly one attempt for the 413 event — no retry budget consumed.
      expect(sendEvent.mock.calls.filter(([p]) => p.eventName === 'too_big').length).toBe(1);
      expect(((await Storage.getItem<any[]>(STORAGE_KEYS.EVENT_QUEUE)) || []).length).toBe(0);

      const dl = (await Storage.getItem<any[]>(STORAGE_KEYS.DEAD_LETTER_QUEUE)) || [];
      expect(dl.length).toBe(1);
      expect(dl[0].payload.eventName).toBe('too_big');
      expect(dl[0].permanent).toBe(true);

      const line = warn.mock.calls.map((c) => String(c[0])).find((m) => m.includes('413'));
      expect(line).toContain('too_big');
      expect(line).toContain('250000 bytes');
    } finally { q.destroy(); warn.mockRestore(); }

    // A fresh queue (cold start) replays the dead-letter store — the permanent entry must
    // NOT come back, while a normal dead-letter entry does.
    await Storage.setItem(STORAGE_KEYS.DEAD_LETTER_QUEUE, [
      { payload: makePayload('too_big'), timestamp: Date.now(), retryCount: 3, permanent: true },
      { payload: makePayload('retry_me'), timestamp: Date.now(), retryCount: 3 },
    ]);
    const replayed: string[] = [];
    const q2 = new EventQueue({ sendEvent: async (p: EventPayload) => { replayed.push(p.eventName); return { success: true }; } } as any, cfg);
    try {
      await new Promise((r) => setTimeout(r, 20)); // let initializeQueue's async load + replay run
      await q2.flush();
      expect(replayed).toEqual(['retry_me']);
    } finally { q2.destroy(); }
  });
});

describe('track() size guard (both entry points)', () => {
  const huge = { blob: 'x'.repeat(200_001) };
  const small = { blob: 'x'.repeat(100) };

  for (const [label, load] of [
    ['bare', () => require('../src/index')],
    ['expo', () => require('../src/expo')],
  ] as const) {
    test(`${label}: eventData over 200_000 bytes is dropped with an errorLog, never enqueued`, async () => {
      jest.resetModules();
      (globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
      const mod = load();
      const Facade = mod.Datalyr;
      await Facade.initialize({ apiKey: 'dk_test', debug: false } as any);

      // Reach the instance behind the static facade to observe enqueue.
      const instance = mod.datalyr || mod.datalyrExpo || mod.default;
      const enqueue = jest.spyOn((instance as any).eventQueue, 'enqueue');
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await Facade.track('huge_event', huge);
        await Facade.track('small_event', small);

        const enqueued = enqueue.mock.calls.map(([p]: any) => p.eventName);
        expect(enqueued).not.toContain('huge_event');
        expect(enqueued).toContain('small_event');
        const dropLines = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('Dropping event') && m.includes('huge_event'));
        expect(dropLines.length).toBe(1);
        expect(dropLines[0]).toMatch(/\d+ bytes/);
      } finally { warn.mockRestore(); enqueue.mockRestore(); }
    });
  }
});
