import { describe, it, expect } from 'vitest';
import { capitalisedWords, checkEvidence, checkQuote, norm, slipToleranceReady } from './evidence';
import { explain } from './explain';
import { SCORING_FIXTURES } from './fixtures';
import { leadMessagesOf } from './lead-messages';
import { computeScore } from './rubric';
import type { Facts } from './types';

/**
 * The one-letter copying slip (v1.5.2, Christian 2026-09-13). The v1.5.1 check lost #8's agreed viewing because the AI
 * copied the lead's "isteden" as "istenden". One such slip may now pass, under every one of his limits — and nothing
 * the checker has ever rejected may pass because of it.
 */
const fx = SCORING_FIXTURES.find((f) => f.id === 8)!;
const raw = leadMessagesOf(fx.input);
const texts = raw.map(norm);
const caps = capitalisedWords([...(fx.input.earlierLeadMessages ?? []).map((m) => m.text), ...fx.input.conversation.map((m) => m.text)]);
const tolerant = (quote: string) => checkQuote(quote, texts, raw, caps);

describe('the limits hold only where the calendar data exists', () => {
  it('the protected day and month words were built for the dashboard languages (fails closed otherwise)', () => {
    expect(slipToleranceReady()).toBe(true);
  });
});

describe("today's failure passes, is logged, and is shown in the lead's real words", () => {
  it('"istenden" in the lead\'s message L23 is read as "isteden"', () => {
    const q = tolerant('L23: Kunne vi faktisk tatt det imrg istenden?');
    expect(q.problem).toBeNull();
    expect(q.slips).toEqual([{ typed: 'istenden', lead: 'isteden', message: 'L23' }]);
    expect(q.corrected).toBe('L23: Kunne vi faktisk tatt det imrg isteden?');
  });
  it('the fact survives, 89 super-hot is restored, the slip is logged, and the reason never shows the typo', () => {
    const facts: Facts = {
      real_lead: true,
      intent: 'real',
      budget: { state: 'clear', quote: 'L16: under 500 000€' },
      area: { state: 'clear', quote: 'L10: Torrevieja eller Ciudad quesada området' },
      need: { state: 'clear', quote: 'L5: Har dere noe med basseng' },
      specific_property: { state: 'discussed', quote: 'L17: den frittstående villaen' },
      timing: { state: 'within_30_days', quote: 'L19: jeg har tid på torsdag hele dagen' },
      viewing: { state: 'agreed_change_pending', within_7_days: true, quote: 'L22: Ja det passer | L23: Kunne vi faktisk tatt det imrg istenden?' },
    };
    const ev = checkEvidence(facts, texts, raw, caps);
    expect(ev.discarded).toEqual([]);
    expect(ev.tolerated).toEqual(['viewing=agreed_change_pending: "istenden" read as "isteden" in the lead\'s message L23 (a one-letter copying slip)']);
    const r = computeScore(ev.facts, raw.length);
    expect(r).toMatchObject({ score: 89, band: 'super_hot' });
    const why = explain(r, ev.facts);
    expect(why).toContain('isteden');
    expect(why).not.toContain('istenden');
  });
  it('without the conversation context the check stays strictly word for word (the old behaviour)', () => {
    expect(checkQuote('L23: Kunne vi faktisk tatt det imrg istenden?', texts).problem).not.toBeNull();
  });
});

describe("Christian's exclusions: never tolerated", () => {
  it.each([
    ['L10: Helst Torrevija eller Ciudad quesada området', 'a capitalised place name'],
    ['L10: Helst Torrevieja eller Ciudad quesda området', 'a place the lead wrote in lower case, but the agency capitalises'],
    ['L16: Ja fortsatt undder 500 000€', 'a piece with a price in it'],
    ['L19: jeg har tid på torsdagg hele dagen', 'a day name'],
    ['L22: Ja dett passer', 'a word shorter than 5 letters'],
    ['L23: Kunne vi faktiskk tatt det imrg istenden', 'two slips in one piece'],
    ['L22: Ja det paasser | L23: Kunne vi faktisk tatt det imrg istenden', 'two slips across the pieces of one fact'],
    ['L23: Kunne vi faktisk tatt det i morgen isteden', 'different words, not a slip'],
    ['L22: Kunne vi faktisk tatt det imrg istenden', 'the right words in the wrong message'],
  ])('%s → rejected (%s)', (quote) => {
    expect(tolerant(quote).problem).not.toBeNull();
  });
  it('a piece holding an email address gets no tolerance', () => {
    const lead = ['Please write to johnsmith@example.com about the villa'];
    expect(checkQuote('L1: write to johnsmitth@example.com', lead.map(norm), lead, new Set()).problem).not.toBeNull();
  });
  it('a month name gets no tolerance, in another language too', () => {
    const lead = ['vi kommer i september for å se huset'];
    expect(checkQuote('L1: vi kommer i septembre for å se huset', lead.map(norm), lead, new Set()).problem).not.toBeNull();
    const pl = ['przyjedziemy we wrześniu obejrzeć dom'];
    expect(checkQuote('L1: przyjedziemy we wrzesniu obejrzeć dom', pl.map(norm), pl, new Set()).problem).not.toBeNull();
    // Inflected month forms the calendar data does not list: Russian and Finnish too.
    const ru = ['мы приедем в сентябре посмотреть дом'];
    expect(checkQuote('L1: мы приедем в сентябри посмотреть дом', ru.map(norm), ru, new Set()).problem).not.toBeNull();
    const fi = ['tulemme syyskuussa katsomaan taloa'];
    expect(checkQuote('L1: tulemme syyskuusa katsomaan taloa', fi.map(norm), fi, new Set()).problem).not.toBeNull();
  });
});

describe('every quote the checker has ever rejected is still rejected with the tolerance on', () => {
  it.each([
    ['L15: huset med basseng', "check 09-11: the agency's words"],
    ['L17: frittstående villaen | L17: 390 000 €', "check 09-11: the agency's listing price"],
    ['L22: Torsdag kl 17:00 passer | L23: Kunne vi faktisk tatt det imrg isteden', "check 09-11: stitched from the agency's confirmation"],
    ['L17: frittstående villaen, 390 000 €, IC-81596', "run 2: the agency's price and reference mixed in"],
    ['L17: hvor den ligger eksakt, hvilken tid er best for dere', 'run 2: two messages glued into one piece'],
    ['L17: frittstående villaen | L17: 3 soverom | L17: privat basseng', "run 3: words borrowed from the agency's listing"],
    ['L16: nær den norske skolen', 'run 3: a paraphrase of her words'],
    ['Ja det passer', 'no message named'],
    ['L9: Ja det passer', 'the wrong message'],
    ['L24: Ja det passer', 'no such message'],
  ])('%s → rejected (%s)', (quote) => {
    expect(tolerant(quote).problem).not.toBeNull();
  });
});
