import { describe, it, expect } from 'vitest';
import { explain } from './explain';

describe('explain: built by code from verified facts only', () => {
  it("a discarded fact never appears, and the model's own sentence is never used", () => {
    const s = explain(
      { score: 76, band: 'hot' },
      {
        real_lead: true,
        intent: 'real',
        budget: { state: 'clear', quote: 'budget up to €300,000' },
        // The evidence check already reset this one to 'none': its quote must not leak into the explanation.
        area: { state: 'none', quote: 'Villamartin' },
        need: { state: 'clear', quote: '3-bedroom house with a garden' },
        reason: 'THE MODEL SENTENCE',
      },
    );
    expect(s).toBe('Hot 76: budget: “budget up to €300,000” · looking for: “3-bedroom house with a garden”');
    expect(s).not.toContain('Villamartin');
    expect(s).not.toContain('THE MODEL SENTENCE');
  });
  it('evidence from several messages reads as separate quotes', () => {
    expect(explain({ score: 89, band: 'super_hot' }, { real_lead: true, need: { state: 'clear', quote: 'L3: hus | L5: med basseng' } })).toBe(
      'Super-hot 89: looking for: “hus” … “med basseng”',
    );
  });
  it('the message numbers are for the quote check only: people never see them', () => {
    const s = explain({ score: 89, band: 'super_hot' }, { real_lead: true, viewing: { state: 'agreed_change_pending', within_7_days: true, quote: 'L22: Ja det passer | L23: Kunne vi faktisk tatt det imrg isteden' } });
    expect(s).toBe('Super-hot 89: viewing agreed, change pending: “Ja det passer” … “Kunne vi faktisk tatt det imrg isteden”');
    expect(s).not.toMatch(/L2\d/);
  });
  it('lost reads as lost, with its evidence', () => {
    expect(explain({ score: null, band: 'lost' }, { real_lead: true, negative: { state: 'bought_elsewhere', quote: 'bought a house through another agency' } })).toBe(
      'Lost, not scored: bought elsewhere: “bought a house through another agency”',
    );
  });
  it('not a lead names why', () => {
    expect(explain({ score: 0, band: 'not_a_lead' }, { real_lead: false, not_a_lead_reason: 'spam' })).toBe('Not a lead 0: spam');
  });
});
