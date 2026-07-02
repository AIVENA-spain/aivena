import { describe, it, expect } from "vitest";
import { isTestAgency, TEST_AGENCY_IDS } from "./test-agencies";

describe("test-agencies allowlist (UI-only hide)", () => {
  it("flags exactly the known internal test agencies", () => {
    expect(isTestAgency("cc-verify-delete-me")).toBe(true);
    expect(isTestAgency("cc-verify-email-test")).toBe(true);
    expect(isTestAgency("testing-agency")).toBe(true);
    expect(isTestAgency("wf1v2-test-agency-aaaaaaaaaaaa")).toBe(true);
  });
  it("does NOT flag real/pilot agencies", () => {
    expect(isTestAgency("demo-costa-homes-pilot01")).toBe(false);
    expect(isTestAgency("mediterraneo-costa-homes")).toBe(false);
    expect(isTestAgency("")).toBe(false);
  });
  it("has exactly the four known ids (kept in sync by hand)", () => {
    expect(TEST_AGENCY_IDS.size).toBe(4);
  });
});
