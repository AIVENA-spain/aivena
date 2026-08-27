"use server";

import { apiFetch, ApiError } from "@/lib/api/client";

import { friendlyDismissError, isValidReason, GENERIC_DISMISS_ERROR } from "./tasks-model";

/**
 * Tasks action home (F7) — server actions. Thin proxy onto the existing
 * `POST /api/v1/tasks/:id/dismiss` (which calls `dismiss_dashboard_task`): it
 * sets the task to dismissed, stamps `handled_at`/`handled_by`/`dismissal_reason`
 * and writes an audited `lead_event`. NOTHING is deleted; history is preserved.
 *
 * The operator email is taken from the verified token server-side (never the
 * client). `reason` MUST be one of the RPC whitelist values (the operator picks
 * it) — otherwise the RPC raises `invalid_dismissal_reason`. Any error code is
 * mapped to friendly copy here so a raw RPC code can NEVER reach the UI (that was
 * the red-text bug: the API's friendly map has no entry for that code, so it
 * returned the raw token — we no longer forward `err.message` blindly).
 */

type Ok = { ok: true };
type Err = { ok: false; error: string };

/** Pull the stable RPC code from the API error (422 bodies carry `{error, code}`). */
function codeFromApiError(err: ApiError): string | null {
  const body = err.body;
  if (body && typeof body === "object" && "code" in body) {
    const code = (body as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  // Fall back to the message — for unmapped codes the API returns the raw token
  // there too, which friendlyDismissError will still catch or collapse.
  return typeof err.message === "string" ? err.message : null;
}

function toErr(err: unknown): Err {
  const detail =
    err instanceof ApiError
      ? `${err.status} ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  console.error("[tasks] dismiss failed:", detail);
  if (err instanceof ApiError) {
    // Map the code to friendly copy; unknown/raw codes collapse to GENERIC.
    return { ok: false, error: friendlyDismissError(codeFromApiError(err)) };
  }
  return { ok: false, error: GENERIC_DISMISS_ERROR };
}

/**
 * Mark a task resolved (dismiss) with an operator-chosen reason. Returns a
 * friendly result the UI renders inline — never throws to the client, never
 * surfaces a raw code or status.
 */
/**
 * Answer an amanda_question ticket (design §3b): one box, one click. The API
 * records the answer, marks the task handled, and queues Amanda's relay —
 * mode-governed (approval agencies get a relay draft; assisted/full auto-send).
 */
export async function answerQuestionAction(
  taskId: string,
  answer: string,
): Promise<Ok | Err> {
  const trimmed = answer.trim();
  if (!trimmed) {
    return { ok: false, error: "Write the answer first — one line is enough." };
  }
  try {
    await apiFetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/answer-question`, {
      method: "POST",
      body: JSON.stringify({ answer: trimmed.slice(0, 1200) }),
    });
    return { ok: true };
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[tasks] answer-question failed:", detail);
    return { ok: false, error: "Couldn't send that answer — please try again." };
  }
}

/**
 * One-tap booking confirm (design §4 ASSISTED): executes the buyer-confirmed
 * viewing through the same deterministic path the engine uses; Amanda then
 * tells the buyer it's locked in. A slot-taken race comes back as a friendly
 * error — the task is auto-handled and Amanda re-offers times to the buyer.
 */
export async function executeBookingAction(taskId: string): Promise<Ok | Err> {
  try {
    await apiFetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/execute-booking`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError && err.status === 422) {
      // Friendly copy comes from the API body; the task is already handled.
      const body = err.body as { error?: unknown } | null;
      const msg = body && typeof body.error === "string" ? body.error : null;
      return { ok: false, error: msg ?? "That slot is no longer available — Amanda will offer new times." };
    }
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[tasks] execute-booking failed:", detail);
    return { ok: false, error: "Couldn't confirm that booking — please try again." };
  }
}

export async function dismissTaskAction(
  taskId: string,
  reason: string,
): Promise<Ok | Err> {
  // Defence-in-depth: never send a reason the RPC will reject.
  if (!isValidReason(reason)) {
    return { ok: false, error: GENERIC_DISMISS_ERROR };
  }
  try {
    await apiFetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/dismiss`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    return { ok: true };
  } catch (err) {
    return toErr(err);
  }
}
