import { describe, it, expect } from "vitest";
import { describeAuditEntry } from "./audit-format";
import type { AgencyAuditEntry } from "@/lib/api/admin-types";

function entry(action: string, metadata: Record<string, unknown>): AgencyAuditEntry {
  return {
    id: "x",
    created_at: "2026-07-02T18:00:00Z",
    actor_email: "staff@aivena.es",
    event_type: "staff_action",
    action,
    metadata: { action, ...metadata },
  };
}

describe("describeAuditEntry", () => {
  it("archive reads as Archived with from→to + reason", () => {
    const d = describeAuditEntry(entry("set_agency_status", { from: "active", to: "archived", reason: "cleanup" }));
    expect(d.title).toBe("Archived");
    expect(d.detail).toContain("active → archived");
    expect(d.detail).toContain("cleanup");
  });
  it("restore (archived→active) reads as Restored", () => {
    const d = describeAuditEntry(entry("set_agency_status", { from: "archived", to: "active", reason: "back" }));
    expect(d.title).toBe("Restored");
  });
  it("test flag on/off", () => {
    expect(describeAuditEntry(entry("set_test_flag", { from: false, to: true })).title).toBe(
      "Marked as test agency",
    );
    expect(describeAuditEntry(entry("set_test_flag", { from: true, to: false })).title).toBe(
      "Unmarked as test agency",
    );
  });
  it("pilot status change", () => {
    const d = describeAuditEntry(entry("set_pilot_status", { from: "setup", to: "live" }));
    expect(d.title).toBe("Pilot status");
    expect(d.detail).toContain("setup → live");
  });
  it("unknown action falls back to the action name (never blank)", () => {
    const d = describeAuditEntry(entry("some_future_action", {}));
    expect(d.title).toBe("some_future_action");
    expect(d.detail).toBe("—");
  });
  it("missing reason → em dash, never 'undefined'", () => {
    const d = describeAuditEntry(entry("set_test_flag", { to: true }));
    expect(d.detail).toBe("—");
    expect(JSON.stringify(d)).not.toContain("undefined");
  });
});
