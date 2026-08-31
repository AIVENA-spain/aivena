import { describe, it, expect } from 'vitest';
import { pickAgent, isOnShift, windowOpen, zonedDayHour, type PingableAgent } from './agent-ping-lib';

const MADRID = 'Europe/Madrid';
const MON_FRI_9_18 = { '1': [9,10,11,12,13,14,15,16,17], '2': [9,10,11,12,13,14,15,16,17],
                       '3': [9,10,11,12,13,14,15,16,17], '4': [9,10,11,12,13,14,15,16,17],
                       '5': [9,10,11,12,13,14,15,16,17] };

const agent = (over: Partial<PingableAgent> = {}): PingableAgent => ({
  id: 'a1', full_name: 'Ana Ruiz', whatsapp_e164: '+34600111222',
  languages: ['es', 'en'], work_hours: MON_FRI_9_18, receives_pings: true,
  status: 'active', last_checkin_at: null, ...over,
});

// 2026-08-31 is a Monday. 10:00 Madrid = 08:00 UTC (CEST, +2).
const MON_10_MADRID = Date.parse('2026-08-31T08:00:00Z');
const MON_21_MADRID = Date.parse('2026-08-31T19:00:00Z');
const SUN_10_MADRID = Date.parse('2026-08-30T08:00:00Z');

describe('zonedDayHour — local time, not the server clock', () => {
  it('reads Madrid local time from a UTC instant', () => {
    expect(zonedDayHour(MON_10_MADRID, MADRID)).toEqual({ day: 1, hour: 10 });
  });
  it('a UTC-midnight instant is still the previous evening in Madrid', () => {
    // 2026-08-31T23:30Z is 01:30 on Tuesday in Madrid — the day must roll.
    expect(zonedDayHour(Date.parse('2026-08-31T23:30:00Z'), MADRID)).toEqual({ day: 2, hour: 1 });
  });
});

describe('isOnShift', () => {
  it('inside the shift', () => expect(isOnShift(agent(), MON_10_MADRID, MADRID)).toBe(true));
  it('after the shift', () => expect(isOnShift(agent(), MON_21_MADRID, MADRID)).toBe(false));
  it('a day they do not work', () => expect(isOnShift(agent(), SUN_10_MADRID, MADRID)).toBe(false));

  it('NO hours set is NOT on shift — never invent a default and text a real person', () => {
    expect(isOnShift(agent({ work_hours: null }), MON_10_MADRID, MADRID)).toBe(false);
    expect(isOnShift(agent({ work_hours: {} }), MON_10_MADRID, MADRID)).toBe(false);
  });
});

describe('windowOpen — the WhatsApp 24h service window', () => {
  it('open just inside the margin', () => {
    const at = MON_10_MADRID;
    expect(windowOpen(agent({ last_checkin_at: new Date(at - 22 * 3600_000).toISOString() }), at)).toBe(true);
  });
  it('closed past the 23h margin, before the true 24h boundary', () => {
    const at = MON_10_MADRID;
    expect(windowOpen(agent({ last_checkin_at: new Date(at - 23.5 * 3600_000).toISOString() }), at)).toBe(false);
  });
  it('never checked in = closed', () => expect(windowOpen(agent(), MON_10_MADRID)).toBe(false));
  it('a corrupt timestamp fails closed', () =>
    expect(windowOpen(agent({ last_checkin_at: 'not-a-date' }), MON_10_MADRID)).toBe(false));
});

describe('pickAgent', () => {
  it('prefers someone who speaks the buyer AND is on shift', () => {
    const es = agent({ id: 'es', full_name: 'Ana', languages: ['es'] });
    const nb = agent({ id: 'nb', full_name: 'Bjorn', languages: ['nb'] });
    const r = pickAgent([es, nb], 'nb', MON_10_MADRID, MADRID);
    expect(r.agent?.id).toBe('nb');
    expect(r.languageCompromise).toBe(false);
  });

  it('NEVER trades away being on shift — that is the roster\'s actual promise', () => {
    const rightLangOffShift = agent({ id: 'nb', languages: ['nb'], work_hours: { '6': [10] } });
    const wrongLangOnShift = agent({ id: 'es', full_name: 'Ana', languages: ['es'] });
    const r = pickAgent([rightLangOffShift, wrongLangOnShift], 'nb', MON_10_MADRID, MADRID);
    expect(r.agent?.id).toBe('es');
    expect(r.languageCompromise).toBe(true);   // flagged, not hidden
  });

  it('nobody on shift → nobody is texted, with the reason', () => {
    const r = pickAgent([agent()], 'es', MON_21_MADRID, MADRID);
    expect(r.agent).toBeNull();
    expect(r.reason).toBe('none_on_shift');
  });

  it('pings switched off is respected', () => {
    const r = pickAgent([agent({ receives_pings: false })], 'es', MON_10_MADRID, MADRID);
    expect(r.agent).toBeNull();
    expect(r.reason).toBe('none_receive_pings');
  });

  it('a removed agent is never picked', () => {
    const r = pickAgent([agent({ status: 'removed' })], 'es', MON_10_MADRID, MADRID);
    expect(r.reason).toBe('no_agents');
  });

  it('spreads the load — fewest pings first, then stable by name', () => {
    const a = agent({ id: 'a', full_name: 'Ana' });
    const b = agent({ id: 'b', full_name: 'Bea' });
    expect(pickAgent([a, b], 'es', MON_10_MADRID, MADRID, { a: 3, b: 1 }).agent?.id).toBe('b');
    // Equal load → deterministic, so the same inputs never pick differently.
    expect(pickAgent([a, b], 'es', MON_10_MADRID, MADRID, {}).agent?.id).toBe('a');
    expect(pickAgent([b, a], 'es', MON_10_MADRID, MADRID, {}).agent?.id).toBe('a');
  });

  it('no agents at all', () => {
    expect(pickAgent([], 'es', MON_10_MADRID, MADRID).reason).toBe('no_agents');
  });
});
