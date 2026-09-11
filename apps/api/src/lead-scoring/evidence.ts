/**
 * Evidence: which facts may count. Christian, 2026-09-11: "unverified facts must never support the score or be shown
 * as proof." A fact counts only when its quote really is in the lead's own messages; three guards stop a listing's
 * own details being read as the lead's search. Everything thrown away is reported, never silently dropped.
 *
 * v1.4 (after the first Scoring check, 2026-09-11): the AI had quoted the agency's words as the lead's. Every quote
 * piece must now name the ONE lead message it comes from ("L22: Ja det passer"), and it is checked inside that message
 * only, so borrowed, stitched or agency-sourced words can no longer pass.
 */
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
  return bad;
}

export const norm = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Whether a piece's words sit in one (normalised) message: word for word, or every word of it (3+ letters, or a number). */
function inMessage(text: string, message: string): boolean {
  const q = norm(text);
  if (!q) return false;
  if (message.includes(q)) return true;
  const words = q.split(' ').filter((w) => w.length >= 3 || /\d/.test(w));
  const tokens = new Set(message.split(' '));
  return words.length > 0 && words.every((w) => tokens.has(w));
}

/** Why a quote cannot count, or null when it can: 1 to 3 pieces, each naming one lead message that holds its words. */
export function quoteProblem(quote: unknown, leadTexts: readonly string[]): string | null {
  const pieces = parseQuote(quote);
  if (pieces.length === 0) return 'no quote';
  if (pieces.length > 3) return `more than 3 pieces (${JSON.stringify(quote)})`;
  for (const p of pieces) {
    if (p.index === null) return `"${p.text}" does not say which lead message it comes from`;
    if (p.index < 0 || p.index >= leadTexts.length) return `${leadLabel(p.index)} is not one of the lead's messages ("${p.text}")`;
    if (!inMessage(p.text, leadTexts[p.index])) return `"${p.text}" is not in the lead's message ${leadLabel(p.index)}`;
  }
  return null;
}

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
};

/** leadTexts = the lead's messages after norm(); leadRaw = the same messages as written. Both in lead-messages.ts order. */
export function checkEvidence(f: Facts, leadTexts: readonly string[], leadRaw: readonly string[]): Evidence {
  const out: Facts = JSON.parse(JSON.stringify(f)) as Facts;
  const discarded: string[] = [];
  const guards: string[] = [];

  for (const k of Object.keys(STATE_DEFAULTS) as StateKey[]) {
    const v = out[k];
    const def = STATE_DEFAULTS[k];
    if (!v || v.state === def) continue;
    const problem = quoteProblem(v.quote, leadTexts);
    if (problem) {
      discarded.push(`${k}=${v.state}: ${problem}`);
      out[k] = { ...v, state: def, ...(k === 'viewing' ? { within_7_days: null } : {}) };
    }
  }
  for (const k of FLAG_KEYS) {
    const v = out[k];
    if (!v?.present) continue;
    const problem = quoteProblem(v.quote, leadTexts);
    if (problem) {
      discarded.push(`${k}: ${problem}`);
      out[k] = { ...v, present: false };
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

  return { facts: out, discarded, guards };
}
