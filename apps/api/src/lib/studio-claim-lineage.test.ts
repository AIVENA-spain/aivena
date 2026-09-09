import { describe, expect, it } from 'vitest';
import {
  hasVagueAuthority, rejectedPropositions, stripVagueAuthority,
} from './studio-copy-gate';
import { mechanismAllowed } from './studio-evidence';

/**
 * GENERATION 22d45453, verbatim — the deck that cost $0.7973, opened 16 pages, and published four
 * of five claims on "ordinary reasoning" with no source at all.
 *
 * Three defects it exposed, all recorded here as fixtures:
 *   1. a refused HIGH claim came back as a MEDIUM paraphrase once the number was dropped;
 *   2. the EDITOR invented "Agencies say" / "Agents report" after the gate had cleared the copy;
 *   3. "what consistently works" slipped a universality check knowing only always/never/every.
 */

/** The claim the gate correctly refused: HIGH, market/statistics, nothing established it. */
const REFUSED =
  'Whenever a listing goes live, buyer attention peaks hard in the first two to three weeks, then tapers off.';
/** What published instead — the same proposition with the measurement removed. */
const RESTATEMENT =
  'A new listing gets its best shot at attention the moment it goes live. That opening window matters more than which month it falls in.';

describe('a refusal attaches to the proposition, not to the sentence', () => {
  const blocked = [
    { field: 'tips[0].body', text: REFUSED, verdict: 'UNSUPPORTED',
      problem: 'Nothing establishes this: a high-risk market/statistics claim may not rest on unknown alone.',
      outcome: 'sentence removed' },
    // an evidence failure at medium
    { field: 'tips[1].body', text: 'Homes here sit longer in winter.', verdict: 'UNSUPPORTED',
      problem: 'Nothing establishes this: no support offered.', outcome: 'sentence removed' },
    // NOT evidence failures — these say nothing about whether a proposition is true
    { field: 'cta_keyword', text: "Comment TIMING and we'll send you the full breakdown.",
      verdict: 'UNSUPPORTED', problem: 'the comment keyword "TIMING" has nothing to do with the post',
      outcome: 'keyword changed to "LISTING"' },
    { field: 'tips[2].title', text: 'A very long headline', verdict: 'OVER_CAP',
      problem: '113 characters against a cap of 62, with no sentence or clause boundary inside it',
      outcome: 'slide removed' },
  ];

  it('keeps only the propositions that failed on EVIDENCE', () => {
    const led = rejectedPropositions(blocked);
    expect(led).toHaveLength(2);
    expect(led.map((r) => r.field)).toEqual(['tips[0].body', 'tips[1].body']);
  });

  it('remembers the bar each one had to clear, so a restatement inherits it', () => {
    const led = rejectedPropositions(blocked);
    expect(led[0].tier).toBe('high');      // the market/statistics refusal
    expect(led[1].tier).toBe('medium');
  });

  it('does not treat a keyword swap or a length cut as a refuted claim', () => {
    const led = rejectedPropositions(blocked);
    expect(led.map((r) => r.field)).not.toContain('cta_keyword');
    expect(led.map((r) => r.field)).not.toContain('tips[2].title');
  });

  it('ignores an attribution strip, which is not an evidence verdict either', () => {
    expect(rejectedPropositions([{
      field: 'tips[0].body', text: 'Agencies say X.', verdict: 'UNSUPPORTED',
      problem: '"Agencies say" attributes this to nobody in particular',
      outcome: 'attribution removed — the statement stands on its own or not at all',
    }])).toEqual([]);
  });

  /**
   * The heart of it. Nothing deterministic separates these two sentences — the second is simply the
   * first with the measurement taken out, which is why it scored MEDIUM and published. The lineage
   * check exists because no regex can tell them apart.
   */
  it('records why this cannot be caught by wording alone', () => {
    expect(mechanismAllowed(RESTATEMENT).ok).toBe(true);     // reads as ordinary reasoning
    expect(REFUSED).toMatch(/two to three weeks/);           // the original carried a measurement
    expect(RESTATEMENT).not.toMatch(/\d/);                   // the restatement carries none
  });
});

/**
 * The editor added these AFTER the gate cleared the copy. Neither phrase was in the verified text —
 * it invented a source for a claim that had been allowed as ordinary reasoning.
 */
describe('manufactured authority', () => {
  const SLIDE_2 = "Buyers notice a property that's been sitting for months. Agencies say a listing "
    + "that sits for months becomes ripe for negotiation — and that's when sellers start fielding lower offers.";
  const SLIDE_3 = 'Agents report that sellers who let a listing drag into a quiet season often '
    + 'accept less just to close before it gets even quieter.';

  it('catches "Agencies say", which the old list missed', () => {
    expect(hasVagueAuthority(SLIDE_2)).toBe(true);
    const r = stripVagueAuthority(SLIDE_2);
    expect(r.changed).toBe(true);
    expect(r.text).not.toMatch(/Agencies say/i);
    expect(r.text).toContain('A listing that sits for months becomes ripe for negotiation');
  });

  it('catches "Agents report that" and removes the dangling that', () => {
    const r = stripVagueAuthority(SLIDE_3);
    expect(r.changed).toBe(true);
    expect(r.text).toBe('Sellers who let a listing drag into a quiet season often accept less '
      + 'just to close before it gets even quieter.');
  });

  it.each([
    'Research suggests that buyers decide in the first ten seconds.',
    'Experts say the paperwork matters.',
    'Studies show that staged homes photograph better.',
    'Most agents agree the first week is the one that counts.',
  ])('strips every shape of borrowed authority: %s', (t) => {
    expect(stripVagueAuthority(t).changed).toBe(true);
  });

  // An agent doing something is not an agent being quoted as an authority.
  it.each([
    'Your agent will walk you through it.',
    'Ask your agent which months bring the buyers.',
    'A good agency earns its fee on the hard days.',
    'We say what we mean.',
  ])('leaves ordinary mentions of agents alone: %s', (t) => {
    expect(hasVagueAuthority(t)).toBe(false);
  });

  it('refuses to butcher a sentence into something too short to publish', () => {
    expect(stripVagueAuthority('Experts say so.').changed).toBe(false);
  });
});

/**
 * Slide 4 published "What consistently works is launching the moment the home... is ready" — a
 * promise of a reliable outcome, through a detector that knew only always/never/every.
 */
describe('a promise of a reliable outcome is not a tendency', () => {
  it.each([
    'What consistently works is launching the moment the home is ready.',
    'A prepared listing reliably produces a faster sale.',
    'Pricing right inevitably brings the buyers.',
    'This approach is proven to work.',
    'Good staging works every time.',
  ])('refuses a universal performance promise: %s', (t) => {
    expect(mechanismAllowed(t).ok).toBe(false);
  });

  it.each([
    'A home that draws interest early tends to keep drawing it.',
    'People who buy for the pool often discover they wanted neighbours instead.',
    'Launching too high can make buyers hesitate.',
    'A well-prepared listing usually shows better.',
  ])('leaves an honest tendency alone: %s', (t) => {
    expect(mechanismAllowed(t).ok).toBe(true);
  });
});
