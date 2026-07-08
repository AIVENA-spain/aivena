/**
 * Domain → semantic tone mappers (2026 redesign). Pure + testable.
 *
 * The redesign replaces the old rainbow (rose/violet/sky/blue/orange scattered
 * inline) with ONE restrained, meaning-driven palette used by <Badge>:
 *   success (green)  = active / positive / high-intent / good
 *   warning (amber)  = needs attention / action-needed
 *   danger  (red)    = real blocker / failed / error
 *   info    (slate)  = automated / informational, no action
 *   neutral (gray)   = idle / low / unknown
 * Amber and red are reserved for attention/blockers only — never decoration.
 */

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

/** Lead intent temperature. Hot = great (green), warm = worth attention (amber),
 *  cold/idle = neutral. Never red — a lead is not an error. */
export function temperatureTone(temperature: string | null | undefined): Tone {
  switch ((temperature ?? "").trim().toLowerCase()) {
    case "hot":
    case "super_hot":
    case "very_hot":
      return "success";
    case "warm":
      return "warning";
    default:
      return "neutral";
  }
}

/** Lead lifecycle status. */
export function leadStatusTone(status: string | null | undefined): Tone {
  switch ((status ?? "").trim().toLowerCase()) {
    case "active":
    case "new":
    case "hot":
    case "super_hot":
      return "success";
    case "warm":
    case "needs_you":
    case "waiting":
    case "pending":
      return "warning";
    case "auto":
    case "auto_handled":
    case "replied":
      return "info";
    case "lost":
    case "closed":
    case "failed":
      return "neutral";
    default:
      return "neutral";
  }
}

/** Conversation state in the Inbox list. */
export function conversationStateTone(state: string | null | undefined): Tone {
  switch ((state ?? "").trim().toLowerCase()) {
    case "needsyou":
    case "needs_you":
    case "waiting":
      return "warning";
    case "replied":
    case "sent":
      return "success";
    case "autohandled":
    case "auto_handled":
    case "auto":
      return "info";
    default:
      return "neutral";
  }
}

/** Readiness / go-live signal → tone. ok=green, warn=amber, blocked=red. */
export function readinessTone(
  level: "ok" | "ready" | "pass" | "warn" | "warning" | "pending" | "blocked" | "fail" | "missing" | string | null | undefined,
): Tone {
  switch ((level ?? "").trim().toLowerCase()) {
    case "ok":
    case "ready":
    case "pass":
    case "passed":
    case "connected":
    case "active":
      return "success";
    case "warn":
    case "warning":
    case "pending":
    case "review":
      return "warning";
    case "blocked":
    case "fail":
    case "failed":
    case "missing":
    case "error":
      return "danger";
    default:
      return "neutral";
  }
}
