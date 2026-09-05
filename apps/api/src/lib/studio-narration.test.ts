import { describe, expect, it } from 'vitest';
import { attributesSource, gateField, intentionalAuthority, narratesEvidence } from './studio-copy-gate';

/** Every one of these shipped in the 5dfb1c3 acceptance run while the counters read zero. */
const SHIPPED_LEAKS = [
  'Official Interior figures for 2025 put Comunidad Valenciana well below the totals recorded in Catalonia and Andalucía.',
  'Visit Jávea puts the drive at 16km, around 20 minutes — though the exact number shifts with route and traffic.',
  "Dénia's population is commonly reported to swing sharply",
  "How fast depends on which index you read, but nobody's calling this a falling market right now.",
  "A regional study by the Observatori Marina Alta found Calpe's population multiplies roughly eightfold in peak season.",
  "Here's what's actually true, and what nobody's measured yet.",
  "What's genuinely established is how much of Alicante province's property market is foreign-bought.",
  'Practitioner consensus holds that a stale listing makes buyers suspicious',
  'Practitioners report that when a property lingers, buyers start wondering what is wrong with it.',
];

/** Copy that must survive. Blocking any of these would make the engine worse, not safer. */
const MUST_SURVIVE = [
  'The buyer withholds 3% of the full deeded price and pays it to the tax office on your behalf.',
  "Spanish courts look at whether an agent's work was determinant in reaching the sale.",
  'Most property listings are forgettable.',
  'Dénia has been a UNESCO Creative City of Gastronomy since 2015.',
  'Your listing appears on Idealista and Fotocasa the same day.',
  'One accountable agent means one line of proof.',
  'Moraira is a coastal núcleo within Teulada-Moraira; Calpe stands alone as its own municipio.',
  'Sign with two non-exclusive agents and both can end up claiming the same commission.',
  'We would rather have the hard pricing conversation before launch.',
  'A generic pool shot competes with a hundred others in the same feed.',
];

// Christian 2026-09-05: default to invisible research, but allow deliberate official attribution
// where it strengthens a data-led post. "INE figures show…" is a choice; "Visit Jávea puts the
// drive at 16km" is a footnote that wandered onto a slide.
describe('deliberate authority is not research leakage', () => {
  it.each([
    'INE figures show the padrón passed 47,000 residents in January 2024.',
    'According to the latest Notariado data, Dutch buyers led the province last year.',
    'The Registradores publish that ranking at national level only.',
    'Código Civil article 1450 makes a sale binding once thing and price are agreed.',
  ])('allows: %s', (t) => {
    expect(attributesSource(t)).toBe(false);
    expect(intentionalAuthority(t)).toBe(true);
  });
  it.each([
    'Visit Jávea puts the drive at 16km, around 20 minutes.',
    "A regional study by the Observatori Marina Alta found Calpe's population multiplies eightfold.",
    'Idealista listed Dénia around 3,404 €/m² in mid-2026.',
  ])('still blocks: %s', (t) => expect(attributesSource(t)).toBe(true));
  it('never lets an authority name launder narration of our own process', () => {
    expect(narratesEvidence('We could not verify the INE figure for this town.')).toBe(true);
    expect(narratesEvidence('Practitioner consensus holds that the Notariado data understates it.')).toBe(true);
  });
});

describe('the copy never narrates the checking', () => {
  it.each(SHIPPED_LEAKS)('flags: %s', (t) => {
    const flagged = narratesEvidence(t) || attributesSource(t)
      || gateField('tips[0].body', t, 'research present').length > 0;
    expect(flagged).toBe(true);
  });

  it.each(MUST_SURVIVE)('leaves alone: %s', (t) => {
    expect(narratesEvidence(t)).toBe(false);
    expect(attributesSource(t)).toBe(false);
    expect(gateField('tips[0].body', t, 'research present')
      .filter((h) => h.rule.id === 'evidence-narrated' || h.rule.id === 'source-attributed')).toEqual([]);
  });

  // A fact about what is PUBLISHED is content — the verified bank asserts exactly this itself, and
  // deleting it would remove the honest half of an honest post. Narrating our own checking is not.
  it('separates a fact about the evidence landscape from narration of our process', () => {
    expect(narratesEvidence('No municipal nationality ranking is published at all.')).toBe(false);
    expect(narratesEvidence('We could not verify which nationality leads.')).toBe(true);
    expect(narratesEvidence('The sources I checked disagree on the distance.')).toBe(true);
  });

  it('is not a list of phrases — it fires on the shape, not the wording', () => {
    // none of these exact strings has ever been seen; each is the same move in new words
    expect(narratesEvidence('Seasoned agents broadly agree that overpricing costs momentum.')).toBe(true);
    expect(narratesEvidence('The figure varies by publisher, so treat it as a direction.')).toBe(true);
    expect(attributesSource('An analysis by the Costa Blanca Insider puts the figure higher.')).toBe(true);
    expect(attributesSource('Coastal Homes Weekly data for 2025 shows a fall.')).toBe(true);
  });
});
