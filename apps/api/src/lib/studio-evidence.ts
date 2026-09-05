/**
 * EVIDENCE — what a published claim is allowed to rest on.
 *
 * The acceptance run of 5dfb1c3 published fifteen material defects while its own counters reported
 * two. The reason was not weak detectors. It was that "supported" meant a second model had said the
 * word SUPPORTED, and "the research establishes it" meant the sentence resembled the briefing.
 * Neither is evidence. A claim about the outside world that a reader could act on must be able to
 * point at the page it came from, and the excerpt must actually be on that page.
 *
 * Everything here is pure and offline so it can be tested: classification of a source, verification
 * that an excerpt really occurs in the text that was fetched, and the source policy that decides
 * which classes of page may carry a legal, tax or statistical proposition.
 */

/* ── SOURCES ─────────────────────────────────────────────────────────────────────────────── */

export type SourceClass =
  | 'official_primary'      // the law itself, and the tax authority: BOE, AEAT, Fiscalía, CGPJ
  | 'official_statistics'   // INE, Interior's crime series, Catastro
  | 'official_regional'     // Generalitat, DOGV, an ayuntamiento
  | 'professional_body'     // Registradores, Notariado, the colegios
  | 'legal_reference'       // databases that reproduce the statute text itself
  | 'press'
  | 'industry'              // portals, brokerages, consultancies
  | 'blog'
  | 'unknown';

export interface ResearchSource {
  id: string;
  url: string;
  title: string;
  domain: string;
  sourceClass: SourceClass;
  /** TRUE ONLY when the page itself was fetched. A search result is a pointer, not a reading. */
  opened: boolean;
  openedAt: string | null;
  contentChars: number;
  /** held in memory during generation so an excerpt can be checked against it; never persisted whole */
  content?: string;
  /** the excerpts a published claim cited from this page, each verified before it was kept */
  excerpts: string[];
}

const OFFICIAL_PRIMARY = [
  'boe.es', 'agenciatributaria.es', 'agenciatributaria.gob.es', 'sede.agenciatributaria.gob.es',
  'fiscal.es', 'poderjudicial.es', 'tribunalconstitucional.es', 'congreso.es', 'senado.es',
  'eur-lex.europa.eu', 'curia.europa.eu',
];
const OFFICIAL_STATISTICS = [
  'ine.es', 'interior.gob.es', 'estadisticasdecriminalidad.ses.mir.es', 'catastro.meh.es',
  'sedecatastro.gob.es', 'epdata.es', 'ec.europa.eu', 'eurostat.ec.europa.eu', 'datosabiertos.gva.es',
];
const OFFICIAL_REGIONAL = ['gva.es', 'dogv.gva.es', 'habitatge.gva.es', 'argos.gva.es'];
const PROFESSIONAL_BODY = ['registradores.org', 'notariado.org', 'colegionotarial', 'notariosyregistradores.com'];
// Not blogs. These reproduce the consolidated statute and the case law verbatim, which is exactly
// what a legal proposition needs to be checked against when the BOE page itself will not open.
const LEGAL_REFERENCE = ['noticias.juridicas.com', 'iberley.es', 'vlex.es', 'vlex.com',
  'legislacion.derecho.com', 'poderjudicial.es', 'westlaw.es'];
const PRESS = [
  'elpais.com', 'elmundo.es', 'abc.es', 'lavanguardia.com', 'eldiario.es', 'infobae.com', 'efe.com',
  'europapress.es', 'expansion.com', 'cincodias.elpais.com', 'levante-emv.com', 'informacion.es',
  'lasprovincias.es', 'theobjective.com', 'elconfidencial.com', 'idealista.com/news', 'rtve.es',
  'telegraph.co.uk', 'theguardian.com', 'ft.com', 'reuters.com', 'bbc.co.uk', 'hispanidad.com',
];
const INDUSTRY = [
  'idealista.com', 'fotocasa.es', 'tinsa.es', 'pisos.com', 'habitaclia.com', 'kyero.com',
  'engelvoelkers.com', 'knightfrank', 'savills', 'cbre', 'rome2rio.com', 'numbeo.com',
];

/** The registrable domain of a URL, lowercased, without www. Empty string when unparseable. */
export function domainOf(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.startsWith('www.') ? h.slice(4) : h;
  } catch { return ''; }
}

/**
 * What kind of page this is. Matched on the domain, and on the full URL for the handful of hosts
 * whose news section is press while the rest of the site is a commercial portal.
 */
export function classifySource(url: string): SourceClass {
  const d = domainOf(url);
  if (!d) return 'unknown';
  const u = url.toLowerCase();
  const hit = (list: string[]) => list.some((x) => (x.includes('/') ? u.includes(x) : d === x || d.endsWith(`.${x}`)));
  if (hit(OFFICIAL_PRIMARY)) return 'official_primary';
  if (hit(OFFICIAL_STATISTICS)) return 'official_statistics';
  if (hit(OFFICIAL_REGIONAL)) return 'official_regional';
  if (hit(PROFESSIONAL_BODY)) return 'professional_body';
  if (hit(LEGAL_REFERENCE)) return 'legal_reference';
  // an ayuntamiento: ajuntament/ayuntamiento hosts, and the .gob.es / .gov space generally
  if (/^(?:ajuntament|ayuntamiento|aytos?)\./.test(d) || /\.(?:gob|gov)\.[a-z]{2}$/.test(d)
      || d.endsWith('.gob.es') || d.endsWith('.gov')) return 'official_regional';
  if (hit(PRESS)) return 'press';
  if (hit(INDUSTRY)) return 'industry';
  if (/(?:blog|wordpress|medium|substack)\./.test(d) || d.includes('blog.')) return 'blog';
  return 'unknown';
}

/* ── EXCERPT VERIFICATION ────────────────────────────────────────────────────────────────── */

/**
 * Comparison form: accents folded, punctuation and case dropped, whitespace collapsed. A fetched
 * page and a model's transcription of one line off it differ in exactly those ways and in nothing
 * that matters.
 */
export function normalizeForMatch(s: string): string {
  return (s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'").replace(/[“”„"]/g, ' ')
    .replace(/[‐-―−]/g, '-')
    .replace(/[^a-z0-9%€$.,;:'()\-\/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FILLER = new Set(`a an and are as at be by de del el en for from in is it la las los of on or
que se the to y una un with was were has have not no do does than that this these those`.split(/\s+/));

function significantTokens(s: string): string[] {
  return normalizeForMatch(s).split(' ').filter((w) => w.length > 2 && !FILLER.has(w));
}

/**
 * Does this excerpt actually occur in that text?
 *
 * Exact (normalized) containment first. Failing that, an ordered-token match: every significant
 * token of the excerpt appears in the text, in order, inside a window proportional to the excerpt.
 * That tolerates a dropped article or a re-wrapped line without tolerating a paraphrase, because
 * order and every content word must still hold.
 */
export function excerptOccursIn(excerpt: string, text: string): boolean {
  const e = normalizeForMatch(excerpt);
  const t = normalizeForMatch(text);
  if (e.length < 12 || !t) return false;
  if (t.includes(e)) return true;
  const want = significantTokens(excerpt);
  if (want.length < 3) return false;
  const words = t.split(' ');
  const window = Math.max(want.length * 4, 40);
  for (let start = 0; start < words.length; start++) {
    let wi = 0;
    for (let i = start; i < Math.min(words.length, start + window) && wi < want.length; i++) {
      if (words[i] === want[wi] || words[i].startsWith(want[wi])) wi++;
    }
    if (wi === want.length) return true;
  }
  return false;
}

/** The cited sources an excerpt is genuinely found in. Only opened pages can carry evidence. */
export function sourcesBacking(
  excerpt: string, sourceIds: readonly string[], sources: readonly ResearchSource[],
): string[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  return sourceIds.filter((id) => {
    const s = byId.get(id);
    return !!s && s.opened && !!s.content && excerptOccursIn(excerpt, s.content);
  });
}

/* ── SOURCE POLICY ───────────────────────────────────────────────────────────────────────── */

export type RiskClass = 'legal_tax' | 'market_statistics' | 'local_fact' | 'none';

/*
 * A trailing \b after \d can never match "Modelo 210" — the boundary falls between the 2 and the 1.
 * The first version of this file made that mistake and classified every claim as risk-free, which
 * is the same dead-checker shape that let fifteen defects through. Boundaries now sit only where a
 * word actually ends, and the claim type the extractor already assigned decides the floor.
 */
const LEGAL_TAX = [
  /\b(?:law|legal|legally|statute|decree|obligation|obliged|liable|liability|prescription|binding|perfected|enforceable)\b/i,
  /\b(?:c[oó]digo civil|civil code|BOE|real decreto|royal decree|LAU|LEC|LECrim|c[oó]digo penal|penal code)\b/i,
  /\bart(?:icle|ículo|\.)?\s?\d+/i,
  /\bmodelo\s?\d+/i,
  /\b(?:tax|taxes|taxed|taxation|withhold|withholding|withheld|retenci[oó]n|IRPF|IRNR|IVA|ITP|plusval[ií]a|capital gains|refund|rebate|deduct\w*)\b/i,
  /\b(?:deadline|filing period|within (?:one|two|three|four|six|\d+) (?:month|months|years?|days?)|fine|fined|penalty|penalties|sanction|surcharge)\b/i,
  /\b(?:licence|license|permit|c[eé]dula|habitation certificate|planning|inheritance|notary|notario|escritura|arras|deposit contract|eviction|desahucio|okupa\w*|usurpaci[oó]n|allanamiento|morada|squatt\w*)\b/i,
  /\b(?:residency|resident status|non-resident|visa|NIE|padr[oó]n|empadron\w*)\b/i,
];
const MARKET_STATS = [
  /\d\s?%|\bper cent\b|\bpercent\b/i,
  /\b(?:price|prices|priced|index|indices|transactions?|sales volume|volume|turnover|average|median|growth|grew|fell|rose|climbed|declined|dropped)\b/i,
  /\b(?:euribor|mortgage rate|interest rate|loan-to-value|yield|affordability)\b/i,
  /\b(?:largest|biggest|leading|leads?|lead the|top|ranked?|ranking|ahead of|overtaken|overtook|outnumber\w*|majority|share of)\b/i,
  /\b(?:british|dutch|german|belgian|polish|french|scandinavian|foreign)\s+(?:buyers?|owners?|purchasers?)\b/i,
  /\b(?:statistics?|figures?|data|dataset|survey|census|registered|recorded)\b/i,
];
const LOCAL_FACT = [
  /\b(?:population|residents?|inhabitants?|padr[oó]n|census)\b/i,
  /\b\d+\s?(?:km|kilometres?|kilometers?|m[íi]nutes?|minutes?|mins?)\b/i,
  /\b(?:distance|drive time|drive|walkable|walking distance|commute)\b/i,
  /\b(?:schools?|hospital|health centre|beach|port|marina|market|town hall|ayuntamiento|municipio|n[uú]cleo|municipality)\b/i,
  /\b(?:seasonal|peak season|year-round|winter|summer)\b.*\b(?:population|residents?|swell|multipl\w*)\b/i,
];

const hitsAny = (rs: RegExp[], t: string) => rs.some((r) => r.test(t));

/**
 * What kind of evidence this proposition needs.
 *
 * The claim type sets the floor — the extractor has already decided this sentence is a legal
 * consequence or a quantity, and no wording test should be able to talk that down. The patterns
 * then raise it for a sentence whose type was milder than its content.
 */
export function riskOf(text: string, claimType?: string): RiskClass {
  const t = text ?? '';
  if (claimType === 'LEGAL_CONSEQUENCE' || hitsAny(LEGAL_TAX, t)) return 'legal_tax';
  if (claimType === 'QUANTIFIED_CLAIM' || claimType === 'TIME_SENSITIVE_FACT'
      || hitsAny(MARKET_STATS, t)) return 'market_statistics';
  if (claimType === 'LOCAL_FACT' || hitsAny(LOCAL_FACT, t)) return 'local_fact';
  if (claimType === 'FACTUAL_MATERIAL' || claimType === 'CAUSAL_INFERENCE') return 'market_statistics';
  return 'none';
}

/** The source classes that may carry a proposition of each risk class. */
export const SOURCE_POLICY: Readonly<Record<RiskClass, readonly SourceClass[]>> = {
  legal_tax: ['official_primary', 'official_regional', 'official_statistics', 'legal_reference',
    'professional_body'],
  market_statistics: ['official_statistics', 'professional_body', 'official_primary', 'official_regional'],
  // deliberately NOT press: a newspaper reporting a figure is where you find it, not where it is
  local_fact: ['official_statistics', 'official_regional', 'official_primary', 'professional_body', 'press'],
  none: ['official_primary', 'official_statistics', 'official_regional', 'professional_body',
    'legal_reference', 'press', 'industry', 'blog', 'unknown'],
};

/**
 * May these sources carry this proposition? A blog can be where you find out an issue exists; it is
 * not where a reader's tax deadline comes from.
 */
export function policyAllows(risk: RiskClass, cited: readonly ResearchSource[]): boolean {
  if (risk === 'none') return true;
  const allowed = SOURCE_POLICY[risk];
  return cited.some((s) => s.opened && allowed.includes(s.sourceClass));
}

/** Whether the research opened anything at all that could carry this topic's riskiest claims. */
export function policyUnmetFor(risk: RiskClass, sources: readonly ResearchSource[]): boolean {
  if (risk === 'none') return false;
  return !policyAllows(risk, sources);
}

/* ── CLAIM SUPPORT ───────────────────────────────────────────────────────────────────────── */

export type SupportType = 'research_evidence' | 'agency_profile' | 'bank_fact' | 'none';

/**
 * What one published material claim rests on. The model proposes the record; the verdict below is
 * decided here, offline, against the pages that were actually fetched. A model saying SUPPORTED is
 * not a support record.
 */
export interface ClaimSupport {
  claimId: string;
  field: string;
  claim: string;
  claimType: string;
  supportType: SupportType;
  sourceIds: string[];
  evidenceExcerpt: string;
  bankFactIds: string[];
  requirementIds: string[];
  verdict: 'supported' | 'unsupported';
  /** why it landed there — the deterministic reason, not the model's narration */
  reason: string;
  risk: RiskClass;
}

export interface SupportContext {
  sources: readonly ResearchSource[];
  agencyEvidence: string;
  /** bank fact or guardrail id → its exact text, for a claim that rests on the verified bank */
  bankText: ReadonlyMap<string, string>;
  /** requirement ids this generation's research did NOT establish */
  unestablished: ReadonlySet<string>;
}

export interface ProposedSupport {
  claimId: string; field: string; claim: string; claimType: string;
  supportType: SupportType; sourceIds?: string[]; evidenceExcerpt?: string;
  bankFactIds?: string[]; requirementIds?: string[];
}

/**
 * Decide, offline, whether a proposed support record actually supports its claim.
 *
 * FAILS CLOSED at every branch. An unknown source id, a source that was never opened, an excerpt
 * that is not on the page, a class of page that may not carry this kind of proposition, or any
 * dependency on a requirement the research did not establish — each of those is unsupported, and
 * unsupported copy does not publish.
 */
export function verifySupport(p: ProposedSupport, ctx: SupportContext): ClaimSupport {
  const sourceIds = (p.sourceIds ?? []).map((s) => String(s).trim()).filter(Boolean);
  const requirementIds = (p.requirementIds ?? []).map((s) => String(s).trim()).filter(Boolean);
  const bankFactIds = (p.bankFactIds ?? []).map((s) => String(s).trim()).filter(Boolean);
  const excerpt = (p.evidenceExcerpt ?? '').trim();
  const risk = riskOf(p.claim, p.claimType);
  const out = (verdict: 'supported' | 'unsupported', reason: string): ClaimSupport => ({
    claimId: p.claimId, field: p.field, claim: p.claim, claimType: p.claimType,
    supportType: p.supportType, sourceIds, evidenceExcerpt: excerpt, bankFactIds,
    requirementIds, verdict, reason, risk,
  });

  // 1. A requirement the research did not establish cannot become the ground of a published claim,
  //    however well the sentence reads. This is the rule B and H3 both broke.
  const blocked = requirementIds.filter((r) => ctx.unestablished.has(r));
  if (blocked.length) return out('unsupported', `rests on unestablished requirement ${blocked.join(', ')}`);

  switch (p.supportType) {
    case 'research_evidence': {
      if (!excerpt) return out('unsupported', 'no evidence excerpt offered');
      const known = sourceIds.filter((id) => ctx.sources.some((s) => s.id === id));
      const unknown = sourceIds.filter((id) => !known.includes(id));
      if (unknown.length) return out('unsupported', `cites source ids that do not exist: ${unknown.join(', ')}`);
      if (!known.length) return out('unsupported', 'no source cited');
      const backing = sourcesBacking(excerpt, known, ctx.sources);
      if (!backing.length) {
        const openedCited = known.filter((id) => ctx.sources.find((s) => s.id === id)?.opened);
        return out('unsupported', openedCited.length
          ? 'the excerpt does not occur on any cited page'
          : 'the cited pages were listed by a search but never opened');
      }
      const backers = ctx.sources.filter((s) => backing.includes(s.id));
      if (!policyAllows(risk, backers)) {
        return out('unsupported', `a ${risk.replace('_', '/')} claim may not rest on `
          + `${[...new Set(backers.map((b) => b.sourceClass))].join(', ')} alone`);
      }
      for (const b of backers) if (!b.excerpts.includes(excerpt)) b.excerpts.push(excerpt);
      return out('supported', `verbatim on ${backing.join(', ')}`);
    }
    case 'agency_profile': {
      if (!excerpt) return out('unsupported', 'no evidence excerpt offered');
      return excerptOccursIn(excerpt, ctx.agencyEvidence)
        ? out('supported', 'stated in the agency profile')
        : out('unsupported', 'not in what the agency has told us');
    }
    case 'bank_fact': {
      if (!excerpt) return out('unsupported', 'no evidence excerpt offered');
      const found = bankFactIds.filter((id) => {
        const t = ctx.bankText.get(id);
        return !!t && excerptOccursIn(excerpt, t);
      });
      return found.length
        ? out('supported', `verified bank fact ${found.join(', ')}`)
        : out('unsupported', 'not found in the verified bank text it names');
    }
    default:
      return out('unsupported', 'no support offered');
  }
}


/* ── PASSAGE RETRIEVAL ───────────────────────────────────────────────────────────────────── */

/** A stretch of a fetched page, offered to the support pass as something it may quote. */
export interface Passage { sourceId: string; text: string; score: number }

/** Sentence-ish windows of a page, long enough to be evidence and short enough to quote. */
function windows(text: string): string[] {
  const out: string[] = [];
  for (const para of text.split(/(?<=[.!?])\s+/)) {
    const t = para.trim();
    if (t.length < 40) continue;
    out.push(t.length > 400 ? t.slice(0, 400) : t);
  }
  return out;
}

/**
 * The passages on the opened pages that actually bear on a claim.
 *
 * Without this the support pass is asked to quote pages it has never seen: it only ever received
 * the briefing, so its "verbatim excerpt" was a memory of a paraphrase, and verification against
 * the real page failed on nineteen claims out of twenty in a smoke test. The pages are in hand —
 * the right move is to hand the model the candidate passages and let it pick, so that a failure to
 * verify means the evidence is genuinely absent rather than that nobody looked it up.
 */
export function findPassages(
  claim: string, sources: readonly ResearchSource[], brief = '', perClaim = 5,
  risk: RiskClass = 'none',
): Passage[] {
  const opened = sources.filter((s) => s.opened && s.content);
  if (!opened.length) return [];

  // THE BRIEFING IS THE BRIDGE. The pages are in Spanish and the post is in English, so scoring a
  // claim directly against page text shares almost no tokens and retrieves nothing — which is why
  // an earlier version handed the model no passages and got "no support offered" on nine claims out
  // of eleven. The briefing is English, and each of its lines is tagged with the page it came off.
  // Match claim → briefing line (same language), then look inside the pages that line names.
  const claimTokens = new Set(significantTokens(claim));
  const numbers = new Set(normalizeForMatch(claim).match(/\b\d[\d.,]*\b/g) ?? []);
  const lines = brief.split('\n').map((l) => l.trim()).filter((l) => l.length > 30);
  const scoredLines = lines.map((line) => {
    const t = significantTokens(line);
    let hit = 0;
    const seen = new Set<string>();
    for (const w of t) if (claimTokens.has(w) && !seen.has(w)) { hit++; seen.add(w); }
    const ids = Array.from(line.matchAll(/\[\s*(S\d+)\s*\]/g), (m) => m[1]);
    return { line, ids, score: hit };
  }).filter((x) => x.score >= 2).sort((a, b) => b.score - a.score).slice(0, 3);

  const named = new Set(scoredLines.flatMap((x) => x.ids));
  // Prefer the pages the briefing pointed at; fall back to every opened page when it pointed at none.
  const pool = named.size ? opened.filter((s) => named.has(s.id)) : opened;
  // Score page passages against the briefing lines (which quote them) rather than against the
  // English claim, plus any figure the claim uses, which survives translation intact.
  const target = new Set([...scoredLines.flatMap((x) => significantTokens(x.line)), ...claimTokens]);

  const out: Passage[] = [];
  for (const s of pool) {
    for (const w of windows(s.content ?? '')) {
      const toks = significantTokens(w);
      if (!toks.length) continue;
      let hit = 0;
      const seen = new Set<string>();
      for (const t of toks) if (target.has(t) && !seen.has(t)) { hit++; seen.add(t); }
      const wn = normalizeForMatch(w);
      let numHit = 0;
      for (const n of numbers) if (wn.includes(n)) numHit++;
      if (hit < 2 && !numHit) continue;
      // Offer evidence the claim is ALLOWED to rest on. A perfectly quoted passage off a law
      // firm's blog cannot carry a tax rule, so putting it in front of the model wastes the slot
      // and produces a support record that was always going to fail policy.
      const allowed = SOURCE_POLICY[risk].includes(s.sourceClass) ? 2.5 : 1;
      out.push({ sourceId: s.id, text: w, score: allowed * (hit + numHit * 3) / Math.sqrt(toks.length) });
    }
  }
  out.sort((a, b) => b.score - a.score);
  // Spread across sources: five passages off one page is a worse offer than one off five.
  const perSource = new Map<string, number>();
  const spread: Passage[] = [];
  for (const p of out) {
    const n = perSource.get(p.sourceId) ?? 0;
    if (n >= 2) continue;
    perSource.set(p.sourceId, n + 1);
    spread.push(p);
    if (spread.length >= perClaim) break;
  }
  return spread;
}
