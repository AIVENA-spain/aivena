"use server";

import { apiFetch, ApiError } from "@/lib/api/client";
import type { InboxEntryResponse, TaskDetailResponse } from "@/lib/api/types";

/**
 * Inbox thread loader. Called from the client when a lead is selected in the
 * Conversation view. Reuses the existing /api/v1/tasks/:id endpoint — no new
 * data plumbing — and returns a stable `{ ok, detail | reason }` shape so the
 * client can never see a raw error message. Technical detail is logged
 * server-side only.
 */
export async function loadTaskDetailAction(
  taskId: string,
): Promise<
  | { ok: true; detail: TaskDetailResponse }
  | { ok: false; status: "not_found" | "failed" }
> {
  if (!taskId) return { ok: false, status: "failed" };
  try {
    const detail = await apiFetch<TaskDetailResponse>(
      `/api/v1/tasks/${taskId}`,
    );
    return { ok: true, detail };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      console.error("[inbox] task detail not found:", taskId);
      return { ok: false, status: "not_found" };
    }
    const message =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[inbox] failed to load task detail:", taskId, message);
    return { ok: false, status: "failed" };
  }
}

/**
 * One named lead, opened directly (no task behind it) — Option A. Same stable
 * shape as the task loader; a missing or other-agency lead is "not_found".
 */
export async function loadLeadEntryAction(
  leadId: string,
): Promise<
  | { ok: true; entry: InboxEntryResponse }
  | { ok: false; status: "not_found" | "failed" }
> {
  if (!leadId) return { ok: false, status: "not_found" };
  try {
    const entry = await apiFetch<InboxEntryResponse>(
      `/api/v1/leads/${encodeURIComponent(leadId)}/inbox-entry`,
    );
    return { ok: true, entry };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
      console.error("[inbox] lead entry not found:", leadId);
      return { ok: false, status: "not_found" };
    }
    const message =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[inbox] failed to load lead entry:", leadId, message);
    return { ok: false, status: "failed" };
  }
}
