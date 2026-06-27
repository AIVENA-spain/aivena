import { describe, it, expect } from "vitest";
import {
  routeIntent,
  buildTodayPlan,
  buildWhatsWrong,
  explainTasks,
  explainWhatsApp,
  answerFor,
} from "./operations-summary";
import type { OperationsResponse } from "@/lib/api/types";

function base(over: Partial<OperationsResponse> = {}): OperationsResponse {
  return {
    computedAt: "2026-06-27T16:00:00.000Z",
    agencyId: "demo",
    attention: { failedSends: 0, openTasks: 0, atRiskLeads: 0, providerIssues: 0, openActionItems: 0 },
    failedSends: { count: 0, items: [], note: "", available: true },
    actionQueue: { total: 0, byType: [], items: [], available: true },
    providers: [
      { provider: "whatsapp", state: "ready", detail: "ok", source: "x" },
      { provider: "email", state: "unknown", detail: "x", source: "x" },
    ],
    lifecycle: { buckets: [], atRisk: [], available: true },
    signalHealth: [{ signal: "failedSends", ok: true, source: "x" }],
    ...over,
  };
}

// Demo-like situation: a reply to approve, a hot lead, an OLD failed send to
// Marte (12d), and WhatsApp degraded.
function demo(): OperationsResponse {
  return base({
    attention: { failedSends: 1, openTasks: 2, atRiskLeads: 1, providerIssues: 1, openActionItems: 3 },
    failedSends: {
      count: 1,
      items: [{ messageId: "m", leadId: "l1", leadName: "Marte Brenno", channel: "whatsapp", status: "undelivered", at: "x", ageHours: 288, preview: null }],
      note: "",
      available: true,
    },
    actionQueue: {
      total: 2,
      byType: [
        { type: "suggested_reply", label: "Reply to approve", count: 1 },
        { type: "super_hot_alert", label: "Hot-lead alert", count: 1 },
      ],
      items: [
        { taskId: "t1", leadId: "l1", leadName: "Marte Brenno", type: "suggested_reply", label: "Reply to approve", status: "pending", priority: "high", temperature: "warm", title: null, createdAt: "x", ageHours: 2 },
        { taskId: "t2", leadId: "l2", leadName: "Katarzyna Nowak", type: "super_hot_alert", label: "Hot-lead alert", status: "open", priority: "high", temperature: "super_hot", title: null, createdAt: "x", ageHours: 8 },
      ],
      available: true,
    },
    providers: [
      { provider: "whatsapp", state: "degraded", detail: "Sender connected but the WhatsApp channel is off.", source: "x" },
      { provider: "email", state: "unknown", detail: "x", source: "x" },
    ],
  });
}

describe("routeIntent", () => {
  it("maps typed questions to the right deterministic intent", () => {
    expect(routeIntent("what should I do today?")).toBe("today");
    expect(routeIntent("what should I fix first")).toBe("today");
    expect(routeIntent("why is whatsapp degraded?")).toBe("whatsapp");
    expect(routeIntent("explain these tasks")).toBe("tasks");
    expect(routeIntent("what's wrong")).toBe("wrong");
    expect(routeIntent("any issues?")).toBe("wrong");
  });
  it("returns null for general/how-to questions (those wait for the LLM)", () => {
    for (const q of ["hello", "how do I add a property", "what is plusvalía tax", "thanks"]) {
      expect(routeIntent(q), q).toBeNull();
    }
  });
});

describe("buildTodayPlan — prioritised, plain-language, age-aware", () => {
  it("orders by urgency, ages an old failure as 'decide', and closes calmly", () => {
    const s = buildTodayPlan(demo());
    expect(s).toMatch(/^Here's what I'd do first today:/);
    // reply-to-approve is the top priority (blocks the buyer)
    expect(s.indexOf("1. A reply is waiting for your approval")).toBeGreaterThanOrEqual(0);
    expect(s.indexOf("reply is waiting")).toBeLessThan(s.indexOf("Hot lead needs attention"));
    // the 12-day-old failure is presented as "decide", incl. mark resolved — NOT urgent-red
    expect(s).toMatch(/Old failed message to Marte Brenno \(12 days ago\)/);
    expect(s).toMatch(/mark it resolved if it no longer matters/i);
    // only the top 3 are shown; the degraded provider is the 1 lower-priority rest
    expect(s).toMatch(/Plus 1 more lower-priority item — nothing else looks urgent\./);
  });
  it("all-clear → friendly caught-up message", () => {
    expect(buildTodayPlan(base())).toMatch(/all caught up/i);
  });
});

describe("buildWhatsWrong", () => {
  it("lists what's off (recent vs older failures) and points to the plan", () => {
    const s = buildWhatsWrong(demo());
    expect(s).toMatch(/1 failed send \(1 older\)/);
    expect(s).toMatch(/2 open tasks/);
    expect(s).toMatch(/WhatsApp is degraded/);
    expect(s).toMatch(/What should I do today/);
  });
  it("all-clear → nothing's wrong", () => {
    expect(buildWhatsWrong(base())).toMatch(/nothing's wrong/i);
  });
});

describe("explainTasks", () => {
  it("gives a plain-language glossary for the task types present", () => {
    const s = explainTasks(demo());
    expect(s).toMatch(/Reply to approve.*waiting for your approval/i);
    expect(s).toMatch(/Hot-lead alert.*engaged/i);
    expect(s).toMatch(/mark it resolved/i);
  });
  it("no tasks → says so", () => {
    expect(explainTasks(base())).toMatch(/no open tasks/i);
  });
});

describe("explainWhatsApp", () => {
  it("degraded → 'degraded, not down' + what to do", () => {
    const s = explainWhatsApp(demo());
    expect(s).toMatch(/degraded, not down/i);
    expect(s).toMatch(/turn the WhatsApp channel on|Settings/i);
  });
  it("ready → healthy", () => {
    expect(explainWhatsApp(base())).toMatch(/healthy/i);
  });
  it("disconnected → reconnect guidance", () => {
    const s = explainWhatsApp(base({ providers: [{ provider: "whatsapp", state: "disconnected", detail: "not connected.", source: "x" }] }));
    expect(s).toMatch(/isn't connected/i);
    expect(s).toMatch(/reconnect/i);
  });
});

describe("answerFor dispatch", () => {
  it("routes each intent to its builder", () => {
    const d = demo();
    expect(answerFor("today", d)).toBe(buildTodayPlan(d));
    expect(answerFor("wrong", d)).toBe(buildWhatsWrong(d));
    expect(answerFor("tasks", d)).toBe(explainTasks(d));
    expect(answerFor("whatsapp", d)).toBe(explainWhatsApp(d));
  });
});
