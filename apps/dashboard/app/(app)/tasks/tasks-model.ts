import type { OpsTask } from "@/lib/api/types";

/**
 * Pure, framework-free model for the /tasks action home (F7).
 *
 * The page is the agency-facing home for EVERY open `dashboard_task` — including
 * leads that have no Inbox conversation (and so have no Inbox home), which is the
 * gap the assistant could only describe before (the "Katarzyna" case). Resolve
 * uses the existing `POST /api/v1/tasks/:id/dismiss` (audited; history kept).
 *
 * All interaction logic lives here as a pure state machine so it is testable in
 * the node vitest environment (no React render) — matching readiness-display.ts.
 * Honesty-first: a first click NEVER writes (it asks for confirmation); a write
 * fires exactly once, only on an explicit confirm; nothing is auto-resolved.
 */

// ---- per-row two-step state machine -----------------------------------------

export type RowState = "idle" | "confirming" | "saving" | "resolved" | "error";

export type RowEvent =
  | { type: "ASK" } // first click — open the confirm step (NO write)
  | { type: "CANCEL" } // back out of confirm / error
  | { type: "CONFIRM" } // explicit second click — commit (→ saving, write fires)
  | { type: "SUCCESS" } // dismiss RPC succeeded
  | { type: "FAIL"; error: string }; // dismiss RPC failed (friendly message)

export type Row = { task: OpsTask; state: RowState; error: string | null };

/** Pure transition. Guards keep the write to a single, explicit confirm. */
export function rowReducer(row: Row, ev: RowEvent): Row {
  switch (ev.type) {
    case "ASK":
      // Only from a resting state → confirming. NEVER writes.
      return row.state === "idle" || row.state === "error"
        ? { ...row, state: "confirming", error: null }
        : row;
    case "CANCEL":
      return row.state === "confirming" || row.state === "error"
        ? { ...row, state: "idle", error: null }
        : row;
    case "CONFIRM":
      // The ONLY path into `saving`, and only from `confirming` — so a repeated
      // confirm while already saving/resolved cannot trigger a second write.
      return row.state === "confirming" ? { ...row, state: "saving", error: null } : row;
    case "SUCCESS":
      return row.state === "saving" ? { ...row, state: "resolved", error: null } : row;
    case "FAIL":
      return row.state === "saving" ? { ...row, state: "error", error: ev.error } : row;
    default:
      return row;
  }
}

/** True exactly when a transition ENTERS `saving` — i.e. when the write should fire. */
export function entersSaving(prev: RowState, next: RowState): boolean {
  return prev !== "saving" && next === "saving";
}

/** A resolved task is no longer an active item that needs a decision. */
export function isActive(state: RowState): boolean {
  return state !== "resolved";
}

export function activeCount(rows: Row[]): number {
  return rows.filter((r) => isActive(r.state)).length;
}

// ---- presentation helpers (pure) --------------------------------------------

/** Plain-language "why this matters" per task type — mirrors the assistant glossary. */
export const TASK_WHY: Record<string, string> = {
  suggested_reply: "An AI-drafted reply is waiting for your approval before it sends.",
  send_issue: "A message didn't reach the buyer — retry, reply manually, or mark it resolved.",
  human_review_needed: "AIVENA wasn't sure how to handle something and is asking you to take a look.",
  super_hot_alert: "A lead is very engaged right now — worth contacting quickly.",
  viewing_booking_needed: "A buyer wants a viewing — a time still needs to be confirmed.",
  scoring_failed: "AIVENA couldn't score this lead automatically — review it manually.",
  manual_follow_up: "A follow-up AIVENA has left for a human to do.",
};

export function whyItMatters(type: string): string {
  return TASK_WHY[type] ?? "A task that needs a human to take a look.";
}

/** Compact age label for a row ("just now" / "7h old" / "11d old"). */
export function ageLabel(hours: number | null): string | null {
  if (hours === null) return null;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.round(hours)}h old`;
  return `${Math.round(hours / 24)}d old`;
}

/**
 * Inbox deep-link for a task — ONLY when the lead actually has an Inbox row
 * (`inInbox`). A non-Inbox task returns null: no dead-end "open" link; its only
 * in-app action is Resolve, right here.
 */
export function inboxHref(task: OpsTask): string | null {
  return task.inInbox && task.leadId
    ? `/approvals?leadId=${encodeURIComponent(task.leadId)}`
    : null;
}
