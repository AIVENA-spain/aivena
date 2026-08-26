// Amanda engine — structured lead-state (design §1 layer 2 + §10 counters).
// Pure logic over the amanda_lead_state.state jsonb: timestamped, supersession-
// aware (latest value wins), rejected properties never re-pitched, filled intel
// slots never re-asked, and the active→cooling→dormant machine with its
// scheduler-enforced nudge caps. Persistence lives with the worker; this file
// is db-free and fully tested.

export interface SlotValue<T> {
  value: T;
  at: string;              // ISO timestamp of when the buyer said it
  source?: string;         // turn id / extraction id, for audit
}

export interface LeadStateData {
  budget_max?: SlotValue<number>;
  budget_min?: SlotValue<number>;
  areas?: SlotValue<string[]>;
  property_types?: SlotValue<string[]>;
  bedrooms_min?: SlotValue<number>;
  must_haves?: SlotValue<string[]>;
  timeline?: SlotValue<string>;
  financing?: SlotValue<string>;
  purpose?: SlotValue<string>;            // holiday home / relocation / investment
  trip_dates?: SlotValue<{ from: string; to: string }>;   // §11.13 trip-mode Phase A
  rejected_property_ids?: string[];
  promised_followups?: Array<{ what: string; at: string; done?: boolean }>;
}

export const INTEL_SLOTS = ['budget_max', 'areas', 'bedrooms_min', 'timeline', 'financing', 'purpose', 'trip_dates'] as const;
export type IntelSlot = (typeof INTEL_SLOTS)[number];

export type EngagementState = 'active' | 'cooling' | 'dormant';

export interface LeadStateEnvelope {
  data: LeadStateData;
  engagement: EngagementState;
  valueNudgesSent: number;               // lifetime cap 2 (§10 B4)
  lastNudgeAt: string | null;
}

export const LIFETIME_NUDGE_CAP = 2;

export function emptyLeadState(): LeadStateEnvelope {
  return { data: {}, engagement: 'active', valueNudgesSent: 0, lastNudgeAt: null };
}

/** Supersession-aware merge: a newer statement REPLACES the slot (latest budget
 *  wins); an older/equal-timestamp extraction never overwrites a newer value. */
export function mergeExtraction(state: LeadStateData, patch: Partial<LeadStateData>, atISO: string, source?: string): LeadStateData {
  const next: LeadStateData = { ...state };
  for (const [key, raw] of Object.entries(patch)) {
    if (raw === undefined || raw === null) continue;
    if (key === 'rejected_property_ids') {
      const incoming = raw as string[];
      next.rejected_property_ids = [...new Set([...(state.rejected_property_ids ?? []), ...incoming])];
      continue;
    }
    if (key === 'promised_followups') {
      next.promised_followups = [...(state.promised_followups ?? []), ...(raw as LeadStateData['promised_followups'] ?? [])];
      continue;
    }
    const existing = (state as Record<string, unknown>)[key] as SlotValue<unknown> | undefined;
    const incomingValue = (raw as SlotValue<unknown>).value !== undefined ? (raw as SlotValue<unknown>).value : raw;
    if (existing && existing.at >= atISO) continue;         // stale extraction never wins
    (next as Record<string, unknown>)[key] = { value: incomingValue, at: atISO, source } satisfies SlotValue<unknown>;
  }
  return next;
}

/** Deterministic re-ask blocker (§10 B2): a filled slot is never asked again. */
export function slotFilled(state: LeadStateData, slot: IntelSlot): boolean {
  const v = state[slot] as SlotValue<unknown> | undefined;
  if (!v) return false;
  const value = v.value;
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '';
}

export function askableSlots(state: LeadStateData): IntelSlot[] {
  return INTEL_SLOTS.filter((s) => !slotFilled(state, s));
}

/** Rejected-property filter (§10 B5): applied to EVERY suggestion payload. */
export function filterRejected<T extends { id: string }>(state: LeadStateData, properties: T[]): T[] {
  const rejected = new Set(state.rejected_property_ids ?? []);
  return properties.filter((p) => !rejected.has(p.id));
}

// ── Disengagement score (§10 B3) — deterministic, per turn ───────────────────
export interface DisengagementSignals {
  currentGapMs: number;                  // since the buyer's last message
  buyerMedianGapMs: number | null;       // their own historical median
  lastTwoReplies: string[];              // most recent buyer messages, newest last
  hadLongerBaseline: boolean;            // earlier replies were substantive
  declinedSuggestionNoCounter: boolean;
}

const CLOSURE_TOKENS = new Set(['ok', 'okay', 'vale', 'thanks', 'thank you', 'gracias', 'we\'ll see', 'ya veremos', '👍', 'ok!', 'ok.']);

export function disengagementScore(sig: DisengagementSignals): number {
  let score = 0;
  if (sig.buyerMedianGapMs !== null && sig.currentGapMs > 3 * sig.buyerMedianGapMs && sig.currentGapMs > 8 * 3600_000) score += 2;
  const brevityCollapse = sig.hadLongerBaseline
    && sig.lastTwoReplies.length >= 2
    && sig.lastTwoReplies.every((r) => r.trim().split(/\s+/).length <= 3);
  if (brevityCollapse) score += 2;
  const lastReply = sig.lastTwoReplies[sig.lastTwoReplies.length - 1]?.trim().toLowerCase() ?? '';
  if (CLOSURE_TOKENS.has(lastReply)) score += 1;
  if (sig.declinedSuggestionNoCounter) score += 1;
  return score;
}

export const COOLING_THRESHOLD = 3;

// ── Re-engagement law (§10 B4) — the scheduler consults this, never the model ─
export interface NudgeGate {
  engagement: EngagementState;
  valueNudgesSent: number;
  lastBuyerMessageAtMs: number;
  nowMs: number;
  hasValuePayload: boolean;              // new match / price change / photos / promised answer
}

export function nudgeAllowed(g: NudgeGate): { allowed: boolean; reason: string } {
  if (g.engagement !== 'cooling') return { allowed: false, reason: 'not_cooling' };
  if (g.valueNudgesSent >= LIFETIME_NUDGE_CAP) return { allowed: false, reason: 'lifetime_cap' };
  if (!g.hasValuePayload) return { allowed: false, reason: 'no_value_payload' };
  if (g.nowMs - g.lastBuyerMessageAtMs < 24 * 3600_000) return { allowed: false, reason: 'too_soon' };
  return { allowed: true, reason: 'ok' };
}
