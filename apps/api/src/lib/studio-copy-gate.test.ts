import { describe, expect, it } from 'vitest';

import { trimWords } from './studio-copy-gate';

/**
 * REGRESSION: a generated card shipped ending "timelines still vary by court and".
 *
 * The old trim cut at a word boundary, which is not a thought boundary. A reader cannot see the
 * character cap — a body ending on a connective just reads as a broken product. Cosmetic failures
 * trim and send; they never fail the run, so the trim itself has to produce something sendable.
 */
describe('trimWords', () => {
  it('leaves anything inside the budget untouched', () => {
    expect(trimWords('Short enough already.', 250)).toBe('Short enough already.');
    expect(trimWords(undefined, 250)).toBe(undefined);
  });

  it('never ends on a dangling connective', () => {
    const DANGLE = /\s(?:and|or|but|so|because|since|while|with|without|for|from|to|of|in|on|at|by|as|that|which|than|per|y|o|pero|con|sin|para|de|en|por|como|que|a)$/i;
    const cases: [string, number][] = [
      ['Since 3 April 2025 the rule changed. Before the reform, courts averaged 23.2 months nationally — timelines still vary by court and jurisdiction.', 150],
      ['One idea here and another idea there and a third that runs long and', 40],
      ['The withholding is only an advance against the final bill, and it is settled later by', 60],
      ['Buyers notice the gap before they ever ask about the house, which is why', 55],
      ['Precio, notaría, registro y gestoría se descuentan del importe final para', 50],
    ];
    for (const [text, max] of cases) {
      const out = trimWords(text, max) as string;
      expect(out.length).toBeLessThanOrEqual(max);
      expect(out, `dangling connective left in: ${JSON.stringify(out)}`).not.toMatch(DANGLE);
      expect(out).not.toMatch(/[\s,;:—–-]$/);
    }
  });

  it('prefers the last complete sentence when one lands past half the budget', () => {
    const text = 'The bank is paid off from the proceeds at completion, before you ever see a cent. '
      + 'A cancellation cost applies on top of that, and it varies by lender.';
    expect(trimWords(text, 110))
      .toBe('The bank is paid off from the proceeds at completion, before you ever see a cent.');
  });

  it('takes the word cut when the only sentence end is too early to be worth it', () => {
    // Cutting back to a very short first sentence throws away most of the budget. A clean word cut
    // that does not dangle is the better trade — the reader sees a finished phrase either way.
    const text = 'The bank is paid off at completion. A cancellation cost applies on top of that, and it varies by lender.';
    const out = trimWords(text, 80) as string;
    expect(out.length).toBeGreaterThan(40);
    expect(out).not.toMatch(/\s(?:and|of|by|on|to)$/i);
  });

  it('falls back to a word cut when no sentence fits inside the budget', () => {
    const text = 'An exclusive mandate hands the sale to a single agency for a set period of three to six months.';
    const out = trimWords(text, 40) as string;
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.split(' ').length).toBeGreaterThan(3);
    expect(text.startsWith(out)).toBe(true);
  });
});
