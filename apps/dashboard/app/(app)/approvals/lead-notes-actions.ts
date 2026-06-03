"use server";

import { apiFetch, ApiError } from "@/lib/api/client";
import type { LeadNoteRow, LeadNotesResponse } from "@/lib/api/types";

/**
 * Lead-notes server actions — thin proxies onto the Hono lead-notes route. The
 * API owns validation and maps DB RAISE codes to friendly messages; this layer
 * just forwards and collapses any unexpected failure to a friendly string.
 * Never surfaces status codes or DB detail.
 */

const GENERIC = "Something went wrong — please try again, and contact support if it persists.";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

function toErr(scope: string, err: unknown): Err {
  const detail =
    err instanceof ApiError
      ? `${err.status} ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  console.error(`[lead-notes] ${scope} failed:`, detail);
  // API-supplied friendly messages (4xx) pass through; anything else → generic.
  if (err instanceof ApiError && err.status < 500 && err.message) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: GENERIC };
}

export async function listLeadNotesAction(
  leadId: string,
): Promise<Ok<LeadNoteRow[]> | Err> {
  try {
    const res = await apiFetch<LeadNotesResponse>(
      `/api/v1/lead-notes?leadId=${encodeURIComponent(leadId)}`,
    );
    return { ok: true, data: res.notes };
  } catch (err) {
    return toErr("list", err);
  }
}

export async function addLeadNoteAction(
  leadId: string,
  body: string,
): Promise<Ok<null> | Err> {
  try {
    await apiFetch("/api/v1/lead-notes", {
      method: "POST",
      body: JSON.stringify({ leadId, body }),
    });
    return { ok: true, data: null };
  } catch (err) {
    return toErr("add", err);
  }
}

export async function updateLeadNoteAction(
  noteId: string,
  body: string,
): Promise<Ok<null> | Err> {
  try {
    await apiFetch(`/api/v1/lead-notes/${encodeURIComponent(noteId)}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    });
    return { ok: true, data: null };
  } catch (err) {
    return toErr("update", err);
  }
}

export async function deleteLeadNoteAction(
  noteId: string,
): Promise<Ok<null> | Err> {
  try {
    await apiFetch(`/api/v1/lead-notes/${encodeURIComponent(noteId)}`, {
      method: "DELETE",
    });
    return { ok: true, data: null };
  } catch (err) {
    return toErr("delete", err);
  }
}

export async function toggleNoteAiContextAction(
  noteId: string,
  contextForAi: boolean,
): Promise<Ok<null> | Err> {
  try {
    await apiFetch(`/api/v1/lead-notes/${encodeURIComponent(noteId)}/ai-context`, {
      method: "POST",
      body: JSON.stringify({ contextForAi }),
    });
    return { ok: true, data: null };
  } catch (err) {
    return toErr("toggle", err);
  }
}
