/**
 * Readiness presentation helpers — PURE, React-free, so they unit-test in the
 * node vitest env. They turn the `GET /api/v1/readiness` model into display
 * primitives (chip label + tone, progress summary, ordering, provider names).
 *
 * The fixed chrome (status chip labels, provider names, headings) is localized
 * via next-intl (settings.readiness.*): these functions return the i18n key
 * SUFFIX and the components resolve it with t(). The per-item dynamic copy
 * (item.label/uiCopy, provider.detail) still comes from the API in English —
 * the API is the source of truth; localizing that is the remaining D9 step.
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

/** i18n key suffix for the status chip → settings.readiness.status.<key>. */
export function statusLabelKey(s: ReadinessStatus): string {
  switch (s) {
    case "ready": return "ready";
    case "live_but_unproven": return "inProgress";
    case "manual_fallback": return "manual";
    case "missing": return "actionNeeded";
    case "needs_decision": return "needsDecision";
    case "blocked": return "waitingAivena";
    case "unavailable": return "unavailable";
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

/** i18n key suffix for the provider name → settings.readiness.provider.<key>. */
export function providerNameKey(p: ReadinessProviderId): string {
  switch (p) {
    case "email": return "email";
    case "whatsapp": return "whatsapp";
    case "whatsapp_templates_multilang": return "multilang";
    case "calendar": return "calendar";
    case "property_feed": return "feed";
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
