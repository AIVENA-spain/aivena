import { describe, expect, it } from 'vitest';
import { figuresBacked, figuresIn, policyAllows, riskTier, verifySupport,
  type ProposedSupport, type ResearchSource, type SourceFact, type SupportContext } from './studio-evidence';
import { classifySource, domainOf } from './studio-evidence';

const src = (id: string, url: string, opened = true): ResearchSource => ({
  id, url, title: '', domain: domainOf(url), sourceClass: classifySource(url), opened,
  openedAt: opened ? '2026-09-05T00:00:00Z' : null, contentChars: 0, excerpts: [],
});

/**
 * Christian, 2026-09-05: "Bold writer + careful high-risk facts + flexible normal marketing." The
 * test that matters is not that everything is verified — it is that the right things are.
 */
describe('three tiers, not one bar', () => {
  it.each([
    // HIGH — being wrong costs money, changes a legal decision, or misrepresents the agency
    ['Filing Modelo 210 late can forfeit your right to reclaim anything at all.', undefined],
    ['The buyer withholds 3% of the full deeded price.', undefined],
    ['At province level, British buyers remain the largest foreign group.', undefined],
    ['Euribor sits above 3% now.', undefined],
    ['We have sold more homes in Jávea than anyone.', 'AGENCY_FACT'],
    ['Dénia counted 47,261 residents in 2024.', 'LOCAL_FACT'],
    ['You will pay the difference if your bill is higher.', undefined],
  ])('high risk: %s', (t, type) => expect(riskTier(t, type)).toBe('high'));

  it.each([
    // MEDIUM — grounded, but a marketing sentence about a place or a behaviour is not a citation
    ['Summer changes the rhythm of this town.', 'LOCAL_FACT'],
    ['Buyers judge a listing before they read a word of it.', 'FACTUAL_MATERIAL'],
    ['A listing that lingers makes buyers wonder what is wrong with it.', 'CAUSAL_INFERENCE'],
    ['Moraira is quieter out of season than its neighbour.', 'LOCAL_FACT'],
  ])('medium risk: %s', (t, type) => expect(riskTier(t, type)).toBe('medium'));

  it.each([
    // LOW — the post earns its living here and is never evidence-policed
    ['Your home deserves better marketing.', 'OPINION_POSITIONING'],
    ['Stop selling square metres. Sell the life.', 'MARKETING_PUFFERY'],
    ['Five agents can mean five different stories.', 'CREATIVE_HOOK'],
    ["Some homes don't need a lower price. They need a better launch.", 'OPINION_POSITIONING'],
    ['Imagine the terrace at seven in the evening.', 'HYPOTHETICAL'],
  ])('low risk: %s', (t, type) => expect(riskTier(t, type)).toBe('low'));
});

describe('a figure may not appear out of nowhere', () => {
  it('reads both thousand separators as the same number', () => {
    expect(figuresIn('3.708 operaciones')).toEqual(['3708']);
    expect(figuresIn('3,708 purchases')).toEqual(['3708']);
  });
  it('accepts a paraphrase that keeps the number', () => {
    expect(figuresBacked('Dutch buyers completed 3,708 purchases.', 'Países Bajos: 3.708 operaciones')).toBe(true);
  });
  it('refuses a number the evidence never had', () => {
    expect(figuresBacked('Dutch buyers completed 5,200 purchases.', 'Países Bajos: 3.708 operaciones')).toBe(false);
  });
  it('does not demand figures of a sentence that has none', () => {
    expect(figuresBacked('Dutch buyers moved into first place.', 'Países Bajos: 3.708 operaciones')).toBe(true);
  });
});

describe('source policy scales with risk', () => {
  const portal = [src('S1', 'https://www.idealista.com/venta-viviendas/javea')];
  const ine = [src('S2', 'https://www.ine.es/x')];
  it('refuses a portal as the ground of a tax rule', () => {
    expect(policyAllows('legal_tax', portal, 'high')).toBe(false);
  });
  it('accepts a portal for a medium-risk local claim', () => {
    expect(policyAllows('local_fact', portal, 'medium')).toBe(true);
  });
  it('accepts INE anywhere', () => {
    expect(policyAllows('market_statistics', ine, 'high')).toBe(true);
  });
  it('polices nothing at low risk', () => {
    expect(policyAllows('legal_tax', portal, 'low')).toBe(true);
  });
});

describe('a Spanish page supports an English sentence', () => {
  const sources = [src('S1', 'https://www.registradores.org/estadisticas')];
  const facts: SourceFact[] = [{
    id: 'F1', sourceId: 'S1', excerpt: 'Países Bajos: 3.708 operaciones', language: 'es',
    canonical: 'Dutch buyers completed 3,708 purchases in Alicante province in 2025.',
    sourceClass: 'professional_body', geography: 'Alicante province', period: '2025',
  }];
  const ctx: SupportContext = { sources, facts, agencyEvidence: '', bankText: new Map(), unestablished: new Set() };
  const P = (o: Partial<ProposedSupport>): ProposedSupport => ({
    claimId: 'c1', field: 'tips[0].body', claim: 'Dutch buyers moved into first place in Alicante province last year.',
    claimType: 'QUANTIFIED_CLAIM', supportType: 'source_fact', factIds: ['F1'], ...o });

  // THE POINT OF THE WHOLE LAYER: these words appear nowhere on the Spanish page.
  it('supports a paraphrase that follows from the fact', () => {
    expect(verifySupport(P({}), ctx).verdict).toBe('supported');
  });
  it('still refuses a figure the fact does not carry', () => {
    const r = verifySupport(P({ claim: 'Dutch buyers completed 5,200 purchases in Alicante province.' }), ctx);
    expect(r.verdict).toBe('unsupported');
    expect(r.reason).toMatch(/figure that is not in the evidence/);
  });
  it('refuses an invented fact id', () => {
    expect(verifySupport(P({ factIds: ['F9'] }), ctx).verdict).toBe('unsupported');
  });
  it('never polices a low-risk line at all', () => {
    const r = verifySupport(P({ claim: 'Your home deserves better marketing.',
      claimType: 'OPINION_POSITIONING', supportType: 'none', factIds: [] }), ctx);
    expect(r.verdict).toBe('supported');
    expect(r.tier).toBe('low');
  });
  it('lets a medium-risk claim rest on a portal', () => {
    const portalSrc = [src('S1', 'https://www.idealista.com/venta-viviendas/javea')];
    const portalFact: SourceFact[] = [{ ...facts[0], sourceClass: 'industry',
      canonical: 'Moraira has a marina and a seafront promenade.', excerpt: 'puerto deportivo de Moraira' }];
    const r = verifySupport({ claimId: 'c2', field: 'tips[1].body',
      claim: 'Moraira is built around its marina.', claimType: 'LOCAL_FACT',
      supportType: 'source_fact', factIds: ['F1'] },
      { ...ctx, sources: portalSrc, facts: portalFact });
    expect(r.tier).toBe('medium');
    expect(r.verdict).toBe('supported');
  });
});
