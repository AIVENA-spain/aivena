import { describe, it, expect } from 'vitest';
import { applyDates, daysFromNow, isDate } from './dates';
import { computeScore } from './rubric';
import type { Facts } from './types';

const NORWEGIAN = (): Facts => ({
  real_lead: true,
  intent: 'real',
  budget: { state: 'clear', quote: 'L16: under 500 000€' },
  area: { state: 'clear', quote: 'L10: Torrevieja eller Ciudad quesada området' },
  need: { state: 'clear', quote: 'L5: Har dere noe med basseng' },
  specific_property: { state: 'discussed', quote: 'L17: den frittstående villaen' },
  // The viewing they agreed, then asked to move: Thursday 3 September, worked out from the message it was said in.
  viewing: { state: 'agreed_change_pending', date: '2026-09-03', within_7_days: null, quote: 'L22: Ja det passer' },
  timing: { state: 'within_30_days', date: null, quote: 'L19: jeg har tid på torsdag hele dagen' },
  concrete_question: { present: true, quote: 'L17: hvor den ligger eksakt' },
  asked_for_listings_or_photos: { present: true, quote: 'L14: Ja jeg ser gjerne noen bilder' },
  financing_ready: { present: false },
  decision: { state: 'none' },
  negative: { state: 'none' },
});

describe('a date is a real date, or it is nothing', () => {
  it('accepts only YYYY-MM-DD', () => {
    expect(isDate('2026-09-03')).toBe(true);
    for (const bad of ['3 September', 'torsdag', '2026-13-40', '2026-9-3', '', null, undefined, 20260903]) expect(isDate(bad)).toBe(false);
  });
  it('counts whole days from today, negative once it has passed', () => {
    expect(daysFromNow('2026-09-03', '2026-08-31T15:37:00Z')).toBe(3);
    expect(daysFromNow('2026-09-03', '2026-09-03T23:00:00Z')).toBe(0);
    expect(daysFromNow('2026-09-03', '2026-09-12T16:02:00Z')).toBe(-9);
  });
});

describe('code decides what a date means, not the AI (v1.5, the first Stage 2 run read "torsdag" as upcoming)', () => {
  it('scored 30 minutes after the conversation, the viewing is within 7 days: 89 super-hot', () => {
    const d = applyDates(NORWEGIAN(), '2026-08-31T15:37:00Z');
    expect(d.facts.viewing?.within_7_days).toBe(true);
    expect(d.notes).toEqual([]);
    expect(computeScore(d.facts, 23)).toMatchObject({ score: 89, band: 'super_hot' });
  });
  it('scored twelve days later, the same conversation loses ONLY that bonus and says the date passed: 88, still super-hot', () => {
    const d = applyDates(NORWEGIAN(), '2026-09-12T16:02:00Z');
    expect(d.facts.viewing?.within_7_days).toBe(false);
    expect(d.notes.join(' ')).toMatch(/viewing date \(2026-09-03\) has already passed/);
    // Christian, 2026-09-12: the score must not decay. Being ignored is an urgency problem, not a weaker lead.
    expect(computeScore(d.facts, 23)).toMatchObject({ score: 88, band: 'super_hot' });
    expect(d.facts.budget?.state).toBe('clear');
    expect(d.facts.viewing?.state).toBe('agreed_change_pending');
  });
  it('"within 7 days" claimed with no date is not counted, and says so', () => {
    const f = NORWEGIAN();
    f.viewing = { state: 'requested', date: null, within_7_days: true, quote: 'L21: hva med klokka 17:00' };
    const d = applyDates(f, '2026-09-12T16:02:00Z');
    expect(d.facts.viewing?.within_7_days).toBeNull();
    expect(d.notes.join(' ')).toMatch(/no viewing date was given/);
  });
});

describe('timing comes from the date, not from the AI\'s sense of "soon"', () => {
  const timing = (date: string | null, state = 'within_30_days'): Facts => ({
    real_lead: true,
    intent: 'real',
    budget: { state: 'clear', quote: 'L1: rond de €420.000' },
    area: { state: 'clear', quote: 'L1: Ciudad Quesada of Rojales' },
    need: { state: 'clear', quote: 'L1: vrijstaande villa met 3 slaapkamers' },
    timing: { state, date, quote: 'L1: volgend voorjaar' },
  });
  it('#6: "next spring" resolved to a real date reads as later, not within 30 days', () => {
    const d = applyDates(timing('2027-03-20'), '2026-09-10T13:42:00Z');
    expect(d.facts.timing?.state).toBe('later');
    expect(computeScore(d.facts, 2)).toMatchObject({ score: 76, band: 'hot' });
  });
  it('a date inside 30 days reads as within 30 days', () => {
    expect(applyDates(timing('2026-09-25', 'later'), '2026-09-10T13:42:00Z').facts.timing?.state).toBe('within_30_days');
  });
  it('a date that has passed becomes unknown, and says so', () => {
    const d = applyDates(timing('2026-08-20'), '2026-09-10T13:42:00Z');
    expect(d.facts.timing?.state).toBe('unknown');
    expect(d.notes.join(' ')).toMatch(/has already passed/);
  });
  it('with no date, the AI\'s own reading stands', () => {
    expect(applyDates(timing(null, 'later'), '2026-09-10T13:42:00Z').facts.timing?.state).toBe('later');
    expect(applyDates(timing(null, 'within_30_days'), '2026-09-10T13:42:00Z').facts.timing?.state).toBe('within_30_days');
  });
});
