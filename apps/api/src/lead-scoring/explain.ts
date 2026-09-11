/**
 * The explanation people see, built by CODE from verified facts and their quotes only. The model's own sentence is
 * never used, so a discarded fact can never appear here (Christian, 2026-09-11: unverified facts must never "be shown
 * as proof").
 */
import { FLAG_KEYS, STATE_DEFAULTS, type FlagKey, type StateKey } from './rubric';
import type { Band, Fact, Facts, ScoreResult } from './types';

const BAND_LABEL: Record<Band, string> = {
  not_a_lead: 'Not a lead',
  very_cold: 'Very cold',
  early_interest: 'Early interest',
  warm: 'Warm',
  hot: 'Hot',
  super_hot: 'Super-hot',
  ready_to_act: 'Ready to act',
  lost: 'Lost, not scored',
  deal: 'Deal, not scored',
  do_not_contact: 'Do not contact, not scored',
};

const STATE_LABEL: Partial<Record<StateKey, Record<string, string>>> = {
  decision: {
    asks_how_to_proceed: 'asks how to proceed',
    offer_or_negotiation: 'makes an offer or negotiates',
    agrees_to_reserve_pay_or_documents: 'agrees to reserve, pay or send documents',
    ready_to_close_now: 'wants to close now',
    already_committed: 'already committed',
  },
  negative: { not_interested: 'no longer interested', bought_elsewhere: 'bought elsewhere', stop_contact: 'asked not to be contacted' },
  viewing: {
    wants_to_view: 'wants to view',
    requested: 'viewing requested',
    agreed_settled: 'viewing agreed',
    agreed_change_pending: 'viewing agreed, change pending',
  },
  budget: { clear: 'budget', vague: 'rough budget' },
  area: { clear: 'area', vague: 'rough area' },
  need: { clear: 'looking for', vague: 'property type' },
  specific_property: { availability_only: 'asked if a listing is available', discussed: 'specific listing' },
  timing: { within_30_days: 'within 30 days', later: 'later' },
};

const FLAG_LABEL: Record<FlagKey, string> = {
  concrete_question: 'concrete question',
  asked_for_listings_or_photos: 'asked for listings or photos',
  financing_ready: 'financing ready',
};

const NOT_A_LEAD_LABEL: Record<string, string> = {
  spam: 'spam',
  wrong_number: 'wrong number',
  supplier_or_job: 'supplier or job seeker',
  no_buy_or_sell_intent: 'no wish to buy, sell or rent',
};

const ORDER: Array<StateKey | FlagKey> = [
  'decision',
  'negative',
  'viewing',
  'budget',
  'area',
  'need',
  'specific_property',
  'timing',
  'financing_ready',
  'concrete_question',
  'asked_for_listings_or_photos',
];
const isFlag = (k: StateKey | FlagKey): k is FlagKey => (FLAG_KEYS as readonly string[]).includes(k);

export function explain(result: ScoreResult, facts: Facts): string {
  const head = result.score == null ? BAND_LABEL[result.band] : `${BAND_LABEL[result.band]} ${result.score}`;
  const parts: string[] = [];
  if (result.band === 'not_a_lead' && facts.not_a_lead_reason) parts.push(NOT_A_LEAD_LABEL[facts.not_a_lead_reason] ?? 'not a lead');
  for (const k of ORDER) {
    const v: Fact | undefined = facts[k];
    if (!v) continue;
    const label = isFlag(k)
      ? v.present === true
        ? FLAG_LABEL[k]
        : undefined
      : v.state && v.state !== STATE_DEFAULTS[k]
        ? STATE_LABEL[k]?.[v.state]
        : undefined;
    if (!label) continue;
    const pieces = String(v.quote ?? '')
      .split('|')
      .map((x) => x.trim())
      .filter(Boolean);
    parts.push(pieces.length ? `${label}: ${pieces.map((p) => `“${p}”`).join(' … ')}` : label);
  }
  return parts.length ? `${head}: ${parts.join(' · ')}` : head;
}
