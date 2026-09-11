/**
 * Conversation state for the Inbox list and cards — pure, so it can be tested.
 *
 * WHY THIS EXISTS (2026-09-11): the list said "Auto-handled" for a lead the banner directly above it
 * said "Needs a human". Two surfaces read two sources. The list only knew suggested_reply tasks
 * (dashboard_inbox filters task_type='suggested_reply'), while the banner knew escalations. An
 * automatic HOLDING reply ("let me double-check and get right back to you") was then the last
 * outbound, so the list read the conversation as handled — the opposite of the truth.
 *
 * The rule now: a lead in the Needs-a-human queue ALWAYS reads "Needs a human", whatever the list
 * would otherwise infer from its own rows. An automatic reply is never evidence that a person is no
 * longer needed.
 */

export type ConvoState = "needsHuman" | "needsYou" | "replied" | "autoHandled" | "waiting";

/** The fields of an inbox row that decide its state. InboxRow satisfies this structurally. */
export type ConvoStateInput = {
  latestInboundAt?: string | null;
  lastOutboundAt?: string | null;
  lastOutboundKind?: string | null;
};

export function resolveConvoState(
  rep: ConvoStateInput,
  pendingCount: number,
  inNeedsHumanQueue = false,
): ConvoState {
  // An open escalation outranks everything the list can infer from its own rows.
  if (inNeedsHumanQueue) return "needsHuman";
  // A buyer reply that landed AFTER our last outbound needs attention again,
  // even if no task is pending yet.
  const newInboundAfterOutbound =
    rep.latestInboundAt != null &&
    rep.lastOutboundAt != null &&
    new Date(rep.latestInboundAt).getTime() > new Date(rep.lastOutboundAt).getTime();
  if (pendingCount > 0 || newInboundAfterOutbound) return "needsYou";
  if (rep.lastOutboundKind === "operator") return "replied";
  if (rep.lastOutboundKind === "auto") return "autoHandled";
  return "waiting";
}

/** True when a person must act — these sort first and count toward the tab badge. */
export function needsAction(state: ConvoState | null | undefined): boolean {
  return state === "needsHuman" || state === "needsYou";
}
