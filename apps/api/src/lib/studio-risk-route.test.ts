import { describe, expect, it } from 'vitest';
import { LOW_RISK_BRIEF, mayEscalate, mayRewriteDeck, needsEscalation, researches, routeTopic } from './studio-risk-route';
import { DEFAULT_MODELS, ROLES, describeRouting, envKeyFor, modelFor, roleOverrides } from './studio-models';

/**
 * A lifestyle post should not pay for legal-grade verification. But the topic being LOW is a
 * statement about the QUESTION, not about the ANSWER — and the answer is what publishes.
 *
 * Christian, 2026-09-08: "LOW can skip the expensive evidence/research engine, but it must not
 * blindly trust the initial topic classification." His example is the one this file is built
 * around: ask why people fall in love with Moraira, and the writer may hand back a 23% price rise.
 */

const deck = (tips: Array<{ title: string; body: string }>) => ({
  eyebrow: '', hook_title: 'Why people fall in love with Moraira', slide2_title: '', slide2_body: '',
  tips: tips.map((t) => ({ ...t, teaser: '' })),
  recap_title: '', save_line: '', cta_heading: '', cta_action: '', cta_keyword: '',
  agency_line: '', caption: '', hashtags: [] as string[],
});

describe('which path a topic starts on', () => {
  it.each([
    'Why people fall in love with Moraira',
    'Golf course community or old town square: which one fits your actual daily habits',
    'What nobody tells you about choosing a neighbourhood',
  ])('sends opinion and lifestyle down the cheap path: %s', (t) => {
    expect(routeTopic(t).tier).toBe('low');
  });

  it.each([
    'What tax do I pay when I sell my Spanish property',
    'How much have Costa Blanca prices risen this year',
    'The 3% withholding when a non-resident sells',
    'Which nationality buys the most homes in Alicante',
    'How long does it take to get a licence of first occupation',
  ])('researches anything a reader could act on and find false: %s', (t) => {
    expect(researches(routeTopic(t).tier)).toBe(true);
  });

  /**
   * An accepted false positive, documented so nobody "fixes" it by weakening the figure detector.
   * "Ten years older" is rhetoric, but the same pattern catches "within two months", which is a
   * real deadline. Erring toward research costs money; erring the other way costs truth — and the
   * scan on the finished copy is what actually protects the reader either way.
   */
  it('errs toward research when rhetoric reads like a figure', () => {
    const d = routeTopic('The version of you who is ten years older is the one buying this house');
    expect(researches(d.tier)).toBe(true);
    // recorded so real usage can say how often ordinary lifestyle language trips this
    expect(d.signal).toBe('figure_or_rule');
  });

  it('researches when the verified bank governs the subject with checkable facts', () => {
    const t = 'Golf course community or old town square: which fits your daily habits';
    expect(routeTopic(t).tier).toBe('low');
    expect(researches(routeTopic(t, { cardRisky: true }).tier)).toBe(true);
  });

  it('researches when there is no topic at all rather than guessing', () => {
    expect(researches(routeTopic('').tier)).toBe(true);
    expect(researches(routeTopic('   ').tier)).toBe(true);
  });

  it('names LOW, MEDIUM and HIGH — one taxonomy, not two', () => {
    expect(routeTopic('Why people fall in love with Moraira').tier).toBe('low');
    expect(routeTopic('How things are selling right now on the coast').tier).toBe('medium');
    expect(routeTopic('What tax do I pay when I sell my Spanish property').tier).toBe('high');
  });

  it('records which rule fired, so a false positive can be found in the data', () => {
    expect(routeTopic('Which nationality buys the most homes in Alicante').signal).toBe('ranking_question');
    expect(routeTopic('Why people fall in love with Moraira').signal).toBe('nothing_checkable');
  });

  it('gives a reason in plain language, for the record', () => {
    expect(routeTopic('What tax do I pay when I sell').why).toMatch(/legal|tax/i);
    expect(routeTopic('Why people fall in love with Moraira').why).toMatch(/opinion|lifestyle|marketing/i);
  });
});

describe('the scan on the finished copy', () => {
  it('lets an honest lifestyle deck publish without ever touching research', () => {
    const d = deck([
      { title: 'Holiday-you and daily-you want different things',
        body: 'On holiday you want a pool. On a Tuesday you want a bakery you can walk to.' },
      { title: 'Walk the route you would take in the rain',
        body: 'Not the pool, not the view — the walk to bread and medicine and a bar with the football on.' },
    ]);
    const c = needsEscalation(d);
    expect(c.escalate).toBe(false);
    expect(c.triggers).toEqual([]);
  });

  // CHRISTIAN'S CASE, verbatim. A LOW topic, a writer that reached for a number anyway.
  it('escalates when the writer invents a price rise inside a lifestyle post', () => {
    const d = deck([
      { title: 'People come for the bay and stay for the mornings',
        body: 'The walk into the old town is the reason people stay.' },
      { title: 'Everyone else has noticed too',
        body: 'Moraira property prices have risen 23% this year.' },
    ]);
    const c = needsEscalation(d);
    expect(c.escalate).toBe(true);
    expect(c.triggers.map((t) => t.field)).toContain('tips[1].body');
    expect(c.why).toMatch(/claim a reader could act on/i);
  });

  it.each([
    ['a tax statement', 'Non-residents pay a 19% rate on the gain when they sell.'],
    ['a legal obligation', 'You are legally obliged to hold a licence of first occupation.'],
    ['a deadline', 'The declaration must be filed within four months of the sale.'],
    ['a ranking', 'The British are still the largest group of foreign buyers in the province.'],
    ['a current market claim', 'Prices here sit above the old town and are climbing.'],
  ])('escalates %s a lifestyle writer slipped in', (_kind, sentence) => {
    const d = deck([{ title: 'A perfectly ordinary headline', body: sentence }]);
    expect(needsEscalation(d).escalate).toBe(true);
  });

  it('does not escalate ordinary reasoning that merely sounds confident', () => {
    const d = deck([
      { title: 'The pool is not the thing you will use',
        body: 'People who buy for the pool often discover they wanted neighbours instead.' },
      { title: 'A resort empties out in winter',
        body: 'A working town keeps its rhythm all year, and that is what you will actually live in.' },
    ]);
    expect(needsEscalation(d).escalate).toBe(false);
  });

  it('escalates rather than deletes — the trigger carries the sentence, not a verdict', () => {
    const d = deck([{ title: 'Worth knowing', body: 'Moraira prices have risen 23% this year.' }]);
    const c = needsEscalation(d);
    expect(c.triggers[0].text).toContain('23%');   // the claim survives to be checked
  });
});

describe('what a low-risk writer is told', () => {
  it('names the classes that would change the job', () => {
    for (const s of ['price', 'tax', 'deadline', 'ranking', 'agency']) {
      expect(LOW_RISK_BRIEF.toLowerCase()).toContain(s);
    }
  });

  // The failure mode Christian has rejected twice: copy hedged into meaninglessness.
  it('does not tell the writer to be timid', () => {
    expect(LOW_RISK_BRIEF).toMatch(/real conviction|take a position/i);
    expect(LOW_RISK_BRIEF).toMatch(/written for checking rather than cut|sent for checking rather than cut/i);
  });
});

describe('roles, not model names', () => {
  it('resolves every role to a model with nothing configured', () => {
    for (const r of ROLES) expect(modelFor(r, {})).toBe(DEFAULT_MODELS[r]);
  });

  it('changes one role without touching the others', () => {
    const env = { [envKeyFor('FACT_EXTRACTOR')]: 'claude-haiku-4-5' };
    expect(modelFor('FACT_EXTRACTOR', env)).toBe('claude-haiku-4-5');
    expect(modelFor('WRITER', env)).toBe(DEFAULT_MODELS.WRITER);
  });

  it('ignores a blank override rather than running on an empty model name', () => {
    expect(modelFor('WRITER', { [envKeyFor('WRITER')]: '   ' })).toBe(DEFAULT_MODELS.WRITER);
  });

  it('says out loud when a customer-facing role has been moved', () => {
    const env = { [envKeyFor('WRITER')]: 'some-cheap-model' };
    expect(roleOverrides(env)[0].customerFacing).toBe(true);
    expect(describeRouting(env)).toContain('CUSTOMER-FACING');
  });

  it('is quiet when nothing is overridden', () => {
    expect(roleOverrides({})).toEqual([]);
    expect(describeRouting({})).toMatch(/default/i);
  });
});

/**
 * Christian's exact examples, 2026-09-09. A timing QUESTION is checkable but not a performance
 * claim; a timing CLAIM with a measurable outcome is HIGH even with no digits in it.
 *
 * The topic that cost $1.94 — "listing in the wrong month can add years, not weeks, to the sale" —
 * routed LOW because nothing looked for written duration.
 */
describe('market timing: the question and the claim are not the same risk', () => {
  it.each([
    'Listing your home in the wrong month can add years, not weeks, to the sale',
    'Homes sell 30% faster in spring',
    'December listings take twice as long',
    'The wrong month can add years to your sale',
    'Selling in August dramatically increases time on market',
  ])('treats a measurable outcome as HIGH: %s', (t) => {
    expect(routeTopic(t).tier).toBe('high');
  });

  it.each([
    'What is the best time of year to list?',
    'Does seasonality matter when selling?',
    'Which season brings the buyers who are actually ready',
  ])('treats a timing question as MEDIUM, not HIGH: %s', (t) => {
    expect(routeTopic(t).tier).toBe('medium');
  });

  it('records measurable_outcome so the reason is in the data', () => {
    const d = routeTopic('Listing in the wrong month can add years to the sale');
    expect(d.signal).toBe('measurable_outcome');
    expect(d.why).toMatch(/measurable outcome/i);
  });

  it('keeps ordinary lifestyle copy out of it', () => {
    expect(routeTopic('Why people fall in love with Moraira').tier).toBe('low');
    expect(routeTopic('What nobody tells you about choosing a neighbourhood').tier).toBe('low');
  });
});

/**
 * One carousel was written THREE times — a LOW draft, a researched rewrite, then a minimum-viable
 * recovery on top — because nothing counted. These are the counters, as rules.
 */
describe('one generation cannot regenerate itself repeatedly', () => {
  it('allows the first escalation and refuses the second', () => {
    expect(mayEscalate({ deckWrites: 1, escalationCycles: 0 }).ok).toBe(true);
    const second = mayEscalate({ deckWrites: 1, escalationCycles: 1 });
    expect(second.ok).toBe(false);
    expect(second.why).toMatch(/reusing the evidence already gathered/);
  });

  it('refuses a deck rewrite once targeted repair has reshaped the deck', () => {
    const r = mayRewriteDeck({ deckWrites: 1, escalationCycles: 1 });
    expect(r.ok).toBe(false);
    expect(r.why).toMatch(/already reshaped/);
  });

  it('allows exactly one deck-level recovery when nothing else has run', () => {
    expect(mayRewriteDeck({ deckWrites: 1, escalationCycles: 0 }).ok).toBe(true);
    expect(mayRewriteDeck({ deckWrites: 2, escalationCycles: 0 }).ok).toBe(false);
  });

  // The exact shape of the $1.94 run: LOW write → escalation → recovery. The third write is refused.
  it('refuses the third write in the sequence that cost $1.94', () => {
    let budget = { deckWrites: 1, escalationCycles: 0 };          // the LOW draft
    expect(mayEscalate(budget).ok).toBe(true);
    budget = { ...budget, escalationCycles: 1 };                  // targeted verification
    expect(mayRewriteDeck(budget).ok).toBe(false);                // ← the write that must not happen
  });
});
