/**
 * HOW DEEP THIS POST HAS TO GO — decided twice, not once.
 *
 * Most of what an agency posts is lifestyle, opinion and marketing: it asserts nothing a reader
 * could be hurt by being wrong about. Running the full evidence engine over it is where the money
 * goes — on the one measured generation, research + source facts + the whole gate stack was 72% of
 * the bill for a post about walking to the bakery.
 *
 * But a topic being LOW is not a promise about the COPY. Christian, 2026-09-08: "A lifestyle
 * writer can still introduce a material claim such as a price increase, ranking, tax statement,
 * law, deadline or agency-performance claim." Ask for "why people fall in love with Moraira" and
 * the writer may hand back "Moraira prices have risen 23% this year" — a high-risk current market
 * claim inside a post that skipped research entirely.
 *
 * So the route is decided at the start and CHECKED AGAIN on the finished draft:
 *
 *   topic → route → cheap write → scan the copy → publish, or escalate what it actually said
 *
 * The scan is deterministic and free. Escalation means the claim gets VERIFIED, never silently
 * deleted — "if the writer accidentally produces a strong factual point, AIVENA should verify it
 * rather than sterilise the post."
 *
 * Pure: no env, no network, no model.
 */
import { planFields, type PlanLike } from './studio-copy-gate';
import { riskOf, riskTier } from './studio-evidence';

/**
 * ONE taxonomy, not two. LOW / MEDIUM / HIGH is the conceptual model everywhere — the cost
 * buckets, the routing and the source policy all speak it, so the codebase cannot drift into
 * calling the same thing two names.
 *
 * LOW    asserts nothing a reader could act on and find false — skips research entirely.
 * MEDIUM local character, market context, mechanisms — researched, any reliable published source.
 * HIGH   law, tax, money, figures, rankings — researched, and held to the producer of the fact.
 */
export type Tier = 'low' | 'medium' | 'high';

export interface RouteDecision {
  tier: Tier;
  /** plain-language reason, for the record and the log */
  why: string;
  /** the signal that decided it, so a false positive can be found in the data later */
  signal: 'empty' | 'ranking_question' | 'currency_question' | 'risk_class' | 'figure_or_rule'
    | 'card_needs_agency_data' | 'nothing_checkable';
}

/** Whether this tier goes and looks things up. */
export const researches = (t: Tier): boolean => t !== 'low';

/**
 * A question that ASKS FOR a superlative, a comparison or a count.
 *
 * Router-local on purpose. "Which nationality buys the most homes in Alicante" is a ranking
 * question and slipped to the cheap path, because the shared gate patterns look for a stated
 * ranking ("the British lead the province") rather than a request for one. Broadening the shared
 * pattern would make "most people choose the postcard" — puffery — an evidence claim everywhere.
 * Here it only decides whether to research, where being wrong costs money rather than truth.
 */
const ASKS_FOR_A_RANKING =
  /\b(?:which|what|who|how many|how much)\b[^.?]{0,60}\b(?:most|least|best|biggest|largest|cheapest|highest|lowest|fastest|top|rank\w*|majority|share)\b/i;
/** A question about how things stand right now, which goes stale and has to be checked. */
const ASKS_ABOUT_NOW =
  /\b(?:right now|currently|this year|last year|these days|at the moment|so far in \d{4}|trend\w*|rising|falling|climbing|dropping)\b/i;

/**
 * Which path this topic starts on.
 *
 * Deliberately conservative: only a topic that asserts nothing checkable takes the cheap path, and
 * a matched bank card whose subject is genuinely risky keeps the post on the researched path even
 * when the wording sounds soft. Everything uncertain researches — the saving is worth having only
 * while it costs nothing in truth.
 */
export function routeTopic(topic: string, opts: { cardRisky?: boolean } = {}): RouteDecision {
  const t = (topic ?? '').trim();
  if (!t) return { tier: 'high', why: 'no topic given', signal: 'empty' };
  if (ASKS_FOR_A_RANKING.test(t)) {
    return { tier: 'high', why: 'the topic asks which one is the most or the biggest',
      signal: 'ranking_question' };
  }
  if (ASKS_ABOUT_NOW.test(t)) {
    return { tier: 'medium', why: 'the topic asks how things stand right now',
      signal: 'currency_question' };
  }
  const risk = riskOf(t);
  if (risk !== 'none') {
    return {
      tier: risk === 'legal_tax' || risk === 'market_statistics' ? 'high' : 'medium',
      why: `the topic itself asks about ${risk.replace('_', '/')}`,
      signal: 'risk_class',
    };
  }
  // Deliberately kept broad. "The version of you who is ten years older" reads as a figure here and
  // takes the expensive path — a false positive that costs money, never truth. Narrowing the figure
  // detector to win it back would weaken the same test the publication gate depends on, and the
  // second check below is what actually protects the reader.
  if (riskTier(t) === 'high') {
    return { tier: 'high', why: 'the topic names a figure, a rule or a ranking',
      signal: 'figure_or_rule' };
  }
  if (opts.cardRisky) {
    return { tier: 'medium', why: 'this subject cannot be written without the agency\'s own figures',
      signal: 'card_needs_agency_data' };
  }
  return { tier: 'low', signal: 'nothing_checkable',
    why: 'opinion, lifestyle or marketing — nothing a reader could act on and find false' };
}

export interface EscalationCheck {
  escalate: boolean;
  /** the fields that carried a material claim, with the text that triggered it */
  triggers: Array<{ field: string; text: string }>;
  why: string;
}

/**
 * A LOW post has been written. Did the writer stay inside what it was allowed to assert?
 *
 * Deterministic, so it costs nothing and cannot itself become a reason the post is expensive. Only
 * HIGH-tier text escalates: law, tax, deadlines, money, figures, quantified change, rankings and
 * price comparisons — the classes where being wrong costs the reader something. Ordinary
 * lifestyle reasoning is medium at most and never triggers this.
 *
 * The point is NOT to catch the writer out. A post that escalates is a post with something worth
 * saying in it; it goes and gets that checked.
 */
export function needsEscalation(plan: PlanLike): EscalationCheck {
  const triggers = planFields(plan)
    .filter((f) => riskTier(f.text) === 'high')
    .map((f) => ({ field: f.field, text: f.text }));
  if (!triggers.length) {
    return { escalate: false, triggers, why: 'the finished copy asserts nothing that needs checking' };
  }
  return {
    escalate: true,
    triggers,
    why: `${triggers.length} line(s) make a claim a reader could act on: `
      + triggers.map((t) => t.field).join(', '),
  };
}

/**
 * What a LOW writer is told, in place of a research palette.
 *
 * It is not "write nothing factual" — that produces the timid copy Christian has rejected twice.
 * It is "this is yours to argue; the moment you reach for a number or a rule, you have changed the
 * job", which keeps the writing free and makes the escalation rare rather than routine.
 */
export const LOW_RISK_BRIEF = [
  'THIS POST IS YOURS TO ARGUE. It is about judgement, feel and what daily life is actually like —',
  'no research was gathered for it, because it does not need any.',
  '',
  'Write with real conviction. Take a position, name a tension, tell someone what to do about it.',
  'Concrete beats vague: a rainy Tuesday, the walk to the bakery, the version of them who is ten',
  'years older. That is the whole point of this post and it needs no evidence at all.',
  '',
  'What you may NOT do is smuggle in something checkable to sound authoritative:',
  '· no prices, percentages, rents, fees or costs, and no "X% more" of anything',
  '· no law, tax, deadline, permit or licence',
  '· no rankings, records or "the biggest/fastest/most popular"',
  '· no claim about what this agency has achieved',
  '· no "prices are rising", "the market is turning", "demand is up" — that is a current market claim',
  '',
  'If the argument genuinely needs one of those, write it anyway and write it plainly — it will be',
  'sent for checking rather than cut. Do not hedge it into meaninglessness to slip it past. A vague',
  'sentence is worse than a checkable one.',
].join('\n');
