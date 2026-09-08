import { describe, expect, it } from 'vitest';
import { mechanismAllowed, riskOf, riskTier } from './studio-evidence';

/**
 * A CARD MAY NOT HIJACK THE USER'S QUESTION.
 *
 * Live case, 2026-09-07. The agent typed a lifestyle question — golf resort or old town square,
 * which one fits your daily habits. It matched bank card B22, whose four required points are about
 * local prices, community fees, protected-zone renovation licences and winter occupancy. Because
 * the topic's risk class was computed from the topic AND the card's requirements, a question with
 * no legal or numerical content became a `legal_tax` topic: official-primary-only sources, two
 * enforcement passes, 92,779 characters of the BOE opened, 0 of 4 requirements established, and
 * most of the deck refused.
 *
 * Christian, 2026-09-08: "A bank card should provide useful knowledge and guardrails, but it should
 * not hijack the user's intent. Card match != every research requirement becomes mandatory."
 *
 * The split these tests hold: guardrails stay active on the subject; the research agenda follows
 * the angle the agent actually asked about; and a quantitative or legal claim still needs grounding
 * the moment the writer chooses to make one.
 */

const TOPIC = 'Golf course community or old town square: which one fits your actual daily habits, '
  + 'not your holiday habits';

/** B22's four required points, verbatim from the bank. */
const B22_MUST = [
  'The real price comparison in this specific town — establish the gap rather than asserting parity',
  'Community fees, and what they cover on a golf urbanisation, against the near-zero fees but higher '
    + 'maintenance of an old-town house',
  'Old-town practicalities: parking, stairs, renovation costs, and whether the centre is a protected '
    + 'zone with restricted licences',
  'Winter occupancy on the urbanisation versus year-round life in the old town, and how each resells',
].join('\n');

describe('the risk class follows the question, not the card', () => {
  it('reads the lifestyle topic as carrying no evidence risk of its own', () => {
    expect(riskOf(TOPIC)).toBe('none');
  });

  // THE REGRESSION. riskOf(topic + cardMust + questions) is what escalated it; the card's agenda is
  // no longer an input, so this is now the only thing the classification can see before research.
  it('does not inherit a risk class from requirements the agent never asked about', () => {
    const withCard = riskOf(`${TOPIC}\n${B22_MUST}`);
    expect(riskOf(TOPIC)).toBe('none');
    // the card's own list is where "price comparison" lives — that must not become the topic's risk
    expect(withCard).not.toBe(riskOf(TOPIC));
    expect(riskOf(B22_MUST)).not.toBe('none');
  });

  it('still reads a topic that genuinely turns on money as a money topic', () => {
    expect(riskOf('What does a golf urbanisation cost per year against an old town house'))
      .not.toBe('none');
  });

  it('still reads a topic that genuinely turns on the law as a legal one', () => {
    expect(riskOf('Can you renovate a house in a protected old-town zone, or does the licence stop you'))
      .toBe('legal_tax');
  });
});

describe('what a lifestyle deck is allowed to say', () => {
  it.each([
    'On holiday you want a pool and silence; on a Tuesday you want a bakery you can walk to.',
    'A resort built around a car asks different things of your knees than a square built around walking.',
    'Walk the route you would take on a rainy Tuesday, not the one in the brochure.',
    'People who buy for the pool often find they wanted neighbours instead.',
  ])('lets ordinary reasoning about daily life stand: %s', (t) => {
    expect(riskTier(t, 'CAUSAL_INFERENCE')).toBe('medium');
    expect(mechanismAllowed(t).ok).toBe(true);
  });

  // The other half of Christian's rule: choosing to make the claim brings the bar with it.
  it.each([
    ['Community fees on the urbanisation run to 1,800 € a year.', 'QUANTIFIED_CLAIM'],
    ['The old town is a protected zone, so you cannot change the façade.', 'LEGAL_CONSEQUENCE'],
    ['Resort prices per square metre sit above the old town here.', 'FACTUAL_MATERIAL'],
  ])('still demands grounding once the writer makes the claim anyway: %s', (t, type) => {
    expect(riskTier(t, type)).toBe('high');
    // a high-risk claim is never ordinary reasoning, whatever the card said
    expect(mechanismAllowed(t).ok).toBe(false);
  });
});
