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
  DISMISS_REASONS,
  DEFAULT_REASON,
  isValidReason,
  friendlyDismissError,
  GENERIC_DISMISS_ERROR,
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
  return { task: task(), state: "idle", error: null, reason: DEFAULT_REASON, ...over };
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

describe("dismissal reasons — must match the RPC whitelist", () => {
  // The exact whitelist enforced by dismiss_dashboard_task. If the RPC changes,
  // this test must change too — that's the point (it guards invalid_dismissal_reason).
  const RPC_WHITELIST = ["dropped_lead", "handled_externally", "not_relevant", "wrong_number", "duplicate"];

  it("every offered reason is accepted by the RPC (no invalid_dismissal_reason)", () => {
    for (const r of DISMISS_REASONS) expect(RPC_WHITELIST).toContain(r.value);
  });
  it("the default reason is valid and every offered value validates", () => {
    expect(isValidReason(DEFAULT_REASON)).toBe(true);
    for (const r of DISMISS_REASONS) expect(isValidReason(r.value)).toBe(true);
  });
  it("rejects free text (the original bug) and unknown values", () => {
    expect(isValidReason("Marked resolved from the Tasks list")).toBe(false);
    expect(isValidReason("")).toBe(false);
    expect(isValidReason("superseded_by_new_inbound")).toBe(false); // W4a-internal, not for this RPC
  });
});

describe("SET_REASON — only while confirming, only valid values", () => {
  it("updates the reason during the confirm step", () => {
    const r = rowReducer(row({ state: "confirming" }), { type: "SET_REASON", reason: "not_relevant" });
    expect(r.reason).toBe("not_relevant");
    expect(r.state).toBe("confirming"); // no state change, no write
  });
  it("ignores an invalid reason and reasons set outside confirming", () => {
    expect(rowReducer(row({ state: "confirming" }), { type: "SET_REASON", reason: "nonsense" }).reason).toBe(DEFAULT_REASON);
    expect(rowReducer(row({ state: "idle" }), { type: "SET_REASON", reason: "not_relevant" }).reason).toBe(DEFAULT_REASON);
  });
  it("ASK resets the reason to the default", () => {
    const r = rowReducer(row({ state: "idle", reason: "duplicate" }), { type: "ASK" });
    expect(r.reason).toBe(DEFAULT_REASON);
  });
});

describe("friendlyDismissError — a raw RPC code must NEVER reach the user", () => {
  it("maps the invalid_dismissal_reason bug code to friendly copy (not the raw token)", () => {
    const msg = friendlyDismissError("invalid_dismissal_reason");
    expect(msg).not.toContain("invalid_dismissal_reason");
    expect(msg).toMatch(/couldn't resolve/i);
  });
  it("maps known codes and collapses unknown/null to the generic line", () => {
    expect(friendlyDismissError("task_already_handled")).toMatch(/already handled/i);
    expect(friendlyDismissError("task_not_found")).toMatch(/no longer exists/i);
    expect(friendlyDismissError("some_unmapped_raw_code")).toBe(GENERIC_DISMISS_ERROR);
    expect(friendlyDismissError(null)).toBe(GENERIC_DISMISS_ERROR);
    expect(friendlyDismissError(undefined)).toBe(GENERIC_DISMISS_ERROR);
  });
});
