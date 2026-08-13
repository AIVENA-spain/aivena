"use server";

import { apiFetch, ApiError } from "@/lib/api/client";
import type {
  ContactReadiness,
  LeadIntel,
  LeadIntelResponse,
  WhatsappState,
} from "@/lib/api/types";

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

/**
 * Deterministic contact readiness (get_lead_contact_readiness) for the right
 * panel — so its Next-best-action and the Suggest button obey the same truth as
 * the composer. Never recomputed client-side. Null data / failure → the panel
 * fails CLOSED (treats contact as unverified), never fabricating an available
 * action. Same RPC the composer consults.
 */
export async function getLeadContactReadinessAction(
  leadId: string,
): Promise<Ok<ContactReadiness | null> | Err> {
  try {
    const res = await apiFetch<{ ok: boolean; data: ContactReadiness | null }>(
      `/api/v1/leads/${encodeURIComponent(leadId)}/contact-readiness`,
    );
    return { ok: true, data: res.data ?? null };
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[lead-intel] contact-readiness load failed:", detail);
    return { ok: false, error: "Couldn't verify contact status." };
  }
}

export type BriefSummary = { summary: string; source: "llm" | "deterministic" };

/**
 * The AIVENA Brief natural-language summary (LLM-primary, deterministic
 * fallback — grounded strictly on the lead's structured facts + contactability
 * truth). Read-only. On failure the caller shows a calm loading/empty state
 * rather than fabricating a summary.
 */
export async function getLeadBriefSummaryAction(
  leadId: string,
): Promise<Ok<BriefSummary> | Err> {
  try {
    const res = await apiFetch<{ ok: boolean; data: BriefSummary }>(
      `/api/v1/leads/${encodeURIComponent(leadId)}/brief-summary`,
    );
    return { ok: true, data: res.data };
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[lead-intel] brief-summary load failed:", detail);
    return { ok: false, error: "Couldn't load the brief summary." };
  }
}

/**
 * Record an internal request that the AIVENA team approve this lead's
 * check-in template. SAFE: the API writes only an internal task/event and never
 * submits anything to Meta/Twilio. `deduped` is true when a request was already
 * pending (repeated clicks are a no-op).
 */
export async function requestTemplateAction(
  leadId: string,
): Promise<Ok<{ deduped: boolean }> | Err> {
  try {
    const res = await apiFetch<{ ok: boolean; deduped?: boolean }>(
      `/api/v1/leads/${encodeURIComponent(leadId)}/request-template`,
      { method: "POST", body: JSON.stringify({}) },
    );
    return { ok: true, data: { deduped: res.deduped === true } };
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[lead-intel] request-template failed:", detail);
    if (err instanceof ApiError && err.status < 500 && err.message) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: "Couldn't send the request — please try again." };
  }
}
