import { describe, expect, it } from 'vitest';
import { dropTips, tipsThatLostAClaim } from './studio-copy-gate';
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

describe('taking the whole semantic unit', () => {
  const deck = {
    tips: [
      { title: INNOCENT[0], body: 'A home that draws interest early tends to keep drawing it.' },
      { title: GUILTY_TITLE, body: SURVIVING_BODY },
      { title: INNOCENT[1], body: 'A home that lingers starts to raise questions.' },
    ],
  };

  it('removes the guilty slide and leaves the innocent ones untouched', () => {
    const out = dropTips(deck, [1]);
    expect(out.tips).toHaveLength(2);
    expect(out.tips.map((t) => t.title)).toEqual(INNOCENT);
    expect(JSON.stringify(out)).not.toContain('not the same buyers');
  });

  it('renumbers for free, because every count reads off tips.length', () => {
    expect(dropTips(deck, [0, 1]).tips).toHaveLength(1);
  });

  it('changes nothing when no slide is guilty — the common case', () => {
    expect(dropTips(deck, [])).toBe(deck);
  });
});
