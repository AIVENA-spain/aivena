import type { ReplyLanes } from "@/lib/api/types";

/**
 * Settings safety helpers — shared by the automation control (client) and the
 * setup checklist (server). Pure, no React/hooks, so both boundaries can import.
 */

const TEMPS = ["cold", "warm", "hot", "super_hot"] as const;

/**
 * True when ANY lead temperature (or the default lane) is set to `auto_send` —
 * i.e. AIVENA would send replies to clients without human approval. This is the
 * "unsafe for pilot" condition that drives the warning banner + checklist state.
 */
export function hasAutoSend(lanes: ReplyLanes | undefined): boolean {
  if (!lanes) return false;
  if (lanes.default_lane === "auto_send") return true;
  const t = lanes.by_temperature ?? {};
  return TEMPS.some((k) => t[k] === "auto_send");
}

/** True when EVERY temperature is auto-send ("everything sends automatically"). */
export function isFullAutoSend(lanes: ReplyLanes | undefined): boolean {
  if (!lanes) return false;
  if (lanes.default_lane === "auto_send") return true;
  const t = lanes.by_temperature ?? {};
  return TEMPS.every((k) => t[k] === "auto_send");
}
