"use server";

import { apiFetch, ApiError } from "@/lib/api/client";
import type { TaskDetailResponse } from "@/lib/api/types";

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
