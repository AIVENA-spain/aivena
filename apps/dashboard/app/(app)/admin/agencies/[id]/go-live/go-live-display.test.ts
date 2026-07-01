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
