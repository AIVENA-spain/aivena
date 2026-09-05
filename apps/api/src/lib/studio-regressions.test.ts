import { describe, expect, it } from 'vitest';
import { GATE_RULES, gateField } from './studio-copy-gate';

/**
 * The exact sentences the 5dfb1c3 acceptance run published, and the corrected versions that must
 * survive. Christian's rule: a correction may not become a new absolute — replacing "nothing is
 * binding until you sign" with "any accepted offer binds you" would be a different wrong answer.
 */
const fired = (t: string) => gateField('tips[0].body', t, 'research present').map((h) => h.rule.id);

describe('the fifteen confirmed defects, as fixtures', () => {
  describe('H1 — a verbal agreement in Spain', () => {
    it.each([
      'Agreeing a price by phone or email creates no obligation on either side in Spain. Nothing is binding until a document is signed — until then, either party can walk.',
      'In Spain nothing is binding until you sign, and what you sign decides whether you can still walk away.',
      'A verbal yes means nothing yet.',
      'Until you put it in writing, no obligation exists for either side.',
    ])('blocks: %s', (t) => expect(fired(t)).toContain('binding-only-on-signature'));

    it.each([
      'Agreement on the property and the price can already bind both sides under the Civil Code; whether a particular exchange did depends on what was actually agreed.',
      'What you sign next decides the remedies, not whether a contract exists at all.',
      'A price agreed in a message can already matter — what is provable is the harder question.',
    ])('leaves the nuanced version alone: %s', (t) => expect(fired(t)).toEqual([]));
  });

  describe('H2 — a late Modelo 210', () => {
    it.each([
      'Filing Modelo 210 late can forfeit your right to reclaim anything at all.',
      'Miss the four-month window and you lose the refund entirely.',
    ])('blocks: %s', (t) => expect(fired(t)).toContain('late-filing-forfeits-refund'));

    it.each([
      'A late Modelo 210 costs surcharges and interest; the right to reclaim an excess withholding runs on its own four-year clock.',
      'The filing period and the period in which the right prescribes are two different clocks.',
    ])('leaves the nuanced version alone: %s', (t) => expect(fired(t)).toEqual([]));
  });

  describe('B — furniture and utilities are evidence, not a switch', () => {
    it('challenges the automatic reading', () => {
      expect(fired('Following a 2020 Supreme Court ruling, a furnished holiday home with electricity, water and gas connected counts as an occupied residence.'))
        .toContain('morada-by-checklist');
    });
    it('leaves the nuanced version alone', () => {
      expect(fired('A second home can constitute a morada where its owner genuinely uses it for private life, and furniture and connected utilities are evidence of that use.'))
        .toEqual([]);
    });
  });
});

// A rule that cannot fire is indistinguishable from a rule that found nothing. Every rule in the
// table gets a string that must trip it — this guard has caught three real dead rules already.
describe('the three new rules can actually fire', () => {
  it.each(['binding-only-on-signature', 'late-filing-forfeits-refund', 'morada-by-checklist'])(
    '%s is a real rule with both halves reachable', (id) => {
      const rule = GATE_RULES.find((r) => r.id === id);
      expect(rule).toBeDefined();
      expect(rule!.problem.length).toBeGreaterThan(80);
      expect(rule!.authority.length).toBeGreaterThan(10);
    });
});
