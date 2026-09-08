import { describe, expect, it } from 'vitest';

/**
 * WHAT A FAILED GENERATION IS ALLOWED TO SAY TO THE AGENT.
 *
 * Christian, 2026-09-07: the screen may say the angle didn't work and show what survived. It may
 * NOT say "unsupported claim", "bank contradiction", "evidence failure" or "compliance check" —
 * that vocabulary is ours, it belongs in the record, and it means nothing to someone trying to post
 * something today. Anything the engine did not write for the agent falls back to the plain line.
 */

/** Mirrors the guard in studio-wizard.ts — kept here so the rule itself is testable with no env. */
const FRIENDLY_FAILURE = /^Not enough reliable information for this angle yet/i;
const PLAIN = "That one didn't come together. Try it again, or come at the topic another way.";
const shown = (reason: string) => (FRIENDLY_FAILURE.test(reason) ? reason : PLAIN);

/** The internal vocabulary that must never reach a screen. */
const INTERNAL = /\b(?:unsupported|claim|bank|contradict\w*|evidence|compliance|gate|guardrail|requirement|adjudicat\w*|palette|verdict)\b/i;

describe('the failure message the agent sees', () => {
  it('shows the engine\'s own friendly line, which is written for them', () => {
    const real = 'Not enough reliable information for this angle yet. Try a broader version of the '
      + 'topic, or a different angle on it.';
    expect(shown(real)).toBe(real);
    expect(INTERNAL.test(shown(real))).toBe(false);
  });

  it.each([
    'insert failed',
    'fetch failed: ETIMEDOUT',
    'claim gate failed: 4 material claims unsupported',
    'no slide survived: 5 of 5 could not be evidenced (7 material claims unsupported)',
    'CONTRADICTS_GUARDRAIL B22#never3',
    'carousel_failed',
    '',
  ])('replaces anything written for us rather than for them: %s', (reason) => {
    expect(shown(reason)).toBe(PLAIN);
    expect(INTERNAL.test(shown(reason))).toBe(false);
  });

  it('never leaks internal vocabulary, whatever the engine threw', () => {
    expect(INTERNAL.test(PLAIN)).toBe(false);
  });
});

describe('the surviving draft', () => {
  /** Mirrors the shaping in the status route: text only, ordered, both halves present. */
  const draftOf = (tips: Array<{ title?: string; body?: string }>) => tips
    .filter((t) => (t?.title ?? '').trim() && (t?.body ?? '').trim())
    .map((t, i) => ({ order: i + 1, title: String(t.title), body: String(t.body) }));

  it('keeps what worked, in order', () => {
    const d = draftOf([
      { title: 'Holiday-you and daily-you want different things', body: 'On holiday you want a pool.' },
      { title: 'Walk the route you would take on a rainy Tuesday', body: 'Not the pool, the bakery.' },
    ]);
    expect(d).toHaveLength(2);
    expect(d.map((x) => x.order)).toEqual([1, 2]);
  });

  it('renumbers from the deck that actually survived, not from the original', () => {
    const d = draftOf([
      { title: 'One', body: 'Kept.' },
      { title: 'Two', body: '' },            // lost its body — not a slide
      { title: 'Three', body: 'Also kept.' },
    ]);
    expect(d.map((x) => x.order)).toEqual([1, 2]);
    expect(d.map((x) => x.title)).toEqual(['One', 'Three']);
  });

  it('shows nothing rather than a headline over an empty card', () => {
    expect(draftOf([{ title: 'A headline with no body', body: '   ' }])).toEqual([]);
  });
});
