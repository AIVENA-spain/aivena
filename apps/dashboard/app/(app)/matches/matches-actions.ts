"use server";

import { apiFetch, ApiError } from "@/lib/api/client";
import type {
  Match,
  MatchExplanationItem,
  MatchExplanationResponse,
} from "@/lib/api/types";

/**
 * Matches server actions — thin proxy onto the read-only Hono matches route,
 * used by the client <MatchedProperties> panel. The API owns validation and
 * collapses any DB failure to one calm message; this layer forwards API-supplied
 * friendly 4xx text and falls back to the generic line otherwise. Never surfaces
 * status codes or DB detail (Law 2).
 */

const GENERIC = "Couldn't load matches right now.";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

export async function getLeadMatchesAction(
  leadId: string,
): Promise<Ok<Match[]> | Err> {
  try {
    const res = await apiFetch<{ ok: boolean; data: Match[]; error?: string }>(
      `/api/v1/matches/${encodeURIComponent(leadId)}?limit=5`,
    );
    return { ok: true, data: res.data ?? [] };
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[matches] getLeadMatches failed:", detail);
    // API-supplied friendly 4xx messages pass through; anything else → generic.
    if (err instanceof ApiError && err.status < 500 && err.message) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: GENERIC };
  }
}

const EXPLAIN_GENERIC = "Couldn't load match details.";

/**
 * "Why matched" explanation for a lead's property matches (Day-2). Lazy /
 * expand-on-demand: pass a propertyId to focus a single card, or omit for all.
 * Read-only; API-supplied friendly 4xx text passes through, anything else →
 * the calm generic line (Law 2 — no codes/detail).
 */
export async function getMatchExplanationAction(
  leadId: string,
  propertyId?: string,
): Promise<Ok<MatchExplanationItem[]> | Err> {
  const qs = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";
  try {
    const res = await apiFetch<MatchExplanationResponse>(
      `/api/v1/matches/${encodeURIComponent(leadId)}/explanation${qs}`,
    );
    return { ok: true, data: res.matches ?? [] };
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[matches] getMatchExplanation failed:", detail);
    if (err instanceof ApiError && err.status < 500 && err.message) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: EXPLAIN_GENERIC };
  }
}

const SUGGEST_GENERIC =
  "Something went wrong — please try again, and contact support if it persists.";

/** Shape of the create_property_suggestion_task success envelope. */
type SuggestData = {
  task_id: string;
  conversation_id: string;
  channel?: string;
  match_count?: number;
  language?: string;
  preview?: string;
};

/**
 * Create a "suggest these matched properties" reply task for a lead. The API
 * (POST /api/v1/leads/:leadId/suggest-properties) calls
 * create_property_suggestion_task and returns the jsonb envelope. We forward
 * the API-supplied friendly message on {ok:false} and on 4xx ApiError; any
 * 5xx / unknown throw collapses to the calm generic line (Law 2 — no detail).
 */
export async function suggestPropertiesAction(
  leadId: string,
): Promise<Ok<SuggestData> | Err> {
  try {
    const res = await apiFetch<
      | ({ ok: true } & SuggestData)
      | { ok: false; error: string }
    >(`/api/v1/leads/${encodeURIComponent(leadId)}/suggest-properties`, {
      method: "POST",
      body: JSON.stringify({ limit: 4 }),
    });
    if (res.ok) {
      const { ok: _ok, ...data } = res;
      return { ok: true, data };
    }
    return { ok: false, error: res.error || SUGGEST_GENERIC };
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[matches] suggestProperties failed:", detail);
    // API-supplied friendly 4xx messages pass through; anything else → generic.
    if (err instanceof ApiError && err.status < 500 && err.message) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: SUGGEST_GENERIC };
  }
}
