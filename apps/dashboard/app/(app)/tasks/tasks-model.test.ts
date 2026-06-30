import { describe, it, expect } from "vitest";
import type { OpsTask } from "@/lib/api/types";
import {
  rowReducer,
  entersSaving,
  isActive,
  activeCount,
  whyItMatters,
  ageLabel,
  inboxHref,
  type Row,
} from "./tasks-model";

function task(over: Partial<OpsTask> = {}): OpsTask {
  return {
    taskId: "t1",
    leadId: "l1",
    leadName: "Katarzyna Nowak",
    type: "super_hot_alert",
    label: "Hot-lead alert",
    status: "open",
    priority: "high",
    temperature: "super_hot",
    title: null,
    createdAt: "x",
    ageHours: 264,
    inInbox: false,
    ...over,
  };
}
function row(over: Partial<Row> = {}): Row {
  return { task: task(), state: "idle", error: null, ...over };
}

describe("rowReducer — two-step confirm, no accidental / double writes", () => {
  it("first click only ASKS — it moves to confirming, never to saving (no write)", () => {
    const r = rowReducer(row({ state: "idle" }), { type: "ASK" });
    expect(r.state).toBe("confirming");
    expect(entersSaving("idle", r.state)).toBe(false); // nothing should write yet
  });

  it("an explicit CONFIRM (second click) is the ONLY way into saving", () => {
    const confirming = row({ state: "confirming" });
    const r = rowReducer(confirming, { type: "CONFIRM" });
    expect(r.state).toBe("saving");
    expect(entersSaving("confirming", r.state)).toBe(true); // write fires here, once
  });

  it("CONFIRM does nothing from any non-confirming state → cannot double-write", () => {
    for (const state of ["idle", "saving", "resolved", "error"] as const) {
      const r = rowReducer(row({ state }), { type: "CONFIRM" });
      expect(r.state).toBe(state); // unchanged
      expect(entersSaving(state, r.state)).toBe(false); // never a second write
    }
  });

  it("SUCCESS resolves a saving row; resolved rows are no longer active", () => {
    const r = rowReducer(row({ state: "saving" }), { type: "SUCCESS" });
    expect(r.state).toBe("resolved");
    expect(isActive(r.state)).toBe(false);
  });

  it("FAIL surfaces a friendly error and allows retry/cancel", () => {
    const failed = rowReducer(row({ state: "saving" }), { type: "FAIL", error: "This task was already resolved." });
    expect(failed.state).toBe("error");
    expect(failed.error).toMatch(/already resolved/i);
    // from error you can ASK again (retry) or CANCEL
    expect(rowReducer(failed, { type: "ASK" }).state).toBe("confirming");
    expect(rowReducer(failed, { type: "CANCEL" }).state).toBe("idle");
  });

  it("CANCEL backs out of confirming without writing", () => {
    const r = rowReducer(row({ state: "confirming" }), { type: "CANCEL" });
    expect(r.state).toBe("idle");
  });
});

describe("activeCount", () => {
  it("counts everything except resolved rows", () => {
    const rows: Row[] = [
      row({ state: "idle" }),
      row({ state: "confirming" }),
      row({ state: "saving" }),
      row({ state: "error" }),
      row({ state: "resolved" }),
    ];
    expect(activeCount(rows)).toBe(4);
  });
});

describe("whyItMatters", () => {
  it("gives plain-language meaning per known type, with a safe fallback", () => {
    expect(whyItMatters("suggested_reply")).toMatch(/waiting for your approval/i);
    expect(whyItMatters("super_hot_alert")).toMatch(/engaged/i);
    expect(whyItMatters("viewing_booking_needed")).toMatch(/viewing/i);
    expect(whyItMatters("totally_unknown_type")).toMatch(/take a look/i);
  });
});

describe("ageLabel", () => {
  it("humanises hours, null-safe", () => {
    expect(ageLabel(null)).toBeNull();
    expect(ageLabel(0.5)).toBe("just now");
    expect(ageLabel(7)).toBe("7h old");
    expect(ageLabel(264)).toBe("11d old");
  });
});

describe("inboxHref — no dead-end links", () => {
  it("returns an Inbox deep-link ONLY when the lead is in the Inbox", () => {
    expect(inboxHref(task({ inInbox: true, leadId: "abc" }))).toBe("/approvals?leadId=abc");
    // non-Inbox lead (Katarzyna) → no link; its only action is Resolve, on this page
    expect(inboxHref(task({ inInbox: false, leadId: "abc" }))).toBeNull();
    expect(inboxHref(task({ inInbox: true, leadId: null }))).toBeNull();
  });
});
