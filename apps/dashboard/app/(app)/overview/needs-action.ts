/**
 * What Overview's "Needs Action" counts, and which activity rows happened while a lead was waiting
 * for a person — pure, so it can be tested.
 *
 * WHY THIS EXISTS (2026-09-11): Overview said "Needs Action 0" and "Nothing waiting" while the Inbox
 * banner said "Needs a human (1)". The tile and the table read dashboard_needs_you, which only knows
 * suggested_reply drafts; the escalation lives in the handoff queue. Same bug class as the
 * "Auto-handled" badge fixed earlier that day: two surfaces, two sources. Overview now reads the SAME
 * queue the banner reads and counts both. The permanent fix is one source for "what needs the agency"
 * that every surface reads.
 */

export type HandoffLite = { lead_id: string; needs_human_since: string };

/** Parses ISO and Postgres-style ("2026-08-31 15:07:15.97+00") timestamps. NaN when unreadable. */
function toMs(value: string): number {
  const t = Date.parse(value);
  if (!Number.isNaN(t)) return t;
  return Date.parse(value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
}

/**
 * Ready replies plus every Needs-a-human lead not already counted as a ready reply.
 * Null when either source could not be read — the tile then shows a dash, never a false 0.
 */
export function needsActionCount(
  readyReplies: number | null | undefined,
  readyReplyLeadIds: readonly string[],
  handoffs: readonly HandoffLite[] | null,
): number | null {
  if (readyReplies == null || handoffs == null) return null;
  const counted = new Set(readyReplyLeadIds);
  const waiting = new Set(handoffs.map((h) => h.lead_id).filter((id) => !counted.has(id)));
  return readyReplies + waiting.size;
}

/**
 * Activity rows that happened at or after their lead was handed to a person. An automatic reply sent
 * while a lead waits (a holding reply: "let me double-check and get right back to you") is not a
 * resolution, so those rows carry the Needs-a-human badge.
 */
export function rowsWaitingOnHuman(
  rows: readonly { eventId: string; leadId: string | null; occurredAt: string }[],
  handoffs: readonly HandoffLite[] | null,
): Set<string> {
  const since = new Map<string, number>();
  for (const h of handoffs ?? []) {
    const t = toMs(h.needs_human_since);
    if (!Number.isNaN(t)) since.set(h.lead_id, t);
  }
  const out = new Set<string>();
  for (const r of rows) {
    const s = r.leadId ? since.get(r.leadId) : undefined;
    if (s !== undefined && toMs(r.occurredAt) >= s) out.add(r.eventId);
  }
  return out;
}
