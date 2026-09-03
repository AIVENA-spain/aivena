import { describe, expect, it } from 'vitest';

import { GATE_RULES, endsMidThought, gateField } from './studio-copy-gate';

const fired = (text: string, research = '') =>
  gateField('tips[0].body', text, research).map((h) => h.rule.id);

/**
 * The ten permanent regression cases, each as a MUST-BLOCK / MUST-PASS pair.
 *
 * The pass half is not decoration. A gate that cannot fail proves nothing, and a gate that blocks
 * the correct debunk of a myth is the bug this project has already shipped twice — "there is no
 * 48-hour rule" is the sentence we WANT. Every block string below is real text a live generation
 * produced, or the exact myth the bank forbids.
 */
describe('deterministic claim gate — the ten regression cases', () => {
  it('1. the 15-day squatter myth', () => {
    expect(fired('Since 3 April 2025, Ley Orgánica 1/2025 moved usurpación and allanamiento de morada '
      + 'into juicios rápidos, aiming to resolve these cases in about 15 days.')).toContain('squatter-15-days');
    expect(fired('There is no 15-day eviction deadline in Spanish law.')).not.toContain('squatter-15-days');
  });

  it('2. a fixed-hour squatter rule', () => {
    expect(fired('You have 48 hours to report it before the okupas gain rights.'))
      .toContain('squatter-fixed-hours');
    // Both of these are real lines a live generation produced, and both are correct.
    expect(fired("There's no official 24 or 48-hour eviction statute.")).not.toContain('squatter-fixed-hours');
    expect(fired("There's no rule that a squatter becomes unremovable after 48 hours."))
      .not.toContain('squatter-fixed-hours');
  });

  it('3. non-violent usurpación sent down the fast track', () => {
    expect(fired('Ley Orgánica 1/2025 moved usurpación into juicios rápidos.'))
      .toContain('usurpacion-fast-track');
    expect(fired('Non-violent usurpación under art. 245.2 does not take the juicio rápido route.'))
      .not.toContain('usurpacion-fast-track');
  });

  it('4. an approximate legal timeline nobody established', () => {
    const claim = 'About a month after filing, the court orders occupants to show a title to the property.';
    expect(fired(claim)).toContain('legal-timeline-approximate');
    expect(fired(claim, 'The requerimiento is issued about a month after the demanda is filed.'))
      .not.toContain('legal-timeline-approximate');
  });

  it('5. an unsupported commission pattern', () => {
    expect(fired('Exclusive terms often carry a slightly lower commission, since the agency is '
      + 'confident it can close the sale alone.')).toContain('commission-pattern');
    expect(fired('We will walk you through what our commission covers.')).not.toContain('commission-pattern');
  });

  it('6. mandate mechanics universalised from one possible contract', () => {
    expect(fired('Under a non-exclusive mandate, only the agent who lands the buyer gets paid.'))
      .toContain('mandate-mechanics');
    expect(fired('An exclusive mandate hands the sale to a single agency for a set period, usually '
      + 'three to six months.')).toContain('mandate-mechanics');
    // Written as a list of durations rather than a range, this walked past the first version.
    expect(fired('Exclusive terms are commonly three, six or twelve months, often auto-renewing '
      + 'unless cancelled in writing.')).toContain('mandate-mechanics');
    // Not universalised WITHOUT support: research that establishes the terms clears it.
    expect(fired('Exclusive terms are commonly three, six or twelve months, often auto-renewing.',
      'A nota de encargo on this coast typically runs a fixed term of three to twelve months, '
      + 'with auto-renewal unless cancelled in writing.')).not.toContain('mandate-mechanics');
    // The commercial argument the owner wants KEPT must sail through untouched.
    expect(fired('One agency, one line of communication, means someone actually answers for the campaign.'))
      .toHaveLength(0);
    expect(fired('Five agents on a listing gives a seller five people to chase and nobody accountable.'))
      .toHaveLength(0);
  });

  it('8. a cause invented from two observations', () => {
    expect(fired("Fewer sales, not less demand. That's tight supply, not cooling interest."))
      .toContain('causal-inference');
    expect(fired('Fewer transactions do not automatically mean weaker demand.'))
      .not.toContain('causal-inference');
  });

  it('9. a legal obligation upgraded to a hard stop', () => {
    expect(fired('Agency commission, a gestor to handle the paperwork, the energy certificate you '
      + 'need to sell at all.')).toContain('obligation-upgraded');
    // The owner's own corrected wording. Blocking this would be the gate defeating the fix.
    expect(fired('The energy certificate the seller is required to provide.'))
      .not.toContain('obligation-upgraded');
  });

  it('10. a field cut off mid-thought', () => {
    expect(endsMidThought('timelines still vary by court and')).toBe(true);
    expect(endsMidThought('timelines still vary by court.')).toBe(false);
    expect(endsMidThought('Buyers notice the gap before they ever ask about the house.')).toBe(false);
  });

  it('also kills the abolished golden visa in any framing', () => {
    expect(fired('Buy a property at the right level and the golden visa gives you residence.'))
      .toContain('golden-visa');
  });
});

describe('the gate leaves marketing alone', () => {
  // Post F was pure marketing and correct. If the gate touches any of it, the gate is wrong.
  const POST_F = [
    'Buyers scroll fast and judge in seconds. A wide, flat photo of the whole facade tells them '
      + "nothing they can't get from twenty other listings.",
    '"Spacious," "bright," "close to everything" describe thousands of homes on this coast.',
    'A number alone gives a buyer nothing to justify it.',
    "Buyers don't read a listing top to bottom like a document.",
    "The goal isn't to be seen once. It's to be the listing a buyer goes back to before making the call.",
    'Most property listings are forgettable. Yours does not have to be.',
  ];
  it('fires on nothing in a pure-marketing post', () => {
    for (const line of POST_F) expect(gateField('f', line), line).toHaveLength(0);
  });

  it('fires on nothing in the clean seller-money card', () => {
    expect(gateField('c', 'If there is still a loan on the property, the bank is paid off from the '
      + 'proceeds at completion, plus a cancellation cost that varies by lender.')).toHaveLength(0);
  });
});

describe('the table itself', () => {
  it('gives every rule an authority and a repairable problem statement', () => {
    for (const r of GATE_RULES) {
      expect(r.authority.length, r.id).toBeGreaterThan(40);
      expect(r.problem.length, r.id).toBeGreaterThan(40);
      expect(r.all.length, r.id).toBeGreaterThanOrEqual(2);
      if (r.severity === 'challenge') expect(['challenge']).toContain(r.severity);
    }
  });
});

/**
 * Adversarial pairs found by re-running the shipped table against 29 hand-written strings.
 *
 * Every one of these was a real defect in the first version: four myths it let through, three
 * correct debunks it blocked, and one rule that could never fire at all because the phrase it
 * hunted for — "cannot" — was also on its own list of negation cues.
 */
describe('refutation scope — the eight defects the adversarial pass found', () => {
  it('a trailing "not" that negates something else does not clear the claim', () => {
    expect(fired('Squatters are evicted in 15 days, not months.')).toContain('squatter-15-days');
    expect(fired('The 15-day okupa eviction is a myth, not a rule.')).not.toContain('squatter-15-days');
  });

  it('a negation far away in the sentence does not reach the claim', () => {
    expect(fired('What no agent will tell you: squatters can be evicted in 15 days.'))
      .toContain('squatter-15-days');
    expect(fired('Forget what you read about okupas being out in 48 hours.'))
      .not.toContain('squatter-fixed-hours');
  });

  it('a negation in a later clause does not clear an assertion in an earlier one', () => {
    expect(fired('An exclusive mandate runs three to six months and no other agency can market the property.'))
      .toContain('mandate-mechanics');
    expect(fired('One point of contact. One coordinated strategy. One person accountable.'))
      .toHaveLength(0);
  });

  it("a rule's own trigger word cannot serve as its alibi", () => {
    // "cannot" is both the hard-stop phrasing this rule hunts and a negation cue. Before masking,
    // the rule cleared itself every single time and could never fire.
    expect(fired('Without a registered energy certificate you cannot sell.'))
      .toContain('obligation-upgraded');
    expect(fired('The energy certificate the seller is required to provide.')).toHaveLength(0);
  });

  it('reads the answer to a rhetorical question', () => {
    expect(fired('Evicted in 15 days? No. Here is what actually happens.'))
      .not.toContain('squatter-15-days');
    expect(fired('Evicted in 15 days? Yes, since the reform.')).toContain('squatter-15-days');
  });

  it('leaves a plain observation alone but catches the cause bolted onto it', () => {
    expect(fired('Fewer homes changed hands in Alicante province than a year earlier, while prices '
      + 'were reported at record highs.')).toHaveLength(0);
    expect(fired("Fewer sales, not less demand. That's tight supply, not cooling interest."))
      .toContain('causal-inference');
  });

  it('catches an invented hearing date and leaves honest advice alone', () => {
    expect(fired('Expect a first hearing about a month after filing the denuncia.'))
      .toContain('legal-timeline-approximate');
    expect(fired('Ask your lawyer for a realistic date, in writing.')).toHaveLength(0);
  });

  it('catches a commission regularity and leaves a plain offer alone', () => {
    expect(fired('An exclusive mandate usually carries a lower commission than splitting the job '
      + 'between three agencies.')).toContain('commission-pattern');
    expect(fired('We will walk you through what our commission covers.')).toHaveLength(0);
  });
});

describe('a correct, precise legal statement is not a violation', () => {
  it('leaves the violent branch alone and still catches the unqualified claim', () => {
    // The first version of the fast-track rule deleted this sentence from a live post. It is true:
    // allanamiento and violent usurpación DO enter the fast track. Only the unqualified claim, and
    // the explicitly non-violent one, are wrong.
    expect(fired('Since April 2025, allanamiento and violent usurpación can enter the fast-track '
      + 'criminal route.')).toHaveLength(0);
    expect(fired('Ley Orgánica 1/2025 moved usurpación into juicios rápidos.'))
      .toContain('usurpacion-fast-track');
    expect(fired('A non-violent occupation of an empty home goes straight to a juicio rápido.'))
      .toContain('usurpacion-fast-track');
  });
});

describe('7. a local premise written with no research', () => {
  const CLAIM = 'Jávea needs a car for the school run; Dénia you can do on foot.';

  it('fires when nothing was researched about the towns it names', () => {
    expect(fired(CLAIM, '')).toContain('local-premise-unresearched');
  });

  it('clears once the research actually covers those towns', () => {
    const brief = 'Javea is split across the Old Town, the Port and the Arenal, so daily errands '
      + 'usually mean driving. Denia concentrates its market, port and old town within walking distance.';
    expect(fired(CLAIM, brief)).not.toContain('local-premise-unresearched');
  });

  it('matches across accents in either direction', () => {
    expect(fired('Denia you can do on foot.', 'Dénia concentrates everything in walking distance.'))
      .not.toContain('local-premise-unresearched');
  });

  it('leaves the feeling alone — only the premise is policed', () => {
    // The register the owner wants kept. No checkable premise, so nothing fires.
    expect(fired('Jávea trades convenience for calm.', '')).toHaveLength(0);
    expect(fired('Pick the life first. The house comes after.', '')).toHaveLength(0);
    // And a pure-marketing post names no town at all.
    expect(fired('Buyers scroll fast and judge in seconds.', '')).toHaveLength(0);
  });
});

/**
 * The structural guard against this project's most-repeated bug: a matcher that CANNOT FIRE looks
 * exactly like a matcher that found nothing wrong. Four have shipped now — a word boundary after
 * "Art.", a non-overlapping finditer, "okupa" followed by \b, and a rule whose trigger word was
 * also on its own negation-cue list. If a rule is added without a string that makes it fire, this
 * fails, and nobody has to notice.
 */
describe('every rule in the table can actually fire', () => {
  const CORPUS = [
    'Since 3 April 2025, Ley Orgánica 1/2025 moved usurpación and allanamiento de morada into '
      + 'juicios rápidos, aiming to resolve these cases in about 15 days.',
    'You have 48 hours to report it before the okupas gain rights.',
    'Buy a property at the right level and the golden visa gives you residence.',
    'Expect a first hearing about a month after filing the denuncia.',
    'Exclusive terms often carry a slightly lower commission than a multi-agency listing.',
    'Under a non-exclusive mandate, only the agent who lands the buyer gets paid.',
    'Without a registered energy certificate you cannot sell.',
    "Fewer sales, not less demand. That's tight supply, not cooling interest.",
    'Jávea needs a car for the school run; Dénia you can do on foot.',
  ];
  it('is exercised by at least one string each', () => {
    const seen = new Set(CORPUS.flatMap((c) => gateField('t', c, '')).map((h) => h.rule.id));
    const dead = GATE_RULES.filter((r) => !seen.has(r.id)).map((r) => r.id);
    expect(dead, `these rules never fired — they may be unable to`).toEqual([]);
  });

  it('has no duplicate rule ids', () => {
    const ids = GATE_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('two defects the second live run exposed', () => {
  it('a card may not end on a bare negator', () => {
    // Real generated text. The first dangling list knew connectives but not "not", so a card
    // shipped reading "...are hearing timelines, not".
    const body = 'Since April 2025, break-ins into a lived-in home can move through the fast-track '
      + 'court process. Minor occupation of an empty property without violence still goes through '
      + 'the slower track - the 15-day figures people quote are hearing timelines, not';
    expect(endsMidThought(body)).toBe(true);
    expect(endsMidThought('the 15-day figures people quote are hearing timelines')).toBe(false);
    expect(endsMidThought('One agency. One price. One story')).toBe(false);
  });

  it('an unanswered question asserts nothing and survives', () => {
    // The teaser is the open loop that sets up the debunk on the next slide. Deleting it is an
    // over-block, and over-blocking is the failure mode that quietly ruins the writing.
    expect(fired("Does the '48-hour rule' people mention actually exist?")).toHaveLength(0);
    expect(fired('Evicted in 15 days?')).toHaveLength(0);
    // But a question that answers itself is judged on the answer.
    expect(fired('Evicted in 15 days? Yes, since the reform.')).toContain('squatter-15-days');
  });
});
