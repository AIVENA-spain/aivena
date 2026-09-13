import type { ReplyLanes } from "@/lib/api/types";

/**
 * Settings safety helpers — shared by the automation control (client) and the
 * setup checklist (server). Pure, no React/hooks, so both boundaries can import.
 */

/**
 * True when the default reply lane is `auto_send`.
 *
 * Per-temperature lanes (`by_temperature`) are deliberately NOT read (Christian, 2026-09-13): no code path sends,
 * queues, alerts or follows up on a lead's temperature, and the per-temperature picker was removed in June 2026. Once
 * lead scores are live, a temperature-driven "sends automatically" claim would look believable while nothing of the sort
 * happens. Temperature must never control sending, so it must not appear to either. (The never-used isFullAutoSend,
 * which also read temperatures, was removed with it.)
 */
export function hasAutoSend(lanes: ReplyLanes | undefined): boolean {
  return lanes?.default_lane === "auto_send";
}
