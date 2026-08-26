import { describe, it, expect } from 'vitest';
import {
  splitSentences, countWords, countQuestionSentences, lintDraft,
  screenBannedPatterns, screenPaymentDetails, cooldownOk, validateDraft, COOLDOWN_MS,
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
