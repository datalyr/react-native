// 401 handling: hold events (no retry burned, one loud warning) for a grace window so a key
// rotation or config slip does not dead-letter cold-start events; after the window the
// original permanent-4xx path applies.
import { HttpClient } from '../src/http-client';
import type { EventPayload } from '../src/types';

const payload: EventPayload = {
  workspaceId: 'ws_1', visitorId: 'vis_1', anonymousId: 'anon_1', sessionId: 'sess_xyz',
  eventId: 'id_1', eventName: 'purchase', source: 'mobile_app', timestamp: '2026-09-03T10:00:00.000Z',
};

describe('HTTP 401 → held, not dropped, during the grace window', () => {
  test('returns authPending with one warning, then throws once the window has elapsed', async () => {
    const fetchSpy = jest.fn(async () => ({ ok: false, status: 401, statusText: 'Unauthorized', headers: { get: () => null } }));
    (global as any).fetch = fetchSpy;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const nowSpy = jest.spyOn(Date, 'now');
    try {
      const client = new HttpClient('https://ingest.datalyr.com/track', { apiKey: 'dl_bad', useServerTracking: true } as any);
      nowSpy.mockReturnValue(1_000_000);
      const first = await client.sendEvent(payload);
      expect(first.success).toBe(false);
      expect(first.authPending).toBe(true);
      expect(first.status).toBe(401);
      const second = await client.sendEvent(payload);
      expect(second.authPending).toBe(true);
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('HTTP 401')).length).toBe(1);
      // Past the 10-minute window: permanent client error (queue dead-letters after retries).
      nowSpy.mockReturnValue(1_000_000 + 11 * 60 * 1000);
      const third = await client.sendEvent(payload);
      expect(third.success).toBe(false);
      expect(third.authPending).toBeUndefined();
    } finally {
      warn.mockRestore();
      nowSpy.mockRestore();
    }
  });
});
