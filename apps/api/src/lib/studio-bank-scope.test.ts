import { describe, expect, it } from 'vitest';
import { BANK_CARDS } from './studio-bank.generated';
import { cardInScope, cardScope, getCard, outOfScopeReason, retrieveBankFacts } from './studio-bank-match';
import { placesIn } from './studio-copy-gate';

const card = (id: string) => {
  const c = getCard(id);
  if (!c) throw new Error(`bank card ${id} is gone — this test is about a real card`);
  return c;
};

describe('place extraction', () => {
  it('canonicalises the same town spelled differently', () => {
    expect(placesIn('Xàbia o Dénia')).toEqual(new Set(['javea', 'denia']));
    expect(placesIn('Calp vs Calpe')).toEqual(new Set(['calpe']));
  });
  it('finds nothing in a topic about no place', () => {
    expect(placesIn('Why your listing needs a reason to be remembered').size).toBe(0);
  });
});

describe('card scope', () => {
  it('reads B20 as a card about Jávea and Dénia', () => {
    expect(cardScope(card('B20'))).toEqual(new Set(['javea', 'denia']));
  });
  it('keeps B20 for the topic it was verified for', () => {
    expect(cardInScope(card('B20'), 'Jávea or Dénia — which life are you actually buying?')).toBe(true);
  });
  // THE H3 FAILURE: this exact pairing produced four unestablishable requirements
  it('refuses B20 for Moraira versus Calpe', () => {
    expect(cardInScope(card('B20'), 'Moraira or Calpe — where would you rather actually live all year?')).toBe(false);
    expect(outOfScopeReason(card('B20'), 'Moraira or Calpe — where would you rather live?'))
      .toMatch(/written about javea\/denia and the topic is about moraira\/calpe/);
  });
  it('refuses a place-scoped card for a topic that names no place', () => {
    expect(cardInScope(card('B20'), 'Which coastal town suits year-round living?')).toBe(false);
  });
  it('leaves subject cards general', () => {
    const general = BANK_CARDS.filter((c) => cardScope(c).size === 0);
    expect(general.length).toBeGreaterThan(50);
    expect(cardInScope(general[0], 'anything at all about Moraira')).toBe(true);
  });
});

describe('cross-bank guardrail retrieval', () => {
  // THE H4 FAILURE: the post matched B43 and published the exact thing B43 forbids
  it('retrieves the guardrail that a nationality ranking is national only', () => {
    const facts = retrieveBankFacts([
      'At province level, British buyers remain the largest foreign group, ahead of Germans and Dutch.',
      'Any claim that Dutch buyers have overtaken them applies nationally, not here.',
    ], 'buyer');
    expect(facts.map((f) => f.id)).toContain('B43#2');
    expect(facts.some((f) => f.kind === 'never' && /national ranking to Alicante province/i.test(f.text))).toBe(true);
  });
  // THE H1/H2 FAILURE: no card was matched at all, yet the bank covers the subject
  it('retrieves tax guardrails for a post that matched no card', () => {
    const facts = retrieveBankFacts([
      'Filing Modelo 210 late can forfeit your right to reclaim anything at all.',
      'The buyer withholds 3% of the price for the tax agency automatically.',
    ]);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.some((f) => /210|3\s?%|retenci|withh/i.test(f.text))).toBe(true);
  });
  it('does not drag guardrails in front of pure marketing', () => {
    expect(retrieveBankFacts(['Most property listings are forgettable.',
      'One sharp detail beats a full gallery.', 'A generic pool shot competes with a hundred others.'])).toEqual([]);
  });
  it('never returns a fact from a blocked card', () => {
    const ids = new Set(BANK_CARDS.filter((c) => c.state === 'blocked').map((c) => c.id));
    const facts = retrieveBankFacts(['squatters okupas usurpación allanamiento morada eviction']);
    for (const f of facts) expect(ids.has(f.cardId)).toBe(false);
  });
});
