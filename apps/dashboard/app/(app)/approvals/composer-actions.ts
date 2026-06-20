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
/** `windowClosed` is set when a send was rejected because the WhatsApp 24h
 *  window has closed — the composer flips to the re-engage affordance. */
type Err = { ok: false; error: string; windowClosed?: boolean };

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

/** The API tags a closed-window rejection with this stable code in the body. */
function isWindowClosed(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 422 &&
    typeof err.body === "object" &&
    err.body !== null &&
    (err.body as { code?: unknown }).code === "whatsapp_window_closed"
  );
}

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
    return { ok: false, error: err.message, windowClosed: isWindowClosed(err) };
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

/**
 * Rendered preview of the approved re-engagement template (`agency_followup_v1`)
 * for this lead — what the buyer will receive. Rendered server-side identically
 * to the send RPC. `body` is null when no template is available; the composer
 * shows a calm fallback rather than an empty box.
 */
export async function getReengagePreviewAction(
  leadId: string,
): Promise<Ok<{ body: string | null }> | Err> {
  try {
    const res = await apiFetch<{ ok: boolean; body: string | null }>(
      `/api/v1/whatsapp/reengage-preview?lead_id=${encodeURIComponent(leadId)}`,
    );
    return { ok: true, data: { body: res.body ?? null } };
  } catch (err) {
    return toErr("reengagePreview", err);
  }
}

/**
 * Send the approved re-engagement template to re-open a closed WhatsApp window.
 * The API maps every precondition failure (opted-out, no phone, cooldown, …) to
 * friendly copy; this forwards it. The outbound queued message lands in the
 * thread and transitions to sent/failed honestly via the send pipeline.
 */
export async function reengageAction(
  leadId: string,
): Promise<
  | Ok<{ send_queue_id: string; conversation_message_id: string; rendered_body: string }>
  | Err
> {
  try {
    const res = await apiFetch<{
      ok: boolean;
      send_queue_id: string;
      conversation_message_id: string;
      rendered_body: string;
    }>(`/api/v1/whatsapp/reengage`, {
      method: "POST",
      body: JSON.stringify({ lead_id: leadId }),
    });
    return {
      ok: true,
      data: {
        send_queue_id: res.send_queue_id,
        conversation_message_id: res.conversation_message_id,
        rendered_body: res.rendered_body,
      },
    };
  } catch (err) {
    return toErr("reengage", err);
  }
}
