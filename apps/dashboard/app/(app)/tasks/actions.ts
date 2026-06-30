"use server";

import { apiFetch, ApiError } from "@/lib/api/client";

/**
 * Tasks action home (F7) — server actions. Thin proxy onto the existing
 * `POST /api/v1/tasks/:id/dismiss` (which calls `dismiss_dashboard_task`): it
 * sets the task to dismissed, stamps `handled_at`/`handled_by`/`dismissal_reason`
 * and writes an audited `lead_event`. NOTHING is deleted; history is preserved.
 *
 * The operator email is taken from the verified token server-side (never the
 * client). The API maps DB RAISE codes (e.g. an already-handled task) to a calm
 * friendly 4xx message — we forward that text and collapse any 5xx/unknown to a
 * single generic line (Law 2: no status codes / DB detail to the user).
 */

const GENERIC =
  "Something went wrong updating that task — please try again, and contact support if it keeps happening.";

type Ok = { ok: true };
type Err = { ok: false; error: string };

function toErr(err: unknown): Err {
  const detail =
    err instanceof ApiError
      ? `${err.status} ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  console.error("[tasks] dismiss failed:", detail);
  // Forward the API's friendly 4xx copy (e.g. "already resolved"); else generic.
  if (err instanceof ApiError && err.status < 500 && err.message) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: GENERIC };
}

/**
 * Mark a task resolved (dismiss). `reason` is required by the API; the workspace
 * passes a stable audit reason. Returns a friendly result the UI can render
 * inline — never throws to the client.
 */
export async function dismissTaskAction(
  taskId: string,
  reason: string,
): Promise<Ok | Err> {
  const trimmed = reason.trim();
  if (!trimmed) {
    return { ok: false, error: "A reason is required to resolve a task." };
  }
  try {
    await apiFetch(`/api/v1/tasks/${encodeURIComponent(taskId)}/dismiss`, {
      method: "POST",
      body: JSON.stringify({ reason: trimmed }),
    });
    return { ok: true };
  } catch (err) {
    return toErr(err);
  }
}
