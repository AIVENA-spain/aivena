import { describe, expect, it } from 'vitest';
import { canonicalWithinExcerpt, checkCta, isSpecificLocalOrCurrent, mechanismAllowed } from './studio-evidence';

/**
 * Christian, 2026-09-05: a medium-risk claim may stand on ordinary reasoning — but not when it is a
 * specific local or current fact wearing a qualitative coat.
 */
describe('what may stand without a source', () => {
  it.each([
    'Launching too high can make buyers hesitate.',
    'Five versions of the same property can create conflicting messaging.',
    'A listing that sits for a long time can make buyers wonder why.',
    'A description full of square metres reads like a spec sheet.',
    'One accountable agent means one line of proof.',
  ])('allows ordinary reasoning: %s', (t) => expect(mechanismAllowed(t).ok).toBe(true));

  it.each([
    'Moraira is quieter in winter than Calpe.',
    'Parking is harder in Dénia.',
    'Dutch buyers dominate Jávea.',
    'This neighbourhood is mostly permanent residents.',
    'This portal pushes old listings down.',
    'Right now the market is turning.',
  ])('refuses a local or current fact in a qualitative coat: %s', (t) => {
    expect(isSpecificLocalOrCurrent(t)).toBe(true);
    expect(mechanismAllowed(t).ok).toBe(false);
  });

  it('refuses a tendency written as a law of nature', () => {
    expect(mechanismAllowed('Overpricing always costs you the first two weeks.').ok).toBe(false);
    expect(mechanismAllowed('Overpricing can cost you the first two weeks.').ok).toBe(true);
  });
});

describe('a CTA is a capability question, not an evidence one', () => {
  const CAP = 'Works in: Jávea, Moraira, Dénia, Teulada. Mandate types offered: both.';
  it.each([
    "Comment ARRAS and let's talk.",
    'Message us if you are thinking of selling.',
    'Comment COAST and tell us which town you are considering.',
  ])('leaves a generic invitation alone: %s', (t) => expect(checkCta(t, CAP).ok).toBe(true));

  it.each([
    ["Comment ARRAS and we'll send you the full guide.", 'Comment ARRAS'],
    ["Comment PRICE and we'll send you a valuation.", 'Comment PRICE'],
    ["Comment PHOTO and we'll arrange drone photography.", 'Comment PHOTO'],
  ])('rewrites an unsupported promise instead of failing the post: %s', (t, head) => {
    const d = checkCta(t, CAP);
    expect(d.ok).toBe(false);
    expect(d.rewrite).toBe(`${head} and we'll talk you through the key points.`);
    expect(d.rewrite).not.toMatch(/send you|arrange/);
  });

  it('allows a promise the agency actually makes', () => {
    expect(checkCta("Comment PRICE and we'll send you a valuation.",
      `${CAP} Services: valuation, listing photography.`).ok).toBe(true);
  });
});

describe('the canonical fact may translate but never conclude', () => {
  const F = (excerpt: string, canonical: string) => canonicalWithinExcerpt({ excerpt, canonical });
  const NL = 'Países Bajos: 3.708 operaciones en Alicante en 2025';

  it("accepts Christian's valid example", () => {
    expect(F(NL, 'Dutch buyers completed 3,708 purchases in Alicante province in 2025.').ok).toBe(true);
  });
  it("refuses Christian's invalid example", () => {
    const r = F(NL, 'Dutch buyers became the dominant group across the Costa Blanca.');
    expect(r.ok).toBe(false);
  });
  it.each([
    ['Calp llega a albergar 167.707 personas en temporada alta',
      'Calpe has a peak-season population of 167,707 residents.', /capacity into a population/],
    ['precio de oferta medio 3.404 €/m² en Dénia',
      'Homes in Dénia sold for an average of 3,404 €/m².', /asking price into a price someone paid/],
    ['El proyecto de ley propone un plazo de 15 días',
      'The law requires a 15-day deadline.', /proposal into law in force/],
    ['El comprador podrá desistir del contrato',
      'The buyer must withdraw from the contract.', /possibility into an obligation/],
    [NL, 'Dutch buyers completed 3,708 purchases in Málaga in 2025.', /moves the fact to/],
    ['Países Bajos: 3.708 operaciones en Alicante',
      'Dutch buyers completed 3,708 purchases in Alicante in 2024.', /figure the excerpt does not contain/],
  ])('refuses: %s → %s', (excerpt, canonical, why) => {
    const r = F(excerpt, canonical);
    expect(r.ok).toBe(false);
    expect(r.why).toMatch(why as RegExp);
  });
  it('lets a statute be stated plainly in another language', () => {
    expect(F('Artículo 1450. La venta se perfeccionará entre comprador y vendedor, y será obligatoria para ambos',
      'A sale is perfected and binding on both parties once the thing and the price are agreed.').ok).toBe(true);
  });
});
