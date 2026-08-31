import { describe, it, expect } from 'vitest';
import { reminderDateParts, reminderGreetingName, reminderPropertyLabel } from './viewing-reminders-lib';
import { SUPPORTED_LANGUAGES } from './validators';

// 2026-09-03 10:30 Madrid time.
const MS = Date.parse('2026-09-03T08:30:00Z');
const TZ = 'Europe/Madrid';

describe('viewing reminder — the template is localised, so the variables must be too', () => {
  it('gives the month in the LEAD language, not English', () => {
    expect(reminderDateParts(MS, TZ, 'en').date).toBe('3 September');
    expect(reminderDateParts(MS, TZ, 'nb').date).toMatch(/september/);
    expect(reminderDateParts(MS, TZ, 'es').date).toMatch(/septiembre/);
    expect(reminderDateParts(MS, TZ, 'de').date).toMatch(/September/);
    expect(reminderDateParts(MS, TZ, 'fi').date).toMatch(/syys/);
    expect(reminderDateParts(MS, TZ, 'ru').date).toMatch(/сент/);
  });

  it('never leaks an English month into a non-English reminder', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      // German capitalises its months and "September" IS the German word, so a
      // match there is correct German, not a leak.
      if (lang === 'en' || lang === 'de') continue;
      const { date } = reminderDateParts(MS, TZ, lang);
      expect(date, `${lang} got the English month`).not.toMatch(/September\b/);
    }
  });

  it('follows the day/month ORDER each locale actually uses, not just its month name', () => {
    // "September 3" in English but "3 de septiembre" in Spanish - a hand-rolled
    // `${day} ${MONTH}` could never get this right.
    // en is pinned to en-GB: British buyers write "3 September", not "September 3".
    expect(reminderDateParts(MS, TZ, 'en').date).toBe('3 September');
    expect(reminderDateParts(MS, TZ, 'es').date).toBe('3 de septiembre');
    expect(reminderDateParts(MS, TZ, 'nb').date).toBe('3. september');
    expect(reminderDateParts(MS, TZ, 'de').date).toBe('3. September');
  });

  it('keeps the time tz-correct and the day right in every language', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const { date, time } = reminderDateParts(MS, TZ, lang);
      expect(time, lang).toBe('10:30');
      expect(date, lang).toMatch(/3/);
    }
  });

  it('survives a language tag Intl does not know, rather than killing the reminder', () => {
    expect(() => reminderDateParts(MS, TZ, 'zz-not-a-tag')).not.toThrow();
    expect(reminderDateParts(MS, TZ, 'zz-not-a-tag').time).toBe('10:30');
  });

  it('uses the real name when we have one', () => {
    expect(reminderGreetingName('Marte', 'nb')).toBe('Marte');
    expect(reminderGreetingName('  Marte  ', 'nb')).toBe('Marte');
  });

  it('never sends an English filler to a non-English lead, and never sends empty', () => {
    // Empty would be rejected by Meta; "there" was the old bug.
    for (const lang of SUPPORTED_LANGUAGES) {
      const g = reminderGreetingName(null, lang);
      expect(g.length, lang).toBeGreaterThan(0);
      if (lang !== 'en') expect(g, lang).not.toBe('there');
      expect(reminderPropertyLabel(null, lang).length, lang).toBeGreaterThan(0);
      if (lang !== 'en') expect(reminderPropertyLabel(null, lang), lang).not.toBe('the property');
    }
  });

  it('normalises legacy language codes rather than falling back to English', () => {
    // 'no' is what older rows carry; it must resolve to the nb wording.
    expect(reminderGreetingName(null, 'no')).toBe(reminderGreetingName(null, 'nb'));
    expect(reminderDateParts(MS, TZ, 'no').date).toBe(reminderDateParts(MS, TZ, 'nb').date);
  });
});
