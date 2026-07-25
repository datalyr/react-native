// RN-21 — a session that already ended must report that it ended.
//
// Measured 2026-07-25: only **7.3%** of mobile sessions ever emitted
// `session_end` (ws 0980fb33: 106,913 session_start vs 7,782 session_end over 7
// days; 2.6–7.2% on the other three workspaces). Session duration was therefore
// uncomputable for ~93% of sessions, and `session_end` is a customer-facing
// metric — it is listed in lib/reports/metric-catalog.ts.
//
// Cause: `handleSessionTimeout`'s timer only runs while the app is alive, and
// `handleAppForeground`'s end-and-restart path only runs if the user comes back.
// An app backgrounded and then killed left its session in storage, and the next
// launch abandoned it silently.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AutoEventsManager } from '../src/auto-events';

type Tracked = { name: string; props: Record<string, any> };

function makeManager(sessionId: string, onTrack: Tracked[]) {
  return new AutoEventsManager(
    async (name, props) => { onTrack.push({ name, props }); },
    { trackSessions: true, trackScreenViews: false },
    () => sessionId,
  );
}

beforeEach(async () => {
  await (AsyncStorage as any).clear();
});

describe('RN-21 — session_end recovery at launch', () => {
  it('emits session_end for a session abandoned by an app kill', async () => {
    const tracked: Tracked[] = [];
    const startedAt = Date.now() - 90 * 60 * 1000; // 90 min ago
    const lastActivity = startedAt + 5 * 60 * 1000; // active for 5 min, then gone

    await AsyncStorage.setItem('@datalyr/current_session', JSON.stringify({
      sessionId: 'sess_old',
      startTime: startedAt,
      lastActivity,
      screenViews: 3,
      events: 7,
    }));

    const mgr = makeManager('sess_new', tracked);
    await mgr.initialize();

    const names = tracked.map((t) => t.name);
    expect(names).toEqual(['session_end', 'session_start']);

    const end = tracked.find((t) => t.name === 'session_end')!;
    expect(end.props.session_id).toBe('sess_old');
    expect(end.props.pageviews).toBe(3);
    mgr.destroy();
  });

  it('back-dates the recovered session_end instead of inventing a duration', async () => {
    // The whole point: the app may have been closed for days. Both the duration
    // and the event timestamp come from the session's own lastActivity, so a
    // 5-minute session recovered a day later still reports 5 minutes — not 24h.
    const tracked: Tracked[] = [];
    const startedAt = Date.now() - 24 * 60 * 60 * 1000;
    const lastActivity = startedAt + 5 * 60 * 1000;

    await AsyncStorage.setItem('@datalyr/current_session', JSON.stringify({
      sessionId: 'sess_old', startTime: startedAt, lastActivity, screenViews: 1, events: 1,
    }));

    const mgr = makeManager('sess_new', tracked);
    await mgr.initialize();

    const end = tracked.find((t) => t.name === 'session_end')!;
    expect(end.props.duration_seconds).toBe(300);
    expect(end.props.timestamp).toBe(lastActivity);
    mgr.destroy();
  });

  it('does not touch a session that is genuinely still open', async () => {
    // Same canonical id = the 30-minute window has not lapsed. Resuming must
    // stay silent: no session_end, and no duplicate session_start.
    const tracked: Tracked[] = [];
    await AsyncStorage.setItem('@datalyr/current_session', JSON.stringify({
      sessionId: 'sess_live',
      startTime: Date.now() - 60_000,
      lastActivity: Date.now() - 1_000,
      screenViews: 1,
      events: 2,
    }));

    const mgr = makeManager('sess_live', tracked);
    await mgr.initialize();

    expect(tracked.map((t) => t.name)).toEqual([]);
    mgr.destroy();
  });

  it('starts cleanly on a first-ever launch', async () => {
    const tracked: Tracked[] = [];
    const mgr = makeManager('sess_first', tracked);
    await mgr.initialize();

    expect(tracked.map((t) => t.name)).toEqual(['session_start']);
    mgr.destroy();
  });

  it('the recovered session is removed, so it cannot be double-ended', async () => {
    const tracked: Tracked[] = [];
    await AsyncStorage.setItem('@datalyr/current_session', JSON.stringify({
      sessionId: 'sess_old',
      startTime: Date.now() - 7200_000,
      lastActivity: Date.now() - 7000_000,
      screenViews: 0,
      events: 0,
    }));

    const first = makeManager('sess_new', tracked);
    await first.initialize();
    first.destroy();

    // A second launch must not re-emit an end for sess_old.
    const second: Tracked[] = [];
    const mgr2 = makeManager('sess_newer', second);
    await mgr2.initialize();

    // Non-vacuous: the FIRST launch must genuinely have ended sess_old…
    expect(tracked.filter((t) => t.name === 'session_end' && t.props.session_id === 'sess_old'))
      .toHaveLength(1);
    // …and the second must not repeat it.
    const endsForOld = second.filter((t) => t.name === 'session_end' && t.props.session_id === 'sess_old');
    expect(endsForOld).toHaveLength(0);
    mgr2.destroy();
  });

  it('session_start still follows the recovered session_end, in that order', async () => {
    // Ordering matters downstream: an end for the previous session must never
    // arrive after the start of the next one.
    const tracked: Tracked[] = [];
    await AsyncStorage.setItem('@datalyr/current_session', JSON.stringify({
      sessionId: 'sess_old',
      startTime: Date.now() - 7200_000,
      lastActivity: Date.now() - 7000_000,
      screenViews: 0,
      events: 0,
    }));

    const mgr = makeManager('sess_new', tracked);
    await mgr.initialize();

    // Both must be present, or findIndex returns -1 and the ordering assertion
    // passes vacuously on a build that emits no session_end at all.
    expect(tracked.map((t) => t.name)).toContain('session_end');
    expect(tracked.map((t) => t.name)).toContain('session_start');
    expect(tracked.findIndex((t) => t.name === 'session_end'))
      .toBeLessThan(tracked.findIndex((t) => t.name === 'session_start'));
    mgr.destroy();
  });
});
