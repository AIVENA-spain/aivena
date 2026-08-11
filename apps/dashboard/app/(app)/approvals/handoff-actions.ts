"use server";

import { apiFetch, ApiError } from "@/lib/api/client";

/**
 * Amanda Live L1 — "Needs a human" queue server actions. Thin proxies onto the
 * authenticated /api/v1/handoffs routes (RLS-fenced to the caller's agency).
 * Claiming/releasing never sends anything to the client — the actual contact
 * happens on WhatsApp/phone/email, gated elsewhere.
 */

export type HandoffRow = {
  lead_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  language: string | null;
  needs_human_since: string;
  human_claimed_by: string | null;
  human_claimed_at: string | null;
  conversation_id: string | null;
  last_message: string | null;
};

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

const GENERIC = "Couldn't load the handoff queue right now.";

export async function getHandoffQueueAction(): Promise<Ok<HandoffRow[]> | Err> {
  try {
    const res = await apiFetch<{ ok: boolean; data: HandoffRow[] }>("/api/v1/handoffs");
    return { ok: true, data: res.data ?? [] };
  } catch (err) {
    console.error("[handoffs] load failed:", err instanceof ApiError ? `${err.status} ${err.message}` : String(err));
    return { ok: false, error: GENERIC };
  }
}

export async function claimHandoffAction(leadId: string): Promise<{ ok: true; claimedBy: string | null } | Err> {
  try {
    const res = await apiFetch<{ ok: boolean; claimedBy: string | null }>(
      `/api/v1/handoffs/${encodeURIComponent(leadId)}/claim`,
      { method: "POST" },
    );
    return { ok: true, claimedBy: res.claimedBy ?? null };
  } catch (err) {
    if (err instanceof ApiError && err.status < 500 && err.message) return { ok: false, error: err.message };
    console.error("[handoffs] claim failed:", String(err));
    return { ok: false, error: "Couldn't claim this request — please refresh and try again." };
  }
}

export async function releaseHandoffAction(leadId: string): Promise<{ ok: true } | Err> {
  try {
    await apiFetch(`/api/v1/handoffs/${encodeURIComponent(leadId)}/release`, { method: "POST" });
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError && err.status < 500 && err.message) return { ok: false, error: err.message };
    console.error("[handoffs] release failed:", String(err));
    return { ok: false, error: "Couldn't release this request — please refresh and try again." };
  }
}
