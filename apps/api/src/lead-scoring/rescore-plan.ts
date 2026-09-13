/**
 * The go-live re-score rule, per lead, with no database access (Stage 3b; used by routes/admin/scoring-rescore.ts).
 * June's legacy scoring output is archived and cleared; a lead the scorer can read is then scored for real; a live score
 * is never cleared. Go-live may run only while scoring is declared live and writing (Stage 3c).
 */
import { LEAD_SCORING_LIVE, LEAD_SCORING_MODE } from '../lib/automation-status';
import { SERVICE_SOURCE } from './source';

const CLOSED = ['closed', 'lost', 'booked', 'do_not_contact'];

export type RescoreLeadRow = {
  lead_id: string;
  full_name: string | null;
  status: string | null;
  opt_in_status: string | null;
  score: number | null;
  temperature: string | null;
  scored_at: string | Date | null;
  intent: string | null;
  urgency: string | null;
  has_reasoning: boolean;
  score_source: string | null;
  inbound_messages: number;
};

export type RescoreAction = 'rescore_and_clear_legacy' | 'clear_legacy' | 'rescore' | 'nothing';

export type RescorePlan = {
  leadId: string;
  name: string | null;
  action: RescoreAction;
  reason: string;
  /** Which June fields are present now (they are archived before being cleared). */
  legacyFields: string[];
};

/** The rule, as a pure function: what go-live does to one lead. */
export function planLead(r: RescoreLeadRow): RescorePlan {
  const live = r.score_source === SERVICE_SOURCE;
  const legacyFields = live
    ? []
    : ([
        ['score', r.score != null],
        ['temperature', r.temperature != null],
        ['scored_at', r.scored_at != null],
        ['intent', r.intent != null],
        ['urgency', r.urgency != null],
        ['reasoning_summary', r.has_reasoning],
      ] as const)
        .filter(([, present]) => present)
        .map(([f]) => f);
  const closed = CLOSED.includes(String(r.status ?? ''));
  const optedOut = r.opt_in_status === 'opted_out';
  const scorable = Number(r.inbound_messages) > 0 && !closed && !optedOut;
  const base = { leadId: r.lead_id, name: r.full_name, legacyFields };
  if (live) return { ...base, action: 'nothing', reason: 'Already has a live score; the scorer keeps it current.' };
  if (scorable && legacyFields.length) {
    return { ...base, action: 'rescore_and_clear_legacy', reason: `June data archived and cleared, then scored from ${r.inbound_messages} message(s) from the lead.` };
  }
  if (scorable) return { ...base, action: 'rescore', reason: `Scored for the first time from ${r.inbound_messages} message(s) from the lead.` };
  if (legacyFields.length) {
    const why = closed ? `the lead is ${r.status}` : optedOut ? 'the lead opted out' : 'there are no messages from the lead to score';
    return { ...base, action: 'clear_legacy', reason: `June data archived and cleared; not re-scored because ${why}.` };
  }
  return { ...base, action: 'nothing', reason: 'No June data and nothing to score yet.' };
}

/** Go-live may only run when scoring is declared live and writing (Stage 3c). */
export const rescoreAllowed = (live: boolean = LEAD_SCORING_LIVE, mode: string = LEAD_SCORING_MODE): boolean => live && mode === 'write';
