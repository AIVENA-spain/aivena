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
