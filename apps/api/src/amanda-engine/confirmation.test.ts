import { describe, it, expect } from 'vitest';
import { detectConfirmation } from './confirmation';

describe('detectConfirmation — conservative by design (§4)', () => {
  it('affirms clear short confirmations across languages', () => {
    expect(detectConfirmation('Yes please!', 'en')).toBe('affirm');
    expect(detectConfirmation('vale', 'es')).toBe('affirm');
    expect(detectConfirmation('Perfecto', 'es')).toBe('affirm');
    expect(detectConfirmation('ja gerne', 'de')).toBe('affirm');
    expect(detectConfirmation('det passer', 'nb')).toBe('affirm');
    expect(detectConfirmation('да', 'ru')).toBe('affirm');
  });
  it('declines negatives', () => {
    expect(detectConfirmation('no', 'en')).toBe('decline');
    expect(detectConfirmation('mejor otro dia', 'es')).toBe('decline');
    expect(detectConfirmation('nee liever niet', 'nl')).toBe('decline');
  });
  it('treats modifications as unclear — "yes but Sunday" books nothing', () => {
    expect(detectConfirmation('yes but sunday', 'en')).toBe('unclear');
    expect(detectConfirmation('ok at 18:00 instead', 'en')).toBe('unclear');
    expect(detectConfirmation('vale pero mejor el domingo', 'es')).toBe('unclear');
    expect(detectConfirmation('ok tomorrow', 'en')).toBe('unclear');
  });
  it('treats anything long or substantive as unclear', () => {
    expect(detectConfirmation('Yes, and can you also tell me about the community fees for this property?', 'en')).toBe('unclear');
    expect(detectConfirmation('What is the price?', 'en')).toBe('unclear');
  });
  it('handles curly apostrophes and trailing punctuation', () => {
    expect(detectConfirmation('That works!', 'en')).toBe('affirm');
    expect(detectConfirmation('can’t make it', 'en')).toBe('decline');
  });
});
