import { describe, expect, it } from "vitest";
import { deriveContactGate, gateBlocksAllSends } from "./contact-gate";
import type { ContactReadiness } from "@/lib/api/types";

/**
 * Proof harness for the contact gate — the payloads below are the REAL
 * `get_lead_contact_readiness` outputs captured from prod on 2026-08-12
 * (post-apply proof of ledger 20260812100927), trimmed to the fields the gate
 * reads plus the fields the reason panels render. The opted_out / blocked and
 * window-open payloads mirror the controlled rolled-back DB proofs from the
 * same session (identical shapes, states that had no durable live rows).
 */

// Marte Brenno — window closed, Norwegian, NO approved nb template, last
// check-in failed template_language_not_approved. The incident lead.
const MARTE: ContactReadiness = {
  ok: true,
  version: "v1",
  template_key: "agency_followup_v1",
  lead_language: "no",
  lead_language_normalized: "nb",
  opt_in_status: "opted_in",
  channel: "whatsapp",
  whatsapp_window: { state: "closed", open: false, expires_at: null },
  last_inbound_at: "2026-07-16T14:30:43.12+00:00",
  last_successful_outbound_at: "2026-07-08T08:54:03.739+00:00",
  last_failed_outbound_at: "2026-08-12T09:04:36.615+00:00",
  last_failed_reason: "template_language_not_approved",
  provider: { ready: true, state: "ready" },
  normal_reply_allowed: false,
  template_checkin_required: true,
  approved_template_in_lead_language: false,
  approved_template_languages: ["en"],
  recommended_action: "do_not_send_get_template_approved",
  blocked_reason: "no_approved_template_in_lead_language",
  explanation:
    "The reply window is closed and there is no approved nb check-in template (approved languages: en). Sending will always fail — do not retry. Options: get the nb template approved, or wait for the lead to reply. The pipeline is strict-language by design and will not substitute another language. Last send attempt failed at 2026-08-12 09:04 UTC with reason: template_language_not_approved. That failure is a configuration gap that is still present — retrying will not help until it is fixed.",
  phone_valid: true,
  template_registered_for_agency: true,
  reengagement_cooldown_until: null,
};

// Sarah Whitcombe — EN lead, approved EN template, but her stored phone is not
// E.164 (+44 with spaces) → the honest earlier gate.
const SARAH: ContactReadiness = {
  ok: true,
  lead_language: "en",
  lead_language_normalized: "en",
  opt_in_status: "opted_in",
  whatsapp_window: { state: "never_opened", open: false, expires_at: null },
  provider: { ready: true, state: "ready" },
  normal_reply_allowed: false,
  template_checkin_required: true,
  approved_template_in_lead_language: true,
  approved_template_languages: ["en"],
  recommended_action: "add_valid_phone_number",
  blocked_reason: "lead_missing_valid_phone",
  phone_valid: false,
  template_registered_for_agency: true,
  last_failed_reason: null,
  reengagement_cooldown_until: null,
};

// wf1v2 test-agency lead — agency has no WhatsApp provider configured.
const PROVIDER_MISSING: ContactReadiness = {
  ok: true,
  lead_language: null,
  lead_language_normalized: "en",
  opt_in_status: "unknown",
  whatsapp_window: { state: "never_opened", open: false, expires_at: null },
  provider: { ready: false, state: "not_configured" },
  normal_reply_allowed: false,
  template_checkin_required: true,
  approved_template_in_lead_language: true,
  approved_template_languages: ["en"],
  recommended_action: "fix_whatsapp_provider_setup",
  blocked_reason: "whatsapp_not_configured",
  phone_valid: false,
  template_registered_for_agency: false,
  last_failed_reason: null,
  reengagement_cooldown_until: null,
};

// Controlled rolled-back proof shape: opted_out (blocked is identical).
const OPTED_OUT: ContactReadiness = {
  ok: true,
  opt_in_status: "opted_out",
  recommended_action: "do_not_contact",
  blocked_reason: "lead_opted_out_or_blocked",
  normal_reply_allowed: false,
  template_checkin_required: false,
};

// English lead, valid phone, window closed, approved EN template → sendable.
const CHECKIN_OK: ContactReadiness = {
  ok: true,
  lead_language_normalized: "en",
  whatsapp_window: { state: "closed", open: false, expires_at: null },
  provider: { ready: true, state: "ready" },
  normal_reply_allowed: false,
  template_checkin_required: true,
  approved_template_in_lead_language: true,
  approved_template_languages: ["en"],
  recommended_action: "send_template_checkin",
  blocked_reason: null,
  phone_valid: true,
  template_registered_for_agency: true,
  reengagement_cooldown_until: null,
};

// Window open → normal reply.
const WINDOW_OPEN: ContactReadiness = {
  ok: true,
  whatsapp_window: { state: "open", open: true, expires_at: "2026-08-13T09:00:00Z" },
  provider: { ready: true, state: "ready" },
  normal_reply_allowed: true,
  template_checkin_required: false,
  recommended_action: "send_normal_reply",
  blocked_reason: null,
  phone_valid: true,
};

// Cooldown — template fine, but a check-in already went out < 7 days ago.
const COOLDOWN: ContactReadiness = {
  ok: true,
  recommended_action: "wait_reengagement_cooldown",
  blocked_reason: "reengagement_cooldown",
  reengagement_cooldown_until: "2026-08-15T09:00:00Z",
  approved_template_in_lead_language: true,
  template_registered_for_agency: true,
};

describe("deriveContactGate — the five approved proof cases", () => {
  it("Marte: window closed + no approved nb template → check-in blocked with the missing-template reason (never 'try again')", () => {
    const gate = deriveContactGate(MARTE, true, true);
    expect(gate).toEqual({
      kind: "blocked",
      reason: "no_template",
      language: "nb",
      approvedLanguages: ["en"],
    });
    // The blocked-no_template gate hides the send button entirely; freeform
    // stays window-gated (already disabled because the window is closed).
    expect(gateBlocksAllSends(gate)).toBe(false);
  });

  it("English lead with approved template + valid phone: check-in enabled", () => {
    expect(deriveContactGate(CHECKIN_OK, true, true)).toEqual({ kind: "checkin" });
  });

  it("Sarah (EN template but invalid phone): all sends blocked with the phone reason", () => {
    const gate = deriveContactGate(SARAH, true, true);
    expect(gate).toEqual({ kind: "blocked", reason: "phone" });
    expect(gateBlocksAllSends(gate)).toBe(true);
  });

  it("opted_out / blocked lead: all contact actions disabled — even with an open window", () => {
    const gate = deriveContactGate(OPTED_OUT, false, true);
    expect(gate).toEqual({ kind: "blocked", reason: "opted_out" });
    expect(gateBlocksAllSends(gate)).toBe(true);
  });

  it("provider missing: all sends blocked with the provider-setup reason", () => {
    const gate = deriveContactGate(PROVIDER_MISSING, true, true);
    expect(gate).toEqual({ kind: "blocked", reason: "provider" });
    expect(gateBlocksAllSends(gate)).toBe(true);
  });

  it("window open: normal reply enabled", () => {
    expect(deriveContactGate(WINDOW_OPEN, false, true)).toEqual({ kind: "normal" });
  });
});

describe("deriveContactGate — edges", () => {
  it("cooldown: check-in visible but disabled until the date", () => {
    expect(deriveContactGate(COOLDOWN, true, true)).toEqual({
      kind: "checkin_cooldown",
      until: "2026-08-15T09:00:00Z",
    });
  });

  it("readiness unavailable + window closed: FAIL CLOSED for the check-in (unverified)", () => {
    expect(deriveContactGate(null, true, true)).toEqual({ kind: "unverified" });
    expect(deriveContactGate({ ok: false, error: "lead_not_found" }, true, true)).toEqual({
      kind: "unverified",
    });
  });

  it("readiness unavailable + window open: normal reply keeps working (server still guards)", () => {
    expect(deriveContactGate(null, false, true)).toEqual({ kind: "normal" });
  });

  it("snapshot disagreement (window closed but readiness says normal reply): fail to unverified, never a dead check-in UI", () => {
    expect(deriveContactGate(WINDOW_OPEN, true, true)).toEqual({ kind: "unverified" });
  });

  it("unknown future action code + window closed: fail closed", () => {
    expect(
      deriveContactGate({ ok: true, recommended_action: "something_new" }, true, true),
    ).toEqual({ kind: "unverified" });
  });

  it("non-WhatsApp channels are untouched", () => {
    expect(deriveContactGate(MARTE, true, false)).toEqual({ kind: "normal" });
  });
});
