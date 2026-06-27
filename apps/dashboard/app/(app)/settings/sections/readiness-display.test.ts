import { describe, it, expect } from "vitest";
import type { ReadinessItem, ReadinessStatus } from "@/lib/api/types";
import {
  statusLabel,
  statusTone,
  isDone,
  providerName,
  orderItems,
  summarize,
} from "./readiness-display";

const ALL_STATUSES: ReadinessStatus[] = [
  "ready", "live_but_unproven", "manual_fallback", "missing", "blocked", "needs_decision", "unavailable",
];

function item(id: string, status: ReadinessStatus, owner: ReadinessItem["owner"]): ReadinessItem {
  return {
    id, label: id, area: "A", gate: "G1", owner, status,
    agencyEditable: true, adminApproved: null,
    signal: { source: "src", value: "v" }, uiCopy: "copy", blockedBy: [],
  };
}

describe("status chip mapping", () => {
  it("labels every status (total coverage, no undefined)", () => {
    for (const s of ALL_STATUSES) {
      expect(statusLabel(s)).toBeTruthy();
      expect(["good", "warn", "info", "muted"]).toContain(statusTone(s));
    }
  });
  it("only ready + manual_fallback are tone 'good'/'info' done-states", () => {
    expect(statusTone("ready")).toBe("good");
    expect(statusTone("manual_fallback")).toBe("info");
    expect(statusTone("missing")).toBe("warn");
    expect(statusTone("blocked")).toBe("muted");
  });
  it("isDone is true only for ready + manual_fallback", () => {
    expect(isDone("ready")).toBe(true);
    expect(isDone("manual_fallback")).toBe(true);
    for (const s of ["live_but_unproven", "missing", "blocked", "needs_decision", "unavailable"] as ReadinessStatus[]) {
      expect(isDone(s)).toBe(false);
    }
  });
});

describe("providerName", () => {
  it("names every provider id", () => {
    expect(providerName("email")).toBe("Email");
    expect(providerName("whatsapp")).toBe("WhatsApp");
    expect(providerName("whatsapp_templates_multilang")).toBe("Multilingual templates");
    expect(providerName("calendar")).toBe("Calendar");
    expect(providerName("property_feed")).toBe("Property catalog");
  });
});

describe("orderItems — attention floats up", () => {
  it("missing/needs_decision before ready/manual_fallback", () => {
    const ordered = orderItems([
      item("a", "ready", "agency"),
      item("b", "missing", "agency"),
      item("c", "manual_fallback", "agency"),
      item("d", "needs_decision", "agency"),
    ]);
    expect(ordered.map((i) => i.id)).toEqual(["b", "d", "c", "a"]);
  });
});

describe("summarize — agency progress excludes AIVENA-owned items", () => {
  const items = [
    item("identity.name", "ready", "agency"),
    item("identity.website", "needs_decision", "agency"),
    item("posture.approval_first", "ready", "system"),
    item("team.agents", "manual_fallback", "aivena"),     // AIVENA — excluded from agency bar
    item("lifecycle.go_live", "blocked", "aivena"),        // AIVENA — excluded (never drags the bar)
  ];
  const s = summarize(items);

  it("counts only agency/system items in the headline", () => {
    expect(s.total).toBe(3); // identity.name, identity.website, posture.approval_first
    expect(s.done).toBe(2); // the two ready ones (website needs_decision is not done)
    expect(s.pct).toBe(67);
  });
  it("surfaces AIVENA-owned items separately (not dropped)", () => {
    expect(s.aivenaItems.map((i) => i.id).sort()).toEqual(["lifecycle.go_live", "team.agents"]);
  });
  it("blocked AIVENA go-live item never appears in the agency progress set", () => {
    expect(s.agencyItems.find((i) => i.id === "lifecycle.go_live")).toBeUndefined();
  });
  it("empty input does not divide by zero", () => {
    expect(summarize([]).pct).toBe(0);
  });
});
