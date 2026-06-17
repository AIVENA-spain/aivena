"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { apiFetch, ApiError } from "@/lib/api/client";
import type { ApproveResponse } from "@/lib/api/types";

export type ActionState = {
  error?: string;
  /** True when the API rejected with whatsapp_window_closed — the composer
   *  should flip to the closed-window state (Part D). */
  windowClosed?: boolean;
};

/** The API tags this domain rejection with a stable code in the error body. */
function isWindowClosed(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 422 &&
    typeof err.body === "object" &&
    err.body !== null &&
    (err.body as { code?: unknown }).code === "whatsapp_window_closed"
  );
}

const APPROVE_FALLBACK =
  "Something went wrong sending this reply. Please try again — if it keeps happening, contact support.";
const DISMISS_FALLBACK =
  "Something went wrong dismissing this task. Please try again — if it keeps happening, contact support.";

/**
 * Convert any thrown error into a user-facing string.
 *
 * - HTTP 422 from the API means a domain rejection that the server mapped to
 *   a friendly message (e.g. "no conversation thread for this lead"). Show it.
 * - Anything else — 5xx, network blip, malformed response, unknown shape —
 *   is infrastructure; we log the technical detail server-side and return the
 *   calm fallback. The user never sees a status code or a raw stack string.
 */
function userFacingError(
  err: unknown,
  fallback: string,
  scope: string,
): string {
  const detail =
    err instanceof ApiError
      ? `${err.status} ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  console.error(`[${scope}] action failed:`, detail);

  if (err instanceof ApiError && err.status === 422) {
    return err.message;
  }
  return fallback;
}

export async function approveTaskAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const taskId = String(formData.get("taskId") ?? "").trim();
  const subjectRaw = String(formData.get("subject") ?? "");
  const bodyRaw = String(formData.get("body") ?? "");

  if (!taskId) {
    return { error: APPROVE_FALLBACK };
  }

  try {
    await apiFetch<ApproveResponse>(`/api/v1/tasks/${taskId}/approve`, {
      method: "POST",
      body: JSON.stringify({
        editedSubject: subjectRaw,
        editedBody: bodyRaw,
      }),
    });
  } catch (err) {
    return {
      error: userFacingError(err, APPROVE_FALLBACK, "approve"),
      windowClosed: isWindowClosed(err),
    };
  }

  revalidatePath("/approvals");
  revalidatePath("/");
  redirect("/approvals?approved=1");
}

export async function dismissTaskAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const taskId = String(formData.get("taskId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!taskId) {
    return { error: DISMISS_FALLBACK };
  }
  if (!reason) {
    return { error: "A reason is required." };
  }

  try {
    await apiFetch<{ ok: true }>(`/api/v1/tasks/${taskId}/dismiss`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  } catch (err) {
    return {
      error: userFacingError(err, DISMISS_FALLBACK, "dismiss"),
    };
  }

  revalidatePath("/approvals");
  revalidatePath("/");
  redirect("/approvals?dismissed=1");
}
