"use server";

import { apiFetch, ApiError } from "@/lib/api/client";
import type { OperationsResponse } from "@/lib/api/types";
import { answerFor, type AssistantIntent } from "@/lib/assistant/operations-summary";

/**
 * AIVENA Assistant — read-only deterministic answers (no LLM).
 *
 * Thin server action over GET /api/v1/operations (the same aggregate the
 * Command Center reads). Given an intent ("today" / "wrong" / "tasks" /
 * "whatsapp") it returns a short, guiding, plain-language answer. This is the
 * assistant slice that works BEFORE the Anthropic-DPA gate (N1/N2) opens the
 * free-form / research chat. No provider call, no new secret, no lead-private
 * deep read, no write. Friendly errors only.
 */

const GENERIC = "Couldn't load your live data right now — please try again in a moment.";

export type AssistantAnswerResult =
  | { ok: true; answer: string }
  | { ok: false; error: string };

export async function getAssistantAnswerAction(intent: AssistantIntent): Promise<AssistantAnswerResult> {
  try {
    const data = await apiFetch<OperationsResponse>("/api/v1/operations");
    return { ok: true, answer: answerFor(intent, data) };
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[assistant/answer] load failed:", detail);
    return { ok: false, error: GENERIC };
  }
}
