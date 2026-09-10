import { describe, it, expect } from "vitest";
import { AUTOMATION, followUpState, scoreState, scoringIsLive, followUpsAreLive } from "./automation-status";

describe("followUpState — the defect this replaces", () => {
  it("a lead that is merely NOT PAUSED is not active", () => {
    // This is the exact bug: `followup_paused` defaults to false, so every lead read as
    // "Follow-up active" while nothing was ever scheduled.
    expect(followUpState({ paused: false, nextFollowUpAt: null })).toBe("not_active");
    expect(followUpState({ nextFollowUpAt: null })).toBe("not_active");
    expect(followUpState({})).toBe("not_active");
  });

  it("only a real FUTURE follow-up counts as scheduled", () => {
    const now = new Date("2026-09-10T12:00:00Z");
    expect(followUpState({ nextFollowUpAt: "2026-09-11T09:00:00Z", now })).toBe("scheduled");
    expect(followUpState({ nextFollowUpAt: "2026-09-09T09:00:00Z", now })).toBe("not_active");
    expect(followUpState({ nextFollowUpAt: "not a date", now })).toBe("not_active");
    expect(followUpState({ nextFollowUpAt: "", now })).toBe("not_active");
  });

  it("an explicit pause is reported as paused, even with something scheduled", () => {
    const now = new Date("2026-09-10T12:00:00Z");
    expect(followUpState({ paused: true, nextFollowUpAt: "2026-09-11T09:00:00Z", now })).toBe("paused");
  });
});

describe("scoreState — a stale number must not read as live", () => {
  it("with the engine stopped, an existing score is LEGACY, never live", () => {
    expect(AUTOMATION.leadScoring).toBe("not_running");   // pin the current reality
    expect(scoreState({ score: 82, temperature: "hot" })).toBe("legacy");
    expect(scoreState({ score: 82 })).toBe("legacy");
    expect(scoreState({ temperature: "warm" })).toBe("legacy");
  });

  it("with the engine stopped and no score, it is UNAVAILABLE", () => {
    expect(scoreState({ score: null, temperature: null })).toBe("unavailable");
    expect(scoreState({})).toBe("unavailable");
    expect(scoreState({ temperature: "" })).toBe("unavailable");
  });

  it("nothing reports LIVE while the engine is stopped", () => {
    for (const input of [{ score: 1 }, { score: 100, temperature: "very_hot" }, {}]) {
      expect(scoreState(input)).not.toBe("live");
    }
  });
});

describe("the declaration is the single source of truth", () => {
  it("both helpers agree with AUTOMATION", () => {
    expect(scoringIsLive()).toBe(AUTOMATION.leadScoring === "running");
    expect(followUpsAreLive()).toBe(AUTOMATION.automaticFollowUps === "running");
  });

  it("today, neither engine is running — this test is the tripwire when that changes", () => {
    // If someone wires the engine and flips AUTOMATION, this fails and forces them to
    // re-check every surface that was showing a not-live state.
    expect(scoringIsLive()).toBe(false);
    expect(followUpsAreLive()).toBe(false);
  });
});
