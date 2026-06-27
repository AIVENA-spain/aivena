"use server";

import { apiFetch, ApiError } from "@/lib/api/client";
import type { OperationsResponse } from "@/lib/api/types";
import { formatOperationsSummary } from "@/lib/assistant/operations-summary";

/**
 * AIVENA Assistant — read-only operational summary (no LLM).
 *
 * Thin server action over GET /api/v1/operations (the same aggregate the
 * Command Center renders), formatted into a plain-language "what needs your
 * attention" briefing. This is the assistant slice that works BEFORE the
 * Anthropic-DPA gate (N1/N2) opens the free-form chat reply. No provider call,
 * no new secret, no lead-private deep read, no write. Friendly errors only.
 */

const GENERIC = "Couldn't load your operations summary right now.";

export type AssistantSummaryResult =
  | { ok: true; summary: string }
  | { ok: false; error: string };

export async function getOperationsSummaryAction(): Promise<AssistantSummaryResult> {
  try {
    const data = await apiFetch<OperationsResponse>("/api/v1/operations");
    return { ok: true, summary: formatOperationsSummary(data) };
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[assistant/summary] load failed:", detail);
    return { ok: false, error: GENERIC };
  }
}
