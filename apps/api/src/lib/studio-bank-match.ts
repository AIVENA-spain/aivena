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
