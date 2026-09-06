import { describe, expect, it } from 'vitest';
import { numero } from '../../../../studio/engine/carouselSlides';

/**
 * A live English deck rendered "Nº 02 — 05" in the folio and a hardcoded "Nº 1 DE 3" above the
 * headline, beside a third decorative numeral. Three counters, one of them in the wrong language:
 * the build language leaking onto a client's artwork.
 */
describe('the numero sign follows the post language', () => {
  it.each([
    ['en', 'No.'], ['es', 'Nº'], ['de', 'Nr.'], ['nl', 'Nr.'], ['fr', 'Nº'],
    ['no', 'Nr'], ['sv', 'Nr'], ['da', 'Nr.'], ['fi', 'Nro'], ['pl', 'Nr'], ['ru', '№'],
    ['it', 'N.'], ['pt', 'Nº'],
  ])('%s → %s', (lang, sign) => expect(numero(lang)).toBe(sign));

  it('never gives an English deck the Spanish sign', () => {
    expect(numero('en')).not.toBe('Nº');
  });
  it('falls back to a neutral sign for a language we do not ship', () => {
    expect(numero('xx')).toBe('No.');
  });
  it('defaults to Spanish when nothing is passed, as the renderers always have', () => {
    expect(numero()).toBe('Nº');
  });
});
