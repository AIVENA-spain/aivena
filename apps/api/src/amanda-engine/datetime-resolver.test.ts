import { describe, it, expect } from 'vitest';
import { resolveDatetimePhrase, parseTime, zonedTimeToUtc, wallClockInZone } from './datetime-resolver';

const TZ = 'Europe/Madrid';
// Wednesday 2026-08-26 12:00 Madrid (CEST, UTC+2) = 10:00Z
const NOW = Date.UTC(2026, 7, 26, 10, 0);

describe('zonedTimeToUtc — DST-safe', () => {
  it('handles Madrid summer time (UTC+2)', () => {
    const ms = zonedTimeToUtc(2026, 8, 26, 17, 0, TZ);
    expect(new Date(ms).toISOString()).toBe('2026-08-26T15:00:00.000Z');
  });
  it('handles Madrid winter time (UTC+1)', () => {
    const ms = zonedTimeToUtc(2026, 12, 15, 17, 0, TZ);
    expect(new Date(ms).toISOString()).toBe('2026-12-15T16:00:00.000Z');
  });
  it('round-trips through wallClockInZone', () => {
    const ms = zonedTimeToUtc(2026, 10, 25, 12, 30, TZ);   // DST transition day
    const wc = wallClockInZone(ms, TZ);
    expect([wc.hour, wc.minute, wc.day]).toEqual([12, 30, 25]);
  });
});

describe('parseTime', () => {
  it('parses explicit forms', () => {
    expect(parseTime('at 17:00')).toEqual({ hour: 17, minute: 0 });
    expect(parseTime('5pm works')).toEqual({ hour: 17, minute: 0 });
    expect(parseTime('om 17h')).toEqual({ hour: 17, minute: 0 });
    expect(parseTime('a las 10')).toEqual({ hour: 10, minute: 0 });
  });
  it('flags bare small hours as ambiguous — never guess afternoon (design §4)', () => {
    expect(parseTime('a las 5')).toBe('ambiguous');
    expect(parseTime('at 5')).toBe('ambiguous');
  });
});

describe('resolveDatetimePhrase', () => {
  it('resolves "friday at 17:00" to the coming Friday, Madrid time', () => {
    const r = resolveDatetimePhrase('friday at 17:00', NOW, TZ);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.utcISO).toBe('2026-08-28T15:00:00.000Z');
      expect(r.explicit).toMatchObject({ weekday: 'friday', day: 28, month: 8, hour: 17, minute: 0 });
    }
  });
  it('resolves Spanish: "el viernes a las 17:00"', () => {
    const r = resolveDatetimePhrase('el viernes a las 17:00', NOW, TZ);
    expect(r.ok && r.utcISO).toBe('2026-08-28T15:00:00.000Z');
  });
  it('same weekday with a passed time rolls to NEXT week', () => {
    const r = resolveDatetimePhrase('wednesday at 10:00', NOW, TZ);   // now is Wed 12:00
    expect(r.ok && r.utcISO).toBe('2026-09-02T08:00:00.000Z');
  });
  it('same weekday with a still-future time stays today', () => {
    const r = resolveDatetimePhrase('wednesday at 18:00', NOW, TZ);
    expect(r.ok && r.utcISO).toBe('2026-08-26T16:00:00.000Z');
  });
  it('"mañana" + explicit date forms work', () => {
    expect(resolveDatetimePhrase('manana a las 10:30', NOW, TZ).ok).toBe(true);
    const r = resolveDatetimePhrase('el 30 de agosto a las 11:00', NOW, TZ);
    expect(r.ok && r.utcISO).toBe('2026-08-30T09:00:00.000Z');
    const r2 = resolveDatetimePhrase('30/08 at 11:00', NOW, TZ);
    expect(r2.ok && r2.utcISO).toBe('2026-08-30T09:00:00.000Z');
  });
  it('a past month rolls to next year, never backwards', () => {
    const r = resolveDatetimePhrase('el 3 de junio a las 11:00', NOW, TZ);
    expect(r.ok && r.utcISO).toBe('2027-06-03T09:00:00.000Z');
  });
  it('clarifies instead of guessing', () => {
    expect(resolveDatetimePhrase('friday a las 5', NOW, TZ)).toEqual({ ok: false, reason: 'ambiguous_time' });
    expect(resolveDatetimePhrase('friday', NOW, TZ)).toEqual({ ok: false, reason: 'missing_time' });
    expect(resolveDatetimePhrase('whenever suits', NOW, TZ)).toEqual({ ok: false, reason: 'unparseable' });
  });
  it('rejects resolved times in the past', () => {
    expect(resolveDatetimePhrase('today at 09:00', NOW, TZ)).toEqual({ ok: false, reason: 'past' });
  });
});
