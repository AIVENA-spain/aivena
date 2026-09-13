/**
 * Evidence: which facts may count. Christian, 2026-09-11: "unverified facts must never support the score or be shown
 * as proof." A fact counts only when its quote really is in the lead's own messages; three guards stop a listing's
 * own details being read as the lead's search. Everything thrown away is reported, never silently dropped.
 *
 * v1.4 (after the first Scoring check, 2026-09-11): the AI had quoted the agency's words as the lead's. Every quote
 * piece must now name the ONE lead message it comes from ("L22: Ja det passer"), and it is checked inside that message
 * only, so borrowed, stitched or agency-sourced words can no longer pass.
 *
 * v1.5.2 (Christian, 2026-09-13): the AI copied the lead's "isteden" as "istenden" and a true, agreed viewing was
 * thrown away. ONE word per fact may now differ by ONE letter from a word in the named lead message — and only when it
 * has 5+ letters, holds no digit, sits in a piece with no number, price, reference, phone number or email, is not a
 * day or month word in any dashboard language, and is written in lower case everywhere in the conversation (so never
 * a name or a place). The quote is then corrected to the lead's real word, and the slip is logged as tolerated.
 */
import { isDate } from './dates';
import { leadLabel, parseQuote } from './lead-messages';
import { FLAG_KEYS, STATE_DEFAULTS, type StateKey } from './rubric';
import type { Facts } from './types';

/** Strict validation: an answer with ANY value outside these lists is rejected, never guessed (practice run 1, #6/#11). */
export const ALLOWED_STATES: Record<StateKey, readonly string[]> = {
  budget: ['clear', 'vague', 'none'],
  area: ['clear', 'vague', 'none'],
  need: ['clear', 'vague', 'none'],
  specific_property: ['none', 'availability_only', 'discussed'],
  timing: ['within_30_days', 'later', 'unknown'],
  viewing: ['none', 'wants_to_view', 'requested', 'agreed_settled', 'agreed_change_pending'],
  decision: ['none', 'asks_how_to_proceed', 'offer_or_negotiation', 'agrees_to_reserve_pay_or_documents', 'ready_to_close_now', 'already_committed'],
  negative: ['none', 'not_interested', 'bought_elsewhere', 'stop_contact'],
};
const NOT_A_LEAD_REASONS: readonly (string | null)[] = [null, 'spam', 'wrong_number', 'supplier_or_job', 'no_buy_or_sell_intent'];

export function invalidValues(f: Facts): string[] {
  const bad: string[] = [];
  if (typeof f.real_lead !== 'boolean') bad.push(`real_lead=${JSON.stringify(f.real_lead)}`);
  if (!NOT_A_LEAD_REASONS.includes(f.not_a_lead_reason ?? null)) bad.push(`not_a_lead_reason=${JSON.stringify(f.not_a_lead_reason)}`);
  if (f.real_lead === true && !['real', 'curious'].includes(String(f.intent))) bad.push(`intent=${JSON.stringify(f.intent)}`);
  for (const k of Object.keys(ALLOWED_STATES) as StateKey[]) {
    if (!ALLOWED_STATES[k].includes(String(f[k]?.state))) bad.push(`${k}=${JSON.stringify(f[k]?.state)}`);
  }
  for (const k of FLAG_KEYS) if (typeof f[k]?.present !== 'boolean') bad.push(`${k}=${JSON.stringify(f[k]?.present)}`);
  const w = f.viewing?.within_7_days ?? null;
  if (w !== null && typeof w !== 'boolean') bad.push(`viewing.within_7_days=${JSON.stringify(w)}`);
  // v1.5: a date is a real date or nothing. A half-written one is never guessed at.
  for (const k of ['timing', 'viewing'] as const) {
    const d = f[k]?.date ?? null;
    if (d !== null && !isDate(d)) bad.push(`${k}.date=${JSON.stringify(d)}`);
  }
  return bad;
}

export const norm = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const rawWordsOf = (s: string): string[] => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Whether a piece's words sit in one (normalised) message: word for word, or every word of it (3+ letters, or a number). */
function inMessage(text: string, message: string): boolean {
  const q = norm(text);
  if (!q) return false;
  if (message.includes(q)) return true;
  const words = q.split(' ').filter((w) => w.length >= 3 || /\d/.test(w));
  const tokens = new Set(message.split(' '));
  return words.length > 0 && words.every((w) => tokens.has(w));
}

// ── The one-letter slip (v1.5.2) ───────────────────────────────────────────────────────────────────────────────────

/** The dashboard's 13 languages (Norwegian is "nb" to the calendar data). */
const LOCALES = ['en', 'es', 'nl', 'de', 'fr', 'nb', 'sv', 'da', 'fi', 'pl', 'pt', 'it', 'ru'] as const;

/** Day, month, today and tomorrow words in every dashboard language, from the runtime's own calendar data. */
function buildCalendarWords(): Set<string> {
  const out = new Set<string>();
  const add = (s: string) => {
    for (const w of norm(s.replace(/\p{N}/gu, ' ')).split(' ')) if (w.length >= 3) out.add(w);
  };
  for (const locale of LOCALES) {
    try {
      for (let d = 0; d < 7; d++) {
        const day = new Date(Date.UTC(2026, 8, 7 + d));
        for (const weekday of ['long', 'short'] as const) add(new Intl.DateTimeFormat(locale, { weekday, timeZone: 'UTC' }).format(day));
      }
      for (let m = 0; m < 12; m++) {
        const date = new Date(Date.UTC(2026, m, 15));
        for (const month of ['long', 'short'] as const) {
          add(new Intl.DateTimeFormat(locale, { month, timeZone: 'UTC' }).format(date));
          // With a day, several languages use another form of the month ("15 września", "15 сентября").
          add(new Intl.DateTimeFormat(locale, { day: 'numeric', month, timeZone: 'UTC' }).format(date));
        }
      }
      const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      for (const n of [-1, 0, 1, 2]) add(relative.format(n, 'day'));
      for (const n of [-1, 0, 1]) add(relative.format(n, 'week'));
    } catch {
      // A language the runtime lacks adds nothing, and slipToleranceReady() then refuses every slip.
    }
  }
  return out;
}
const CALENDAR_WORDS = buildCalendarWords();

/** Fails closed: without real calendar data in these languages, no slip is tolerated at all. */
export const slipToleranceReady = (): boolean =>
  CALENDAR_WORDS.has('torsdag') && CALENDAR_WORDS.has('czwartek') && CALENDAR_WORDS.has('september');

const LETTERS = /^\p{L}+$/u;
/** A piece holding a number, price, reference, phone number, email or link is never given any tolerance. */
const PROTECTED_PIECE = /[\p{N}€$£¥@]|https?:\/\/|www\./iu;
const letterCount = (w: string): number => [...w].length;
const firstFive = (w: string): string => [...w].slice(0, 5).join('');
const CALENDAR_PREFIXES = new Set([...CALENDAR_WORDS].filter((w) => letterCount(w) >= 5).map(firstFive));
/**
 * A day or month word, INCLUDING its inflected forms ("we wrześniu", "в сентябре", "syyskuussa"), which the calendar data
 * does not list: any word sharing its first five letters with one. It blocks a few unrelated words too, which only
 * means fewer slips are tolerated, never more.
 */
const isCalendarLike = (w: string): boolean => CALENDAR_WORDS.has(w) || (letterCount(w) >= 5 && CALENDAR_PREFIXES.has(firstFive(w)));

function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length]!;
}

/**
 * Every word written with a capital anywhere in the conversation, on either side. A lead may write a place in lower
 * case ("Ciudad quesada") while the agency writes "Quesada": such a word is a name, and a slip in it is never tolerated.
 */
export function capitalisedWords(texts: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const w of rawWordsOf(t)) if (w[0] !== w[0]!.toLocaleLowerCase()) out.add(norm(w));
  return out;
}

type Slip = { typed: string; lead: string };
type PieceMatch = { ok: true; slip: Slip | null } | { ok: false };

function matchPiece(text: string, message: string, rawMessage: string | undefined, capitalised: ReadonlySet<string>): PieceMatch {
  const q = norm(text);
  if (!q) return { ok: false };
  if (message.includes(q)) return { ok: true, slip: null };
  const words = q.split(' ').filter((w) => w.length >= 3 || /\d/.test(w));
  if (words.length === 0) return { ok: false };
  const tokens = new Set(message.split(' '));
  const missing = words.filter((w) => !tokens.has(w));
  if (missing.length === 0) return { ok: true, slip: null };

  // Exactly one word may be a one-letter slip, and only inside every limit Christian set.
  if (rawMessage === undefined || missing.length !== 1 || !slipToleranceReady() || PROTECTED_PIECE.test(text)) return { ok: false };
  const word = missing[0]!;
  if (!LETTERS.test(word) || letterCount(word) < 5 || isCalendarLike(word) || capitalised.has(word)) return { ok: false };
  const typed = rawWordsOf(text).find((r) => norm(r) === word);
  if (!typed || typed !== typed.toLocaleLowerCase()) return { ok: false };
  const near = [...tokens].filter(
    (t) => LETTERS.test(t) && letterCount(t) >= 5 && !isCalendarLike(t) && !capitalised.has(t) && editDistance(t, word) === 1,
  );
  if (near.length !== 1) return { ok: false }; // no such word, or more than one: not a slip we can be sure of
  const lead = rawWordsOf(rawMessage).find((r) => norm(r) === near[0]);
  if (!lead || lead !== lead.toLocaleLowerCase()) return { ok: false };
  return { ok: true, slip: { typed, lead } };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const replaceWord = (text: string, from: string, to: string): string =>
  text.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(from)}(?=[^\\p{L}\\p{N}]|$)`, 'u'), `$1${to}`);

export type QuoteCheck = {
  /** Why the quote cannot count, or null when it can. */
  problem: string | null;
  /** One-letter slips that were tolerated (at most one per fact). */
  slips: Array<Slip & { message: string }>;
  /** The quote rewritten with the lead's real words, when a slip was tolerated. */
  corrected: string | null;
};

/**
 * 1 to 3 pieces, each naming one lead message that holds its words. The slip tolerance applies only when the lead's
 * raw messages and the conversation's capitalised words are both supplied (the scorer supplies them); without them the
 * check is strictly word for word.
 */
export function checkQuote(
  quote: unknown,
  leadTexts: readonly string[],
  leadRaw?: readonly string[],
  capitalised?: ReadonlySet<string>,
): QuoteCheck {
  const fail = (problem: string): QuoteCheck => ({ problem, slips: [], corrected: null });
  const pieces = parseQuote(quote);
  if (pieces.length === 0) return fail('no quote');
  if (pieces.length > 3) return fail(`more than 3 pieces (${JSON.stringify(quote)})`);
  const tolerant = leadRaw !== undefined && capitalised !== undefined;
  const slips: QuoteCheck['slips'] = [];
  const rebuilt: string[] = [];
  for (const p of pieces) {
    if (p.index === null) return fail(`"${p.text}" does not say which lead message it comes from`);
    if (p.index < 0 || p.index >= leadTexts.length) return fail(`${leadLabel(p.index)} is not one of the lead's messages ("${p.text}")`);
    const m = matchPiece(p.text, leadTexts[p.index]!, tolerant ? leadRaw[p.index] : undefined, capitalised ?? new Set());
    if (!m.ok) return fail(`"${p.text}" is not in the lead's message ${leadLabel(p.index)}`);
    if (m.slip) slips.push({ ...m.slip, message: leadLabel(p.index) });
    rebuilt.push(`${leadLabel(p.index)}: ${m.slip ? replaceWord(p.text, m.slip.typed, m.slip.lead) : p.text}`);
  }
  // More than one differing word is not a typo: it is a different sentence.
  if (slips.length > 1) {
    return fail(`more than one word differs from the lead's messages (${slips.map((s) => `"${s.typed}"`).join(', ')})`);
  }
  return { problem: null, slips, corrected: slips.length ? rebuilt.join(' | ') : null };
}

export const quoteProblem = (quote: unknown, leadTexts: readonly string[]): string | null => checkQuote(quote, leadTexts).problem;
export const quoteFound = (quote: unknown, leadTexts: readonly string[]): boolean => quoteProblem(quote, leadTexts) === null;

/** A quote's words without the message numbers, for comparing one fact's evidence with another's. */
const wordsOf = (quote: unknown): string => norm(parseQuote(quote).map((p) => p.text).join(' '));

// A lead message that names a listing reference ("ref MI3321", "IC-81596"). Tested on the RAW text: codes are upper case.
const REF_CODE = /\b[A-Z]{1,4}-?\d{3,6}\b/;
const REF_WORD = /\bref\b/i;

export type Evidence = {
  facts: Facts;
  /** Facts thrown away because their quote is not in the lead's own words. Never scored, never shown. */
  discarded: string[];
  /** Facts neutralised by a guard (a listing's detail is not the lead's search). */
  guards: string[];
  /** Facts kept although the AI's copy had a one-letter slip: logged, and the quote corrected to the lead's words. */
  tolerated: string[];
};

const slipNote = (s: QuoteCheck['slips'][number]): string =>
  `"${s.typed}" read as "${s.lead}" in the lead's message ${s.message} (a one-letter copying slip)`;

/**
 * leadTexts = the lead's messages after norm(); leadRaw = the same messages as written; capitalised = the conversation's
 * capitalised words (capitalisedWords()). Without `capitalised` the check stays strictly word for word.
 */
export function checkEvidence(
  f: Facts,
  leadTexts: readonly string[],
  leadRaw: readonly string[],
  capitalised?: ReadonlySet<string>,
): Evidence {
  const out: Facts = JSON.parse(JSON.stringify(f)) as Facts;
  const discarded: string[] = [];
  const guards: string[] = [];
  const tolerated: string[] = [];

  for (const k of Object.keys(STATE_DEFAULTS) as StateKey[]) {
    const v = out[k];
    const def = STATE_DEFAULTS[k];
    if (!v || v.state === def) continue;
    const q = checkQuote(v.quote, leadTexts, leadRaw, capitalised);
    if (q.problem) {
      discarded.push(`${k}=${v.state}: ${q.problem}`);
      out[k] = { ...v, state: def, ...(k === 'viewing' ? { within_7_days: null } : {}) };
    } else if (q.corrected) {
      tolerated.push(`${k}=${v.state}: ${slipNote(q.slips[0]!)}`);
      out[k] = { ...v, quote: q.corrected };
    }
  }
  for (const k of FLAG_KEYS) {
    const v = out[k];
    if (!v?.present) continue;
    const q = checkQuote(v.quote, leadTexts, leadRaw, capitalised);
    if (q.problem) {
      discarded.push(`${k}: ${q.problem}`);
      out[k] = { ...v, present: false };
    } else if (q.corrected) {
      tolerated.push(`${k}: ${slipNote(q.slips[0]!)}`);
      out[k] = { ...v, quote: q.corrected };
    }
  }

  // Guard 1 (practice run 1, #3): "is it still available?" on its own is never a concrete question.
  if (out.specific_property?.state === 'availability_only' && out.concrete_question?.present) {
    guards.push('an availability question is not a concrete question');
    out.concrete_question = { ...out.concrete_question, present: false };
  }

  // Guard 2 (run 1, #4): a budget, area or need quoted from inside the listing reference is that listing's detail.
  const sp = wordsOf(out.specific_property?.quote);
  if (out.specific_property && out.specific_property.state !== 'none' && sp) {
    for (const k of ['budget', 'area', 'need'] as const) {
      const v = out[k];
      const q = wordsOf(v?.quote);
      if (v && v.state !== 'none' && q && (sp.includes(q) || q.includes(sp))) {
        guards.push(`${k} "${v.quote}" is the listing's detail, not their own search`);
        out[k] = { ...v, state: 'none' };
      }
    }
  }

  // Guard 4 (v1.6, Christian 2026-09-13): search budget, offer price, listing price and financing are four different
  // things. A budget quoted from inside their offer on a listing, or from inside their financing, is not their search
  // budget (a listing's own price is already caught by guard 2).
  for (const [k, label] of [['decision', 'their offer on a listing'], ['financing_ready', 'their financing']] as const) {
    const v = out[k];
    const active = k === 'decision' ? v?.state === 'offer_or_negotiation' : v?.present === true;
    const source = wordsOf(v?.quote);
    const b = out.budget;
    const bq = wordsOf(b?.quote);
    if (active && source && b && b.state !== 'none' && bq && (source.includes(bq) || bq.includes(source))) {
      guards.push(`budget "${b.quote}" is ${label}, not their search budget`);
      out.budget = { ...b, state: 'none' };
    }
  }

  // Guard 3 (run 3, #4): an area or need whose words sit ONLY in messages naming a listing reference is that listing's
  // detail, whichever message the model named. Budget is left alone: "up to €400k" is the lead's.
  const listingMessage = leadRaw.map((t) => REF_CODE.test(t) || REF_WORD.test(t));
  if (listingMessage.some(Boolean)) {
    for (const k of ['area', 'need'] as const) {
      const v = out[k];
      if (!v || v.state === 'none') continue;
      const hits = parseQuote(v.quote).map((p) => leadTexts.flatMap((t, i) => (inMessage(p.text, t) ? [i] : [])));
      if (hits.length > 0 && hits.every((idx) => idx.length > 0 && idx.every((i) => listingMessage[i]))) {
        guards.push(`${k} "${v.quote}" appears only where they ask about a listing reference: the listing's detail`);
        out[k] = { ...v, state: 'none' };
      }
    }
  }

  return { facts: out, discarded, guards, tolerated };
}
