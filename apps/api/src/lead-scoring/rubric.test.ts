import { describe, it, expect } from 'vitest';
import { computeScore, temperatureOf } from './rubric';
import { SCORING_FIXTURES } from './fixtures';
import { leadMessagesOf } from './lead-messages';
import type { Facts } from './types';

describe('rubric v1.3: the approved scale, in code', () => {
  for (const fx of SCORING_FIXTURES) {
    it(`#${fx.id} ${fx.title}: the right facts give exactly ${fx.expected.score ?? 'no score'} (${fx.expected.band})`, () => {
      const r = computeScore(fx.expectedFacts, leadMessagesOf(fx.input).length);
      expect(r.band).toBe(fx.expected.band);
      expect(r.score).toBe(fx.expected.score);
    });
  }

  it("temperatures follow Christian's bands, and not-a-lead is never cold", () => {
    expect(temperatureOf(null)).toBeNull();
    expect(temperatureOf(0)).toBe('not_a_lead');
    expect(temperatureOf(9)).toBe('not_a_lead');
    expect(temperatureOf(10)).toBe('cold');
    expect(temperatureOf(49)).toBe('cold');
    expect(temperatureOf(50)).toBe('warm');
    expect(temperatureOf(69)).toBe('warm');
    expect(temperatureOf(70)).toBe('hot');
    expect(temperatureOf(84)).toBe('hot');
    expect(temperatureOf(85)).toBe('super_hot');
    expect(temperatureOf(100)).toBe('super_hot');
  });

  it('lost, deal and do-not-contact leave scoring: no score and no temperature, so no automation can reach them', () => {
    const cases: Array<[Facts, string]> = [
      [{ real_lead: true, negative: { state: 'not_interested' } }, 'lost'],
      // Run 1: the model called a buyer who bought elsewhere "not a lead". The negative still wins.
      [{ real_lead: false, not_a_lead_reason: 'no_buy_or_sell_intent', negative: { state: 'bought_elsewhere' } }, 'lost'],
      [{ real_lead: true, decision: { state: 'already_committed' } }, 'deal'],
      [{ real_lead: true, negative: { state: 'stop_contact' } }, 'do_not_contact'],
    ];
    for (const [facts, band] of cases) {
      const r = computeScore(facts, 3);
      expect(r.band).toBe(band);
      expect(r.score).toBeNull();
      expect(temperatureOf(r.score)).toBeNull();
    }
  });

  it('95–100 means ready to act now; 100 needs immediate ready-to-close intent', () => {
    const at = (state: string) => computeScore({ real_lead: true, intent: 'real', decision: { state } }, 2).score;
    expect(at('asks_how_to_proceed')).toBe(95);
    expect(at('offer_or_negotiation')).toBe(97);
    expect(at('agrees_to_reserve_pay_or_documents')).toBe(99);
    expect(at('ready_to_close_now')).toBe(100);
  });

  it('a lone availability question is warm (50), never hot', () => {
    expect(computeScore({ real_lead: true, intent: 'real', specific_property: { state: 'availability_only' } }, 1)).toEqual({
      score: 50,
      band: 'warm',
      note: 'availability question only',
    });
  });
});
