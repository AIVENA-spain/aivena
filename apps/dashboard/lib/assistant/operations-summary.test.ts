import { describe, it, expect } from "vitest";
import { formatOperationsSummary, looksLikeAttentionAsk } from "./operations-summary";
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
    signalHealth: [
      { signal: "failedSends", ok: true, source: "x" },
      { signal: "whatsapp", ok: true, source: "x" },
    ],
    ...over,
  };
}

describe("looksLikeAttentionAsk", () => {
  it("matches operational/status asks", () => {
    for (const q of [
      "what needs my attention?",
      "what's wrong",
      "give me a status",
      "summary please",
      "summarize my issues",
      "any problems?",
      "what's happening",
      "overview",
    ]) {
      expect(looksLikeAttentionAsk(q), q).toBe(true);
    }
  });
  it("does NOT match general chit-chat / how-to (those wait for the LLM)", () => {
    for (const q of ["hello", "how do I add a property?", "what is plusvalía tax", "thanks"]) {
      expect(looksLikeAttentionAsk(q), q).toBe(false);
    }
  });
});

describe("formatOperationsSummary", () => {
  it("all-clear → a single calm line, no invented issues", () => {
    const s = formatOperationsSummary(base());
    expect(s).toMatch(/everything looks clear/i);
    expect(s).not.toContain("•"); // no itemised issues when all-clear
  });

  it("summarises real counts + names the top at-risk lead + provider issue", () => {
    const s = formatOperationsSummary(
      base({
        attention: { failedSends: 1, openTasks: 5, atRiskLeads: 1, providerIssues: 1, openActionItems: 6 },
        failedSends: {
          count: 1,
          items: [{ messageId: "m", leadId: "l", leadName: "Marte Brenno", channel: "text", status: "undelivered", at: "x", ageHours: 288, preview: null }],
          note: "",
          available: true,
        },
        actionQueue: {
          total: 5,
          byType: [
            { type: "suggested_reply", label: "Reply to approve", count: 1 },
            { type: "super_hot_alert", label: "Hot-lead alert", count: 1 },
          ],
          items: [],
          available: true,
        },
        lifecycle: {
          buckets: [{ key: "at_risk", label: "At risk", count: 1 }],
          atRisk: [{ leadId: "l", leadName: "Marte Brenno", bucket: "at_risk", reason: "Has an unresolved failed send", temperature: "warm", ageHours: 288, lastActivityAt: "x" }],
          available: true,
        },
        providers: [
          { provider: "whatsapp", state: "degraded", detail: "Sender connected but the WhatsApp channel is off.", source: "x" },
          { provider: "email", state: "unknown", detail: "x", source: "x" },
        ],
      }),
    );
    expect(s).toMatch(/1 failed send/);
    expect(s).toMatch(/Marte Brenno/);
    expect(s).toMatch(/5 open tasks/);
    expect(s).toMatch(/reply to approve/i);
    expect(s).toMatch(/1 at-risk lead/);
    expect(s).toMatch(/has an unresolved failed send/i);
    expect(s).toMatch(/WhatsApp is degraded/);
    expect(s).not.toMatch(/Email is/); // unknown/ready providers are NOT reported as issues
  });

  it("flags degraded live signals honestly (partial data)", () => {
    const s = formatOperationsSummary(
      base({
        attention: { failedSends: 0, openTasks: 0, atRiskLeads: 0, providerIssues: 0, openActionItems: 1 },
        actionQueue: { total: 1, byType: [{ type: "x", label: "Thing", count: 1 }], items: [], available: true },
        signalHealth: [{ signal: "whatsapp", ok: false, source: "x" }],
      }),
    );
    expect(s).toMatch(/some live data couldn't be read/i);
    expect(s).toMatch(/whatsapp/i);
  });
});
