import { describe, it, expect } from 'vitest';
import {
  splitSentences, countWords, countQuestionSentences, lintDraft,
  screenBannedPatterns, screenPaymentDetails, cooldownOk, validateDraft, COOLDOWN_MS,
  normalizeLeadLanguage, screenLanguageDrift, screenOfficePromise,
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
