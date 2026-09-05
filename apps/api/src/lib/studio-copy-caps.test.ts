import { describe, expect, it } from 'vitest';
import { PUBLISHED_FIELDS, capFor, fieldIncomplete, fieldPolicy, shortenToBoundary } from './studio-copy-gate';

// The four fields that shipped cut in the 5dfb1c3 acceptance run, with the kind of longer line each
// was cut FROM. None of them may ever be produced by shortening again.
const REAL_CUTS: { field: string; cap: number; long: string; cut: string }[] = [
  { field: 'tips[2].teaser', cap: 70, cut: 'So does the Costa Blanca actually have a bigger problem than other',
    long: 'So does the Costa Blanca actually have a bigger problem than other regions?' },
  { field: 'tips[2].title', cap: 62, cut: 'Your loan-to-value depends on residency status, among other',
    long: 'Your loan-to-value depends on residency status, among other things' },
  { field: 'eyebrow', cap: 44, cut: 'Moraira vs Calpe, for people who actually',
    long: 'Moraira vs Calpe, for people who actually live there' },
  { field: 'tips[1].title', cap: 62, cut: 'Practitioner consensus holds that a stale listing makes',
    long: 'Practitioner consensus holds that a stale listing makes buyers suspicious' },
];

describe('shortening never produces a fragment', () => {
  it.each(REAL_CUTS)('$field: never reproduces the shipped cut', ({ cap, long, cut }) => {
    const out = shortenToBoundary(long, cap);
    expect(out).not.toBe(cut);
    if (out !== null) expect(out.length).toBeLessThanOrEqual(cap);
  });

  it('prefers a whole sentence inside the budget', () => {
    expect(shortenToBoundary('One price. One team. One line of proof that runs the whole way through.', 30))
      .toBe('One price. One team.');
  });
  it('falls back to a clause boundary', () => {
    expect(shortenToBoundary('Moraira vs Calpe, for people who actually live there', 44))
      .toBe('Moraira vs Calpe');
  });
  it('refuses when the line offers no boundary at all', () => {
    expect(shortenToBoundary('Practitioner consensus holds that a stale listing makes buyers suspicious', 62))
      .toBeNull();
  });
  it('leaves anything already inside the cap exactly as written', () => {
    expect(shortenToBoundary('The price you launch at is the one buyers judge', 90))
      .toBe('The price you launch at is the one buyers judge');
  });
  // MUST-PASS: whatever it does return has to read as finished
  it('never returns something the completeness check would flag', () => {
    const longs = [
      'Commission follows proof, not paperwork, and the paperwork is not the proof anybody needs',
      'Two agents, one buyer, and one very awkward invoice at the end of it all',
      'The buyer withholds three per cent of the deeded price, not of your profit, at the notary',
      'Spanish courts look at whether the work was determinant, or at least genuinely helpful',
    ];
    for (const cap of [30, 44, 62, 70, 80]) {
      for (const l of longs) {
        const out = shortenToBoundary(l, cap);
        if (out !== null) expect(fieldIncomplete('tips[0].title', out)).toBe(false);
      }
    }
  });
});

describe('completeness across published fields', () => {
  it('flags prose that never finished its sentence', () => {
    expect(fieldIncomplete('tips[0].body', 'Borrowing is getting more expensive, not')).toBe(true);
    expect(fieldIncomplete('caption', 'Five agents chasing one buyer sounds like reach')).toBe(true);
  });
  it('flags a headline that ends on a word nothing can follow', () => {
    expect(fieldIncomplete('tips[2].title', 'Your loan-to-value depends on residency status, among other')).toBe(true);
    expect(fieldIncomplete('tips[2].teaser', 'So does the coast have a bigger problem than other')).toBe(true);
  });
  // MUST-PASS: a headline is allowed to be a fragment by design
  it.each([
    ['hook_title', 'The price you launch at is the one buyers judge'],
    ['recap_title', 'In 30 seconds'],
    ['tips[3].title', 'The Comunidad Valenciana is not where occupation concentrates'],
    ['eyebrow', 'For sellers weighing mandate types'],
  ])('leaves a deliberate fragment alone: %s', (f, t) => expect(fieldIncomplete(f, t)).toBe(false));
  it('does not police the swipe cue or the hashtags', () => {
    expect(fieldIncomplete('swipe_cue', 'Desliza')).toBe(false);
    expect(fieldIncomplete('hashtags', 'CostaBlanca')).toBe(false);
  });
});

describe('every published field has a policy', () => {
  it('covers the whole schema and skips nothing by accident', () => {
    expect(PUBLISHED_FIELDS).toHaveLength(20);
    const byPolicy = (p: string) => PUBLISHED_FIELDS.filter((f) => f.policy === p).map((f) => f.field);
    expect(byPolicy('static')).toEqual(['swipe_cue']);
    expect(byPolicy('hashtags')).toEqual(['hashtags']);
    expect(byPolicy('claim')).toHaveLength(18);
  });
  it('treats an unknown field as claim-bearing rather than skipping it', () => {
    expect(fieldPolicy('some_future_field')).toBe('claim');
  });
  it('caps every claim-bearing field that renders on a slide', () => {
    for (const f of ['eyebrow', 'hook_title', 'slide2_title', 'slide2_body', 'recap_title',
      'save_line', 'cta_heading', 'cta_action', 'cta_keyword', 'agency_line', 'caption',
      'tips[0].title', 'tips[0].body', 'tips[0].teaser']) {
      expect(capFor(f)).toBeGreaterThan(0);
    }
  });
});
