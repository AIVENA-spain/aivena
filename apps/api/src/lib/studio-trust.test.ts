import { describe, expect, it } from 'vitest';
import { deriveTrustSignal } from './studio-trust';

/**
 * The badge told the truth about whether RESEARCH RAN, not whether the CLAIMS SURVIVED. A deck whose
 * claims were removed, repaired or never checked still wore "Research checked". These lock the honest
 * rule: the mark is earned only when research ran, the gate reported, and nothing went wrong — and a
 * remix can never wear it.
 */

/** A clean, fully-supported researched deck: research ran, the gate reported, nothing failed. */
const CLEAN = {
  routing: { tier: 'high', researched: true },
  claim_qa: { claims: 4, policed: 3, blocked: [], dropped: 0, repairs: 0, bankContradictions: [] },
  fact_health: { timedOut: [], degraded: null },
  semantic_unit: { inspected: [1, 2], decisions: [] },
  claim_lineage: { rejected: 0, restatements: [] },
};

describe('the mark is earned, not lit by research alone', () => {
  it('checks a clean researched deck', () => {
    expect(deriveTrustSignal(CLEAN)).toEqual({ researched: true, claimsChecked: true });
  });

  it('a lifestyle post that did not research shows nothing', () => {
    expect(deriveTrustSignal({ routing: { tier: 'low', researched: false } }))
      .toEqual({ researched: false, claimsChecked: false });
    expect(deriveTrustSignal({})).toEqual({ researched: false, claimsChecked: false });
    expect(deriveTrustSignal(null)).toEqual({ researched: false, claimsChecked: false });
  });

  it('research ran but the gate left no report — cannot claim checked', () => {
    expect(deriveTrustSignal({ routing: { researched: true } }))
      .toEqual({ researched: true, claimsChecked: false });
  });
});

describe('a claim that did not cleanly survive downgrades the mark', () => {
  const trouble = (patch: Record<string, unknown>) =>
    deriveTrustSignal({ ...CLEAN, claim_qa: { ...CLEAN.claim_qa, ...patch } });

  it('blocked', () => expect(trouble({ blocked: [{ field: 'tips[0].body' }] }).claimsChecked).toBe(false));
  it('dropped', () => expect(trouble({ dropped: 1 }).claimsChecked).toBe(false));
  it('repaired', () => expect(trouble({ repairs: 1 }).claimsChecked).toBe(false));
  it('bank contradiction', () => expect(trouble({ bankContradictions: [{ field: 'x' }] }).claimsChecked).toBe(false));
  it('gate degraded', () => expect(trouble({ degraded: true }).claimsChecked).toBe(false));

  it('a source timed out (not checked)', () => {
    expect(deriveTrustSignal({ ...CLEAN, fact_health: { timedOut: ['ine.es'], degraded: null } }).claimsChecked)
      .toBe(false);
  });
  it('fact health degraded', () => {
    expect(deriveTrustSignal({ ...CLEAN, fact_health: { timedOut: [], degraded: 'coverage thin' } }).claimsChecked)
      .toBe(false);
  });
  it('the semantic-unit check could not fire', () => {
    expect(deriveTrustSignal({ ...CLEAN, semantic_unit: { checkerFailed: true } }).claimsChecked).toBe(false);
  });
  it('the lineage check could not fire', () => {
    expect(deriveTrustSignal({ ...CLEAN, claim_lineage: { checkFailed: true } }).claimsChecked).toBe(false);
  });

  it('still reports that research ran, even when the mark is downgraded', () => {
    expect(trouble({ dropped: 2 })).toEqual({ researched: true, claimsChecked: false });
  });
});

describe('a remix can never inherit the checked mark', () => {
  it('a remixed deck is never checked, even carrying a clean parent gate report', () => {
    expect(deriveTrustSignal({ ...CLEAN, remix_of: 'parent-uuid' }))
      .toEqual({ researched: true, claimsChecked: false });
  });

  it('a remix with no routing shows nothing at all', () => {
    // exactly what a remix stores today: engine/carousel fields + remix_of, no routing, no claim_qa
    expect(deriveTrustSignal({ engine: 'carousel', carousel_type: 'tips', remix_of: 'p', remix_axis: 'hook' }))
      .toEqual({ researched: false, claimsChecked: false });
  });
});
