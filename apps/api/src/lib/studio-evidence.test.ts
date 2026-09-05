import { describe, expect, it } from 'vitest';
import {
  classifySource, domainOf, excerptOccursIn, normalizeForMatch, policyAllows, riskOf,
  sourcesBacking, verifySupport, type ProposedSupport, type ResearchSource, type SupportContext,
} from './studio-evidence';

const src = (o: Partial<ResearchSource> & { id: string; url: string }): ResearchSource => ({
  title: '', domain: domainOf(o.url), sourceClass: classifySource(o.url), opened: true,
  openedAt: '2026-09-05T00:00:00Z', contentChars: (o.content ?? '').length, excerpts: [], ...o,
});

const CC1450 = 'Artículo 1450. La venta se perfeccionará entre comprador y vendedor, y será '
  + 'obligatoria para ambos, si hubieren convenido en la cosa objeto del contrato y en el precio, '
  + 'aunque ni la una ni el otro se hayan entregado.';

describe('excerpt verification', () => {
  it('accepts the line as it stands on the page', () => {
    expect(excerptOccursIn('La venta se perfeccionará entre comprador y vendedor', CC1450)).toBe(true);
  });
  it('accepts it with the accents dropped and the quotes changed', () => {
    expect(excerptOccursIn('"La venta se perfeccionara entre comprador y vendedor"', CC1450)).toBe(true);
  });
  it('accepts a re-wrapped line that keeps every content word in order', () => {
    expect(excerptOccursIn('venta perfeccionará comprador vendedor obligatoria ambos', CC1450)).toBe(true);
  });
  // MUST-BLOCK: the whole point. A paraphrase is not a quotation.
  it('rejects a paraphrase that says the opposite', () => {
    expect(excerptOccursIn('Nothing is binding until a document is signed', CC1450)).toBe(false);
  });
  it('rejects an excerpt too short to identify anything', () => {
    expect(excerptOccursIn('venta', CC1450)).toBe(false);
  });
  it('rejects content words that appear out of order', () => {
    expect(excerptOccursIn('entregado precio contrato objeto cosa la en convenido', CC1450)).toBe(false);
  });
  it('normalises accents, smart quotes and dashes', () => {
    expect(normalizeForMatch('perfeccionará — “x”')).toBe('perfeccionara - x');
  });
});

describe('source classification', () => {
  it.each([
    ['https://www.boe.es/buscar/act.php?id=BOE-A-1889-4763', 'official_primary'],
    ['https://sede.agenciatributaria.gob.es/Sede/ayuda.html', 'official_primary'],
    ['https://www.ine.es/jaxiT3/Tabla.htm', 'official_statistics'],
    ['https://estadisticasdecriminalidad.ses.mir.es/', 'official_statistics'],
    ['https://www.registradores.org/estadisticas', 'professional_body'],
    ['https://noticias.juridicas.com/base_datos/Privado/cc.l4t4.html', 'legal_reference'],
    ['https://www.iberley.es/legislacion/articulo-1454-codigo-civil', 'legal_reference'],
    ['https://ajuntament.calp.es/es/poblacion', 'official_regional'],
    ['https://www.gva.es/va/inicio', 'official_regional'],
    ['https://www.idealista.com/news/inmobiliario', 'press'],
    ['https://www.idealista.com/venta-viviendas/javea', 'industry'],
    ['https://www.rome2rio.com/s/Javea/Denia', 'industry'],
  ])('%s → %s', (url, cls) => expect(classifySource(url)).toBe(cls));
});

describe('risk classification', () => {
  // the exact sentence whose risk the first version of this file scored as none
  it('reads Modelo 210 as legal/tax despite the digit boundary', () => {
    expect(riskOf('Filing Modelo 210 late can forfeit your right to reclaim anything at all.')).toBe('legal_tax');
  });
  it('reads a nationality ranking as market statistics', () => {
    expect(riskOf('At province level, British buyers remain the largest foreign group.')).toBe('market_statistics');
  });
  it('reads a population figure as a local fact', () => {
    expect(riskOf("Teulada-Moraira's municipio counted 12,912 residents in 2025.")).toBe('local_fact');
  });
  // MUST-PASS: marketing rhetoric must stay risk-free or the engine goes sterile
  it.each([
    'Most property listings are forgettable.',
    'Buyers scroll dozens of near-identical homes before one stops them.',
    'We would rather have one accountable agent.',
    'A generic pool shot competes with a hundred others in the same feed.',
  ])('leaves rhetoric alone: %s', (t) => expect(riskOf(t)).toBe('none'));
  it('takes the claim type as the floor even when the wording is bland', () => {
    expect(riskOf('It works differently here.', 'LEGAL_CONSEQUENCE')).toBe('legal_tax');
  });
});

describe('source policy', () => {
  const blog = src({ id: 'S1', url: 'https://spainguide.blog.example/tax' });
  const boe = src({ id: 'S2', url: 'https://www.boe.es/x' });
  const ine = src({ id: 'S3', url: 'https://www.ine.es/x' });
  it('refuses a blog as the ground of a tax rule', () => expect(policyAllows('legal_tax', [blog])).toBe(false));
  it('accepts a database that reproduces the statute verbatim', () => {
    expect(policyAllows('legal_tax', [src({ id: 'S9', url: 'https://noticias.juridicas.com/base_datos/Privado/cc.l4t4.html' })])).toBe(true);
  });
  it('refuses a newspaper as the ground of a statistic', () => {
    expect(policyAllows('market_statistics', [src({ id: 'S8', url: 'https://elpais.com/economia/x.html' })])).toBe(false);
  });
  it('accepts the BOE', () => expect(policyAllows('legal_tax', [boe])).toBe(true));
  it('accepts INE for a statistic', () => expect(policyAllows('market_statistics', [ine])).toBe(true));
  it('refuses a source that was found but never opened', () => {
    expect(policyAllows('legal_tax', [{ ...boe, opened: false }])).toBe(false);
  });
  it('does not police rhetoric', () => expect(policyAllows('none', [blog])).toBe(true));
});

describe('sourcesBacking', () => {
  const s1 = src({ id: 'S1', url: 'https://www.boe.es/x', content: CC1450 });
  const s2 = src({ id: 'S2', url: 'https://www.ine.es/x', content: 'unrelated text about population' });
  it('returns only the sources the excerpt is actually on', () => {
    expect(sourcesBacking('La venta se perfeccionará entre comprador y vendedor', ['S1', 'S2'], [s1, s2])).toEqual(['S1']);
  });
  it('returns nothing for a page that was never opened', () => {
    expect(sourcesBacking('La venta se perfeccionará entre comprador', ['S1'], [{ ...s1, opened: false }])).toEqual([]);
  });
});

describe('verifySupport', () => {
  const sources = [
    src({ id: 'S1', url: 'https://www.boe.es/x', content: CC1450 }),
    src({ id: 'S2', url: 'https://spainlaw.blog.example/x', content: CC1450 }),
    src({ id: 'S3', url: 'https://www.ine.es/x', content: 'Calp 27.616 habitantes a 1 de enero de 2025' }),
  ];
  const ctx = (over: Partial<SupportContext> = {}): SupportContext => ({
    sources, facts: [], agencyEvidence: 'Works in: Jávea, Moraira, Dénia, Teulada. Staff speak es, en, nl, de.',
    bankText: new Map([['B43#2', 'The current Registradores nationality ranking is published at NATIONAL level only']]),
    unestablished: new Set<string>(), ...over,
  });
  const P = (o: Partial<ProposedSupport>): ProposedSupport => ({
    claimId: 'c1', field: 'tips[0].body', claim: 'A sale is binding once thing and price are agreed.',
    claimType: 'LEGAL_CONSEQUENCE', supportType: 'page_direct', ...o,
  });

  it('supports a claim quoted off an official page that was opened', () => {
    const r = verifySupport(P({ sourceIds: ['S1'], evidenceExcerpt: 'La venta se perfeccionará entre comprador y vendedor' }), ctx());
    expect(r.verdict).toBe('supported');
  });
  // MUST-BLOCK: the H4 shape — plausible sentence, no excerpt behind it
  it('refuses a claim with no excerpt', () => {
    const r = verifySupport(P({ sourceIds: ['S1'], evidenceExcerpt: '' }), ctx());
    expect(r.verdict).toBe('unsupported');
    expect(r.reason).toMatch(/no evidence excerpt/);
  });
  it('refuses an invented source id', () => {
    const r = verifySupport(P({ sourceIds: ['S9'], evidenceExcerpt: 'La venta se perfeccionará entre comprador' }), ctx());
    expect(r.verdict).toBe('unsupported');
    expect(r.reason).toMatch(/do not exist/);
  });
  // The second link: allowed, marked, and counted apart — never presented as page-verified.
  it('accepts a quote off a briefing line that names an opened page, and marks it', () => {
    const brief = 'A sale binds both sides once thing and price are agreed. [S1]';
    const r = verifySupport(P({ sourceIds: ['S1'], evidenceExcerpt: 'A sale binds both sides once thing and price are agreed' }),
      { ...ctx(), brief });
    expect(r.verdict).toBe('supported');
    expect(r.viaBriefing).toBe(true);
  });
  it('will not accept a briefing line that names no cited source', () => {
    const brief = 'A sale binds both sides once thing and price are agreed.';
    expect(verifySupport(P({ sourceIds: ['S1'], evidenceExcerpt: 'A sale binds both sides once thing and price are agreed' }),
      { ...ctx(), brief }).verdict).toBe('unsupported');
  });
  it('will not let a briefing line launder a source class that may not carry the claim', () => {
    const brief = 'A sale binds both sides once thing and price are agreed. [S2]';
    expect(verifySupport(P({ sourceIds: ['S2'], evidenceExcerpt: 'A sale binds both sides once thing and price are agreed' }),
      { ...ctx(), brief }).verdict).toBe('unsupported');
  });
  it('refuses an excerpt that is not on the page it cites', () => {
    const r = verifySupport(P({ sourceIds: ['S3'], evidenceExcerpt: 'La venta se perfeccionará entre comprador' }), ctx());
    expect(r.verdict).toBe('unsupported');
    expect(r.reason).toMatch(/does not occur/);
  });
  it('refuses a page a search returned but nothing opened', () => {
    const closed = sources.map((s) => (s.id === 'S1' ? { ...s, opened: false } : s));
    const r = verifySupport(P({ sourceIds: ['S1'], evidenceExcerpt: 'La venta se perfeccionará entre comprador' }), ctx({ sources: closed }));
    expect(r.verdict).toBe('unsupported');
    expect(r.reason).toMatch(/never opened/);
  });
  it('refuses a legal claim resting only on a blog, even quoted correctly', () => {
    const r = verifySupport(P({ sourceIds: ['S2'], evidenceExcerpt: 'La venta se perfeccionará entre comprador y vendedor' }), ctx());
    expect(r.verdict).toBe('unsupported');
    expect(r.reason).toMatch(/may not rest on/);
  });
  // MUST-BLOCK: the B and H3 shape
  // Christian 2026-09-05: partial is not permission for the paragraph, and not a bar either — the
  // claim still has to produce direct evidence for the proposition it actually uses.
  it('lets a partial requirement through when the claim has its own evidence', () => {
    const r = verifySupport(
      P({ sourceIds: ['S1'], evidenceExcerpt: 'La venta se perfeccionará entre comprador y vendedor', requirementIds: ['B11#1'] }),
      ctx({ unestablished: new Set<string>() }));
    expect(r.verdict).toBe('supported');
  });
  it('refuses any claim that rests on an unestablished requirement', () => {
    const r = verifySupport(
      P({ sourceIds: ['S1'], evidenceExcerpt: 'La venta se perfeccionará entre comprador y vendedor', requirementIds: ['B12#3'] }),
      ctx({ unestablished: new Set(['B12#3']) }));
    expect(r.verdict).toBe('unsupported');
    expect(r.reason).toMatch(/unestablished requirement B12#3/);
  });
  it('supports an agency claim that is in the profile', () => {
    const r = verifySupport(P({ claim: 'We work in Jávea and Dénia.', claimType: 'AGENCY_FACT',
      supportType: 'agency_profile', evidenceExcerpt: 'Works in: Jávea, Moraira, Dénia, Teulada' }), ctx());
    expect(r.verdict).toBe('supported');
  });
  it('refuses an agency claim that is not', () => {
    const r = verifySupport(P({ claim: 'We sell homes 30% faster.', claimType: 'AGENCY_FACT',
      supportType: 'agency_profile', evidenceExcerpt: 'we sell homes faster than anyone' }), ctx());
    expect(r.verdict).toBe('unsupported');
  });
  it('supports a claim quoted from the verified bank', () => {
    const r = verifySupport(P({ claimType: 'QUANTIFIED_CLAIM', supportType: 'bank_fact',
      bankFactIds: ['B43#2'], evidenceExcerpt: 'nationality ranking is published at NATIONAL level only' }), ctx());
    expect(r.verdict).toBe('supported');
  });
  it('refuses a bank citation the bank does not contain', () => {
    const r = verifySupport(P({ claimType: 'QUANTIFIED_CLAIM', supportType: 'bank_fact',
      bankFactIds: ['B43#2'], evidenceExcerpt: 'British buyers lead Alicante province' }), ctx());
    expect(r.verdict).toBe('unsupported');
  });
  it('refuses a claim offering no support at all', () => {
    expect(verifySupport(P({ supportType: 'none' }), ctx()).verdict).toBe('unsupported');
  });
});

// A rule that cannot fire looks exactly like a rule that found nothing. Every branch of the verdict
// must be reachable, or this file is decoration.
describe('every unsupported reason is reachable', () => {
  it('covers each branch at least once', () => {
    const reasons = new Set<string>();
    const sources = [src({ id: 'S1', url: 'https://www.boe.es/x', content: CC1450 })];
    const base: SupportContext = { sources, agencyEvidence: 'Works in: Jávea', bankText: new Map(), unestablished: new Set(['R#1']) };
    const cases: ProposedSupport[] = [
      { claimId: 'a', field: 'f', claim: 'x tax', claimType: 'LEGAL_CONSEQUENCE', supportType: 'page_direct', requirementIds: ['R#1'] },
      { claimId: 'b', field: 'f', claim: 'x tax', claimType: 'LEGAL_CONSEQUENCE', supportType: 'page_direct', sourceIds: ['S1'] },
      { claimId: 'c', field: 'f', claim: 'x tax', claimType: 'LEGAL_CONSEQUENCE', supportType: 'page_direct', sourceIds: ['ZZ'], evidenceExcerpt: 'La venta se perfeccionará entre comprador' },
      { claimId: 'd', field: 'f', claim: 'x tax', claimType: 'LEGAL_CONSEQUENCE', supportType: 'page_direct', evidenceExcerpt: 'La venta se perfeccionará entre comprador' },
      { claimId: 'e', field: 'f', claim: 'x tax', claimType: 'LEGAL_CONSEQUENCE', supportType: 'page_direct', sourceIds: ['S1'], evidenceExcerpt: 'something not on that page at all really' },
      { claimId: 'f', field: 'f', claim: 'x', claimType: 'AGENCY_FACT', supportType: 'agency_profile', evidenceExcerpt: 'we are the biggest agency on the coast' },
      { claimId: 'g', field: 'f', claim: 'x', claimType: 'QUANTIFIED_CLAIM', supportType: 'bank_fact', bankFactIds: ['nope'], evidenceExcerpt: 'anything at all here' },
      { claimId: 'h', field: 'f', claim: 'x', claimType: 'FACTUAL_MATERIAL', supportType: 'none' },
    ];
    for (const c of cases) {
      const r = verifySupport(c, base);
      expect(r.verdict).toBe('unsupported');
      reasons.add(r.reason.replace(/[A-Z]\d+#?\d*/g, 'ID'));
    }
    expect(reasons.size).toBeGreaterThanOrEqual(7);
  });
});
