"use server";

import { apiFetch, ApiError } from "@/lib/api/client";
import type { WhatsappState } from "@/lib/api/types";

/**
 * Composer server actions — thin proxies onto the Hono API for the persistent
 * inbox composer. The API owns validation and maps DB RAISE codes to friendly
 * messages; this layer forwards API-supplied friendly 4xx text (including the
 * WhatsApp-window-closed message) and collapses any 5xx / unknown throw to the
 * one calm generic line. NEVER redirects; never surfaces status codes or DB
 * detail (Law 2).
 */

const GENERIC =
  "Something went wrong sending that — please try again, and contact support if it keeps happening.";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

/** Pending suggested-reply task for the open conversation (null when none). */
export type PendingSuggestion = {
  id: string;
  message_body: string;
  /** The AI draft translated into the agency's language — read-only helper shown
   *  next to the editable lead-language draft. Null when no translation is needed
   *  (same-language lead) or it hasn't landed yet. */
  suggested_reply_translated_owner: string | null;
  ai_draft_pending: boolean;
  lead_language: string | null;
};

export type ComposerState = {
  pending: PendingSuggestion | null;
  whatsapp: WhatsappState | null;
};

/** Map a thrown error to a friendly string: API 4xx text passes through, else generic. */
function toErr(scope: string, err: unknown): Err {
  const detail =
    err instanceof ApiError
      ? `${err.status} ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  console.error(`[composer] ${scope} failed:`, detail);
  if (err instanceof ApiError && err.status < 500 && err.message) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: GENERIC };
}

/**
 * Fetch the composer state for the open conversation: the pending suggested
 * reply (if any) and — for WhatsApp leads — the 24h-window state. A WhatsApp
 * state lookup failure degrades to null (the window banner just doesn't show);
 * the approve/send RPC still guards a doomed send server-side.
 */
export async function getComposerStateAction(
  conversationId: string | null,
  leadId: string,
  channel: string | null,
): Promise<Ok<ComposerState> | Err> {
  try {
    let pending: PendingSuggestion | null = null;
    if (conversationId) {
      const res = await apiFetch<{
        ok: boolean;
        data: PendingSuggestion | null;
      }>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/pending-suggestion`);
      pending = res.data ?? null;
    }

    let whatsapp: WhatsappState | null = null;
    if ((channel ?? "").toLowerCase() === "whatsapp") {
      try {
        const res = await apiFetch<{ ok: boolean; data: WhatsappState | null }>(
          `/api/v1/leads/${encodeURIComponent(leadId)}/whatsapp-state`,
        );
        whatsapp = res.data ?? null;
      } catch (err) {
        // Degrade gracefully — the window banner is best-effort.
        console.error("[composer] whatsapp-state failed:", err);
      }
    }

    return { ok: true, data: { pending, whatsapp } };
  } catch (err) {
    return toErr("state", err);
  }
}

/**
 * Approve + send a pending suggested-reply task with the operator's (possibly
 * edited) text. Reuses the existing approve route, which returns the API's
 * friendly message on 4xx (incl. the WhatsApp-window-closed copy).
 */
export async function sendSuggestedAction(
  taskId: string,
  body: string,
): Promise<Ok<null> | Err> {
  try {
    await apiFetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/approve`, {
      method: "POST",
      body: JSON.stringify({ editedBody: body, editedSubject: null }),
    });
    return { ok: true, data: null };
  } catch (err) {
    return toErr("sendSuggested", err);
  }
}

/** Freeform send via send_custom_reply (no pending task). */
export async function sendFreeformAction(
  leadId: string,
  body: string,
  subject: string | null,
  channel: string,
): Promise<Ok<null> | Err> {
  try {
    await apiFetch(`/api/v1/leads/${encodeURIComponent(leadId)}/reply`, {
      method: "POST",
      body: JSON.stringify({ body, subject, channel }),
    });
    return { ok: true, data: null };
  } catch (err) {
    return toErr("sendFreeform", err);
  }
}

/** Dismiss a pending suggested-reply task (returns the composer to freeform). */
export async function dismissSuggestedAction(
  taskId: string,
): Promise<Ok<null> | Err> {
  try {
    await apiFetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/dismiss`, {
      method: "POST",
      body: JSON.stringify({ reason: "not_relevant" }),
    });
    return { ok: true, data: null };
  } catch (err) {
    return toErr("dismissSuggested", err);
  }
}
