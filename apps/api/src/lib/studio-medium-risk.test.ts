import { describe, expect, it } from 'vitest';
import { canonicalWithinExcerpt, checkCta, isSpecificLocalOrCurrent, mechanismAllowed } from './studio-evidence';

/**
 * Christian, 2026-09-05: a medium-risk claim may stand on ordinary reasoning — but not when it is a
 * specific local or current fact wearing a qualitative coat.
 */
describe('what may stand without a source', () => {
  it.each([
    'Five versions of the same property can create conflicting messaging.',
    'A description full of square metres reads like a spec sheet.',
    'One accountable agent means one line of proof.',
    'A home that feels cared for photographs better.',
    'Photograph the room people will actually sit in.',
  ])('allows ordinary reasoning: %s', (t) => expect(mechanismAllowed(t).ok).toBe(true));

  /**
   * RECLASSIFIED 2026-09-09, deliberately. These two were approved here as ordinary reasoning under
   * the earlier policy. Christian's rule after generation 22d45453 supersedes it: "These are not
   * harmless generic reasoning just because they have no number. They are claims about buyer
   * behaviour, negotiation, sale outcomes and financial consequences."
   *
   * Both say how buyers actually react to a price or to time on the market. They stay MEDIUM — they
   * are not figures — but MEDIUM now means "grounded in something", not "waved through".
   */
  it.each([
    'Launching too high can make buyers hesitate.',
    'A listing that sits for a long time can make buyers wonder why.',
  ])('now asks for grounding on a claim about how the market behaves: %s', (t) => {
    expect(mechanismAllowed(t).ok).toBe(false);
    expect(mechanismAllowed(t).why).toMatch(/how buyers, sellers or listings actually behave/);
  });

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

  /**
   * The topic that broke this open: "golf course community or old town square — which one fits your
   * actual daily habits". A deck about where to live is made of seasonal rhythm and daily routine.
   * Every one of these was refused as a specific current claim, which left a lifestyle post with
   * nothing it was allowed to say.
   */
  it.each([
    'A resort tends to empty out in winter, while a working town keeps its rhythm all year.',
    'Summer flatters everywhere; a Tuesday in November tells you more.',
    'Off-season is when you find out whether the bakery stays open.',
  ])('allows a seasonal rhythm, which recurs rather than dates: %s', (t) => {
    expect(isSpecificLocalOrCurrent(t)).toBe(false);
    expect(mechanismAllowed(t).ok).toBe(true);
  });

  it.each([
    'Moraira is quieter in winter than Calpe.',       // a named place
    'The population triples in summer.',              // a figure
    'German buyers arrive in spring.',                // a market nationality
    'Right now the winter lets are gone.',            // an actual currency marker
  ])('still refuses a season attached to a real claim: %s', (t) => {
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
  // The H4 error, one link earlier: a NATIONAL figure attached to a province. The guard used to be
  // skipped whenever the excerpt named no place at all, which is exactly when this happens.
  it('refuses a national figure re-labelled as a provincial one', () => {
    const r = F('Reino Unido 6,99% de las compras de extranjeros a nivel nacional',
      'British buyers lead Alicante province with 6.99% of purchases.');
    expect(r.ok).toBe(false);
    expect(r.why).toMatch(/moves the fact to alicante/);
  });

  // A country of ORIGIN is a nationality, not a geography. "Países Bajos" and "Dutch buyers" are the
  // same fact, and treating the country as a place threw away every nationality fact H4 needed.
  it('does not treat a nationality as a change of geography', () => {
    expect(F('Reino Unido 6,99%, Países Bajos 6,94%, Alemania 6,11% de las compras de extranjeros',
      'UK buyers led nationally with 6.99%, ahead of the Netherlands at 6.94% and Germany at 6.11%.').ok)
      .toBe(true);
  });

  // A Spanish table giving both a share and a count is not a share alone.
  it('does not call a count a share when the source gives both in Spanish', () => {
    expect(F('Países Bajos: 3.708 operaciones (12,53%) en Alicante en 2025',
      'Dutch buyers completed 3,708 purchases in Alicante province in 2025, 12.53% of all sales.').ok)
      .toBe(true);
  });

  it('lets a statute be stated plainly in another language', () => {
    expect(F('Artículo 1450. La venta se perfeccionará entre comprador y vendedor, y será obligatoria para ambos',
      'A sale is perfected and binding on both parties once the thing and the price are agreed.').ok).toBe(true);
  });
});
