import { describe, it, expect } from "vitest";
import { needsActionCount, rowsWaitingOnHuman } from "./needs-action";

// Marte Brenno, 2026-08-31 — handed to a person at 15:07:15, then sent a holding reply 5 seconds later.
const MARTE = { lead_id: "marte", needs_human_since: "2026-08-31T15:07:15.975661Z" };

describe("needsActionCount — the 'Needs Action 0' of 2026-09-11", () => {
  it("counts a Needs-a-human lead even when there are no ready replies", () => {
    expect(needsActionCount(0, [], [MARTE])).toBe(1);
  });

  it("adds escalations to ready replies without counting a lead twice", () => {
    expect(needsActionCount(2, ["a", "b"], [MARTE])).toBe(3);
    expect(needsActionCount(1, ["marte"], [MARTE])).toBe(1);
  });

  it("is unknown (null), never 0, when either source failed to load", () => {
    expect(needsActionCount(0, [], null)).toBeNull();
    expect(needsActionCount(undefined, [], [MARTE])).toBeNull();
  });

  it("with nobody waiting it is the ready-reply count, as before", () => {
    expect(needsActionCount(4, ["a"], [])).toBe(4);
  });
});

describe("rowsWaitingOnHuman — the holding reply shown as a plain 'Auto-reply sent'", () => {
  const rows = [
    { eventId: "holding", leadId: "marte", occurredAt: "2026-08-31T15:07:20.742734Z" },
    { eventId: "earlier", leadId: "marte", occurredAt: "2026-08-31T14:56:18.813466Z" },
    { eventId: "other", leadId: "someone-else", occurredAt: "2026-08-31T15:10:00Z" },
  ];

  it("marks what happened after the hand-off, and only for that lead", () => {
    expect([...rowsWaitingOnHuman(rows, [MARTE])]).toEqual(["holding"]);
  });

  it("marks nothing when nobody is waiting or the queue is unknown", () => {
    expect(rowsWaitingOnHuman(rows, []).size).toBe(0);
    expect(rowsWaitingOnHuman(rows, null).size).toBe(0);
  });

  it("reads Postgres-style timestamps too", () => {
    const pg = { lead_id: "marte", needs_human_since: "2026-08-31 15:07:15.975661+00" };
    expect([...rowsWaitingOnHuman(rows, [pg])]).toEqual(["holding"]);
  });
});
