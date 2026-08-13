// lead-summary.ts — network side of the AIVENA Brief summary. Calls Anthropic
// (grounded, no web search, no thinking) and delegates ALL prompt/guard/fallback
// logic to the pure lead-summary-lib.ts. Never throws: any error, timeout, or
// over-budget returns the deterministic summary so the Brief card always renders.
//
// Cost guards mirror chat.ts Phase-D: a per-agency fairness cap AND a per-instance
// global circuit-breaker, checked before the paid call. Bills the platform
// ANTHROPIC_API_KEY (same key Studio uses).

import { createRateLimiter } from "./chat-lib";
import {
  ANTHROPIC_URL,
  SUMMARY_MAX_TOKENS,
  SUMMARY_MODEL,
  SUMMARY_TIMEOUT_MS,
  buildSummaryUser,
  deterministicSummary,
  resolveSummary,
  SUMMARY_SYSTEM_PROMPT,
  type LeadFacts,
  type SummaryResult,
} from "./lead-summary-lib";

const MODEL = process.env.LEAD_SUMMARY_MODEL?.trim() || SUMMARY_MODEL;
const DISABLED = process.env.LEAD_SUMMARY_LLM_DISABLED === "true";

// Cost backstops: a spoofed caller can never run up an unbounded Anthropic bill.
const allowLlmAgency = createRateLimiter(30, 60_000); // per-agency fairness cap
const allowLlmGlobal = createRateLimiter(120, 60_000); // per-instance circuit breaker
function llmBudgetAvailable(agencyId: string, now: number): boolean {
  return allowLlmGlobal("all", now) && allowLlmAgency(agencyId, now);
}

/** Raw Anthropic call — grounded, deterministic-only (thinking disabled, no web
 *  search, no temperature). Returns the text, or null on any error/timeout. */
async function callClaude(system: string, user: string): Promise<string | null> {
  // Read the key from process.env directly (env.ts already validates it at API
  // startup) so importing this module never triggers env.ts's exit-on-missing —
  // that would take down unrelated route unit tests. Missing key → null → fallback.
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);
  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: SUMMARY_MAX_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
        thinking: { type: "disabled" },
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      console.error("[lead-summary] api error:", resp.status, detail.slice(0, 200));
      return null;
    }
    const data = (await resp.json()) as { content?: Array<{ type: string; text?: string }> };
    return data.content?.find((c) => c.type === "text")?.text ?? null;
  } catch (err) {
    console.error("[lead-summary] call failed:", (err as Error)?.message?.slice(0, 160));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Produce the Brief summary for a lead. LLM-primary, deterministic-fallback:
 * over-budget / disabled / any failure / any guard miss → the grounded
 * deterministic summary. `agencyId` scopes the per-agency budget.
 */
export async function getLeadSummary(agencyId: string, facts: LeadFacts): Promise<SummaryResult> {
  if (DISABLED || !llmBudgetAvailable(agencyId, Date.now())) {
    return { summary: deterministicSummary(facts), source: "deterministic" };
  }
  const text = await callClaude(SUMMARY_SYSTEM_PROMPT, buildSummaryUser(facts));
  return resolveSummary(text, facts);
}
