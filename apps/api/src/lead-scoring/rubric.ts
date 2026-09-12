/**
 * The approved scoring rubric (v1.3, Christian 2026-09-11), as plain code. The AI never picks the number: it extracts
 * facts, evidence.ts keeps only the facts backed by the lead's own words, and this file turns those facts into a
 * score. The same facts always give the same score.
 *
 *   0–9 not a lead · 10–29 very cold · 30–49 early interest · 50–69 warm · 70–84 hot · 85–94 super-hot ·
 *   95–100 ready to act. Lost (bought elsewhere / not interested), deal and do-not-contact leave scoring entirely.
 */
import type { Band, Facts, ScoreResult, Temperature } from './types';

// v1.4 (2026-09-11): the scoring table is unchanged; every quote must now name the lead message it comes from.
// v1.5 (2026-09-12): the table is still unchanged; the AI resolves dates and code (dates.ts) decides what they mean.
export const RUBRIC_VERSION = 'v1.5';

/** The "nothing found" value of every state fact. */
export const STATE_DEFAULTS = {
  budget: 'none',
  area: 'none',
  need: 'none',
  specific_property: 'none',
  timing: 'unknown',
  viewing: 'none',
  decision: 'none',
  negative: 'none',
} as const;
export type StateKey = keyof typeof STATE_DEFAULTS;

export const FLAG_KEYS = ['concrete_question', 'asked_for_listings_or_photos', 'financing_ready'] as const;
export type FlagKey = (typeof FLAG_KEYS)[number];

/** Bands that leave lead scoring: no score, no temperature, outside every automatic lane. */
export const NO_SCORE_BANDS: readonly Band[] = ['lost', 'deal', 'do_not_contact'];

/** Christian's temperatures (2026-09-11). Not-a-lead is never "cold", so cold automation can never reach spam. */
export function temperatureOf(score: number | null): Temperature {
  if (score == null) return null;
  if (score < 10) return 'not_a_lead';
  if (score < 50) return 'cold';
  if (score < 70) return 'warm';
  if (score < 85) return 'hot';
  return 'super_hot';
}

export function computeScore(f: Facts, leadMessageCount: number): ScoreResult {
  const st = (k: StateKey): string => f[k]?.state ?? STATE_DEFAULTS[k];
  const has = (k: FlagKey): boolean => f[k]?.present === true;
  const clear = (k: 'budget' | 'area' | 'need'): boolean => st(k) === 'clear';
  const cap = (s: number, max: number): number => Math.min(s, max);

  // These leave lead scoring entirely.
  if (st('decision') === 'already_committed') return { score: null, band: 'deal', note: 'reserved, paid or signed: a deal status' };
  if (st('negative') === 'stop_contact') return { score: null, band: 'do_not_contact', note: 'asked not to be contacted' };
  // Christian, 2026-09-11: bought elsewhere or no longer interested is closed-lost, not a cold lead. Checked BEFORE
  // real_lead, so a model that calls such a buyer "not a lead" cannot change the outcome (practice run 1, #10).
  if (st('negative') === 'not_interested' || st('negative') === 'bought_elsewhere') {
    return { score: null, band: 'lost', note: 'closed-lost: not active' };
  }

  // 0–9: not a lead.
  if (f.real_lead === false) {
    const r = f.not_a_lead_reason;
    const score = r === 'spam' || r === 'wrong_number' ? 0 : r === 'supplier_or_job' || r === 'no_buy_or_sell_intent' ? 5 : 9;
    return { score, band: 'not_a_lead' };
  }

  const nClear = (['budget', 'area', 'need'] as const).filter(clear).length;
  const near = st('timing') === 'within_30_days';
  const specific = st('specific_property') !== 'none';
  const viewing = st('viewing');
  const mentioned = st('area') !== 'none' || st('need') !== 'none';

  // 95–100: ready to act now. Reserved, paid or signed is a deal status (above), not a score.
  const decisionScores: Record<string, number> = {
    asks_how_to_proceed: 95,
    offer_or_negotiation: 97,
    agrees_to_reserve_pay_or_documents: 99,
    ready_to_close_now: 100,
  };
  const decision = decisionScores[st('decision')];
  if (decision !== undefined) return { score: decision, band: 'ready_to_act' };

  // 85–94: super-hot. A viewing requested or agreed, a clear budget, a clear area or a specific property, within 30 days.
  if (['requested', 'agreed_settled', 'agreed_change_pending'].includes(viewing) && clear('budget') && (clear('area') || specific) && near) {
    const s =
      85 +
      (viewing === 'agreed_settled' ? 3 : 0) +
      (specific ? 2 : 0) +
      (clear('need') ? 1 : 0) +
      (f.viewing?.within_7_days === true ? 1 : 0) +
      (has('financing_ready') ? 2 : 0);
    return { score: cap(s, 94), band: 'super_hot' };
  }

  // 70–84: hot. All three clear, or a specific property WITH stronger intent (Christian: a lone
  // "is this still available?" is a strong signal, not a hot lead).
  const stronger = viewing !== 'none' || nClear > 0 || near;
  if (nClear === 3 || (specific && stronger)) {
    const s = 70 + 2 * nClear + (specific ? 4 : 0) + (viewing !== 'none' ? 2 : 0) + (near ? 2 : 0);
    return { score: cap(s, 84), band: 'hot' };
  }

  // A specific listing and nothing stronger: 50 on its own, 60–69 with a follow-up or a concrete question.
  if (specific) {
    if (has('concrete_question') || leadMessageCount >= 2) {
      const s = 60 + (has('concrete_question') ? 3 : 0) + (has('asked_for_listings_or_photos') ? 3 : 0) + (leadMessageCount >= 3 ? 3 : 0);
      return { score: cap(s, 69), band: 'warm' };
    }
    return { score: 50, band: 'warm', note: 'availability question only' };
  }

  // 50–69: warm. Real intent and two of budget, area and need.
  if (f.intent === 'real' && nClear === 2) {
    const s = 50 + 10 + (near ? 5 : 0) + (has('asked_for_listings_or_photos') ? 4 : 0);
    return { score: cap(s, 69), band: 'warm' };
  }

  // 30–49: early interest. Real intent, at most one of budget, area and need.
  if (f.intent === 'real') {
    const s = 30 + (nClear === 1 ? 8 : 0) + (near ? 5 : 0) + (has('concrete_question') ? 4 : 0);
    return { score: cap(s, 49), band: 'early_interest' };
  }

  // 10–29: very cold.
  return { score: cap(10 + (mentioned ? 5 : 0) + (leadMessageCount >= 2 ? 5 : 0), 29), band: 'very_cold' };
}
