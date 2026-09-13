/**
 * Urgency: a live signal beside the score, never inside it (Christian, 2026-09-13).
 *
 *   Score   = how good the lead is. It never decays.
 *   Urgency = what needs a person now, computed by code from timestamps every time it is shown, and never stored.
 *
 * His rules:
 *   - A lead waiting for the agency is "waiting for your reply" — never dormant, whatever the gap. Agency silence is an
 *     urgency problem, not a weaker lead.
 *   - A viewing date that has passed reads "viewing date passed" (it needs a follow-up).
 *   - Inactive (30+ days) and dormant (60+ days) apply ONLY when the agency spoke last and the lead went quiet.
 * "Needs a human" is the existing hand-off queue; it is not recomputed here.
 */

export const INACTIVE_DAYS = 30;
export const DORMANT_DAYS = 60;

export type UrgencySignal =
  | { kind: 'waiting_for_reply'; days: number }
  | { kind: 'viewing_date_passed'; date: string }
  | { kind: 'inactive'; days: number }
  | { kind: 'dormant'; days: number };

export type UrgencyInput = {
  /** The lead's latest message. */
  lastInboundAt: string | null;
  /** The agency's latest message (a person or Amanda). */
  lastOutboundAt: string | null;
  /** The viewing date the scorer resolved (YYYY-MM-DD), if any. */
  viewingDate: string | null;
  now: string;
};

const DAY_MS = 86_400_000;
const wholeDaysBetween = (fromMs: number, toMs: number): number => Math.max(0, Math.floor((toMs - fromMs) / DAY_MS));

export function urgencyOf(input: UrgencyInput): UrgencySignal[] {
  const now = Date.parse(input.now);
  const inbound = input.lastInboundAt ? Date.parse(input.lastInboundAt) : NaN;
  const outbound = input.lastOutboundAt ? Date.parse(input.lastOutboundAt) : NaN;
  const out: UrgencySignal[] = [];
  if (Number.isNaN(now)) return out;

  if (!Number.isNaN(inbound) && (Number.isNaN(outbound) || inbound > outbound)) {
    // The lead spoke last: they are waiting for us. Never inactive, never dormant.
    out.push({ kind: 'waiting_for_reply', days: wholeDaysBetween(inbound, now) });
  } else if (!Number.isNaN(outbound)) {
    // The agency spoke last. Only now can the lead's silence count against them.
    const silentDays = wholeDaysBetween(Number.isNaN(inbound) ? outbound : inbound, now);
    if (silentDays >= DORMANT_DAYS) out.push({ kind: 'dormant', days: silentDays });
    else if (silentDays >= INACTIVE_DAYS) out.push({ kind: 'inactive', days: silentDays });
  }

  if (input.viewingDate && /^\d{4}-\d{2}-\d{2}$/.test(input.viewingDate)) {
    const today = new Date(now);
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    if (Date.parse(`${input.viewingDate}T00:00:00Z`) < todayUtc) out.push({ kind: 'viewing_date_passed', date: input.viewingDate });
  }
  return out;
}
