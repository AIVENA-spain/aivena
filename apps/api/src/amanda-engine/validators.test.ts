import { describe, it, expect } from 'vitest';
import {
  splitSentences, countWords, countQuestionSentences, lintDraft,
  screenBannedPatterns, screenPaymentDetails, cooldownOk, validateDraft, COOLDOWN_MS,
  normalizeLeadLanguage, screenLanguageDrift, screenOfficePromise,
  isShapeOnly, trimToBudget, MEDIUM_MAX_WORDS, LONG_MAX_WORDS,
} from './validators';

describe('sentence + question counting', () => {
  it('splits multilingual sentences', () => {
    expect(splitSentences('Hola. ¿Te va bien el sábado? Genial')).toHaveLength(3);
  });
  it('counts question SENTENCES, not ? characters', () => {
    expect(countQuestionSentences('Would Saturday at 17:00 work? It has a pool.')).toBe(1);
    expect(countQuestionSentences('¿Te va bien? ¿O prefieres el domingo?')).toBe(2);
    expect(countQuestionSentences('The price is 245.000 euros.')).toBe(0);
  });
});

describe('lintDraft — length law (§10 B1) + question discipline (§10 B2)', () => {
  it('accepts a short warm reply', () => {
    expect(lintDraft('It has a private pool! Would you like to see it on Saturday?').ok).toBe(true);
  });
  it('rejects a wall of text in short mode', () => {
    const wall = Array(6).fill('This villa has an amazing feature you will love.').join(' ');
    const r = lintDraft(wall);
    expect(r.ok).toBe(false);
    expect(r.violations.join(',')).toMatch(/too_many_sentences|too_long/);
  });
  it('allows long-form when flagged, still capped at 120 words', () => {
    const long = Array(4).fill('The area is family friendly with beaches nearby and good schools.').join(' ');
    expect(lintDraft(long, { allowLongForm: true }).ok).toBe(true);
    const tooLong = Array(15).fill('The area is family friendly with beaches nearby and very good schools.').join(' ');
    expect(lintDraft(tooLong, { allowLongForm: true }).ok).toBe(false);
  });
  it('rejects stacked questions (never interrogate)', () => {
    const r = lintDraft('What is your budget? And when do you want to move?');
    expect(r.ok).toBe(false);
    expect(r.violations).toContain('multiple_questions');
  });
  it('enforces the mirror band against a terse buyer', () => {
    const r = lintDraft('Here are three lovely sentences about this villa with many nice words in each one now.', { mirrorTargetWords: 8 });
    expect(r.ok).toBe(false);
    expect(r.violations.join(',')).toMatch(/mirror_band/);
  });
});

describe('banned-pattern screen (§10 B5)', () => {
  it.each([
    'This is your last chance to see it!',
    'It won’t last long at this price.',
    'There are many other interested buyers.',
    'Reserve today or it will be gone.',
    'You still haven’t replied to my message.',
    'Es tu última oportunidad, actúa ya.',
    'Hay muchos compradores interesados, solo hoy.',
  ])('blocks pushy phrasing: %s', (text) => {
    expect(screenBannedPatterns(text).ok).toBe(false);
  });
  it('passes honest, calm copy — including factual trip urgency (§11.13)', () => {
    expect(screenBannedPatterns('Since you fly home on Friday, shall we fit both viewings on Thursday?').ok).toBe(true);
    expect(screenBannedPatterns('The owner will consider offers around 5% below asking.').ok).toBe(true);
  });
});

describe('deliver-now law — no self future promises (Christian, live demo 2026-08-27)', () => {
  it.each([
    'Jeg sjekker nye boliger nå. Kommer straks tilbake med konkrete alternativer!',
    'Hei igjen! Jeg sender deg forslag straks.',
    "I'll get back to you shortly with some great options.",
    'Let me come back to you with a few listings.',
    'Te mando opciones enseguida.',
    'Kommer tillbaka strax med några förslag.',
  ])('blocks: %s', (text) => {
    const r = screenBannedPatterns(text);
    expect(r.ok).toBe(false);
    expect(r.matched.join(',')).toContain('self_future_promise');
  });
  it('the OFFICE promising to come back stays legal (§3b relay promise)', () => {
    expect(screenBannedPatterns("Good question — I'll check with the office and come back to you with their answer.").ok).toBe(true);
    expect(screenBannedPatterns('Jeg sjekker med kontoret og kommer straks tilbake til deg med svaret.').ok).toBe(true);
  });
  it('acting NOW stays legal', () => {
    expect(screenBannedPatterns('I found two villas in San Javier that fit — want the details?').ok).toBe(true);
    expect(screenBannedPatterns('Jeg fant to boliger som passer: en i San Javier og en i Los Alcázares.').ok).toBe(true);
  });
});

describe('language law (live demo 2026-08-27: "no" lead got English)', () => {
  it('normalizes aliases and region tags; empty stays null', () => {
    expect(normalizeLeadLanguage('no')).toBe('nb');
    expect(normalizeLeadLanguage('NO')).toBe('nb');
    expect(normalizeLeadLanguage('nn')).toBe('nb');
    expect(normalizeLeadLanguage('pt-BR')).toBe('pt');
    expect(normalizeLeadLanguage('sv')).toBe('sv');
    expect(normalizeLeadLanguage('')).toBeNull();
    expect(normalizeLeadLanguage(null)).toBeNull();
  });
  it('blocks the exact live English drift against a Norwegian lead', () => {
    const live = "I can't promise these are the very newest, but here are two current listings within about 20 minutes of Torrevieja, both with a communal pool. Want more details on either, or should I keep looking?";
    expect(screenLanguageDrift(live, 'no').ok).toBe(false);
    expect(screenLanguageDrift(live, 'nb').ok).toBe(false);
  });
  it('passes Norwegian, Spanish, German drafts against their own language', () => {
    expect(screenLanguageDrift('Hei igjen Marte! Jeg fant to leiligheter i Torrevieja med felles svømmebasseng som kan passe deg veldig godt.', 'no').ok).toBe(true);
    expect(screenLanguageDrift('¡Hola! He encontrado dos apartamentos en Torrevieja con piscina comunitaria que podrían encajar contigo.', 'es').ok).toBe(true);
    expect(screenLanguageDrift('Hallo! Ich habe zwei Wohnungen in Torrevieja mit Gemeinschaftspool gefunden, die gut passen könnten.', 'de').ok).toBe(true);
  });
  it('skips when the lead language IS English, is unknown, or the draft is tiny', () => {
    expect(screenLanguageDrift('Here are the details you asked about for the villa with the pool.', 'en').ok).toBe(true);
    expect(screenLanguageDrift('Here are the details you asked about for the villa with the pool.', 'xx').ok).toBe(true);
    expect(screenLanguageDrift('Ok!', 'no').ok).toBe(true);
  });
  it('review-pinned false positives stay legal: German marker-collisions, Russian with Latin catalogue names', () => {
    expect(screenLanguageDrift('Ich will also mehr Details zum Apartment im Bungalow sehen, gerne mit Terrasse.', 'de').ok).toBe(true);
    expect(screenLanguageDrift('Я нашла для вас два варианта: Apartment in Orihuela Costa и Bungalow in San Miguel, оба с бассейном рядом. Хотите узнать подробности об одном из них?', 'ru').ok).toBe(true);
  });
});

describe('office-promise law (live demo 2026-08-27: promised checks, no ticket)', () => {
  it.each([
    'Jeg dobbeltsjekker med kontoret at den fortsatt er tilgjengelig til denne prisen.',
    'Jeg sjekker med kontoret og kommer tilbake til deg.',
    "I'll double-check current status with the office.",
    'Lo confirmo con la oficina y te digo.',
    'Ich kläre das mit dem Büro.',
  ])('without a filed question, blocks: %s', (text) => {
    expect(screenOfficePromise(text, false).ok).toBe(false);
  });
  it('the same promises are legal when the ticket machinery backs them', () => {
    expect(screenOfficePromise('Jeg sjekker med kontoret og kommer tilbake til deg.', true).ok).toBe(true);
  });
  it('OFFERS (questions) are always legal — that is the desired stale-listing hedge', () => {
    expect(screenOfficePromise('Vil du at jeg skal sjekke med kontoret?', false).ok).toBe(true);
    expect(screenOfficePromise('Want me to confirm the current status with the office?', false).ok).toBe(true);
  });
  it('mentioning the office without a check-verb stays legal', () => {
    expect(screenOfficePromise('The office is open Monday to Friday from 9:30.', false).ok).toBe(true);
  });
  it('review-pinned false positives stay legal: home office + double bedroom vocabulary', () => {
    expect(screenOfficePromise('It has a home office and a double bedroom facing the pool.', false).ok).toBe(true);
    expect(screenOfficePromise('The apartment offers a bright home office you could double as a guest room.', false).ok).toBe(true);
  });
  it('review-pinned false negatives now blocked: fr / it / pl / ru office promises', () => {
    expect(screenOfficePromise('Je vérifie avec le bureau et je reviens vers vous.', false).ok).toBe(false);
    expect(screenOfficePromise("Controllo con l'ufficio e ti faccio sapere.", false).ok).toBe(false);
    expect(screenOfficePromise('Sprawdzę to w biurze i dam znać.', false).ok).toBe(false);
    expect(screenOfficePromise('Я проверю в офисе и вернусь к вам с ответом.', false).ok).toBe(false);
  });
  it('validateDraft wires both laws when their context is provided', () => {
    const r = validateDraft("I'll double-check with the office and come back to you.", { expectedLanguage: 'no', officeContextPresent: false });
    expect(r.ok).toBe(false);
    expect(r.violations.join(',')).toMatch(/office_promise_without_filed_question/);
    expect(r.violations.join(',')).toMatch(/wrong_language/);
  });
});

describe('tourist-rental legality floor (buyer-research 2026-08-28)', () => {
  it.each([
    'You can definitely rent it out on Airbnb when you are not using it.',
    'The tourist licence transfers with the property, no problem.',
    'Se puede alquilar sin problema en verano.',
    'Du kan trygt leie den ut når dere ikke er der.',
  ])('blocks assertive rentability claims: %s', (text) => {
    const r = screenBannedPatterns(text);
    expect(r.ok).toBe(false);
    expect(r.matched.join(',')).toContain('rental_legality_claim');
  });
  it('relaying the OFFICE\'s written rental answer stays legal (§3b)', () => {
    expect(screenBannedPatterns('The office confirms the tourist licence transfers with the property.').ok).toBe(true);
  });
  it('routing the question stays legal', () => {
    expect(screenBannedPatterns('That one is worth getting exactly right — I have asked the office to confirm the licence for this property.').ok).toBe(true);
  });
});

describe('payments/IBAN floor (§11.5) — existential guard', () => {
  it('blocks an IBAN in any casing/spacing', () => {
    expect(screenPaymentDetails('Please transfer to ES91 2100 0418 4502 0005 1332').ok).toBe(false);
    expect(screenPaymentDetails('iban: es9121000418450200051332').ok).toBe(false);
    expect(screenPaymentDetails('Send it to DE89370400440532013000 today').ok).toBe(false);
  });
  it('blocks long digit runs near payment vocabulary', () => {
    expect(screenPaymentDetails('Make the deposit to account number 0049 1500 04 2810355721').ok).toBe(false);
  });
  it('passes prices, refs and phone-free chat', () => {
    expect(screenPaymentDetails('The asking price is 245.000 euros for IC-28746.').ok).toBe(true);
    expect(screenPaymentDetails('A 10% deposit is customary at contract stage — María will guide you.').ok).toBe(true);
  });
});

describe('cooldown clock (§10 B5)', () => {
  it('refuses an uninvited double-text inside the window', () => {
    expect(cooldownOk(1_000_000, 1_000_000 + COOLDOWN_MS - 1, false)).toBe(false);
  });
  it('allows after the window, when invited, or when never sent', () => {
    expect(cooldownOk(1_000_000, 1_000_000 + COOLDOWN_MS, false)).toBe(true);
    expect(cooldownOk(1_000_000, 1_000_001, true)).toBe(true);
    expect(cooldownOk(null, 5, false)).toBe(true);
  });
});

describe('validateDraft — the combined law', () => {
  it('collects violations across all validators', () => {
    const r = validateDraft('Last chance! Transfer to ES91 2100 0418 4502 0005 1332 now. What is your budget? When can you fly?');
    expect(r.ok).toBe(false);
    expect(r.violations.join(',')).toMatch(/banned:/);
    expect(r.violations.join(',')).toMatch(/payment_floor:/);
    expect(r.violations).toContain('multiple_questions');
  });
  it('passes the kind of message Amanda should actually send', () => {
    expect(validateDraft('I checked with the office — they say there is some room on the price. Would you like me to set up a viewing?').ok).toBe(true);
  });
});

/**
 * The live failure this pins (Christian 2026-08-29): Amanda researched the
 * Norwegian school, wrote a correct 42-word answer, and the 35-word cap binned
 * it — the buyer got a holding line and the agent got a take-over card for a
 * question she had already answered. Shape must never be treated as truth.
 */
describe('isShapeOnly — only cosmetic failures may be rescued', () => {
  it('length and sentence-count failures are shape', () => {
    expect(isShapeOnly(['too_long:42w>35w'])).toBe(true);
    expect(isShapeOnly(['too_long:42w>35w', 'too_many_sentences:4>3'])).toBe(true);
    expect(isShapeOnly(['mirror_band:30w>20w'])).toBe(true);
    expect(isShapeOnly(['multiple_questions'])).toBe(true);
  });

  it('truth and safety failures are NEVER shape', () => {
    for (const v of [
      'ungrounded_numbers:450000',
      'verifier_rejected',
      'verifier_unavailable',
      'banned:act now',
      'payment_floor:iban',
      'wrong_language_WRITE_THE_WHOLE_REPLY_IN_nb_not_English',
      'office_promise_without_filed_question_CALL_ask_agency_or_DROP_the_promise',
    ]) {
      expect(isShapeOnly([v])).toBe(false);
    }
  });

  it('one truth failure poisons an otherwise cosmetic set', () => {
    expect(isShapeOnly(['too_long:42w>35w', 'ungrounded_numbers:450000'])).toBe(false);
  });

  it('an empty failure list is not a rescue case', () => {
    expect(isShapeOnly([])).toBe(false);
  });
});

describe('trimToBudget — removes text, never invents it', () => {
  it('keeps whole sentences from the front until the budget is spent', () => {
    const draft = 'Yes, there are two homes a short walk from the Norwegian school. One is a three-bed villa. The other is a townhouse with a pool. Shall I send you the details?';
    const out = trimToBudget(draft, 20);
    expect(countWords(out)).toBeLessThanOrEqual(20);
    expect(draft.startsWith(out.slice(0, 40))).toBe(true);
  });

  it('never emits a truncated fragment — a single over-budget sentence is kept whole', () => {
    const one = 'This is one single very long sentence that runs well past any budget we might set for it here';
    expect(trimToBudget(one, 5)).toBe(one);
  });

  it('leaves a draft that already fits completely alone', () => {
    const short = 'Yes, two homes are near that school.';
    expect(trimToBudget(short, 35)).toBe(short);
  });

  it('output is always a substring-prefix of the original words (no new facts)', () => {
    const draft = 'The villa is in Quesada. It has a private pool. Viewings are possible this week.';
    const out = trimToBudget(draft, 10);
    const dw = draft.split(/\s+/);
    out.split(/\s+/).forEach((w, i) => expect(dw[i]).toBe(w));
  });
});

/**
 * Christian 2026-08-29, after the researched answer finally reached the buyer:
 * "she answered way too long and not really confident warm". Widening long-form
 * to research/search was right, but handing those turns the full 120-word
 * property-summary budget produced a bullet-pointed report. The middle tier is
 * the fix, and these pin it so it cannot quietly drift back to 120.
 */
describe('the middle length tier — a chat message, not a brochure', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ') + '.';

  it('a research/search turn is capped at the medium budget, not the full one', () => {
    const draft = words(MEDIUM_MAX_WORDS + 10);
    const r = lintDraft(draft, { allowLongForm: true, longFormBudget: MEDIUM_MAX_WORDS });
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.startsWith('too_long:'))).toBe(true);
  });

  it('the same draft passes when the turn genuinely earned the full budget', () => {
    const draft = words(MEDIUM_MAX_WORDS + 10);
    expect(lintDraft(draft, { allowLongForm: true, longFormBudget: LONG_MAX_WORDS }).ok).toBe(true);
  });

  it('medium keeps sentence discipline — 65 words in nine clipped lines is still a report', () => {
    const draft = Array.from({ length: 9 }, (_, i) => `Line ${i} is here.`).join(' ');
    const r = lintDraft(draft, { allowLongForm: true, longFormBudget: MEDIUM_MAX_WORDS });
    expect(r.violations.some((v) => v.startsWith('too_many_sentences:'))).toBe(true);
  });

  it('the full tier is not sentence-capped — a property summary may run longer', () => {
    const draft = Array.from({ length: 9 }, (_, i) => `Line ${i} is here.`).join(' ');
    const r = lintDraft(draft, { allowLongForm: true, longFormBudget: LONG_MAX_WORDS });
    expect(r.violations.some((v) => v.startsWith('too_many_sentences:'))).toBe(false);
  });

  it('an over-long medium answer is rescued by trimming, never escalated', () => {
    const draft = 'The Norwegian school is in Ciudad Quesada. ' + words(MEDIUM_MAX_WORDS + 20);
    const failures = lintDraft(draft, { allowLongForm: true, longFormBudget: MEDIUM_MAX_WORDS }).violations;
    expect(isShapeOnly(failures)).toBe(true);
    expect(countWords(trimToBudget(draft, MEDIUM_MAX_WORDS))).toBeLessThanOrEqual(MEDIUM_MAX_WORDS);
  });
});
