import { describe, it, expect } from "vitest";
import { resolveConvoState, needsAction } from "./conversation-state";

// Marte Brenno on 2026-08-31 — the exact rows that produced the false badge.
const MARTE = {
  latestInboundAt: "2026-08-31T15:06:51Z",
  lastOutboundAt: "2026-08-31T15:07:20Z", // the engine's holding reply, 29 seconds later
  lastOutboundKind: "auto",
};

describe("resolveConvoState — the false 'Auto-handled' of 2026-09-11", () => {
  it("a lead in the Needs-a-human queue reads needsHuman, even after an automatic reply", () => {
    // pendingCount is 0 because dashboard_inbox never returns human_review_needed tasks.
    expect(resolveConvoState(MARTE, 0, true)).toBe("needsHuman");
  });

  it("without the escalation signal the same rows read autoHandled — which is exactly why the signal is needed", () => {
    expect(resolveConvoState(MARTE, 0, false)).toBe("autoHandled");
  });

  it("the escalation outranks a pending task and a newer inbound", () => {
    expect(resolveConvoState(MARTE, 3, true)).toBe("needsHuman");
    expect(resolveConvoState({ ...MARTE, latestInboundAt: "2026-09-01T00:00:00Z" }, 0, true)).toBe("needsHuman");
  });

  it("ordinary cases are unchanged", () => {
    expect(resolveConvoState(MARTE, 1)).toBe("needsYou");
    expect(resolveConvoState({ ...MARTE, latestInboundAt: "2026-09-01T00:00:00Z" }, 0)).toBe("needsYou");
    expect(resolveConvoState({ ...MARTE, lastOutboundKind: "operator" }, 0)).toBe("replied");
    expect(resolveConvoState({ latestInboundAt: null, lastOutboundAt: null, lastOutboundKind: null }, 0)).toBe("waiting");
  });
});

describe("needsAction — what sorts first and counts toward the tab badge", () => {
  it("both needsHuman and needsYou need a person", () => {
    expect(needsAction("needsHuman")).toBe(true);
    expect(needsAction("needsYou")).toBe(true);
  });

  it("handled and waiting states do not", () => {
    for (const s of ["replied", "autoHandled", "waiting", undefined, null] as const) {
      expect(needsAction(s)).toBe(false);
    }
  });
});
