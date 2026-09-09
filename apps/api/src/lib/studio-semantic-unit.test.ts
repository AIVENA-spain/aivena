import { describe, expect, it } from 'vitest';
import {
  SEMANTIC_UNIT_CHECK_FAILED, applySemanticVerdicts, dropAllUnverified, tipsThatLostAClaim,
} from './studio-copy-gate';
import { riskOf, riskTier, mechanismAllowed } from './studio-evidence';

import { claimTouchesRequirement } from './studio-copy-gate';

/**
 * SLIDE 2 OF GENERATION ebc34869, verbatim.
 *
 * Published:  title "The buyers looking in your season are not the same buyers"
 *             body  "Ask your agent which months bring the buyers, not just the browsers."
 * Removed:    "Who is actively searching changes through the year."  (nothing established it)
 *
 * The headline went on asserting the claim its body had just lost. Title/body atomicity had already
 * shipped and did not catch it, and this file records exactly why — so nobody re-attempts the
 * lexical fix that cannot work.
 */

const GUILTY_TITLE = 'The buyers looking in your season are not the same buyers';
const REMOVED = 'Who is actively searching changes through the year.';
const SURVIVING_BODY = 'Ask your agent which months bring the buyers, not just the browsers.';
/** The two innocent titles from the same deck — any fix must keep these. */
const INNOCENT = [
  'Momentum is easier to build than to rebuild',
  'Time on the market changes how a home is seen',
];

describe('why the lexical atomicity rule could not catch this', () => {
  it('the title and its own body share no distinctive words — they paraphrase each other', () => {
    // "buyers / season" against "searching / year": the overlap test needs two shared terms and
    // finds none, which is why the existing rule stayed silent.
    expect(claimTouchesRequirement(GUILTY_TITLE, REMOVED)).toBe(false);
  });

  it('no risk signal separates the guilty title from the innocent ones on the same deck', () => {
    const scored = [GUILTY_TITLE, ...INNOCENT].map((t) => ({
      tier: riskTier(t), mechanism: mechanismAllowed(t).ok,
    }));
    // all three: medium, ordinary reasoning allowed. Indistinguishable.
    expect(scored.every((s) => s.tier === 'medium')).toBe(true);
    expect(scored.every((s) => s.mechanism === true)).toBe(true);
    expect(riskOf(GUILTY_TITLE)).toBe('none');
  });

  it('the inverse test would delete the innocent slides and keep the guilty one', () => {
    // "does the surviving body still carry the title's distinctive terms?"
    const carries = (title: string, body: string) => claimTouchesRequirement(body, title);
    expect(carries(GUILTY_TITLE, SURVIVING_BODY)).toBe(false);
    // ...and the innocent slide 1 scores the same way, so the test separates nothing.
    expect(carries(INNOCENT[0], 'A home that draws interest early tends to keep drawing it.')).toBe(false);
  });
});

describe('what IS deterministic: which slides are even in question', () => {
  const blocked = [
    { field: 'tips[0].body', outcome: 'sentence removed' },
    { field: 'tips[2].body', outcome: 'sentence removed' },
    { field: 'tips[2].body', outcome: 'sentence removed' },      // the same slide twice
    { field: 'cta_keyword', outcome: 'keyword changed to "LISTING"' },
    { field: 'slide2_body', outcome: 'sentence removed' },       // not a tip
    { field: 'tips[1].body', outcome: 'left whole — never cut mid-phrase' },  // nothing removed
  ];

  it('names only the tips that actually lost a sentence, once each', () => {
    expect(tipsThatLostAClaim(blocked)).toEqual([0, 2]);
  });

  it('ignores fields that were repaired rather than cut, and fields that are not tips', () => {
    expect(tipsThatLostAClaim(blocked)).not.toContain(1);
  });

  it('finds nothing on a clean deck, so a good post never pays for the check', () => {
    expect(tipsThatLostAClaim([])).toEqual([]);
    expect(tipsThatLostAClaim([{ field: 'caption', outcome: 'sentence removed' }])).toEqual([]);
  });
});

describe('KEEP, REWRITE or DROP — and never manufacture a headline', () => {
  const material = (t: string) => riskTier(t) === 'high';
  const deck = () => ({
    tips: [
      { title: INNOCENT[0], body: 'A home that draws interest early tends to keep drawing it.' },
      { title: GUILTY_TITLE, body: SURVIVING_BODY },
      { title: INNOCENT[1], body: 'A home that lingers starts to raise questions.' },
    ],
  });

  it('keeps the innocent slides untouched', () => {
    const { plan, applied } = applySemanticVerdicts(deck(),
      [{ index: 0, decision: 'KEEP', why: 'a general principle' }], material);
    expect(plan.tips).toHaveLength(3);
    expect(applied[0].decision).toBe('KEEP');
  });

  it('rewrites a guilty headline to something the surviving body supports', () => {
    const { plan, applied } = applySemanticVerdicts(deck(), [{
      index: 1, decision: 'REWRITE', why: 'the title still asserted the seasonal claim',
      replacementTitle: 'Ask which months bring buyers, not browsers',
    }], material);
    expect(plan.tips).toHaveLength(3);                       // the deck keeps its length
    expect(plan.tips[1].title).toBe('Ask which months bring buyers, not browsers');
    expect(applied[0].decision).toBe('REWRITE');
  });

  // The replacement is written by the same kind of model that just had a claim removed.
  it('drops rather than accept a replacement that smuggles a new claim in', () => {
    const { plan, applied } = applySemanticVerdicts(deck(), [{
      index: 1, decision: 'REWRITE', why: 'still asserts it',
      replacementTitle: 'Homes listed in spring sell 30% faster',
    }], material);
    expect(plan.tips).toHaveLength(2);
    expect(applied[0].decision).toBe('DROP');
    expect(applied[0].why).toMatch(/makes a claim of its own/);
  });

  it('drops rather than accept a replacement over the cap', () => {
    const { applied } = applySemanticVerdicts(deck(), [{
      index: 1, decision: 'REWRITE', why: 'still asserts it',
      replacementTitle: 'A very long replacement headline that runs well past the sixty-two character ceiling',
    }], material);
    expect(applied[0].decision).toBe('DROP');
    expect(applied[0].why).toMatch(/against a cap of/);
  });

  it('drops rather than accept a REWRITE with no headline offered', () => {
    const { applied } = applySemanticVerdicts(deck(),
      [{ index: 1, decision: 'REWRITE', why: 'still asserts it' }], material);
    expect(applied[0].decision).toBe('DROP');
    expect(applied[0].why).toMatch(/none offered/);
  });

  it('takes the whole slide when nothing left can carry a headline', () => {
    const { plan } = applySemanticVerdicts(deck(),
      [{ index: 1, decision: 'DROP', why: 'the body no longer makes a point' }], material);
    expect(plan.tips).toHaveLength(2);
    expect(plan.tips.map((t) => t.title)).toEqual(INNOCENT);
    expect(JSON.stringify(plan)).not.toContain('not the same buyers');
  });

  it('drops several at once without the indices shifting under it', () => {
    const { plan } = applySemanticVerdicts(deck(), [
      { index: 0, decision: 'DROP', why: 'x' },
      { index: 2, decision: 'DROP', why: 'y' },
    ], material);
    expect(plan.tips.map((t) => t.title)).toEqual([GUILTY_TITLE]);
  });

  it('changes nothing when there is nothing to judge', () => {
    expect(applySemanticVerdicts(deck(), [], material).plan.tips).toHaveLength(3);
  });
});

/**
 * Christian, 2026-09-09: "If the semantic checker is unavailable, publishing the headline anyway is
 * the riskier failure mode. Losing one potentially good slide is preferable to publishing an
 * unsupported factual headline."
 *
 * My first version failed OPEN and kept the slide. That was backwards: the slide is already known
 * to have carried a claim we could not establish, so silence is not neutral.
 */
describe('when the check itself is unavailable', () => {
  const cases = [
    { index: 1, title: GUILTY_TITLE, body: SURVIVING_BODY, removed: [REMOVED] },
    { index: 3, title: 'Another headline', body: 'What is left.', removed: ['Something removed.'] },
  ];

  it('drops every slide it could not clear, rather than keeping them', () => {
    const r = dropAllUnverified(cases, 'no usable answer');
    expect(r.failed).toBe(true);
    expect(r.verdicts.map((v) => v.decision)).toEqual(['DROP', 'DROP']);
    expect(r.verdicts.map((v) => v.index)).toEqual([1, 3]);
  });

  it('says why in words that name the risk, not the mechanism', () => {
    const r = dropAllUnverified(cases, 'timed out');
    expect(r.verdicts[0].why).toMatch(/unverified headline may not publish/);
    expect(r.failure).toBe('timed out');
  });

  it('carries an internal code so the record can distinguish this from a normal drop', () => {
    expect(SEMANTIC_UNIT_CHECK_FAILED).toBe('SEMANTIC_UNIT_CHECK_FAILED');
  });

  it('affects nothing when there was nothing to check', () => {
    expect(dropAllUnverified([], 'whatever').verdicts).toEqual([]);
  });
});
