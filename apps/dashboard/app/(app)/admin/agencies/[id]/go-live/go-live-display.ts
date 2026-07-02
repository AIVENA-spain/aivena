/**
 * Go-Live control — PURE, React-free logic + English labels (the admin surface is
 * English-only, brief §12, so no i18n here). Unit-tested in the node vitest env.
 *
 * Honesty rules baked in:
 *  - The four manual attestations are a HARD gate for `live` and are NEVER
 *    override-able (override only bypasses SOFT readiness gaps).
 *  - `canSubmit` is a client-side ENABLEMENT hint only — it decides whether the
 *    button is pressable, never whether the agency is "ready". The server's
 *    /go-live 422 (blockedBy + missingAttestations) is always the source of truth.
 */
import type { PilotStatus, ReadinessStatus, ReadinessProviderId } from "@/lib/api/types";

/** English chip text for a readiness status (admin panel; mirrors the honest model). */
export const STATUS_LABEL: Record<ReadinessStatus, string> = {
  ready: "Ready",
  live_but_unproven: "Configured — not proven",
  manual_fallback: "Manual fallback",
  missing: "Action needed",
  needs_decision: "Needs a decision",
  blocked: "Waiting on AIVENA",
  unavailable: "Unavailable",
};

export const PILOT_STATUS_LABEL: Record<PilotStatus, string> = {
  setup: "Setup",
  ready_for_pilot: "Ready for pilot",
  live: "Live",
  paused: "Paused",
  blocked: "Blocked",
};

/** The four manual go-live gates — hard-required for `live`, never override-able. */
export type AttestationKey =
  | "autonomo_corrected"
  | "legal_pages_published"
  | "dpa_consent_live"
  | "test_data_cleaned";

export const ATTESTATIONS: { key: AttestationKey; label: string; help: string }[] = [
  {
    key: "autonomo_corrected",
    label: "Autónomo status corrected",
    help: "The agency's autónomo / legal-entity blocker is resolved.",
  },
  {
    key: "legal_pages_published",
    label: "Legal pages published",
    help: "Privacy policy, terms, and legal notice are live on the agency's site.",
  },
  {
    key: "dpa_consent_live",
    label: "DPA & consent live",
    help: "The data-processing agreement and consent capture are in force.",
  },
  {
    key: "test_data_cleaned",
    label: "Test data cleaned",
    help: "Demo / test leads and content have been cleared from the agency.",
  },
];

export type Attestations = Partial<Record<AttestationKey, boolean>>;

/**
 * The self-referential readiness item the SERVER's go-live gate strips out
 * (evaluateGoLive: `configBlockers = blockedBy.filter(id => id !== 'lifecycle.go_live')`).
 * `lifecycle.go_live` is `blocked`/`live_but_unproven` for every not-yet-live agency, so
 * it is ALWAYS in `goLive.blockedBy` — showing it as a blocker would make even a fully
 * ready agency look stuck, contradicting the decision. Keep the panel in lock-step.
 */
export const SELF_BLOCKER_ID = "lifecycle.go_live";

/** Blockers the operator can actually act on — mirrors the server's configBlockers. */
export function visibleBlockers(blockedBy: string[]): string[] {
  return blockedBy.filter((id) => id !== SELF_BLOCKER_ID);
}

/**
 * Admin-facing, specific blocker labels (issue 2). The API item labels are
 * category-level ("Agency name", "Owner", "Timezone") which reads as vague on
 * the go-live page — the staff member can SEE an agency name and some users, so
 * "Agency name" makes them wonder what's actually missing. These restate the
 * real gap. The live per-item action text (item.uiCopy) is shown alongside as
 * the help line, so nothing is invented — the reason still comes from the model.
 */
export const ADMIN_BLOCKER_LABEL: Record<string, string> = {
  "identity.name": "Legal agency name not confirmed",
  "identity.logo": "Logo not uploaded",
  "identity.colors": "Brand colours not set",
  "identity.phone": "Contact phone missing",
  "identity.website": "Agency website not confirmed (placeholder)",
  "identity.areas": "Service area not set",
  "identity.languages": "Languages served not confirmed",
  "identity.timezone": "Timezone needs confirmation",
  "identity.working_hours": "Working hours not set",
  "identity.tone": "Follow-up tone not set",
  "posture.approval_first": "Automation safety posture not confirmed",
  "team.owner": "Agency owner not confirmed",
  "team.agents": "Agent seats pending (AIVENA-handled)",
  "consent.captured": "Consent capture not proven",
};

/** Specific admin label for a blocker id, falling back to the API label. */
export function blockerLabel(id: string, apiLabel: string): string {
  return ADMIN_BLOCKER_LABEL[id] ?? apiLabel;
}

// ── Provider/config plain language (issue 3) ─────────────────────────────────

/**
 * The readiness ITEM id for a provider state. The API is asymmetric for one
 * provider: the item id is `provider.templates_multilang` but the provider-state
 * id is `whatsapp_templates_multilang` — normalize that so the panel can join the
 * provider state (plain copy + technical detail) onto its item row.
 */
export function providerItemId(p: ReadinessProviderId): string {
  const suffix = p === "whatsapp_templates_multilang" ? "templates_multilang" : p;
  return `provider.${suffix}`;
}

export function providerDisplayName(p: ReadinessProviderId): string {
  switch (p) {
    case "email": return "Email sending";
    case "whatsapp": return "WhatsApp sending";
    case "whatsapp_templates_multilang": return "Multilingual WhatsApp templates";
    case "calendar": return "Calendar (viewings)";
    case "property_feed": return "Property catalog / feed";
  }
}

/** Plain sentence from a readiness status (for providers whose detail isn't already prose). */
function statusSentence(status: ReadinessStatus, name: string): string {
  switch (status) {
    case "ready": return `${name} is ready.`;
    case "live_but_unproven": return `${name} is set up, but not fully proven yet.`;
    case "manual_fallback": return `${name} is handled manually for now.`;
    case "missing": return `${name} is not set up yet.`;
    case "needs_decision": return `${name} needs a decision.`;
    case "blocked": return `${name} is waiting on AIVENA.`;
    case "unavailable": return `${name} status isn't available yet.`;
  }
}

/** Defensive parse of a `key=true|false` token from a raw detail string. */
function boolToken(detail: string, key: string): boolean | undefined {
  const m = new RegExp(`${key}=(true|false)`).exec(detail);
  return m ? m[1] === "true" : undefined;
}

/**
 * Non-developer-readable main line for a provider (issue 3). WhatsApp's raw
 * `sender_ready=…, channel_enabled=…, send_proven=…` string is turned into a
 * sentence; other providers already ship prose `detail`, so we use it (mapping a
 * bare "unavailable" to a friendly line). The raw `detail`/`source` still show,
 * but only behind a collapsed "Technical details" disclosure in the panel.
 */
export function providerPlainText(p: {
  provider: ReadinessProviderId;
  status: ReadinessStatus;
  detail: string;
}): string {
  const name = providerDisplayName(p.provider);
  if (p.provider === "whatsapp") {
    const sender = boolToken(p.detail, "sender_ready");
    if (sender === undefined) return statusSentence(p.status, name); // RPC not deployed / non-structured
    if (!sender) return "WhatsApp sender is not connected yet.";
    const proven = boolToken(p.detail, "send_proven");
    const channel = boolToken(p.detail, "channel_enabled");
    const clauses = [
      "WhatsApp sender is connected",
      proven ? "a test send has been proven" : "a test send is not proven yet",
      channel ? "and the channel is enabled" : "but the channel isn't enabled yet",
    ];
    return `${clauses[0]}, ${clauses[1]}, ${clauses[2]}.`;
  }
  const detail = p.detail?.trim();
  if (!detail || detail.toLowerCase() === "unavailable") {
    return statusSentence(p.status, name);
  }
  return detail;
}

// ── Grouped sections + top summary (issue B — cut the noisy flat wall) ────────

export type GoLiveSection = "setup" | "providers" | "legal" | "safety";

export const SECTION_ORDER: GoLiveSection[] = ["setup", "providers", "legal", "safety"];

export const SECTION_LABEL: Record<GoLiveSection, string> = {
  setup: "Agency setup",
  providers: "Providers",
  legal: "Legal & consent",
  safety: "Safety / manual checks",
};

/** Which section a readiness item id belongs to (posture/lifecycle are "safety",
 *  not "setup", even though the API area letter groups them under A/C). */
const ITEM_SECTION: Record<string, GoLiveSection> = {
  "identity.name": "setup",
  "identity.logo": "setup",
  "identity.colors": "setup",
  "identity.phone": "setup",
  "identity.website": "setup",
  "identity.areas": "setup",
  "identity.languages": "setup",
  "identity.timezone": "setup",
  "identity.working_hours": "setup",
  "identity.tone": "setup",
  "team.owner": "setup",
  "team.agents": "setup",
  "provider.email": "providers",
  "provider.whatsapp": "providers",
  "provider.templates_multilang": "providers",
  "provider.calendar": "providers",
  "provider.property_feed": "providers",
  "consent.captured": "legal",
  "posture.approval_first": "safety",
  "lifecycle.go_live": "safety",
};

export function sectionForItem(id: string): GoLiveSection {
  return ITEM_SECTION[id] ?? "setup";
}

/** Top-of-page verdict. `not_ready`/`ready` are the setup-phase verdicts (based on
 *  real, self-blocker-filtered readiness); paused/blocked/live reflect the lifecycle. */
export type GoLiveState = "live" | "paused" | "blocked" | "ready" | "not_ready";

export const GO_LIVE_STATE_LABEL: Record<GoLiveState, string> = {
  live: "Live",
  paused: "Paused",
  blocked: "Blocked",
  ready: "Ready to progress",
  not_ready: "Not ready",
};

export function goLiveState(pilot: PilotStatus | null, blockerCount: number): GoLiveState {
  if (pilot === "live") return "live";
  if (pilot === "paused") return "paused";
  if (pilot === "blocked") return "blocked";
  return blockerCount === 0 ? "ready" : "not_ready";
}

/** The lifecycle transitions the control offers (maps 1:1 to PILOT_TARGETS on the API). */
export type PilotTarget = PilotStatus;

export const TARGETS: {
  key: PilotTarget;
  label: string;
  tone: "brand" | "warn" | "neutral";
  blurb: string;
}[] = [
  {
    key: "ready_for_pilot",
    label: "Mark ready for pilot",
    tone: "brand",
    blurb: "Readiness is good enough to start a controlled pilot.",
  },
  {
    key: "live",
    label: "Go live",
    tone: "brand",
    blurb: "Fully live — requires every manual attestation below.",
  },
  { key: "paused", label: "Pause", tone: "warn", blurb: "Temporarily halt the agency's pilot." },
  {
    key: "blocked",
    label: "Block",
    tone: "warn",
    blurb: "Block the agency (compliance / risk hold).",
  },
  { key: "setup", label: "Back to setup", tone: "neutral", blurb: "Return to the setup phase." },
];

/** Attestations are relevant/required only when going `live`. */
export function attestationsRequired(target: PilotTarget): boolean {
  return target === "live";
}

/** Override (bypass SOFT readiness gaps) only makes sense for a promotion. */
export function overrideApplicable(target: PilotTarget): boolean {
  return target === "ready_for_pilot" || target === "live";
}

/** A written reason is required for pause, block, or any override use. */
export function reasonRequired(target: PilotTarget, override: boolean): boolean {
  return target === "paused" || target === "blocked" || override;
}

export function allAttestationsChecked(a: Attestations): boolean {
  return ATTESTATIONS.every((x) => a[x.key] === true);
}

/**
 * Client-side button enablement — NOT a readiness verdict. Returns false until
 * the operator has supplied everything the server will require, so we don't fire
 * a request that's guaranteed to 422; but a `true` here never means "ready", and
 * the server can still reject with blockedBy/missingAttestations.
 */
export function canSubmit(args: {
  target: PilotTarget | null;
  attestations: Attestations;
  override: boolean;
  reason: string;
  submitting: boolean;
}): boolean {
  const { target, attestations, override, reason, submitting } = args;
  if (!target || submitting) return false;
  if (attestationsRequired(target) && !allAttestationsChecked(attestations)) return false;
  if (reasonRequired(target, override) && reason.trim().length === 0) return false;
  return true;
}
