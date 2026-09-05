/**
 * Finding the verified bank card that governs a typed topic.
 *
 * Pure — no env, no network — so every part of it is testable. The one step that needs a model
 * (asking which of 120 cards a free-typed topic belongs to) lives in the engine and uses the
 * helpers here to build its prompt and read its answer.
 *
 * WHY A MODEL PICKS AND NOT A KEYWORD SCORE: an agent can type the topic in any of thirteen
 * languages, while every bank question is written in English. Token overlap between "¿Pueden los
 * okupas quedarse con tu casa?" and "Will squatters take your holiday home" is zero. The keyword
 * scorer below is the fallback for when that call fails, not the primary path.
 */
import { BANK_CARDS, type BankCard } from './studio-bank.generated';

const BY_ID = new Map(BANK_CARDS.map((c) => [c.id, c]));

export function getCard(id: string | null | undefined): BankCard | undefined {
  return id ? BY_ID.get(id.trim().toUpperCase()) : undefined;
}

/**
 * One line per card, cheap enough to hand a model whole. Truncated at a sentence-safe length: bank
 * questions open with the subject, so the first clause is the identifying part.
 */
export function bankIndex(): string {
  return BANK_CARDS.map((c) => {
    const q = (c.question || c.hook).replace(/\s+/g, ' ').trim();
    return `${c.id} | ${q.length > 130 ? `${q.slice(0, 130)}…` : q}`;
  }).join('\n');
}

/** Read a model's answer. It is told to reply with an id or NONE; be forgiving about the rest. */
export function parseCardPick(reply: string): string | null {
  const m = /\b([SB])\s*-?\s*(\d{1,3})\b/i.exec(reply ?? '');
  if (!m) return null;
  const id = `${m[1].toUpperCase()}${Number(m[2])}`;
  return BY_ID.has(id) ? id : null;
}

const STOP = new Set(`a al an and are as at be but by can de del do does el en for from get gets
has have how in into is it its la las los must my no not of on or que se should so than that the
their them there they this to un una up was what when where which who why will with y you your`
  .split(/\s+/));

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const terms = (s: string) => new Set(
  fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));

/**
 * Deterministic fallback ranking, used when the model pick is unavailable.
 *
 * Bank questions are written in English, so an agent typing in Spanish would match nothing on the
 * question alone. must_establish and never_assume carry the Spanish legal vocabulary — usurpación,
 * desahucio, plusvalía, nota de encargo — so they are indexed too, at a lower weight because they
 * are long and would otherwise drown the question. Rare terms count for more than common ones.
 */
export function keywordCandidates(topic: string, limit = 5): { id: string; score: number }[] {
  const want = terms(topic);
  if (!want.size) return [];
  const df = new Map<string, number>();
  const indexed = BANK_CARDS.map((c) => {
    const strong = terms(`${c.question} ${c.hook}`);
    const weak = terms(`${c.must.join(' ')} ${c.never.join(' ')}`);
    const all = new Set([...strong, ...weak]);
    for (const w of all) df.set(w, (df.get(w) ?? 0) + 1);
    return { id: c.id, strong, weak };
  });
  const idf = (w: string) => Math.log(BANK_CARDS.length / (df.get(w) ?? 1));
  const scored = indexed.map(({ id, strong, weak }) => {
    let score = 0;
    for (const w of want) {
      if (strong.has(w)) score += idf(w);
      else if (weak.has(w)) score += 0.4 * idf(w);
    }
    return { id, score };
  });
  // A forced match is worse than no match: most typed topics are genuinely not in the bank, and the
  // wrong card hands the writer the wrong guardrails. A Spanish topic scored 3.1 against the WRONG
  // squatter card here, so the floor is set above that. In practice this makes the fallback an
  // English-only scorer, which is honest — it exists only for when the model pick is unavailable,
  // and returning nothing then is a correct answer.
  return scored.filter((s) => s.score >= 5).sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * The card rendered for a prompt. `never` is the half that had to reach the writer and never did —
 * a post shipped a legal claim its own card forbids in as many words.
 */
export function cardRules(card: BankCard): string {
  const list = (xs: string[]) => xs.map((x) => `· ${x.replace(/\s+/g, ' ').trim()}`).join('\n');
  return [
    `VERIFIED GUARDRAILS FOR THIS TOPIC (bank card ${card.id}${card.asOf ? `, checked ${card.asOf}` : ''}).`,
    `These were verified against primary law, tax and official statistics. They outrank anything you`,
    `remember. They are INTERNAL — never quote them, never mention them, never write about them.`,
    '',
    'WHAT THE RESEARCH MUST ESTABLISH:',
    list(card.must),
    '',
    'WHAT YOU MAY NEVER ASSUME OR ASSERT:',
    list(card.never),
    card.agencyRequired
      ? '\nTHIS TOPIC NEEDS THE AGENCY\'S OWN FIGURES. Without them, write the version that needs none.'
      : '',
  ].filter(Boolean).join('\n');
}

/* ── SCOPE ───────────────────────────────────────────────────────────────────────────────── */

/**
 * The places a card is written about.
 *
 * B20 is "Jávea or Dénia?" — its four required points are about those two towns, one of them
 * naming the UNESCO designation Dénia holds. Matched to a Moraira-versus-Calpe topic it produced
 * four requirements that could not be established by construction, and the post asserted seasonal
 * population figures anyway. A card that names towns is about those towns.
 */
// TOWNS scope a card. A region does not: a card about "the Costa Blanca" is about a subject that
// happens to have a coastline, and scoping it to that coastline would make it govern nothing.
const TOWN = /\b(J[áa]vea|X[àa]bia|D[ée]nia|Moraira|Teulada|Calpe|Calp|Benissa|Altea|Alt[ée]a|Benidorm|Torrevieja|Orihuela|Guardamar|Santa Pola|El Campello|Villajoyosa|Finestrat|Polop|La Nucia|Albir|Pego|Ondara|Pedreguer|Benitachell|Poble Nou|San Javier|Cartagena|Marbella|Estepona|Nerja|Sitges|Alicante city)\b/gi;

const CANON = (p: string) => p.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/^xabia$/, 'javea').replace(/^calp$/, 'calpe').replace(/^altea$/, 'altea');

/** The distinct places a piece of text names, canonicalised so Xàbia and Jávea are one place. */
export function placesIn(text: string): Set<string> {
  return new Set(Array.from((text ?? '').matchAll(TOWN), (m) => CANON(m[1])));
}

/**
 * Is this card written about specific places rather than about a subject?
 *
 * A card whose QUESTION names towns is scoped to them. A card that mentions a town only in passing
 * inside its requirements is not — "use the INE table for the town the piece names" is general
 * advice that happens to contain an example.
 */
export function cardScope(card: BankCard): Set<string> {
  return placesIn(card.question);
}

/**
 * May this card govern this topic?
 *
 * A card with no places in its question is general and governs by subject. A card scoped to places
 * governs only a topic that names at least one of them. Anything else borrows another town's
 * verified requirements, which is how a Moraira/Calpe post came to be judged against Jávea/Dénia.
 */
export function cardInScope(card: BankCard, topic: string): boolean {
  const scope = cardScope(card);
  if (!scope.size) return true;                       // a card about a subject governs by subject
  const topicPlaces = placesIn(topic);
  for (const p of topicPlaces) if (scope.has(p)) return true;
  // A topic that names no place at all is not the place-scoped card's topic either: "which coastal
  // town suits year-round living" must not inherit requirements written about Jávea and Dénia.
  return false;
}

/** Why a card was refused, for the record. Empty string when it was in scope. */
export function outOfScopeReason(card: BankCard, topic: string): string {
  if (cardInScope(card, topic)) return '';
  const t = [...placesIn(topic)];
  return `card ${card.id} is written about ${[...cardScope(card)].join('/')} and the topic is about `
    + `${t.length ? t.join('/') : 'no named place'}`;
}

/* ── RETRIEVAL FOR VALIDATION ────────────────────────────────────────────────────────────── */

/** One verified statement out of the bank, addressable by id. */
export interface BankFact { id: string; text: string; cardId: string; kind: 'must' | 'never' | 'hook' }

function factsOf(card: BankCard): BankFact[] {
  const out: BankFact[] = [];
  if (card.hook) out.push({ id: `${card.id}#hook`, text: card.hook, cardId: card.id, kind: 'hook' });
  card.must.forEach((t, i) => out.push({ id: `${card.id}#${i + 1}`, text: t, cardId: card.id, kind: 'must' }));
  card.never.forEach((t, i) => out.push({ id: `${card.id}#never${i + 1}`, text: t, cardId: card.id, kind: 'never' }));
  return out;
}

/**
 * The verified statements most relevant to what a finished post actually claims.
 *
 * Retrieval is across the whole bank, not only the card that was matched before research. H1 and H2
 * matched no card at all and made high-risk legal and tax claims that the bank already covers; a
 * guardrail is only useful if it is consulted by what the post says, not by what the topic said.
 */
export function retrieveBankFacts(
  claims: readonly string[], bank?: 'seller' | 'buyer', limit = 14,
): BankFact[] {
  const text = claims.join(' \n ');
  const want = terms(text);
  if (!want.size) return [];
  const pool = BANK_CARDS.filter((c) => (bank ? c.bank === bank : true) && c.state !== 'blocked')
    .flatMap(factsOf);
  const df = new Map<string, number>();
  const indexed = pool.map((f) => {
    const t = terms(f.text);
    for (const w of t) df.set(w, (df.get(w) ?? 0) + 1);
    return { f, t };
  });
  const idf = (w: string) => Math.log(pool.length / (df.get(w) ?? 1));
  const picked = indexed
    .map(({ f, t }) => {
      let score = 0;
      let overlap = 0;
      for (const w of want) if (t.has(w)) { score += idf(w); overlap++; }
      // a guardrail is the half that stops a wrong sentence, so it outranks a requirement
      return { f, score: score * (f.kind === 'never' ? 1.25 : 1), overlap };
    })
    // One shared word is a coincidence. Marketing copy shares "listing" and "detail" with half the
    // bank, and retrieving on that would drag a rhetorical line in front of a legal guardrail.
    .filter((x) => x.overlap >= 4 && x.score >= 12)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.f);
  // A guardrail travels with the requirement it guards. Retrieval on the H4 copy found B43's
  // requirement — the one that says the nationality ranking is national only — and left behind
  // B43's "do not generalise a national ranking to Alicante province", which is the sentence that
  // would have stopped the post. Once a card is in, its whole never_assume list comes with it.
  const cards = new Set(picked.map((f) => f.cardId));
  const withGuardrails = [...picked];
  for (const id of cards) {
    const c = BY_ID.get(id);
    if (!c) continue;
    for (const g of factsOf(c)) {
      if (g.kind === 'never' && !withGuardrails.some((x) => x.id === g.id)) withGuardrails.push(g);
    }
  }
  return withGuardrails;
}
