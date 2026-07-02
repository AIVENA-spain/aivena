import { describe, it, expect } from "vitest";
import {
  ATTESTATIONS,
  TARGETS,
  attestationsRequired,
  overrideApplicable,
  reasonRequired,
  allAttestationsChecked,
  canSubmit,
  visibleBlockers,
  SELF_BLOCKER_ID,
  blockerLabel,
  providerDisplayName,
  providerPlainText,
  sectionForItem,
  SECTION_ORDER,
  goLiveState,
  GO_LIVE_STATE_LABEL,
  providerItemId,
  STATUS_LABEL,
  type Attestations,
} from "./go-live-display";

const ALL: Attestations = {
  autonomo_corrected: true,
  legal_pages_published: true,
  dpa_consent_live: true,
  test_data_cleaned: true,
};

describe("go-live-display — the four manual attestations", () => {
  it("has exactly the four backend attestation keys", () => {
    expect(ATTESTATIONS.map((a) => a.key)).toEqual([
      "autonomo_corrected",
      "legal_pages_published",
      "dpa_consent_live",
      "test_data_cleaned",
    ]);
  });
  it("attestations are required ONLY for live", () => {
    expect(attestationsRequired("live")).toBe(true);
    for (const t of ["setup", "ready_for_pilot", "paused", "blocked"] as const) {
      expect(attestationsRequired(t)).toBe(false);
    }
  });
  it("allAttestationsChecked needs all four true", () => {
    expect(allAttestationsChecked(ALL)).toBe(true);
    expect(allAttestationsChecked({ ...ALL, dpa_consent_live: false })).toBe(false);
    expect(allAttestationsChecked({})).toBe(false);
  });
});

describe("go-live-display — override + reason gating", () => {
  it("override applies only to promotions (ready_for_pilot / live)", () => {
    expect(overrideApplicable("ready_for_pilot")).toBe(true);
    expect(overrideApplicable("live")).toBe(true);
    for (const t of ["setup", "paused", "blocked"] as const) {
      expect(overrideApplicable(t)).toBe(false);
    }
  });
  it("reason required for pause, block, or any override", () => {
    expect(reasonRequired("paused", false)).toBe(true);
    expect(reasonRequired("blocked", false)).toBe(true);
    expect(reasonRequired("live", true)).toBe(true); // override → reason
    expect(reasonRequired("ready_for_pilot", true)).toBe(true); // override → reason
    expect(reasonRequired("ready_for_pilot", false)).toBe(false);
    expect(reasonRequired("setup", false)).toBe(false);
  });
});

describe("go-live-display — canSubmit (button enablement, NOT a readiness verdict)", () => {
  const base = { attestations: {} as Attestations, override: false, reason: "", submitting: false };

  it("blocks with no target or while submitting", () => {
    expect(canSubmit({ ...base, target: null })).toBe(false);
    expect(canSubmit({ ...base, target: "setup", submitting: true })).toBe(false);
  });
  it("setup / ready_for_pilot (no override) submit with nothing extra", () => {
    expect(canSubmit({ ...base, target: "setup" })).toBe(true);
    expect(canSubmit({ ...base, target: "ready_for_pilot" })).toBe(true);
  });
  it("live stays un-submittable until all four attestations are checked", () => {
    expect(canSubmit({ ...base, target: "live" })).toBe(false);
    expect(canSubmit({ ...base, target: "live", attestations: { ...ALL, test_data_cleaned: false } })).toBe(
      false,
    );
    expect(canSubmit({ ...base, target: "live", attestations: ALL })).toBe(true);
  });
  it("pause / block require a reason", () => {
    expect(canSubmit({ ...base, target: "paused" })).toBe(false);
    expect(canSubmit({ ...base, target: "paused", reason: "  " })).toBe(false); // whitespace ≠ reason
    expect(canSubmit({ ...base, target: "paused", reason: "compliance hold" })).toBe(true);
    expect(canSubmit({ ...base, target: "blocked", reason: "risk" })).toBe(true);
  });
  it("override on a promotion forces a reason even though attestations are complete", () => {
    expect(canSubmit({ ...base, target: "live", attestations: ALL, override: true })).toBe(false);
    expect(
      canSubmit({ ...base, target: "live", attestations: ALL, override: true, reason: "signed off by X" }),
    ).toBe(true);
  });
});

describe("go-live-display — visibleBlockers mirrors the server go-live gate", () => {
  it("strips the self-referential lifecycle item (panel must agree with evaluateGoLive)", () => {
    expect(SELF_BLOCKER_ID).toBe("lifecycle.go_live");
    expect(visibleBlockers(["lifecycle.go_live"])).toEqual([]);
    expect(visibleBlockers(["lifecycle.go_live", "identity.name"])).toEqual(["identity.name"]);
  });
  it("a clean agency (only the self-blocker) shows NO blockers — never looks stuck", () => {
    expect(visibleBlockers(["lifecycle.go_live"])).toHaveLength(0);
  });
  it("leaves real blockers untouched", () => {
    expect(visibleBlockers(["identity.name", "provider.email"])).toEqual([
      "identity.name",
      "provider.email",
    ]);
    expect(visibleBlockers([])).toEqual([]);
  });
});

describe("go-live-display — blocker labels are specific (issue 2)", () => {
  it("maps vague API labels to specific admin labels", () => {
    expect(blockerLabel("identity.name", "Agency name")).toBe("Legal agency name not confirmed");
    expect(blockerLabel("identity.website", "Agency website")).toBe(
      "Agency website not confirmed (placeholder)",
    );
    expect(blockerLabel("identity.timezone", "Timezone")).toBe("Timezone needs confirmation");
    expect(blockerLabel("team.owner", "Owner")).toBe("Agency owner not confirmed");
    expect(blockerLabel("consent.captured", "Consent capture")).toBe("Consent capture not proven");
  });
  it("falls back to the API label for an unknown id (never blanks)", () => {
    expect(blockerLabel("some.future.item", "Future item")).toBe("Future item");
  });
});

describe("go-live-display — provider copy is plain, never raw booleans (issue 3)", () => {
  it("turns the raw WhatsApp booleans into a sentence (sender + send proven, channel off)", () => {
    const out = providerPlainText({
      provider: "whatsapp",
      status: "live_but_unproven",
      detail: "sender_ready=true, channel_enabled=false, send_proven=true, last_sync=2026-06-24",
    });
    expect(out).not.toMatch(/sender_ready=|channel_enabled=|send_proven=/); // no raw tokens
    expect(out.toLowerCase()).toContain("sender is connected");
    expect(out.toLowerCase()).toContain("test send has been proven");
    expect(out.toLowerCase()).toContain("channel isn't enabled");
  });
  it("WhatsApp not connected → plain", () => {
    expect(
      providerPlainText({
        provider: "whatsapp",
        status: "missing",
        detail: "sender_ready=false, channel_enabled=false, send_proven=false, last_sync=unknown",
      }),
    ).toBe("WhatsApp sender is not connected yet.");
  });
  it("WhatsApp RPC-not-deployed (non-structured detail) → status sentence, no crash", () => {
    const out = providerPlainText({
      provider: "whatsapp",
      status: "unavailable",
      detail: "Provider readiness RPC not deployed (consume-and-degrade)",
    });
    expect(out).toBe("WhatsApp sending status isn't available yet.");
  });
  it("non-WhatsApp providers keep their already-plain detail", () => {
    expect(
      providerPlainText({ provider: "property_feed", status: "manual_fallback", detail: "141 properties present (source verification pending)" }),
    ).toBe("141 properties present (source verification pending)");
  });
  it("a bare 'unavailable' detail becomes a friendly line", () => {
    expect(providerPlainText({ provider: "calendar", status: "unavailable", detail: "unavailable" })).toBe(
      "Calendar (viewings) status isn't available yet.",
    );
  });
  it("providerDisplayName is human-readable", () => {
    expect(providerDisplayName("email")).toBe("Email sending");
    expect(providerDisplayName("whatsapp")).toBe("WhatsApp sending");
  });
  it("providerItemId joins provider state → item id, incl. the asymmetric multilang one", () => {
    expect(providerItemId("email")).toBe("provider.email");
    expect(providerItemId("whatsapp")).toBe("provider.whatsapp");
    expect(providerItemId("calendar")).toBe("provider.calendar");
    expect(providerItemId("property_feed")).toBe("provider.property_feed");
    // API item id is provider.templates_multilang, provider-state id is whatsapp_templates_multilang
    expect(providerItemId("whatsapp_templates_multilang")).toBe("provider.templates_multilang");
    expect(sectionForItem(providerItemId("whatsapp_templates_multilang"))).toBe("providers");
  });
});

describe("go-live-display — section grouping (issue B)", () => {
  it("maps identity/team items to Agency setup", () => {
    for (const id of ["identity.name", "identity.website", "identity.timezone", "team.owner"]) {
      expect(sectionForItem(id)).toBe("setup");
    }
  });
  it("maps provider items to Providers", () => {
    for (const id of ["provider.email", "provider.whatsapp", "provider.calendar"]) {
      expect(sectionForItem(id)).toBe("providers");
    }
  });
  it("maps consent to Legal & consent", () => {
    expect(sectionForItem("consent.captured")).toBe("legal");
  });
  it("maps posture + lifecycle to Safety / manual checks (NOT setup)", () => {
    expect(sectionForItem("posture.approval_first")).toBe("safety");
    expect(sectionForItem("lifecycle.go_live")).toBe("safety");
  });
  it("unknown ids fall back to setup (never crash)", () => {
    expect(sectionForItem("some.future.item")).toBe("setup");
  });
  it("SECTION_ORDER covers the 4 sections", () => {
    expect(SECTION_ORDER).toEqual(["setup", "providers", "legal", "safety"]);
  });
});

describe("go-live-display — top summary verdict (issue B)", () => {
  it("reflects the lifecycle for live/paused/blocked regardless of blocker count", () => {
    expect(goLiveState("live", 5)).toBe("live");
    expect(goLiveState("paused", 0)).toBe("paused");
    expect(goLiveState("blocked", 0)).toBe("blocked");
  });
  it("setup/ready_for_pilot → not_ready with blockers, ready without", () => {
    expect(goLiveState("setup", 3)).toBe("not_ready");
    expect(goLiveState("setup", 0)).toBe("ready");
    expect(goLiveState("ready_for_pilot", 2)).toBe("not_ready");
    expect(goLiveState(null, 0)).toBe("ready");
  });
  it("every state has a human label", () => {
    for (const s of ["live", "paused", "blocked", "ready", "not_ready"] as const) {
      expect(GO_LIVE_STATE_LABEL[s].length).toBeGreaterThan(0);
    }
  });
});

describe("go-live-display — status labels never invent 'ready'", () => {
  it("only the genuinely-ready status maps to 'Ready'", () => {
    expect(STATUS_LABEL.ready).toBe("Ready");
    expect(STATUS_LABEL.live_but_unproven).not.toBe("Ready");
    expect(STATUS_LABEL.missing).not.toBe("Ready");
    expect(STATUS_LABEL.unavailable).not.toBe("Ready");
  });
  it("every TARGET has a non-empty label + blurb", () => {
    for (const t of TARGETS) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.blurb.length).toBeGreaterThan(0);
    }
  });
});
