/**
 * Readiness presentation helpers — PURE, React-free, so they unit-test in the
 * node vitest env. They turn the `GET /api/v1/readiness` model into display
 * primitives (chip label + tone, progress summary, ordering, provider names).
 *
 * Copy here is the English source of truth (the API already returns English
 * `label`/`uiCopy`/`detail`). Localizing this surface is a tracked follow-up
 * (workboard D9) — the right fix is the API returning localized copy.
 *
 * Honesty: nothing is invented. `unavailable`/`blocked` are shown as-is; there
 * is no mapping that turns an unproven/missing signal into a "ready" chip.
 */
import type {
  ReadinessItem,
  ReadinessProviderId,
  ReadinessStatus,
} from "@/lib/api/types";

export type ChipTone = "good" | "warn" | "info" | "muted";

/** Short status chip label (English data). */
export function statusLabel(s: ReadinessStatus): string {
  switch (s) {
    case "ready": return "Ready";
    case "live_but_unproven": return "In progress";
    case "manual_fallback": return "Handled by AIVENA";
    case "missing": return "Action needed";
    case "needs_decision": return "Needs a decision";
    case "blocked": return "Waiting on AIVENA";
    case "unavailable": return "Status unavailable";
  }
}

export function statusTone(s: ReadinessStatus): ChipTone {
  switch (s) {
    case "ready": return "good";
    case "manual_fallback": return "info";
    case "live_but_unproven":
    case "needs_decision":
    case "missing": return "warn";
    case "blocked":
    case "unavailable": return "muted";
  }
}

/** A status counts toward "done" only if genuinely ready or an accepted manual fallback. */
export function isDone(s: ReadinessStatus): boolean {
  return s === "ready" || s === "manual_fallback";
}

export function providerName(p: ReadinessProviderId): string {
  switch (p) {
    case "email": return "Email";
    case "whatsapp": return "WhatsApp";
    case "whatsapp_templates_multilang": return "Multilingual templates";
    case "calendar": return "Calendar";
    case "property_feed": return "Property catalog";
  }
}

// Order items so what-needs-attention floats up; ready/handled sink.
const STATUS_RANK: Record<ReadinessStatus, number> = {
  missing: 0,
  needs_decision: 1,
  live_but_unproven: 2,
  blocked: 3,
  unavailable: 4,
  manual_fallback: 5,
  ready: 6,
};

export function orderItems(items: ReadinessItem[]): ReadinessItem[] {
  return [...items].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
}

export type ReadinessSummary = {
  /** Agency/system-owned items the agency can actually progress. */
  agencyItems: ReadinessItem[];
  /** AIVENA-owned items (go-live, agent seats, multilingual templates) — surfaced, not counted against the agency. */
  aivenaItems: ReadinessItem[];
  done: number;
  total: number;
  pct: number;
};

/**
 * Split items into the agency's own progress vs what AIVENA handles, and compute
 * the headline progress over the agency-owned set only — so an admin-only item
 * (e.g. lifecycle.go_live, always blocked in Phase 1) never makes the agency's
 * bar look stuck.
 */
export function summarize(items: ReadinessItem[]): ReadinessSummary {
  const agencyItems = orderItems(items.filter((i) => i.owner !== "aivena"));
  const aivenaItems = orderItems(items.filter((i) => i.owner === "aivena"));
  const total = agencyItems.length;
  const done = agencyItems.filter((i) => isDone(i.status)).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return { agencyItems, aivenaItems, done, total, pct };
}
