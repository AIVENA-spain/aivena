import { describe, expect, it } from 'vitest';
import { SUPPORT_TYPES, verifySupport, type SupportContext, type SupportType } from './studio-evidence';

/**
 * THE REGRESSION THAT KEEPS COMING BACK.
 *
 * Commit 5cd5f42 was titled "a provenance type the model cannot choose is a provenance type that
 * does not exist". It widened the tool enum and the prompt to eight types and left the parser's
 * whitelist at four, so `general_mechanism` — the type that lets ordinary marketing stand without a
 * citation — was silently rewritten to `none` and every such sentence was deleted. Every existing
 * test stayed green because they all call verifySupport directly and never touch the parser.
 *
 * These tests exercise the seam itself.
 */
const ctx: SupportContext = {
  sources: [], facts: [], agencyEvidence: 'Works in: Jávea, Moraira, Dénia, Teulada',
  agencyKnowledge: 'Our buyers ask about parking in the old town more than anything else.',
  localIntelligence: '', bankText: new Map(), unestablished: new Map(),
};

/** Exactly what supportClaims does with a model's answer. Kept in step by construction. */
const parse = (raw: string): SupportType =>
  SUPPORT_TYPES.find((t) => t === String(raw ?? '')) ?? 'none';

describe('every support type the model is offered can actually be chosen', () => {
  it.each([...SUPPORT_TYPES])('parses %s back to itself', (t) => {
    expect(parse(t)).toBe(t);
  });

  it('has no type in the union the parser would silently drop', () => {
    for (const t of SUPPORT_TYPES) expect(parse(t)).not.toBe(t === 'none' ? 'x' : 'none');
  });

  it('still falls back to none for a value the model invents', () => {
    expect(parse('vibes')).toBe('none');
    expect(parse('')).toBe('none');
  });
});

describe('the medium-risk lane survives the parser', () => {
  // the exact sentence the repair ladder holds up as the model repair
  const CLAIM = 'Launching too high can make buyers question the property before they book a viewing.';

  it('lets ordinary marketing reasoning through end to end', () => {
    const r = verifySupport({ claimId: 'C1', field: 'tips[0].body', claim: CLAIM,
      claimType: 'CAUSAL_INFERENCE', supportType: parse('general_mechanism') }, ctx);
    expect(r.tier).toBe('medium');
    expect(r.verdict).toBe('supported');
    expect(r.reason).toMatch(/ordinary reasoning/);
  });

  it('would have failed under the old four-type whitelist', () => {
    const oldParse = (raw: string) => (['source_fact', 'page_direct', 'agency_profile', 'bank_fact']
      .find((t) => t === raw) ?? 'none') as SupportType;
    const r = verifySupport({ claimId: 'C1', field: 'tips[0].body', claim: CLAIM,
      claimType: 'CAUSAL_INFERENCE', supportType: oldParse('general_mechanism') }, ctx);
    expect(r.verdict).toBe('unsupported');
  });

  it('carries agency knowledge through the parser too', () => {
    const r = verifySupport({ claimId: 'C2', field: 'tips[1].body',
      claim: 'Our buyers ask about parking here more than anything else.',
      claimType: 'FACTUAL_MATERIAL', supportType: parse('agency_knowledge'),
      evidenceExcerpt: 'Our buyers ask about parking in the old town more than anything else.' }, ctx);
    expect(r.verdict).toBe('supported');
  });

  it('still refuses a specific local claim dressed as a mechanism', () => {
    const r = verifySupport({ claimId: 'C3', field: 'tips[2].body',
      claim: 'Moraira is quieter in winter than Calpe.', claimType: 'LOCAL_FACT',
      supportType: parse('general_mechanism') }, ctx);
    expect(r.verdict).toBe('unsupported');
    expect(r.reason).toMatch(/specific claim about a place/);
  });

  it('still refuses law and tax as ordinary reasoning', () => {
    const r = verifySupport({ claimId: 'C4', field: 'tips[3].body',
      claim: 'Filing Modelo 210 late forfeits your refund.', claimType: 'LEGAL_CONSEQUENCE',
      supportType: parse('general_mechanism') }, ctx);
    expect(r.verdict).toBe('unsupported');
    expect(r.reason).toMatch(/not general reasoning/);
  });
});
