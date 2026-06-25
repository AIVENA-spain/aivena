"use server";

import { apiFetch, ApiError } from "@/lib/api/client";
import type { LeadIntel, LeadIntelResponse, WhatsappState } from "@/lib/api/types";

/**
 * Lead-intel server action — thin proxy onto GET /api/v1/leads/:leadId/intel,
 * the read-only buyer-profile / next-action / follow-up fields for the selected
 * lead (Day-2 Client Intelligence). The API owns tenant fencing and validation;
 * this layer forwards API-supplied friendly 4xx text and collapses anything else
 * to one calm line. Never surfaces status codes or DB detail (Law 2).
 */

const GENERIC = "Couldn't load this lead's details.";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

export async function getLeadIntelAction(
  leadId: string,
): Promise<Ok<LeadIntel> | Err> {
  try {
    const res = await apiFetch<LeadIntelResponse>(
      `/api/v1/leads/${encodeURIComponent(leadId)}/intel`,
    );
    return { ok: true, data: res.data };
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[lead-intel] load failed:", detail);
    if (err instanceof ApiError && err.status < 500 && err.message) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: GENERIC };
  }
}

/**
 * WhatsApp 24h-window state for the Conversation section. Reads the honest
 * `window_open` straight from dashboard_lead_whatsapp_state (the single source of
 * truth — never recomputed client-side). Non-WhatsApp leads / no history come
 * back as null data, which the UI renders as a calm "—". Friendly on failure.
 */
export async function getLeadWhatsappStateAction(
  leadId: string,
): Promise<Ok<WhatsappState | null> | Err> {
  try {
    const res = await apiFetch<{ ok: boolean; data: WhatsappState | null }>(
      `/api/v1/leads/${encodeURIComponent(leadId)}/whatsapp-state`,
    );
    return { ok: true, data: res.data ?? null };
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[lead-intel] whatsapp-state load failed:", detail);
    return { ok: false, error: "Couldn't load the conversation status." };
  }
}
