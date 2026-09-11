import { describe, it, expect } from 'vitest';
import { checkEvidence, invalidValues, norm, quoteFound } from './evidence';
import { SCORING_FIXTURES } from './fixtures';
import { leadMessagesOf } from './score-conversation';
import type { Facts } from './types';

const leadOf = (id: number): string[] => leadMessagesOf(SCORING_FIXTURES.find((f) => f.id === id)!.input);
const NONE = { state: 'none', quote: null };
const NO = { present: false, quote: null };
const base = (over: Partial<Facts> = {}): Facts => ({
  real_lead: true,
  not_a_lead_reason: null,
  intent: 'real',
  budget: NONE,
  area: NONE,
  need: NONE,
  specific_property: NONE,
  concrete_question: NO,
  asked_for_listings_or_photos: NO,
  timing: { state: 'unknown', quote: null },
  viewing: { state: 'none', within_7_days: null, quote: null },
  financing_ready: NO,
  decision: NONE,
  negative: NONE,
  reason: null,
  ...over,
});
const check = (id: number, facts: Facts) => {
  const raw = leadOf(id);
  return checkEvidence(facts, raw.map(norm), raw);
};

describe("quote check: only the lead's own words count (the Norwegian case's real messages)", () => {
  const texts = leadOf(8).map(norm);
  it.each([
    ['hus | med basseng | nært den norske skolen i quesada', true, 'real evidence spread over three messages'],
    ['den frittstående villaen', true, 'one exact piece'],
    ['hvor den ligger eksakt | hvilken tid er best for dere', true, 'two messages as two exact pieces'],
    ['hus med basseng nært den norske skolen', false, 'run 2: words glued from different messages'],
    ['frittstående villaen, 390 000 €, IC-81596', false, "run 2: the agency's price and reference mixed in"],
    ['hvor den ligger eksakt, hvilken tid er best for dere', false, 'run 2: two messages glued into one piece'],
    ['frittstående villaen | 3 soverom | privat basseng', false, "run 3: words borrowed from the agency's listing"],
    ['nær den norske skolen', false, 'run 3: a paraphrase of her words'],
    ['a | b | c | d', false, 'more than three pieces'],
    ['', false, 'no quote at all'],
  ])('%s → %s (%s)', (quote, want) => {
    expect(quoteFound(quote, texts)).toBe(want);
  });
});

describe('strict values: an answer outside the allowed list is rejected, never guessed', () => {
  it('a clean answer passes', () => expect(invalidValues(base())).toEqual([]));
  it('run 1: need="present" is rejected (it was once silently read as "no need")', () => {
    expect(invalidValues(base({ need: { state: 'present', quote: 'villa' } }))).toContain('need="present"');
  });
  it('run 1: an invented not-a-lead reason is rejected', () => {
    expect(invalidValues(base({ real_lead: false, not_a_lead_reason: 'bought_elsewhere' }))).toContain('not_a_lead_reason="bought_elsewhere"');
  });
  it('a yes/no fact must be a real true or false', () => {
    expect(invalidValues(base({ concrete_question: { present: 'yes' as unknown as boolean, quote: null } }))).toContain('concrete_question="yes"');
  });
});

describe('evidence: what is discarded is never used, and always reported', () => {
  it("a fact whose quote is not in the lead's words is discarded", () => {
    const ev = check(8, base({ specific_property: { state: 'discussed', quote: 'frittstående villaen | 3 soverom | privat basseng' } }));
    expect(ev.facts.specific_property?.state).toBe('none');
    expect(ev.discarded.join(' ')).toMatch(/specific_property=discussed/);
  });
  it('a fact with no quote at all is discarded (run 2: a wish to view claimed with no quote)', () => {
    const ev = check(4, base({ viewing: { state: 'wants_to_view', within_7_days: null, quote: null } }));
    expect(ev.facts.viewing?.state).toBe('none');
    expect(ev.discarded).toHaveLength(1);
  });
  it('real evidence is kept', () => {
    const ev = check(8, base({ budget: { state: 'clear', quote: 'fortsatt under 500 000€' }, area: { state: 'clear', quote: 'quesada' } }));
    expect(ev.facts.budget?.state).toBe('clear');
    expect(ev.facts.area?.state).toBe('clear');
    expect(ev.discarded).toEqual([]);
  });
});

describe("guards: a listing's own details are not the lead's search", () => {
  it('guard 1: an availability question is never a concrete question (run 1, #3)', () => {
    const ev = check(3, base({
      specific_property: { state: 'availability_only', quote: 'is this villa still available?' },
      concrete_question: { present: true, quote: 'is this villa still available?' },
    }));
    expect(ev.facts.concrete_question?.present).toBe(false);
    expect(ev.guards).toHaveLength(1);
  });
  it("guard 2: an area quoted from inside the listing reference is the listing's (run 1, #4)", () => {
    const ev = check(4, base({
      area: { state: 'clear', quote: 'townhouse in Torrevieja' },
      specific_property: { state: 'discussed', quote: 'townhouse in Torrevieja, ref MI3321' },
    }));
    expect(ev.facts.area?.state).toBe('none');
  });
  it("guard 3: a town found only where they name a listing reference is the listing's, whatever quote the model chose (run 3, #4)", () => {
    const ev = check(4, base({
      area: { state: 'clear', quote: 'Torrevieja' },
      need: { state: 'vague', quote: 'townhouse' },
      specific_property: { state: 'discussed', quote: 'Does it have its own parking, and how far is it to the beach?' },
    }));
    expect(ev.facts.area?.state).toBe('none');
    expect(ev.facts.need?.state).toBe('none');
  });
  it('guard 3 leaves the Norwegian case alone: she names no listing reference', () => {
    const ev = check(8, base({ area: { state: 'clear', quote: 'Torrevieja eller Ciudad quesada området' } }));
    expect(ev.facts.area?.state).toBe('clear');
    expect(ev.guards).toEqual([]);
  });
});
