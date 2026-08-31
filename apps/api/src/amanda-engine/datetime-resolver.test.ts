import { describe, it, expect } from 'vitest';
import { resolveDatetimePhrase, parseTime, zonedTimeToUtc, wallClockInZone , resolvePreferredDay } from './datetime-resolver';

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

/**
 * Live 2026-08-31: Marte said "I'm available all day on Thursday" and Amanda
 * replied that Thursday was not possible — on a day the calendar was open
 * 13:00-20:00. The phrase resolver had rejected it as missing_time, the caller
 * fell back to generic slots, and Amanda read Tuesday/Wednesday coming back as
 * proof Thursday was full.
 */
describe('resolvePreferredDay — a day without a time is still a day', () => {
  const TZ = 'Europe/Madrid';
  // Monday 31 August 2026, 16:00 Madrid.
  const MON = Date.parse('2026-08-31T14:00:00Z');

  it('"Thursday" resolves to the coming Thursday', () => {
    const d = resolvePreferredDay('Thursday', MON, TZ);
    expect(d).toEqual({ year: 2026, month: 9, day: 3 });
  });

  it('handles the way people actually say it', () => {
    for (const phrase of ['all day Thursday', 'I am free on thursday', 'thursday works']) {
      expect(resolvePreferredDay(phrase, MON, TZ)).toEqual({ year: 2026, month: 9, day: 3 });
    }
  });

  it('a phrase WITH a time still resolves to that same day', () => {
    expect(resolvePreferredDay('Thursday at 17:00', MON, TZ)).toEqual({ year: 2026, month: 9, day: 3 });
  });

  it('today stays today when the day is named on the day itself', () => {
    expect(resolvePreferredDay('monday', MON, TZ)).toEqual({ year: 2026, month: 8, day: 31 });
  });

  it('returns null for something that is not a day at all', () => {
    expect(resolvePreferredDay('whenever suits you', MON, TZ)).toBeNull();
    expect(resolvePreferredDay('', MON, TZ)).toBeNull();
  });
});

/**
 * The resolver spoke English and Spanish while the product promises 13
 * languages — so "torsdag", "Donnerstag" and "czwartek" were all unreadable and
 * every non-EN/ES buyer naming a day fell back to generic times. Found the
 * moment before a Norwegian buyer was about to test it (2026-08-31).
 */
describe('weekdays are understood in every supported language', () => {
  const TZ = 'Europe/Madrid';
  const MON = Date.parse('2026-08-31T14:00:00Z');   // Monday 31 Aug, 16:00 Madrid
  const THU = { year: 2026, month: 9, day: 3 };

  it('Thursday, in all thirteen', () => {
    for (const word of [
      'thursday', 'jueves', 'donnerstag', 'donderdag', 'jeudi', 'giovedi',
      'quinta', 'czwartek', 'torsdag', 'torstai', 'четверг',
    ]) {
      expect(resolvePreferredDay(word, MON, TZ), `failed for "${word}"`).toEqual(THU);
    }
  });

  it('Nordic ø survives normalisation, and the ASCII spelling works too', () => {
    // ø is its own letter and does NOT decompose, unlike Swedish ö.
    const SAT = { year: 2026, month: 9, day: 5 };
    expect(resolvePreferredDay('lørdag', MON, TZ)).toEqual(SAT);
    expect(resolvePreferredDay('lordag', MON, TZ)).toEqual(SAT);
    expect(resolvePreferredDay('lördag', MON, TZ)).toEqual(SAT);
  });

  it('a real sentence, not just the bare word', () => {
    expect(resolvePreferredDay('Jeg er ledig hele torsdag', MON, TZ)).toEqual(THU);
    expect(resolvePreferredDay('passt mir am Donnerstag', MON, TZ)).toEqual(THU);
  });

  it('a full date-and-time still resolves in another language', () => {
    const r = resolveDatetimePhrase('torsdag kl 17:00', MON, TZ);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.explicit.weekday).toBe('thursday');
  });
});

/**
 * The other half of the weekday gap, found the same evening: "tomorrow" was
 * English and Spanish only. Marte wrote "imrg" (i morgen), it was unreadable,
 * the slot search fell back to generic times, and Amanda labelled a WEDNESDAY
 * slot "i morgen" when tomorrow was Tuesday. The verifier blocked it.
 */
describe('today and tomorrow in every supported language', () => {
  const TZ = 'Europe/Madrid';
  const MON = Date.parse('2026-08-31T14:00:00Z');   // Monday 31 Aug, 16:00 Madrid
  const TUE = { year: 2026, month: 9, day: 1 };

  it('tomorrow, in all thirteen', () => {
    for (const word of [
      'tomorrow', 'manana', 'demain', 'domani', 'amanha', 'jutro',
      'imorgon', 'i morgon', 'imorgen', 'i morgen', 'huomenna', 'завтра',
    ]) {
      expect(resolvePreferredDay(word, MON, TZ), `failed for "${word}"`).toEqual(TUE);
    }
  });

  it('today, in all thirteen', () => {
    const today = { year: 2026, month: 8, day: 31 };
    for (const word of [
      'today', 'hoy', 'heute', 'vandaag', "aujourd'hui", 'oggi', 'hoje',
      'dzisiaj', 'idag', 'i dag', 'tanaan', 'сегодня',
    ]) {
      expect(resolvePreferredDay(word, MON, TZ), `failed for "${word}"`).toEqual(today);
    }
  });

  it('bare "morgen" is NOT tomorrow — in Norwegian it means morning', () => {
    // A false positive puts a wrong DATE in front of a buyer; a false negative
    // just falls back to honest alternatives. This must stay a false negative.
    expect(resolvePreferredDay('god morgen', MON, TZ)).toBeNull();
    expect(resolvePreferredDay('på morgenen', MON, TZ)).toBeNull();
  });

  it('a real sentence still resolves', () => {
    expect(resolvePreferredDay('Kunne vi tatt det i morgen isteden?', MON, TZ)).toEqual(TUE);
  });
});
