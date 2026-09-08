import { describe, expect, it } from 'vitest';
import { finishCopy } from '../lib/studio-publish';
import { removeClaim, settleDeck } from '../lib/studio-copy-gate';
import { renderPlannedStyled } from '../../../../studio/engine/carouselStyles';
import type { CarouselPlan } from '../../../../studio/engine/carouselSlides';

/**
 * THE PUBLICATION SEAM.
 *
 * A live deck (599c7e34, 2026-09-07) published a slide the engine had itself decided to remove: a
 * 113-character title over an empty body, reported twice as "slide removed", rendered into the
 * carousel and stored. `removeClaim` and `finishCopy` both expressed "drop this slide" as
 * `body = ''`, trusting a survival filter to sweep it up — but that filter runs inside gatePlan,
 * BEFORE finishCopy and before the two passes the orchestrator runs last, so every blanking after
 * it survived to publication.
 *
 * Unit tests never caught it because none existed for these two functions, and because each one was
 * individually "correct" — it did what its own code said. The defect only exists in the seam
 * between them. So this test walks the whole chain the orchestrator walks: last gate → final plan →
 * stored JSON → render input → rendered images.
 *
 * The invariant, in Christian's words: the exact final plan that passes the last gate is the exact
 * plan that is stored and rendered.
 */

/** The live case, reconstructed: an unshippable title, and a body whose claim a guardrail refuses. */
const OVERLONG_TITLE =
  'Living in a shared community means decisions on common elements are made collectively, by vote, not unilaterally.';
const FEES_CLAIM =
  'In Spain, every home in a shared community carries a fixed ownership share that sets its slice of the fees.';

const plan = (tips: CarouselPlan['tips']): CarouselPlan => ({
  type: 'tips',
  eyebrow: 'For buyers choosing where to live',
  hook_title: 'Golf resort or old town square: pick by habit',
  slide2_title: '', slide2_body: '',
  tips,
  recap_title: '', save_line: '',
  quote_parts: [], quote_hook: '', quote_context: '', attribution: '',
  cta_heading: 'Not sure which fits your life?',
  agency_line: '',
  cta_action: 'Save this for the moment you start comparing neighbourhoods.',
  cta_keyword: "Comment HABITS and we'll talk you through the key points.",
  swipe_cue: 'Swipe',
  image_scenes: [],
  caption: 'A golf view sells the dream. A square with a bakery runs your Tuesday.',
  hashtags: [],
});

const good = [
  { title: 'Holiday-you and daily-you want different things',
    body: 'On holiday you want a pool and silence. On a normal Tuesday you want a bakery, a pharmacy, somewhere to sit with a coffee without driving.',
    teaser: 'Next: the walk that tells you everything' },
  { title: 'Walk the actual route you would take on a rainy Tuesday',
    body: 'Not the pool, not the view — the walk to bread, medicine, and a bar with the football on. If that walk feels long in real life, it will every week.',
    teaser: 'Next: how each one ages with you' },
  { title: 'Think about the you who is ten years older',
    body: 'A resort built around a car asks different things of your knees than a square built around walking. Pick the daily life you will still want later.',
    teaser: '' },
];

describe('a slide the gate removes never reaches the reader', () => {
  const report = () => ({ dropped: 0, blocked: [] as unknown[] });

  it('takes the whole slide, not just its body, when a title cannot be cut', () => {
    const withBad = plan([
      good[0],
      { title: OVERLONG_TITLE, body: 'Owners vote on the things they share.', teaser: '' },
      good[1],
    ]);
    const r = report();
    const out = finishCopy(withBad, r as never);

    expect(out.tips).toHaveLength(2);
    expect(out.tips.map((t: { title: string }) => t.title)).not.toContain(OVERLONG_TITLE);
    // and it is gone from the deck entirely — not present with an emptied body
    expect(JSON.stringify(out)).not.toContain('made collectively');
    expect(out.tips.every((t: { body: string }) => t.body.trim().length > 0)).toBe(true);
  });

  it('never leaves a headline standing over an empty card', () => {
    const hollow = plan([good[0], { title: OVERLONG_TITLE, body: '', teaser: '' }, good[1]]);
    const settled = settleDeck(hollow);
    expect(settled.tips).toHaveLength(2);
    expect(JSON.stringify(settled)).not.toContain('made collectively');
  });

  // THE MIRROR PROBLEM. The live deck also shipped "Community fees follow a fixed share, not a vote
  // on the day" as a TITLE after the guardrail had removed that exact claim from the body beneath.
  it('takes the slide when the title still asserts what the body just lost', () => {
    const withClaim = plan([
      good[0],
      { title: 'Community fees follow a fixed ownership share, not a vote on the day',
        body: `${FEES_CLAIM} Ask for that share before you buy, not after.`, teaser: '' },
      good[1],
    ]);
    const r = removeClaim(withClaim, 'tips[1].body', FEES_CLAIM);
    expect(r.outcome).toBe('slide removed');
    expect(r.plan.tips).toHaveLength(2);
    expect(JSON.stringify(r.plan)).not.toContain('fixed ownership share');
  });

  it('removes only the sentence when the headline does not carry the claim', () => {
    const withClaim = plan([
      good[0],
      { title: 'Ask what you are actually signing up for',
        body: `${FEES_CLAIM} Ask for that share before you buy, not after and never in a hurry.`, teaser: '' },
      good[1],
    ]);
    const r = removeClaim(withClaim, 'tips[1].body', FEES_CLAIM);
    expect(r.outcome).toBe('sentence removed');
    expect(r.plan.tips).toHaveLength(3);
    expect(r.plan.tips[1].title).toBe('Ask what you are actually signing up for');
  });

  it('reports a removal it actually performed', () => {
    const withBad = plan([good[0], { title: OVERLONG_TITLE, body: 'Owners vote.', teaser: '' }]);
    const r = report();
    const out = finishCopy(withBad, r as never);
    expect(r.dropped).toBe(1);
    expect(out.tips).toHaveLength(1);
  });
});

/**
 * The end of the chain, with the real renderer — because "absent from the plan" and "absent from
 * the carousel" are different claims, and only the second one is what the agent sees.
 */
describe('the deck that is stored is the deck that is drawn', () => {
  it('draws no image for a slide the gate removed', async () => {
    const withBad = plan([
      good[0],
      { title: OVERLONG_TITLE, body: 'Owners vote on the things they share.', teaser: '' },
      good[1], good[2],
    ]);
    const final = finishCopy(withBad, { dropped: 0, blocked: [] } as never);
    expect(final.tips).toHaveLength(3);

    // What the orchestrator stores, and what it hands the renderer, are this same object.
    const stored = JSON.parse(JSON.stringify({ plan: final })) as { plan: CarouselPlan };
    expect(stored.plan.tips).toHaveLength(3);
    expect(JSON.stringify(stored)).not.toContain('made collectively');

    const brand = { navy: '#7593B8', gold: '#D3B882', cream: '#F8F5EF', text: '#1F2933' };
    const slides = await renderPlannedStyled(
      'editorial', final, 'Mediterráneo Costa Homes', 'AIVENA.ES', brand as never,
      'en', 0, false, false, false,
    );
    // cover + one per surviving tip + closing. The removed slide costs an image, not a blank one.
    expect(slides).toHaveLength(final.tips.length + 2);
    expect(slides.every((b) => b.length > 0)).toBe(true);
  }, 60_000);
});
