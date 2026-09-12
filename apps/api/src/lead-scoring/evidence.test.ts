import { describe, it, expect } from 'vitest';
import { checkEvidence, invalidValues, norm, quoteFound, quoteProblem } from './evidence';
import { SCORING_FIXTURES } from './fixtures';
import { leadMessagesOf } from './lead-messages';
import { computeScore } from './rubric';
import type { Facts } from './types';

const leadOf = (id: number): string[] => leadMessagesOf(SCORING_FIXTURES.find((f) => f.id === id)!.input);
/** The number of the first lead message of a practice conversation that contains this text. */
const at = (id: number, fragment: string): string => {
  const i = leadOf(id).findIndex((t) => t.includes(fragment));
  if (i < 0) throw new Error(`no lead message in #${id} contains "${fragment}"`);
  return `L${i + 1}`;
};
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

describe('the lead messages are numbered earlier ones first, the order the AI is shown (prompt.test.ts)', () => {
  it('in the Norwegian case, L22 is "Ja det passer" and L23 is the reschedule request', () => {
    const lead = leadOf(8);
    expect(lead).toHaveLength(23);
    expect(lead[21]).toBe('Ja det passer');
    expect(lead[22]).toBe('Kunne vi faktisk tatt det imrg isteden?');
  });
});

describe('quote check (v1.4): every piece names ONE lead message, and its words must be inside that message', () => {
  const texts = leadOf(8).map(norm);
  it.each([
    ['L3: hus | L5: med basseng | L16: nært den norske skolen i quesada', true, 'real evidence spread over three messages'],
    ['L17: den frittstående villaen', true, 'one exact piece'],
    ['L17: hvor den ligger eksakt | L19: hvilken tid er best for dere', true, 'two messages as two exact pieces'],
    ['L21: hva med klokka 17:00 | L22: Ja det passer | L23: Kunne vi faktisk tatt det imrg isteden', true, "the viewing in the lead's own words"],
    ['L17: "den frittstående villaen"', true, 'quotation marks around the words are fine'],
    ['Ja det passer', false, 'the right words, but no message named'],
    ['L9: Ja det passer', false, 'the right words, in the wrong message'],
    ['L24: Ja det passer', false, 'there is no L24'],
    ['L15: huset med basseng', false, "check 2026-09-11: the agency's words, labelled as the lead's"],
    ['L17: frittstående villaen | L17: 390 000 €', false, "check 2026-09-11: the agency's listing price added to her words"],
    ['L22: Torsdag kl 17:00 passer | L23: Kunne vi faktisk tatt det imrg isteden', false, "check 2026-09-11: stitched from the agency's confirmation"],
    ['L17: frittstående villaen, 390 000 €, IC-81596', false, "run 2: the agency's price and reference mixed in"],
    ['L17: hvor den ligger eksakt, hvilken tid er best for dere', false, 'run 2: two messages glued into one piece'],
    ['L17: frittstående villaen | L17: 3 soverom | L17: privat basseng', false, "run 3: words borrowed from the agency's listing"],
    ['L16: nær den norske skolen', false, 'run 3: a paraphrase of her words'],
    ['L1: a | L2: b | L3: c | L4: d', false, 'more than three pieces'],
    ['', false, 'no quote at all'],
  ])('%s → %s (%s)', (quote, want) => {
    expect(quoteFound(quote, texts)).toBe(want);
  });
  it('says why a quote cannot count', () => {
    expect(quoteProblem('Ja det passer', texts)).toMatch(/does not say which lead message/);
    expect(quoteProblem('L24: Ja det passer', texts)).toMatch(/L24 is not one of the lead's messages/);
    expect(quoteProblem('L17: frittstående villaen | L17: 390 000 €', texts)).toBe('"390 000 €" is not in the lead\'s message L17');
    expect(quoteProblem('L22: Ja det passer', texts)).toBeNull();
  });
});

describe('permanent regression: the first Scoring check (Christian, 2026-09-11 20:22 UTC), case #8', () => {
  const lead = leadOf(8);
  const texts = lead.map(norm);
  const facts = (need: string, sp: string, viewing: string): Facts =>
    base({
      budget: { state: 'clear', quote: 'L16: under 500 000€' },
      area: { state: 'clear', quote: 'L10: Torrevieja eller Ciudad quesada området' },
      need: { state: 'clear', quote: need },
      specific_property: { state: 'discussed', quote: sp },
      timing: { state: 'within_30_days', quote: 'L19: Ja gjerne, jeg har tid på torsdag hele dagen' },
      viewing: { state: 'agreed_change_pending', within_7_days: true, quote: viewing },
      concrete_question: { present: true, quote: 'L17: hvor den ligger eksakt' },
      asked_for_listings_or_photos: { present: true, quote: 'L14: Ja jeg ser gjerne noen bilder' },
    });
  it("in the lead's own words, the same facts score exactly 89 super-hot (the expected score is unchanged)", () => {
    const ev = checkEvidence(
      facts('L5: Har dere noe med basseng', 'L17: den frittstående villaen', 'L21: hva med klokka 17:00 | L22: Ja det passer | L23: Kunne vi faktisk tatt det imrg isteden'),
      texts,
      lead,
    );
    expect(ev.discarded).toEqual([]);
    expect(computeScore(ev.facts, lead.length)).toMatchObject({ score: 89, band: 'super_hot' });
  });
  it("the AI's three quotes from that run (the agency's words), even labelled as hers, are thrown away: warm 69, never super-hot on borrowed proof", () => {
    const ev = checkEvidence(
      facts('L15: huset med basseng', 'L17: frittstående villaen | L17: 390 000 €', 'L22: Torsdag kl 17:00 passer | L23: Kunne vi faktisk tatt det imrg isteden'),
      texts,
      lead,
    );
    expect(ev.discarded.map((d) => d.split(':')[0])).toEqual(['need=clear', 'specific_property=discussed', 'viewing=agreed_change_pending']);
    expect(computeScore(ev.facts, lead.length)).toMatchObject({ score: 69, band: 'warm' });
  });
  it('the same three quotes exactly as returned that day, with no message numbers, are thrown away too', () => {
    const ev = checkEvidence(facts('huset med basseng', 'frittstående villaen | 390 000 €', 'Torsdag kl 17:00 passer | Kunne vi faktisk tatt det imrg isteden'), texts, lead);
    expect(ev.discarded).toHaveLength(3);
    expect(computeScore(ev.facts, lead.length)).toMatchObject({ score: 69, band: 'warm' });
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
  it('v1.5: a date must be a real date, or nothing', () => {
    expect(invalidValues(base({ timing: { state: 'within_30_days', date: 'next Thursday' } }))).toContain('timing.date="next Thursday"');
    expect(invalidValues(base({ viewing: { state: 'requested', date: '2026-9-3', within_7_days: null } }))).toContain('viewing.date="2026-9-3"');
    expect(invalidValues(base({ timing: { state: 'within_30_days', date: '2026-09-25' } }))).toEqual([]);
  });
  it('a yes/no fact must be a real true or false', () => {
    expect(invalidValues(base({ concrete_question: { present: 'yes' as unknown as boolean, quote: null } }))).toContain('concrete_question="yes"');
  });
});

describe('evidence: what is discarded is never used, and always reported', () => {
  it("a fact whose quote is not in the lead's words is discarded", () => {
    const ev = check(8, base({ specific_property: { state: 'discussed', quote: 'L17: frittstående villaen | L17: 3 soverom | L17: privat basseng' } }));
    expect(ev.facts.specific_property?.state).toBe('none');
    expect(ev.discarded.join(' ')).toMatch(/specific_property=discussed/);
  });
  it('a fact with no quote at all is discarded (run 2: a wish to view claimed with no quote)', () => {
    const ev = check(4, base({ viewing: { state: 'wants_to_view', within_7_days: null, quote: null } }));
    expect(ev.facts.viewing?.state).toBe('none');
    expect(ev.discarded).toHaveLength(1);
  });
  it('real evidence is kept', () => {
    const ev = check(8, base({ budget: { state: 'clear', quote: 'L16: fortsatt under 500 000€' }, area: { state: 'clear', quote: 'L16: quesada' } }));
    expect(ev.facts.budget?.state).toBe('clear');
    expect(ev.facts.area?.state).toBe('clear');
    expect(ev.discarded).toEqual([]);
  });
});

describe("guards: a listing's own details are not the lead's search", () => {
  it('guard 1: an availability question is never a concrete question (run 1, #3)', () => {
    const q = `${at(3, 'still available')}: is this villa still available?`;
    const ev = check(3, base({ specific_property: { state: 'availability_only', quote: q }, concrete_question: { present: true, quote: q } }));
    expect(ev.discarded).toEqual([]);
    expect(ev.facts.concrete_question?.present).toBe(false);
    expect(ev.guards).toHaveLength(1);
  });
  it("guard 2: an area quoted from inside the listing reference is the listing's (run 1, #4)", () => {
    const l = at(4, 'MI3321');
    const ev = check(4, base({
      area: { state: 'clear', quote: `${l}: townhouse in Torrevieja` },
      specific_property: { state: 'discussed', quote: `${l}: townhouse in Torrevieja, ref MI3321` },
    }));
    expect(ev.discarded).toEqual([]);
    expect(ev.facts.area?.state).toBe('none');
  });
  it("guard 3: a town found only where they name a listing reference is the listing's, whatever quote the model chose (run 3, #4)", () => {
    const ev = check(4, base({
      area: { state: 'clear', quote: `${at(4, 'Torrevieja')}: Torrevieja` },
      need: { state: 'vague', quote: `${at(4, 'townhouse')}: townhouse` },
      specific_property: { state: 'discussed', quote: `${at(4, 'parking')}: Does it have its own parking, and how far is it to the beach?` },
    }));
    expect(ev.discarded).toEqual([]);
    expect(ev.facts.area?.state).toBe('none');
    expect(ev.facts.need?.state).toBe('none');
  });
  it('guard 3 leaves the Norwegian case alone: she names no listing reference', () => {
    const ev = check(8, base({ area: { state: 'clear', quote: 'L10: Torrevieja eller Ciudad quesada området' } }));
    expect(ev.facts.area?.state).toBe('clear');
    expect(ev.guards).toEqual([]);
  });
});
