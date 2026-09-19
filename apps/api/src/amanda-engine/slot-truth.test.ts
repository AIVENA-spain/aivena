import { describe, it, expect } from 'vitest';
import { slotsNotShown, relativeDayMismatches, slotLine, proposedSlotsThisTurn, type ProposedSlots } from './slot-truth';
import { splitSentences } from './validators';

// The live 2026-09-19 case: Saturday 19 September 08:46 UTC (10:46 Madrid);
// proposals Monday 21 September 11:00 and 12:00 Madrid.
const NOW = Date.parse('2026-09-19T08:46:00Z');
const LIVE: ProposedSlots = {
  timezone: 'Europe/Madrid',
  slots: [
    { label: 'Monday 21 September, 11:00', startISO: '2026-09-21T09:00:00.000Z', pendingActionId: 'a' },
    { label: 'Monday 21 September, 12:00', startISO: '2026-09-21T10:00:00.000Z', pendingActionId: 'b' },
  ],
};

describe('slotsNotShown — the buyer must see each time and its day', () => {
  it('the live reply showed neither', () => {
    const live = 'La meg sjekke hva vi har ledig i morgen, så kommer jeg straks tilbake med tider.';
    expect(slotsNotShown(live, LIVE, 'nb')).toHaveLength(2);
  });
  it.each([
    ['en', 'I can do Monday 21 September at 11:00 or 12:00 — which suits you?'],
    ['nb', 'Jeg kan tilby mandag 21. september kl. 11:00 eller kl. 12:00.'],
    ['da', 'Jeg kan tilbyde mandag kl. 11.00 eller 12.00.'],
    ['fi', 'Voin tarjota maanantaina 21.9. klo 11.00 tai 12.00.'],
    ['de', 'Ich hätte Montag, 21. September um 11 Uhr oder 12 Uhr.'],
    ['fr', 'Je peux vous proposer lundi 21 septembre à 11h00 ou 12h00.'],
    ['es', 'Tengo el lunes 21 a las 11:00 o a las 12:00.'],
    ['ru', 'Могу предложить понедельник, 21 сентября, в 11:00 или в 12:00.'],
    ['pl', 'Mogę zaproponować poniedziałek 21 września o 11:00 lub 12:00.'],
  ])('%s: both times with their day count as shown', (lang, text) => {
    expect(slotsNotShown(text, LIVE, lang)).toEqual([]);
  });
  it('a time without its day is not shown', () => {
    expect(slotsNotShown('I have 11:00 or 12:00 free.', LIVE, 'en')).toHaveLength(2);
  });
  it('one of two times missing is reported', () => {
    expect(slotsNotShown('Monday 21 September at 11:00 works.', LIVE, 'en').map((s) => s.label)).toEqual(['Monday 21 September, 12:00']);
  });
});

describe('relativeDayMismatches — "today/tomorrow" must be a proposed day', () => {
  it('the live "i morgen" (Sunday) contradicts the Monday slots', () => {
    expect(relativeDayMismatches('La meg sjekke hva vi har ledig i morgen.', LIVE, NOW)).toEqual(['i morgen']);
  });
  it('the day after tomorrow IS Monday here', () => {
    expect(relativeDayMismatches('I overmorgen, mandag 21., har jeg 11:00 og 12:00.', LIVE, NOW)).toEqual([]);
    expect(relativeDayMismatches('Pasado mañana, lunes 21, a las 11:00.', LIVE, NOW)).toEqual([]);   // not also "mañana"
  });
  it.each(['tomorrow', 'mañana', 'morgen', 'demain', 'domani', 'amanhã', 'jutro', 'imorgon', 'i morgen', 'huomenna', 'завтра'])(
    '"%s" is tomorrow in its language',
    (w) => expect(relativeDayMismatches(`Free ${w} at 11:00`, LIVE, NOW)).toHaveLength(1),
  );
  it('greetings and "in the morning" are not days', () => {
    expect(relativeDayMismatches('God morgen! Por la mañana tengo hueco. Guten Morgen.', LIVE, NOW)).toEqual([]);
  });
  it('no proposals this turn → nothing to contradict', () => {
    expect(relativeDayMismatches('See you tomorrow!', { slots: [], timezone: 'Europe/Madrid' }, NOW)).toEqual([]);
  });
});

describe('slotLine — the deterministic fallback line', () => {
  it('writes both times with their localized day, and asks once', () => {
    const nb = slotLine(LIVE, 'nb', true);
    expect(nb).toBe('Ledige visningstider: mandag 21. september, 11:00 eller mandag 21. september, 12:00. Hvilken passer best for deg?');
    expect(slotsNotShown(nb, LIVE, 'nb')).toEqual([]);
  });
  it('omits the question when the reply already asks one', () => {
    expect(slotLine(LIVE, 'en', false)).toBe('Free viewing times: Monday 21 September, 11:00 or Monday 21 September, 12:00.');
  });
  it.each(['en', 'es', 'de', 'nl', 'fr', 'it', 'pt', 'pl', 'sv', 'nb', 'da', 'fi', 'ru'])('%s: the line it writes passes its own check', (lang) => {
    expect(slotsNotShown(slotLine(LIVE, lang, true), LIVE, lang)).toEqual([]);
  });
});

describe('proposedSlotsThisTurn', () => {
  it('reads slots and timezone from successful propose_viewing_slots events only', () => {
    const p = proposedSlotsThisTurn([
      { tool: 'search_properties', result: { ok: true, data: {} } },
      { tool: 'propose_viewing_slots', result: { ok: false, refused: 'mode' } },
      { tool: 'propose_viewing_slots', result: { ok: true, refused: null, data: { slots: LIVE.slots, timezone: 'Europe/Madrid' } } },
    ]);
    expect(p.slots).toHaveLength(2);
    expect(p.timezone).toBe('Europe/Madrid');
  });
});

describe('dates and times are not sentence ends (shape law, 2026-09-19)', () => {
  it('Nordic/German/Finnish date and time formats count as one sentence', () => {
    expect(splitSentences('Jeg kan tilby fredag 28. august kl. 17:00 eller lørdag 29. august kl. 11:00. Hva passer?')).toHaveLength(2);
    expect(splitSentences('Voin tarjota maanantaina 21.9. klo 11.00 tai 12.00. Sopiiko?')).toHaveLength(2);
    expect(splitSentences('Ich hätte Montag, 21. September um 11 Uhr. Passt das?')).toHaveLength(2);
  });
  it('a real new sentence after a number still splits', () => {
    expect(splitSentences('Den koster 245 000 kr. Vil du se den?')).toHaveLength(2);
    expect(splitSentences('The price is 245000. Want the details?')).toHaveLength(2);
  });
});
