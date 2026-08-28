import { describe, it, expect } from 'vitest';
import { candidateSlots, parseAmandaSettings, upcomingCalendarNotes } from './availability-lib';
import { wallClockInZone } from './datetime-resolver';

// 2026-08-31 is a Monday. Anchor "now" at 08:00 UTC that day (10:00 Madrid).
const MON_08_UTC = Date.UTC(2026, 7, 31, 8, 0, 0);

function slotDates(slots: number[], tz = 'Europe/Madrid') {
  return slots.map((ms) => {
    const wc = wallClockInZone(ms, tz);
    return `${wc.year}-${String(wc.month).padStart(2, '0')}-${String(wc.day).padStart(2, '0')} ${wc.hour}:00`;
  });
}

describe('parseAmandaSettings — availability shapes (Christian 2026-08-28)', () => {
  it('parses configured hours, blocked dates and one-off hour blocks; rejects malformed entries', () => {
    const s = parseAmandaSettings({
      viewing_hours_by_weekday: { '1': [10, 11, 12, 17, 18], '9': [10], '2': ['x', 25, 14] },
      blocked_dates: ['2026-09-07', 'nonsense', '2026-9-1'],
      blocked_slots: [
        { date: '2026-09-01', from: 12, to: 14 },
        { date: 'bad', from: 12, to: 14 },
        { date: '2026-09-01', from: 14, to: 12 },   // inverted → dropped
        { date: '2026-09-01', from: 7, to: 9 },     // below floor → dropped
      ],
    });
    expect(s.viewingHoursByWeekday['1']).toEqual([10, 11, 12, 17, 18]);
    expect(s.viewingHoursByWeekday['2']).toEqual([14]);
    expect(s.viewingHoursByWeekday['9']).toBeUndefined();
    expect(s.blockedDates).toEqual(['2026-09-07']);
    expect(s.blockedSlots).toEqual([{ date: '2026-09-01', from: 12, to: 14 }]);
  });
  it('empty/malformed hours fall back to the safe default (never brick booking)', () => {
    expect(Object.keys(parseAmandaSettings({}).viewingHoursByWeekday).length).toBeGreaterThan(0);
    expect(Object.keys(parseAmandaSettings({ viewing_hours_by_weekday: {} }).viewingHoursByWeekday).length).toBeGreaterThan(0);
  });
});

describe('calendar notes — parse + prompt-context window', () => {
  it('parses valid notes, rejects malformed ones', () => {
    const s = parseAmandaSettings({
      calendar_notes: [
        { date: '2026-09-02', from: 12, to: 14, note: 'Team meeting — office empty' },
        { date: 'bad', from: 12, to: 14, note: 'x' },
        { date: '2026-09-02', from: 14, to: 12, note: 'inverted' },
        { date: '2026-09-02', from: 12, to: 14, note: '' },
      ],
    });
    expect(s.calendarNotes).toEqual([{ date: '2026-09-02', from: 12, to: 14, note: 'Team meeting — office empty', color: 'violet' }]);
  });
  it('upcomingCalendarNotes includes only agency-local today..+14d, sorted and formatted', () => {
    const s = parseAmandaSettings({
      calendar_notes: [
        { date: '2026-08-30', from: 9, to: 10, note: 'B' },
        { date: '2026-08-29', from: 17, to: 19, note: 'A' },
        { date: '2026-08-01', from: 9, to: 10, note: 'past' },
        { date: '2026-10-01', from: 9, to: 10, note: 'far future' },
      ],
    });
    const got = upcomingCalendarNotes(s, MON_08_UTC - 2 * 86_400_000);   // Sat 2026-08-29 in Madrid
    expect(got).toEqual([
      'Calendar note for 2026-08-29 17:00-19:00: A',
      'Calendar note for 2026-08-30 09:00-10:00: B',
    ]);
  });
});

describe('candidateSlots — blocked days and one-off hour blocks', () => {
  const base = parseAmandaSettings({
    viewing_hours_by_weekday: { '1': [10, 11, 12], '2': [10, 11, 12] },   // Mon+Tue only
    viewing_notice_hours: 1,
  });

  it('offers only configured weekday hours', () => {
    const got = slotDates(candidateSlots(MON_08_UTC, base, 6));
    expect(got).toEqual([
      '2026-08-31 11:00', '2026-08-31 12:00',
      '2026-09-01 10:00', '2026-09-01 11:00', '2026-09-01 12:00',
      '2026-09-07 10:00',
    ]);
  });

  it('a blocked DATE removes the whole day', () => {
    const s = { ...base, blockedDates: ['2026-09-01'] };
    const got = slotDates(candidateSlots(MON_08_UTC, s, 4));
    expect(got).toEqual(['2026-08-31 11:00', '2026-08-31 12:00', '2026-09-07 10:00', '2026-09-07 11:00']);
  });

  it('a one-off hour block removes just those hours on that date', () => {
    const s = { ...base, blockedSlots: [{ date: '2026-09-01', from: 11, to: 13 }] };
    const got = slotDates(candidateSlots(MON_08_UTC, s, 4));
    expect(got).toEqual(['2026-08-31 11:00', '2026-08-31 12:00', '2026-09-01 10:00', '2026-09-07 10:00']);
  });

  it('a recurring mid-day break is just a non-contiguous hour array — the siesta case', () => {
    const s = parseAmandaSettings({
      viewing_hours_by_weekday: { '1': [10, 11, 17, 18] },   // open 10-12 + 17-19
      viewing_notice_hours: 1,
    });
    const got = slotDates(candidateSlots(MON_08_UTC, s, 4));
    expect(got).toEqual(['2026-08-31 11:00', '2026-08-31 17:00', '2026-08-31 18:00', '2026-09-07 10:00']);
  });
});
