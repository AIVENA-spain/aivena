"use server";

import { apiFetch, ApiError } from "@/lib/api/client";
import type { MatchingBuyer } from "./reverse-prospect-model";

/**
 * Reverse-prospecting server actions (P2-G) — thin proxies onto the read-only
 * matcher + the approval-first draft endpoint. Neither sends anything: the draft
 * creates a pending suggested-reply Inbox task the agent approves/sends later.
 */

const GENERIC = "Couldn't load matching buyers right now.";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

export async function getMatchingBuyersAction(
  propertyId: string,
): Promise<Ok<MatchingBuyer[]> | Err> {
  try {
    const res = await apiFetch<{ ok: boolean; data: MatchingBuyer[] }>(
      `/api/v1/matches/property/${encodeURIComponent(propertyId)}/buyers`,
    );
    return { ok: true, data: res.data ?? [] };
  } catch (err) {
    const detail =
      err instanceof ApiError ? `${err.status} ${err.message}` : String(err);
    console.error("[reverse-prospect] load failed:", detail);
    if (err instanceof ApiError && err.status < 500 && err.message) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: GENERIC };
  }
}

/**
 * Draft approval-first outreach about this listing to a matched buyer. Creates a
 * pending suggested-reply task in that buyer's Inbox conversation — the agent
 * reviews/edits/approves/sends. NEVER sends here.
 */
export async function draftProspectAction(
  propertyId: string,
  leadId: string,
): Promise<{ ok: true } | Err> {
  try {
    await apiFetch(
      `/api/v1/matches/property/${encodeURIComponent(propertyId)}/prospect/${encodeURIComponent(leadId)}`,
      { method: "POST" },
    );
    return { ok: true };
  } catch (err) {
    const detail =
      err instanceof ApiError ? `${err.status} ${err.message}` : String(err);
    console.error("[reverse-prospect] draft failed:", detail);
    if (err instanceof ApiError && err.status < 500 && err.message) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: "Couldn't draft that outreach — please try again." };
  }
}
