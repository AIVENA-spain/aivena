import { describe, expect, it } from 'vitest';

import { BANK_CARDS } from './studio-bank.generated';
import { bankIndex, cardRules, getCard, keywordCandidates, parseCardPick } from './studio-bank-match';

describe('the bank reaches the engine', () => {
  it('carries every card', () => {
    expect(BANK_CARDS.length).toBe(120);
    expect(BANK_CARDS.filter((c) => c.bank === 'seller')).toHaveLength(68);
    expect(BANK_CARDS.filter((c) => c.bank === 'buyer')).toHaveLength(52);
  });

  it('carries the guardrail that a live post violated', () => {
    // The whole point of the wiring. B12 forbids the exact sentence post B published.
    const b12 = getCard('B12');
    expect(b12).toBeDefined();
    expect(b12!.never.join(' ')).toMatch(/never state that spain now evicts squatters in 15 days/i);
    expect(cardRules(b12!)).toMatch(/15 days/);
  });

  it('never leaks the guardrails as something to write about', () => {
    expect(cardRules(getCard('B12')!)).toMatch(/INTERNAL — never quote them/);
  });
});

describe('parseCardPick', () => {
  it('reads an id however the model spells it', () => {
    expect(parseCardPick('B12')).toBe('B12');
    expect(parseCardPick('The best match is b-12.')).toBe('B12');
    expect(parseCardPick('S1')).toBe('S1');
  });
  it('refuses NONE and ids that do not exist', () => {
    expect(parseCardPick('NONE')).toBeNull();
    expect(parseCardPick('B999')).toBeNull();
    expect(parseCardPick('')).toBeNull();
  });
});

describe('keywordCandidates (the fallback when the model pick fails)', () => {
  it('ranks the squatter card first for a squatter topic', () => {
    const top = keywordCandidates('Could squatters take your Costa Blanca holiday home?');
    expect(top[0]?.id).toBe('B12');
  });
  it('returns nothing rather than a bad guess', () => {
    // Most typed topics are not in the bank, and the wrong card hands the writer the wrong
    // guardrails. Both an unrelated topic and a weak cross-language near-miss must come back empty.
    expect(keywordCandidates('zzzq wumbo flibbertigibbet')).toHaveLength(0);
    expect(keywordCandidates('¿Pueden los okupas quedarse con tu vivienda?')).toHaveLength(0);
  });

  it('puts clear daylight between the winner and the runner-up when it does match', () => {
    const top = keywordCandidates('Could squatters take your Costa Blanca holiday home?');
    expect(top[0].id).toBe('B12');
    expect(top[0].score).toBeGreaterThan(top[1].score * 1.5);
  });
});

describe('bankIndex', () => {
  it('fits in one prompt and lists every card exactly once', () => {
    const idx = bankIndex();
    const lines = idx.split('\n');
    expect(lines).toHaveLength(120);
    expect(new Set(lines.map((l) => l.split(' | ')[0])).size).toBe(120);
    expect(idx.length).toBeLessThan(24_000);
  });
});
