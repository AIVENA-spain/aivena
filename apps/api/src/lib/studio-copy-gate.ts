/**
 * Pure text gates for generated Studio copy — no env, no network, no imports from the engine.
 *
 * This module exists so the gates are unit-testable. studio-carousel-plan.ts imports
 * packages/config/env, which calls process.exit(1) on a missing variable; anything that has to be
 * proven by a test therefore cannot live in that file. Everything here is a plain function over
 * strings, so vitest can run it with no environment at all.
 */

/**
 * Trailing connectives and prepositions in the post languages we ship. A body that ends on one of
 * these was cut, and a reader who cannot see the character cap just sees a broken product.
 */
const DANGLING = /\s+(?:and|or|but|so|because|since|while|when|if|although|though|with|without|for|from|to|of|in|on|at|by|as|that|which|than|per|into|onto|about|after|before|y|e|o|u|pero|porque|mientras|cuando|si|aunque|con|sin|para|de|del|en|por|como|que|a|al|sobre|entre|hasta|desde)$/i;

/**
 * Trim a generated field to its cap without ending mid-thought.
 *
 * REGRESSION: a card shipped ending "timelines still vary by court and". The previous version cut at
 * a word boundary, which is not a thought boundary. Order of preference: the last complete sentence
 * inside the budget, then a word cut with any dangling connective removed.
 *
 * Cosmetic failures trim and send — they never fail a generation. Only truth and safety failures
 * escalate, so this has to always return something publishable.
 */
export function trimWords(v: unknown, max: number): unknown {
  if (typeof v !== 'string' || v.length <= max) return v;
  const cut = v.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (end > max * 0.5) return cut.slice(0, end + 1);
  const sp = cut.lastIndexOf(' ');
  let out = (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:—–-]+$/, '');
  while (DANGLING.test(out)) out = out.replace(DANGLING, '');
  return out.replace(/[\s,;:—–-]+$/, '');
}
