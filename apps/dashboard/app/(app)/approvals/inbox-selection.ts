/**
 * Which conversation the Inbox opens first — pure, so it can be tested.
 *
 * WHY THIS EXISTS (2026-09-18): /approvals?leadId=<id> for a lead that was not
 * in the list silently fell back to the FIRST buyer row. On the demo agency that
 * was another person's WhatsApp conversation, so "Open in Inbox" from Matches,
 * Operations, Overview or Tasks could put a Send button under the wrong client.
 *
 * The rule now: a link that NAMES a lead or a task opens exactly that one, or
 * opens nothing and says so. Only a bare /approvals picks a default.
 */

/** Rows opened directly (no task behind them) carry this id prefix. */
const DIRECT_PREFIX = "lead:";

export function directTaskId(leadId: string): string {
  return `${DIRECT_PREFIX}${leadId}`;
}

export function isDirectTaskId(taskId: string | null | undefined): boolean {
  return typeof taskId === "string" && taskId.startsWith(DIRECT_PREFIX);
}

export function leadIdOfDirect(taskId: string): string {
  return taskId.slice(DIRECT_PREFIX.length);
}

/** The URL that reopens this row after a reload (a direct row by its lead). */
export function inboxUrlFor(taskId: string): string {
  return isDirectTaskId(taskId)
    ? `/approvals?leadId=${encodeURIComponent(leadIdOfDirect(taskId))}`
    : `/approvals?lead=${encodeURIComponent(taskId)}`;
}

export type InitialSelection =
  /** Open this row. */
  | { kind: "open"; taskId: string }
  /** The link named a lead or task that is not here: open NOTHING. */
  | { kind: "unresolved" }
  /** No link: the Inbox's normal default applies. */
  | { kind: "default" };

export function resolveInitialSelection(
  rows: ReadonlyArray<{ taskId: string; leadId: string }>,
  initialTaskId: string | undefined,
  initialLeadId: string | undefined,
): InitialSelection {
  if (initialTaskId) {
    return rows.some((r) => r.taskId === initialTaskId)
      ? { kind: "open", taskId: initialTaskId }
      : { kind: "unresolved" };
  }
  if (initialLeadId) {
    const row = rows.find((r) => r.leadId === initialLeadId);
    return row ? { kind: "open", taskId: row.taskId } : { kind: "unresolved" };
  }
  return { kind: "default" };
}

/** Why a named link opened nothing — shown as a notice, never replaced by another client. */
export type DirectNotice =
  | { kind: "notFound" }
  | { kind: "failed" }
  | { kind: "noContact"; name: string | null };
