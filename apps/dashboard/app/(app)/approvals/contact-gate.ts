import type { ContactReadiness } from "@/lib/api/types";

/**
 * Contact-gate derivation — the pure decision layer between
 * `get_lead_contact_readiness` (deterministic DB truth) and the composer UI.
 *
 * Contract (2026-08-12 slice): AIVENA must never show or enable a contact
 * action that cannot actually work. The RPC is authoritative; this maps its
 * `recommended_action` onto exactly one UI mode. Rules baked in:
 *  - opted_out / blocked → everything disabled (even with an open window).
 *  - provider / phone gates → everything disabled, with the true reason.
 *  - window closed + approved lead-language template → check-in enabled.
 *  - window closed + NO approved lead-language template → check-in hidden,
 *    missing-template reason shown. NEVER "try again": the English floor is
 *    OFF by design (2026-07-04), so no English fallback is offered either.
 *  - re-engage cooldown → check-in visible but disabled until the date.
 *  - readiness unavailable (fetch failed) → FAIL CLOSED for the check-in
 *    (`unverified`), while an open-window normal reply keeps working — a
 *    transient readiness hiccup must not block legal replies, and the send
 *    RPCs still guard server-side.
 * Non-WhatsApp channels are untouched (`normal`): readiness is WhatsApp truth.
 */
export type ContactGate =
  | { kind: "normal" }
  | { kind: "checkin" }
  | { kind: "checkin_cooldown"; until: string | null }
  | {
      kind: "blocked";
      reason: "no_template";
      /** Normalized template language the lead needs (e.g. "nb"). */
      language: string;
      approvedLanguages: string[];
    }
  | {
      kind: "blocked";
      reason: "opted_out" | "provider" | "phone" | "template_unregistered";
    }
  | { kind: "unverified" };

export function deriveContactGate(
  readiness: ContactReadiness | null,
  windowClosed: boolean,
  isWhatsapp: boolean,
): ContactGate {
  if (!isWhatsapp) return { kind: "normal" };
  if (!readiness || readiness.ok !== true) {
    // No verified truth: fail closed for the check-in, keep open-window
    // replies on the existing window gate (server still guards every send).
    return windowClosed ? { kind: "unverified" } : { kind: "normal" };
  }
  switch (readiness.recommended_action) {
    case "do_not_contact":
      return { kind: "blocked", reason: "opted_out" };
    case "fix_whatsapp_provider_setup":
      return { kind: "blocked", reason: "provider" };
    case "add_valid_phone_number":
      return { kind: "blocked", reason: "phone" };
    case "send_normal_reply":
      // The two truths disagreeing (window-state says closed, readiness says a
      // normal reply is fine — a sub-second 24h-boundary race between the two
      // RPC snapshots) must not render a dead check-in UI: fail to "unverified"
      // and let the next poll reconcile.
      return windowClosed ? { kind: "unverified" } : { kind: "normal" };
    case "wait_reengagement_cooldown":
      return {
        kind: "checkin_cooldown",
        until: readiness.reengagement_cooldown_until ?? null,
      };
    case "send_template_checkin":
      return { kind: "checkin" };
    case "register_agency_template":
      return { kind: "blocked", reason: "template_unregistered" };
    case "do_not_send_get_template_approved":
      return {
        kind: "blocked",
        reason: "no_template",
        language: readiness.lead_language_normalized ?? "",
        approvedLanguages: readiness.approved_template_languages ?? [],
      };
    default:
      // Unknown future action codes: fail closed when the window is closed.
      return windowClosed ? { kind: "unverified" } : { kind: "normal" };
  }
}

/** True when the gate forbids ANY send (freeform included, window open or not). */
export function gateBlocksAllSends(gate: ContactGate): boolean {
  return (
    gate.kind === "blocked" &&
    (gate.reason === "opted_out" ||
      gate.reason === "provider" ||
      gate.reason === "phone")
  );
}
