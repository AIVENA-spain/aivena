import { apiFetch, ApiError } from "@/lib/api/client";
import { PageLoadError } from "@/components/shell/page-error";
import type { OperationsResponse } from "@/lib/api/types";

import { TasksWorkspace } from "./tasks-workspace";

export const dynamic = "force-dynamic";

/**
 * /tasks — the agency-facing task/action home (F7).
 *
 * Sourced from the read-only `/api/v1/operations` aggregate (`actionQueue.items`
 * = every open `dashboard_task`, each already carrying `inInbox`). This is the
 * home that conversation-less, task-backed leads never had: the assistant points
 * here, and Resolve uses the existing dismiss RPC (audited; history preserved).
 * Honesty-first: a real "couldn't load" state, never fabricated rows.
 */
export default async function TasksPage() {
  try {
    const data = await apiFetch<OperationsResponse>("/api/v1/operations");
    return <TasksWorkspace tasks={data.actionQueue.items} />;
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[/tasks] failed to load operations:", detail);
    return <PageLoadError />;
  }
}
