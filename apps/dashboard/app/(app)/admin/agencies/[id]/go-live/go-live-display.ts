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
import type { PilotStatus, ReadinessStatus } from "@/lib/api/types";

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
