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

// Demo-like: Marte's reply (in Inbox), an OLD failed send to Marte (in Inbox),
// a hot lead Katarzyna who has NO conversation (inInbox:false — the bug case),
// and WhatsApp degraded.
function demo(): OperationsResponse {
  return base({
    attention: { failedSends: 1, openTasks: 2, atRiskLeads: 1, providerIssues: 1, openActionItems: 3 },
    failedSends: {
      count: 1,
      items: [{ messageId: "m", leadId: "l1", leadName: "Marte Brenno", channel: "whatsapp", status: "undelivered", at: "x", ageHours: 288, preview: null, inInbox: true }],
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
        { taskId: "t1", leadId: "l1", leadName: "Marte Brenno", type: "suggested_reply", label: "Reply to approve", status: "pending", priority: "high", temperature: "warm", title: null, createdAt: "x", ageHours: 2, inInbox: true },
        { taskId: "t2", leadId: "l2", leadName: "Katarzyna Nowak", type: "super_hot_alert", label: "Hot-lead alert", status: "open", priority: "high", temperature: "super_hot", title: null, createdAt: "x", ageHours: 8, inInbox: false },
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
    expect(routeIntent("why is whatsapp degraded?")).toBe("whatsapp");
    expect(routeIntent("explain these tasks")).toBe("tasks");
    expect(routeIntent("what's wrong")).toBe("wrong");
  });
  it("returns null for general/how-to questions", () => {
    for (const q of ["hello", "how do I add a property", "what is plusvalía tax"]) {
      expect(routeIntent(q), q).toBeNull();
    }
  });
});

describe("buildTodayPlan — prioritised, warm, age-aware, path-honest", () => {
  const s = buildTodayPlan(demo());
  it("opens warmly + numbers the top items with emojis", () => {
    expect(s).toMatch(/^Here's what I'd do first today 👇/);
    expect(s).toMatch(/1\. 💬 Review Marte Brenno's reply/);
    expect(s).toMatch(/🔥 Hot lead: Katarzyna Nowak/);
  });
  it("an OFF-TAB lead (no conversation) is NOT told to open in the inbox — reach-out instead + scope note", () => {
    expect(s).toMatch(/reach out to Katarzyna Nowak directly/i);
    expect(s).toMatch(/I check across all your leads/i); // scope note shown because an off-tab item is in the top
  });
  it("an in-inbox item is openable in the Inbox", () => {
    expect(s).toMatch(/Open them in the Inbox/);
  });
  it("the 12-day failure is 'decide', incl. mark resolved (not urgent-red)", () => {
    expect(s).toMatch(/Old failed message to Marte Brenno \(12 days ago\)/);
    expect(s).toMatch(/mark it resolved if it no longer matters/i);
  });
  it("all-clear → friendly caught-up message, no scope note", () => {
    const clear = buildTodayPlan(base());
    expect(clear).toMatch(/all caught up/i);
    expect(clear).not.toMatch(/across all your leads/i);
  });
  it("no scope note when every top item IS in the inbox", () => {
    const allInbox = base({
      attention: { failedSends: 0, openTasks: 1, atRiskLeads: 0, providerIssues: 0, openActionItems: 1 },
      actionQueue: {
        total: 1,
        byType: [{ type: "suggested_reply", label: "Reply to approve", count: 1 }],
        items: [{ taskId: "t", leadId: "l", leadName: "Marte", type: "suggested_reply", label: "Reply to approve", status: "pending", priority: null, temperature: "warm", title: null, createdAt: "x", ageHours: 1, inInbox: true }],
        available: true,
      },
    });
    expect(buildTodayPlan(allInbox)).not.toMatch(/across all your leads/i);
  });
});

describe("buildWhatsWrong", () => {
  it("lists what's off with emojis + points to the plan", () => {
    const s = buildWhatsWrong(demo());
    expect(s).toMatch(/⚠️ 1 failed send \(1 older\)/);
    expect(s).toMatch(/💬 2 open tasks/);
    expect(s).toMatch(/🛠️ WhatsApp is degraded/);
    expect(s).toMatch(/What should I do today/);
  });
  it("all-clear → nothing's wrong", () => {
    expect(buildWhatsWrong(base())).toMatch(/nothing's wrong/i);
  });
});

describe("explainTasks", () => {
  it("glossary for present task types + flags off-tab leads", () => {
    const s = explainTasks(demo());
    expect(s).toMatch(/Reply to approve.*waiting for your approval/i);
    expect(s).toMatch(/Hot-lead alert.*engaged/i);
    expect(s).toMatch(/aren't in the Inbox queue/i); // Katarzyna offTab
  });
  it("no tasks → says so", () => {
    expect(explainTasks(base())).toMatch(/no open tasks/i);
  });
});

describe("explainWhatsApp", () => {
  it("degraded → 'degraded, not down' + what to do", () => {
    const s = explainWhatsApp(demo());
    expect(s).toMatch(/degraded, not down/i);
    expect(s).toMatch(/Settings → Channels/i);
  });
  it("ready → healthy", () => {
    expect(explainWhatsApp(base())).toMatch(/healthy/i);
  });
  it("disconnected → reconnect", () => {
    expect(explainWhatsApp(base({ providers: [{ provider: "whatsapp", state: "disconnected", detail: "not connected.", source: "x" }] }))).toMatch(/reconnect/i);
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
