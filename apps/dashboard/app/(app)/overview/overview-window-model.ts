/**
 * Overview WhatsApp-window awareness (Bug 1).
 *
 * The Overview "needs you" rows come from `dashboard_needs_you`, which returns the
 * raw `suggested_reply` draft. WhatsApp has a 24h send window: outside it, a free-text
 * property draft is NOT sendable — the honest move is the approved check-in / re-engage,
 * which lives on the window-aware Inbox (`/approvals`). This pure helper decides, per
 * row, whether the draft may be presented as sendable, so Overview and Inbox agree.
 *
 * Single source of truth for "is the window open" is the RPC column
 * `whatsapp_window_open` (computed identically to `dashboard_lead_whatsapp_state`).
 * We never recompute the window client-side.
 */

export type ReplyWindowState = {
  /** True only for a WhatsApp lead whose 24h window is closed (or unknown). */
  windowClosed: boolean;
  /** True when the free-text draft may be presented as directly sendable. */
  canSendDraft: boolean;
  /** Coarse label for the UI: non-WhatsApp has no window. */
  label: "open" | "closed" | "none";
};

export function isWhatsappChannel(channel: string | null | undefined): boolean {
  return (channel ?? "").trim().toLowerCase() === "whatsapp";
}

/**
 * Decide how the Overview should treat a needs-you row's draft.
 *
 * - Non-WhatsApp (email / web / phone): no window → always sendable ("none").
 * - WhatsApp, window OPEN: sendable ("open").
 * - WhatsApp, window CLOSED or unknown (null): NOT sendable → re-engage ("closed").
 *   Unknown is treated as closed on purpose (fail-safe): never present a property
 *   draft as sendable when we cannot confirm the window is open.
 */
export function replyWindowState(
  channel: string | null | undefined,
  whatsappWindowOpen: boolean | null | undefined,
): ReplyWindowState {
  if (!isWhatsappChannel(channel)) {
    return { windowClosed: false, canSendDraft: true, label: "none" };
  }
  const open = whatsappWindowOpen === true;
  return {
    windowClosed: !open,
    canSendDraft: open,
    label: open ? "open" : "closed",
  };
}
