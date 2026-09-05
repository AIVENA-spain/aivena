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

import { claimTouchesRequirement, placesIn as placesInText,
  placesOrRegionsIn } from './studio-copy-gate';

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

/**
 * The source ids of a briefing line that contains this excerpt verbatim.
 *
 * Empty when no line does, or when the line names no source. This is the one place the briefing is
 * allowed to stand in for the page, and only for an excerpt that is on the line word for word.
 */
export function briefingLineFor(
  excerpt: string, cited: readonly string[], brief: string,
): string[] | null {
  if (!brief) return null;
  for (const line of brief.split('\n')) {
    if (line.trim().length < 30) continue;
    if (!excerptOccursIn(excerpt, line)) continue;
    const ids = Array.from(line.matchAll(/\[\s*(S\d+)\s*\]/g), (m) => m[1])
      .filter((id) => cited.includes(id));
    if (ids.length) return ids;
  }
  return null;
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
  /\b(?:law|legal|legally|statute|decree|obligation|obliged|liable|liability|prescription|binding|perfected|enforceable|unenforceable)\b/i,
  /\b(?:contract|contractual|clause|wording|signed|signature|agreement|arras|reservation (?:form|contract|fee|sum)|deposit|penalty|forfeit\w*|withdraw\w*|walk away|rescind\w*|breach|remedy|remedies|court|courts|the judge|ruling|case law)\b/i,
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
/* ────────────────────────────────────────────────────────────────────────────────────────────
 * HOW HARD TO VERIFY: three tiers, not one bar.
 *
 * Christian, 2026-09-05: "If being wrong could cost the reader money, change their legal decision,
 * misrepresent the agency, or make the agency publicly look incompetent → verify hard. If it is
 * ordinary rhetoric, interpretation, aspiration or harmless marketing exaggeration → give the
 * writer room." A single courtroom standard applied to every sentence cost a smoke-test deck three
 * of its five slides, and the deleted slides were not wrong — they were unquotable.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

const DEICTIC_SPECIFIC = /\b(?:this (?:town|area|neighbourhood|neighborhood|village|coast|portal|platform|site|street|urbanisation|urbanization|development)|round here|here in|the (?:local|nearby) \w+)\b/i;
const MARKET_NATIONALITY = /\b(?:british|dutch|german|belgian|polish|french|scandinavian|norwegian|swedish|danish|irish|russian|foreign)\s+(?:buyers?|owners?|purchasers?|clients?|families|money)\b/i;
const PERIOD_MARKER = /\b(?:winter|summer|spring|autumn|off[- ]season|high season|peak season|right now|currently|at the moment|this year|last year|these days|since \d{4}|in \d{4}|nowadays)\b/i;
const NAMED_PLATFORM = /\b(?:Idealista|Fotocasa|Kyero|Rightmove|Zillow|Habitaclia|Pisos\.com|Google|Instagram|Facebook|TikTok|portal algorithms?)\b/i;

/** Is this a specific claim about a real place, market or platform rather than a general tendency? */
export function isSpecificLocalOrCurrent(text: string): boolean {
  const t = text ?? '';
  if (placesInText(t).size) return true;
  return DEICTIC_SPECIFIC.test(t) || MARKET_NATIONALITY.test(t)
    || PERIOD_MARKER.test(t) || NAMED_PLATFORM.test(t);
}


export type RiskTier = 'high' | 'medium' | 'low';

/** Anything with a figure, a date, a deadline or a threshold in it is a number the reader may act on. */
const HAS_FIGURE = /(?:\d[\d.,]*\s?%|\b\d[\d.,]*\s?(?:€|eur|euros?|k|m|million|thousand)\b|€\s?\d|\b\d[\d.,]{2,}\b|\b(?:one|two|three|four|five|six|nine|ten|twelve|fifteen|twenty|thirty|sixty|ninety)\s+(?:days?|weeks?|months?|years?|per ?cent|percent)\b|\b\d+\s*(?:days?|weeks?|months?|years?|km|m2|m²|bed|bath)\b|\b(?:19|20)\d{2}\b)/i;
/** A ranking or a superlative about a group — "the British still lead the province". */
const RANKING = /\b(?:largest|biggest|leading|leads?\b|lead the|top(?:s)?\b|ranked?|ranking|first place|ahead of|overtaken|overtook|outnumber\w*|majority|most (?:buyers|owners|sales|popular)|fastest|highest|lowest|cheapest)\b/i;
/** Money the reader will or will not have. */
const FINANCIAL_OUTCOME = /\b(?:you (?:will |'ll )?(?:pay|owe|save|lose|get back|receive|keep)|costs? you|refund|reclaim|withhold\w*|deposit|fee|commission|tax bill|surcharge|penalty|fine)\b/i;

/**
 * How hard this claim has to be verified before it may publish.
 *
 * The claim type sets a floor and the content can raise it, never lower it. A LOCAL_FACT with a
 * population figure in it is a numerical claim; a LOCAL_FACT about what a town feels like in winter
 * is not, and demanding a citation for the second is how a content engine becomes a filing cabinet.
 */
export function riskTier(text: string, claimType?: string): RiskTier {
  const t = text ?? '';
  // Rhetoric, opinion, hooks and hypotheticals are never evidence-policed.
  if (claimType && ['MARKETING_PUFFERY', 'OPINION_POSITIONING', 'CREATIVE_HOOK', 'HYPOTHETICAL']
    .includes(claimType)) return 'low';
  // Law, tax, deadlines, money, the agency's own record, and anything with a number or a ranking.
  if (claimType === 'LEGAL_CONSEQUENCE' || claimType === 'QUANTIFIED_CLAIM'
      || claimType === 'TIME_SENSITIVE_FACT' || claimType === 'AGENCY_FACT') return 'high';
  if (LEGAL_TAX.some((r) => r.test(t))) return 'high';
  if (HAS_FIGURE.test(t) || FINANCIAL_OUTCOME.test(t)) return 'high';
  // A RANKING is high risk when someone actually holds the rank. "A nationality can spend more per
  // purchase without being the biggest group of buyers" names nobody and asserts no position — it
  // is a statement about two metrics not being interchangeable, which is the SAFE version of the
  // claim, and the strict run refused it.
  if (RANKING.test(t) && isSpecificLocalOrCurrent(t)) return 'high';
  // Everything else a reader could check but could not be financially hurt by: how a town feels,
  // how buyers behave, how a mechanism generally works, an unquantified comparison.
  if (claimType && ['FACTUAL_MATERIAL', 'LOCAL_FACT', 'CAUSAL_INFERENCE'].includes(claimType)) return 'medium';
  return 'medium';
}

/** What kind of evidence this proposition needs. Decided from what it claims. */
export function riskOf(text: string, claimType?: string): RiskClass {
  const t = text ?? '';
  if (claimType === 'LEGAL_CONSEQUENCE' || hitsAny(LEGAL_TAX, t)) return 'legal_tax';
  if (claimType === 'QUANTIFIED_CLAIM' || claimType === 'TIME_SENSITIVE_FACT'
      || hitsAny(MARKET_STATS, t)) return 'market_statistics';
  if (claimType === 'LOCAL_FACT' || hitsAny(LOCAL_FACT, t)) return 'local_fact';
  if (claimType === 'FACTUAL_MATERIAL' || claimType === 'CAUSAL_INFERENCE') return 'market_statistics';
  return 'none';
}

/**
 * Which classes of page may carry a proposition, by how much being wrong would cost.
 *
 * Christian, 2026-09-05: "Do not require INE/BOE to prove that a town has a lively marina or that
 * one area feels more urban than another." A tax deadline and a description of a seafront are not
 * the same kind of assertion and must not face the same bar.
 */
export const SOURCE_POLICY: Readonly<Record<RiskClass, readonly SourceClass[]>> = {
  // HIGH-RISK legal and tax: the official text, the tax authority, the courts, or a database that
  // reproduces the statute. A law firm's summary is where you find the article, not the article.
  legal_tax: ['official_primary', 'official_regional', 'official_statistics', 'legal_reference',
    'professional_body'],
  // HIGH-RISK numbers: the producer of the figure. Deliberately not press — a paper reporting a
  // statistic is a report about it.
  market_statistics: ['official_statistics', 'professional_body', 'official_primary', 'official_regional'],
  // MEDIUM-RISK local and qualitative: the town hall, the tourism authority, a serious portal, a
  // respected local or industry source. This is where a description of a place legitimately lives.
  local_fact: ['official_statistics', 'official_regional', 'official_primary', 'professional_body',
    'legal_reference', 'press', 'industry'],
  none: ['official_primary', 'official_statistics', 'official_regional', 'professional_body',
    'legal_reference', 'press', 'industry', 'blog', 'unknown'],
};

/**
 * May these sources carry this proposition? A blog can be where you find out an issue exists; it is
 * not where a reader's tax deadline comes from.
 */
export function policyAllows(
  risk: RiskClass, cited: readonly ResearchSource[], tier: RiskTier = 'high',
): boolean {
  if (risk === 'none' || tier === 'low') return true;
  // A medium-risk claim may rest on any reliable published source. Only high-risk claims are held
  // to the producer of the fact.
  if (tier === 'medium') return cited.some((s) => s.opened);
  const allowed = SOURCE_POLICY[risk];
  return cited.some((s) => s.opened && allowed.includes(s.sourceClass));
}

/** Whether the research opened anything at all that could carry this topic's riskiest claims. */
export function policyUnmetFor(risk: RiskClass, sources: readonly ResearchSource[]): boolean {
  if (risk === 'none') return false;
  return !policyAllows(risk, sources);
}

/* ── SOURCE FACTS ────────────────────────────────────────────────────────────────────────── */

/**
 * One fact, read off one page, with the span it was read from.
 *
 * The layer that was missing. Requiring a finished English marketing sentence to appear on a
 * Spanish statute page is a category error: Aivena is a writer and must paraphrase, and the sources
 * are in a different language from most of the posts. So the verbatim anchor moves one link back —
 * the FACT is anchored to the page word for word, and the claim is then judged against the fact.
 *
 *   opened page → source fact (excerpt verified on the page) → writer → claim (entailed by the fact)
 */
export interface SourceFact {
  id: string;
  sourceId: string;
  /** the span on the page, in the page's own language, verified to occur there */
  excerpt: string;
  language: string;
  /** what it means, in English, as a single checkable statement */
  canonical: string;
  sourceClass: SourceClass;
  /** what the fact is about geographically — a national figure is not a province figure */
  geography: string;
  /** the period it belongs to, where that matters */
  period: string;
  /** what KIND of number or rule it is — a share is not a count, a capacity is not a population */
  metric: string;
}

/** Digits as they appear in either convention, so 3.708 and 3,708 compare equal. */
export function figuresIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of (text ?? '').matchAll(/\d[\d.,]*/g)) {
    const raw = m[0].replace(/[.,]$/, '');
    const digits = raw.replace(/[.,]/g, '');
    if (digits.length >= 2) out.add(digits);
  }
  return [...out];
}

/**
 * Does the evidence carry the figures the claim states?
 *
 * A high-risk claim that puts a number in front of a reader has to have got that number from
 * somewhere. Deterministic, language-independent, and it is what a paraphrase cannot launder.
 */
export function figuresBacked(claim: string, evidence: string): boolean {
  const want = figuresIn(claim);
  if (!want.length) return true;
  const have = new Set(figuresIn(evidence));
  return want.every((n) => have.has(n));
}

/* ── CLAIM SUPPORT ───────────────────────────────────────────────────────────────────────── */

export type SupportType =
  | 'page_direct'        // the claim quotes an opened page word for word
  | 'source_fact'        // the claim follows from a fact read off an opened page
  | 'agency_profile'     // a fact the agency supplied about itself
  | 'agency_knowledge'   // something the agency told us about its market or its clients
  | 'local_intelligence' // stored local knowledge for this area
  | 'general_mechanism'  // ordinary marketing reasoning: a tendency, not a measurement
  | 'bank_fact'
  | 'none';

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
  factIds: string[];
  bankFactIds: string[];
  requirementIds: string[];
  /** how hard this particular claim had to be verified */
  tier: RiskTier;
  verdict: 'supported' | 'unsupported';
  /** why it landed there — the deterministic reason, not the model's narration */
  reason: string;
  risk: RiskClass;
  /**
   * TRUE when the excerpt was found on a briefing line tagged to an opened page rather than on the
   * page itself. The chain still ends at a real source, but one link in it is the research model's
   * transcription, so these are counted apart and never silently mixed with page-verified claims.
   */
  viaBriefing?: boolean;
}

export interface SupportContext {
  sources: readonly ResearchSource[];
  /** what the agency has told us about its market and its clients, beyond the bare profile */
  agencyKnowledge?: string;
  /** stored local knowledge for this area, where the product has any */
  localIntelligence?: string;
  /** the facts read off those pages, each anchored to a verified span */
  facts?: readonly SourceFact[];
  /** the tagged briefing, so a quote from a line that names an opened page can be traced */
  brief?: string;
  agencyEvidence: string;
  /** bank fact or guardrail id → its exact text, for a claim that rests on the verified bank */
  bankText: ReadonlyMap<string, string>;
  /** requirement id → text, for the ones this generation's research did NOT establish */
  unestablished: ReadonlyMap<string, string>;
}

export interface ProposedSupport {
  claimId: string; field: string; claim: string; claimType: string;
  supportType: SupportType; sourceIds?: string[]; evidenceExcerpt?: string;
  /** the source facts this claim follows from */
  factIds?: string[];
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
  const factIds = (p.factIds ?? []).map((s) => String(s).trim()).filter(Boolean);
  const excerpt = (p.evidenceExcerpt ?? '').trim();
  const risk = riskOf(p.claim, p.claimType);
  const tier = riskTier(p.claim, p.claimType);
  const out = (verdict: 'supported' | 'unsupported', reason: string, via = false): ClaimSupport => ({
    claimId: p.claimId, field: p.field, claim: p.claim, claimType: p.claimType,
    supportType: p.supportType, sourceIds, evidenceExcerpt: excerpt, factIds, bankFactIds,
    requirementIds, verdict, reason, risk, tier, viaBriefing: via || undefined,
  });

  // LOW RISK IS NOT POLICED. Opinion, puffery, a hook, a hypothetical — the post earns its living
  // here and demanding a citation for it is how a content engine turns into a filing cabinet.
  if (tier === 'low') return out('supported', 'opinion, rhetoric or framing — not evidence-policed');

  // A requirement the research did not establish cannot become the ground of a HIGH-RISK claim.
  // At medium risk it is a reason to keep the sentence general, not to refuse it outright.
  // TWO SIGNALS, not one. The support model names requirement ids liberally — it tagged an eyebrow
  // reading "Costa Blanca buyers, 2026" as depending on a price-series requirement — and a true
  // sentence should not be deleted because a model was generous with a label. The claim must ALSO
  // use the requirement's own distinctive content.
  const blocked = requirementIds.filter((r) => {
    const text = ctx.unestablished.get(r);
    return !!text && claimTouchesRequirement(p.claim, text);
  });
  if (blocked.length && tier === 'high') {
    return out('unsupported', `rests on unestablished requirement ${blocked.join(', ')}`);
  }

  const facts = ctx.facts ?? [];
  const byFact = new Map(facts.map((f) => [f.id, f]));
  const sourceOf = new Map(ctx.sources.map((s) => [s.id, s]));

  switch (p.supportType) {
    case 'source_fact': {
      const linked = factIds.map((id) => byFact.get(id)).filter((f): f is SourceFact => !!f);
      if (!linked.length) {
        return out('unsupported', factIds.length
          ? `cites source facts that do not exist: ${factIds.join(', ')}`
          : 'no source fact cited');
      }
      const pages = linked.map((f) => sourceOf.get(f.sourceId)).filter((s): s is ResearchSource => !!s);
      if (!policyAllows(risk, pages, tier)) {
        return out('unsupported', `a ${tier}-risk ${risk.replace('_', '/')} claim may not rest on `
          + `${[...new Set(pages.map((b) => b.sourceClass))].join(', ')} alone`);
      }
      // The one thing a paraphrase must not do: introduce a number the evidence never had.
      if (tier === 'high' && !figuresBacked(p.claim, linked.map((f) => `${f.excerpt} ${f.canonical}`).join(' '))) {
        return out('unsupported', 'states a figure that is not in the evidence it cites');
      }
      for (const f of linked) {
        const src = sourceOf.get(f.sourceId);
        if (src && !src.excerpts.includes(f.excerpt)) src.excerpts.push(f.excerpt);
      }
      return out('supported', `follows from ${linked.map((f) => f.id).join(', ')} `
        + `(${linked.map((f) => f.sourceId).join(', ')})`);
    }
    case 'page_direct': {
      if (!excerpt) return out('unsupported', 'no evidence excerpt offered');
      const known = sourceIds.filter((id) => sourceOf.has(id));
      const unknown = sourceIds.filter((id) => !known.includes(id));
      if (unknown.length) return out('unsupported', `cites source ids that do not exist: ${unknown.join(', ')}`);
      if (!known.length) return out('unsupported', 'no source cited');
      const backing = sourcesBacking(excerpt, known, ctx.sources);
      if (!backing.length) {
        const viaLine = briefingLineFor(excerpt, known, ctx.brief ?? '');
        if (viaLine) {
          const opened = ctx.sources.filter((s) => viaLine.includes(s.id) && s.opened);
          if (opened.length && policyAllows(risk, opened, tier)) {
            return out('supported', `on a briefing line tagged to ${viaLine.join(', ')}`, true);
          }
        }
        const openedCited = known.filter((id) => sourceOf.get(id)?.opened);
        return out('unsupported', openedCited.length
          ? 'the excerpt does not occur on any cited page'
          : 'the cited pages were listed by a search but never opened');
      }
      const backers = ctx.sources.filter((s) => backing.includes(s.id));
      if (!policyAllows(risk, backers, tier)) {
        return out('unsupported', `a ${tier}-risk ${risk.replace('_', '/')} claim may not rest on `
          + `${[...new Set(backers.map((b) => b.sourceClass))].join(', ')} alone`);
      }
      if (tier === 'high' && !figuresBacked(p.claim, excerpt)) {
        return out('unsupported', 'states a figure that is not in the excerpt it cites');
      }
      for (const b of backers) if (!b.excerpts.includes(excerpt)) b.excerpts.push(excerpt);
      return out('supported', `verbatim on ${backing.join(', ')}`);
    }
    case 'agency_knowledge':
    case 'local_intelligence': {
      // Something the agency told us about its market or its clients, or stored local knowledge.
      // The model may not manufacture it because it sounds like the kind of thing an agent says.
      const store = p.supportType === 'agency_knowledge'
        ? `${ctx.agencyEvidence}\n${ctx.agencyKnowledge ?? ''}` : (ctx.localIntelligence ?? '');
      if (!store.trim()) {
        return out('unsupported', p.supportType === 'agency_knowledge'
          ? 'the agency has not supplied knowledge of this kind'
          : 'there is no stored local intelligence for this area');
      }
      if (!excerpt) return out('unsupported', 'no evidence excerpt offered');
      if (!excerptOccursIn(excerpt, store)) {
        return out('unsupported', 'not in what the agency or the local record actually says');
      }
      const over = agencyOverreach(p.claim, store);
      if (over) return out('unsupported', over);
      return out('supported', p.supportType === 'agency_knowledge'
        ? 'from what the agency told us' : 'from stored local knowledge');
    }
    case 'general_mechanism': {
      // MEDIUM RISK ONLY. A high-risk claim is never ordinary reasoning.
      if (tier === 'high') {
        return out('unsupported', 'law, tax, money and figures are not general reasoning');
      }
      const m = mechanismAllowed(p.claim);
      return m.ok ? out('supported', m.why) : out('unsupported', m.why);
    }
    case 'agency_profile': {
      // NOT a verbatim test. The profile is a list of facts, and an agency line is a sentence made
      // out of them — "We handle sales and listings across Jávea, Moraira, Dénia and Teulada, in
      // Spanish, English, Dutch and German" is every fact in the profile and none of its words. The
      // strict run refused that line on seven posts out of twelve.
      const bad = agencyOverreach(p.claim, ctx.agencyEvidence);
      if (bad) return out('unsupported', bad);
      return out('supported', 'within what the agency has told us');
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


/* ── AGENCY CLAIMS ───────────────────────────────────────────────────────────────────────── */

/** Services an agency might claim. Each has to be in the profile or it is being invented. */
const SERVICES: Readonly<Record<string, RegExp>> = {
  'rentals': /\b(?:rental|rentals|letting|lettings|long-term let|holiday let)\b/i,
  'property management': /\b(?:property management|managing your property|key ?holding)\b/i,
  'mortgages': /\b(?:mortgage|financing|lending)\b/i,
  'legal services': /\b(?:legal (?:advice|service)|conveyancing|lawyer|abogad\w+|notary service)\b/i,
  'valuations': /\b(?:valuation|appraisal|tasaci[óo]n)\b/i,
  'insurance': /\b(?:insurance|seguro)\b/i,
  'relocation': /\b(?:relocation|moving service|removals)\b/i,
  'renovation': /\b(?:renovation|refurbishment|building work|reform)\b/i,
};

/** Languages, as an agency profile writes them and as copy writes them. */
const LANGUAGE = /\b(es|en|nl|de|fr|sv|no|da|fi|pl|ru|it|pt|spanish|english|dutch|german|french|swedish|norwegian|danish|finnish|polish|russian|italian|portuguese|castellano|espa[ñn]ol|ingl[ée]s|holand[ée]s|neerland[ée]s|alem[áa]n)\b/gi;
const LANG_CANON: Readonly<Record<string, string>> = {
  es: 'es', spanish: 'es', castellano: 'es', 'español': 'es', espanol: 'es',
  en: 'en', english: 'en', 'inglés': 'en', ingles: 'en',
  nl: 'nl', dutch: 'nl', 'holandés': 'nl', holandes: 'nl', 'neerlandés': 'nl', neerlandes: 'nl',
  de: 'de', german: 'de', 'alemán': 'de', aleman: 'de',
  fr: 'fr', french: 'fr', sv: 'sv', swedish: 'sv', no: 'no', norwegian: 'no',
  da: 'da', danish: 'da', fi: 'fi', finnish: 'fi', pl: 'pl', polish: 'pl',
  ru: 'ru', russian: 'ru', it: 'it', italian: 'it', pt: 'pt', portuguese: 'pt',
};
const languagesIn = (t: string) => new Set(
  Array.from((t ?? '').matchAll(LANGUAGE), (m) => LANG_CANON[m[1].toLowerCase()] ?? '').filter(Boolean));

/** A claim about the agency's own record, which the profile never contains. */
const PAST_RECORD = /\b(?:we(?:'ve| have)\s+(?:sold|helped|closed|handled|completed)|our (?:sellers?|buyers?|clients?|track record|average|results?)|sold \d|in \d+ (?:years?|months?)|since \d{4}|award|voted|number one|no\.? ?1|fastest|most (?:successful|trusted))\b/i;
/** A superlative about itself. The profile is a list of facts; it never contains a ranking. */
const SELF_SUPERLATIVE = /\b(?:the\s+)?(?:biggest|largest|leading|top|best|most established|longest[- ]established|number one|foremost|premier|market leader)\b[^.]{0,40}\b(?:agency|agent|estate agent|team|firm|office|brokerage|on the coast|in (?:the )?(?:area|region|province))\b|\bwe are (?:the\s+)?(?:biggest|largest|leading|top|best|number one)\b/i;

/**
 * What in this agency claim goes beyond what the agency told us. Empty string when nothing does.
 *
 * Three deterministic guards instead of one verbatim test: the places named, the languages named,
 * and the services promised must each be inside the profile — and a claim about the agency's own
 * record needs evidence the profile does not contain at all.
 */
export function agencyOverreach(claim: string, profile: string): string {
  const t = claim ?? '';
  if (PAST_RECORD.test(t)) return 'claims a record or a result the agency has not given us';
  if (SELF_SUPERLATIVE.test(t)) return 'ranks the agency against others, which nothing establishes';
  const knownPlaces = placesInText(profile);
  if (knownPlaces.size) {
    const foreign = [...placesInText(t)].filter((x) => !knownPlaces.has(x));
    if (foreign.length) return `names ${foreign.join('/')}, where this agency has not said it works`;
  }
  const knownLangs = languagesIn(profile);
  if (knownLangs.size) {
    const foreign = [...languagesIn(t)].filter((x) => !knownLangs.has(x));
    if (foreign.length) return `claims ${foreign.join('/')}, which is not in the agency profile`;
  }
  for (const [name, re] of Object.entries(SERVICES)) {
    if (re.test(t) && !re.test(profile)) return `claims ${name}, which the agency has not said it offers`;
  }
  if (!figuresBacked(t, profile)) return 'states a figure the agency profile does not contain';
  return '';
}


/* ── WHAT MAY STAND WITHOUT A SOURCE ─────────────────────────────────────────────────────── */

/**
 * A claim that names a place, a time, a nationality in the market, or a specific platform is a
 * checkable fact about the outside world however qualitatively it is phrased.
 *
 * Christian, 2026-09-05: "Launching too high can make buyers hesitate" may stand on ordinary
 * reasoning. "Moraira is quieter in winter than Calpe", "Parking is harder in Dénia", "Dutch buyers
 * dominate Jávea", "This portal pushes old listings down" may not — those are local or current
 * facts wearing a qualitative coat.
 */
/** Stated as a law of nature rather than a tendency. An industry mechanism is never universal. */
const UNIVERSAL = /\b(?:always|never|every (?:buyer|seller|listing|home|time)|all (?:buyers|sellers|listings|homes)|guarantee[sd]?|guaranteed|will (?:definitely|certainly)|invariably|without exception|in every case)\b/i;

/** Modal qualification — the register a tendency belongs in. */
const QUALIFIED = /\b(?:can|may|might|often|usually|typically|tend(?:s)? to|generally|frequently|sometimes|commonly|in many cases|more likely|less likely|risks?|could)\b/i;

/**
 * May this medium-risk claim stand as ordinary marketing reasoning, with no source?
 *
 * Yes when it is a tendency about how selling works. No when it is a specific local or current
 * fact, and no when it has been written as a universal law — "overpricing always costs you the
 * first two weeks" is a measurement pretending to be a maxim.
 */
export function mechanismAllowed(text: string): { ok: boolean; why: string } {
  const t = text ?? '';
  if (isSpecificLocalOrCurrent(t)) {
    return { ok: false, why: 'this is a specific claim about a place, a market or a platform, not a general mechanism' };
  }
  if (UNIVERSAL.test(t) && !QUALIFIED.test(t)) {
    return { ok: false, why: 'stated as a universal rule rather than a tendency' };
  }
  return { ok: true, why: 'ordinary reasoning about how selling works' };
}


/* ── CALLS TO ACTION ─────────────────────────────────────────────────────────────────────── */

/** Things a CTA can promise to hand over. Each is a real deliverable someone has to produce. */
const DELIVERABLE = /\b(?:we(?:'ll| will)\s+|I(?:'ll| will)\s+)?(?:send|share|email|post|deliver|arrange|book|prepare|produce|provide|give)\s+(?:you\s+)?(?:a|an|the|our|your)?\s*([^.,;!?]{3,60})/i;
/** Services and artefacts an agency has to actually offer. Anything else promised is a thing. */
const NAMED_SERVICE = /\b(valuation|appraisal|tasaci[óo]n|survey|drone photography|photography|photoshoot|floor ?plan|video|virtual tour|staging|mortgage|legal advice|conveyancing|translation|management)\b/i;

/** Ordinary invitations to talk. These promise a conversation, which every agency can have. */
const GENERIC_CTA = /\b(?:talk|chat|speak|call|message|write|DM|reply|comment|tell us|ask us|let us know|walk you through|answer|discuss|get in touch|come back to you|point you)\b/i;

export interface CtaDecision {
  ok: boolean;
  /** the deliverable it promised, when it promised one */
  deliverable: string;
  /** a generic version that keeps the marketing and drops the promise, when one is needed */
  rewrite: string;
  why: string;
}

/**
 * Is this CTA promising something the agency can actually hand over?
 *
 * Deliberately cheap — a CTA does not go through the evidence pipeline. And an unsupported promise
 * never fails the post: it is rewritten into the conversation it should have been.
 *
 * Christian, 2026-09-05: "Comment ARRAS and we'll send you the full breakdown" becomes "Comment
 * ARRAS and we'll talk you through the key points." The marketing survives; the invented service
 * does not.
 */
export function checkCta(text: string, capabilities: string): CtaDecision {
  const t = (text ?? '').trim();
  if (!t) return { ok: true, deliverable: '', rewrite: t, why: 'empty' };
  const m = DELIVERABLE.exec(t);
  if (!m) {
    return { ok: true, deliverable: '', rewrite: t,
      why: GENERIC_CTA.test(t) ? 'an invitation to talk, which needs nothing'
        : 'promises nothing that has to be produced' };
  }
  const deliverable = m[1].trim().toLowerCase();
  // A named service has to be one the agency offers. Anything else is a document it would have to
  // produce, which is equally a promise — but if the profile already names it, it stands.
  const service = NAMED_SERVICE.exec(deliverable)?.[1];
  const cap = capabilities ?? '';
  if (service && new RegExp(service.replace(/\s+/g, '\\s?'), 'i').test(cap)) {
    return { ok: true, deliverable, rewrite: t, why: `the agency offers ${service}` };
  }
  if (!service && new RegExp(deliverable.split(/\s+/).slice(0, 2).join('\\s+'), 'i').test(cap)) {
    return { ok: true, deliverable, rewrite: t, why: 'the agency profile names this' };
  }
  // Rewrite: keep everything up to the promise, then offer the conversation instead.
  const head = t.slice(0, m.index)
    .replace(/\s*(?:and|y|und|en)?\s*(?:we(?:'ll| will)|I(?:'ll| will))?\s*$/i, '')
    .replace(/\s*(?:and|y|und|en)\s*$/i, '')
    .replace(/[\s,;:—–-]+$/, '');
  const rewrite = head
    ? `${head} and we'll talk you through the key points.`
    : "Message us and we'll talk you through the key points.";
  return { ok: false, deliverable, rewrite,
    why: `promises a ${deliverable} the agency has not said it produces` };
}


/* ── THE CANONICAL LAYER MAY NORMALISE, NEVER CONCLUDE ───────────────────────────────────── */

/** Demonyms across the languages a source may be written in, so "Países Bajos" ≡ "Dutch". */
const NATION: Readonly<Record<string, string>> = {
  'países bajos': 'nl', 'paises bajos': 'nl', holanda: 'nl', neerlandeses: 'nl', dutch: 'nl',
  netherlands: 'nl', holandeses: 'nl',
  'reino unido': 'uk', britanicos: 'uk', 'británicos': 'uk', british: 'uk', uk: 'uk', ingleses: 'uk',
  alemania: 'de', alemanes: 'de', german: 'de', germans: 'de', germany: 'de',
  belgica: 'be', 'bélgica': 'be', belgas: 'be', belgian: 'be', belgians: 'be', belgium: 'be',
  francia: 'fr', franceses: 'fr', french: 'fr', france: 'fr',
  polonia: 'pl', polacos: 'pl', polish: 'pl', poland: 'pl',
  marruecos: 'ma', marroquies: 'ma', 'marroquíes': 'ma', moroccan: 'ma', morocco: 'ma',
  rumania: 'ro', rumanos: 'ro', romanian: 'ro', romania: 'ro',
};
const nationsIn = (t: string) => {
  const n = normalizeForMatch(t);
  const out = new Set<string>();
  for (const [k, v] of Object.entries(NATION)) if (n.includes(normalizeForMatch(k))) out.add(v);
  return out;
};

/** A measurement is not another measurement. These pairs have each produced a published error. */
const METRIC_TRAPS: readonly { of: RegExp; not: RegExp; why: string }[] = [
  { of: /(?:\bcapacidad|\bplazas|\bpuede albergar|\bllega a albergar|\bcapacity\b|\bcan host\b|\baccommodat\w+)/i,
    not: /\b(?:population|residents|inhabitants|people live|habitantes)\b/i,
    why: 'turns a hosting capacity into a population' },
  { of: /(?:\bprecio de oferta|\bprecio de anuncio|\basking\b|\badvertised\b|\blisting price\b|\boferta)/i,
    not: /\b(?:sale price|sold for|paid|transaction price|precio de venta)\b/i,
    why: 'turns an asking price into a price someone paid' },
  { of: /(?:\btasaci[óo]n|\bvalor tasado|\bappraisal\b|\bvaluation\b)/i,
    not: /\b(?:sale price|sold for|paid|market price)\b/i,
    why: 'turns an appraisal into a market price' },
  { of: /(?:\bporcentaje|%|\bshare\b|\bproporci[óo]n|\bcuota\b)/i,
    not: /\b(?:\d+\s+(?:purchases|sales|operations|transactions|homes|properties)\b)/i,
    why: 'turns a share into an absolute count' },
  { of: /(?:\bproyecto de ley|\banteproyecto|\bproposal\b|\bdraft\b|\bpropuesta|\bborrador)/i,
    not: /\b(?:the law (?:is|says|requires)|is now law|came into force|entr[óo] en vigor|enacted)\b/i,
    why: 'turns a proposal into law in force' },
  { of: /(?:\bpodr[áa]|\bpuede|\bmay\b|\bcan\b|\bmight\b)/i,
    not: /\b(?:must|has to|is required|always|will always|siempre|obligatorio)\b/i,
    why: 'turns a possibility into an obligation' },
];

export interface FactScope { ok: boolean; why: string }

/**
 * Does the canonical statement stay inside its excerpt?
 *
 * Christian, 2026-09-05: "Países Bajos: 3.708 operaciones en Alicante en 2025" may become "Dutch
 * buyers completed 3,708 purchases in Alicante province in 2025". It may NOT become "Dutch buyers
 * became the dominant group across the Costa Blanca" — that is a conclusion the excerpt does not
 * carry. The canonical layer normalises and translates; it never concludes.
 */
export function canonicalWithinExcerpt(fact: { excerpt: string; canonical: string;
  geography?: string; period?: string }, pageText = ''): FactScope {
  // The excerpt is a span, and a table row rarely repeats the province its own page is about. So
  // geography may also come from the text immediately around the excerpt — a real locality test,
  // not the whole page, which would let a national figure borrow a provincial heading.
  const at = pageText ? normalizeForMatch(pageText).indexOf(normalizeForMatch(fact.excerpt)) : -1;
  const near = at >= 0
    ? normalizeForMatch(pageText).slice(Math.max(0, at - 600), at + fact.excerpt.length + 600)
    : '';
  const ex = `${fact.excerpt} ${fact.geography ?? ''} ${fact.period ?? ''} ${near}`;
  const can = fact.canonical ?? '';
  if (!figuresBacked(can, ex)) return { ok: false, why: 'states a figure the excerpt does not contain' };
  // Years are figures too, but they are the ones that silently drift.
  const years = (t: string) => new Set((normalizeForMatch(t).match(/\b(?:19|20)\d{2}\b/g) ?? []));
  const exYears = years(ex);
  for (const y of years(can)) if (!exYears.has(y)) return { ok: false, why: `dates it to ${y}, which the excerpt does not` };
  const exPlaces = placesOrRegionsIn(ex);
  if (exPlaces.size) {
    const foreign = [...placesOrRegionsIn(can)].filter((x) => !exPlaces.has(x));
    if (foreign.length) return { ok: false, why: `moves the fact to ${foreign.join('/')}` };
  }
  const exNations = nationsIn(ex);
  if (exNations.size) {
    const foreign = [...nationsIn(can)].filter((x) => !exNations.has(x));
    if (foreign.length) return { ok: false, why: 'names a nationality the excerpt does not' };
  }
  for (const trap of METRIC_TRAPS) {
    if (trap.of.test(ex) && trap.not.test(can) && !trap.not.test(ex)) return { ok: false, why: trap.why };
  }
  // A conclusion the excerpt cannot carry: a superlative or a dominance claim added on top of it.
  if (/\b(?:dominant|dominate[sd]?|the leader|leads the|overtaken|took over|the biggest|the largest|most popular)\b/i.test(can)
      && !/\b(?:l[íi]der|lidera|domina|mayor|m[áa]s|primer|first|lead|top|dominant)\b/i.test(ex)) {
    return { ok: false, why: 'draws a ranking conclusion the excerpt does not state' };
  }
  return { ok: true, why: 'stays inside the excerpt' };
}


/**
 * The source facts most likely to bear on a claim.
 *
 * The support pass was handed all sixty-five facts a post had gathered and answered "no source fact
 * cited" on eight claims out of ten — not because nothing fitted, but because nothing was findable.
 * The canonical statements are English and so is the claim, so ranking them is straightforward.
 */
export function rankFacts(
  claim: string, facts: readonly SourceFact[], k = 6, claimType?: string,
): SourceFact[] {
  if (!facts.length) return [];
  // Offer evidence the claim is ALLOWED to rest on. Eleven high-risk legal claims cited facts off
  // unclassified pages while the research had the BOE and two legal databases open, and six
  // statistical claims cited portals while eleven professional-body sources sat unused. A fact the
  // policy will refuse is a wasted slot, however well it matches.
  const tier = riskTier(claim, claimType);
  const risk = riskOf(claim, claimType);
  const allowed = new Set<SourceClass>(SOURCE_POLICY[risk]);
  const want = new Set(significantTokens(claim));
  const nums = new Set(figuresIn(claim));
  const scored = facts.map((f) => {
    const toks = significantTokens(`${f.canonical} ${f.geography} ${f.period}`);
    const seen = new Set<string>();
    let hit = 0;
    for (const t of toks) if (want.has(t) && !seen.has(t)) { hit++; seen.add(t); }
    let numHit = 0;
    for (const n of figuresIn(`${f.canonical} ${f.excerpt}`)) if (nums.has(n)) numHit++;
    const usable = tier === 'high' && !allowed.has(f.sourceClass) ? 0.2 : 1;
    return { f, score: usable * (hit + numHit * 4) };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, k).map((x) => x.f);
}
