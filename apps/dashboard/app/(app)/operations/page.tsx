import { apiFetch, ApiError } from "@/lib/api/client";
import { PageLoadError } from "@/components/shell/page-error";
import type { OperationsResponse } from "@/lib/api/types";

import { OperationsWorkspace } from "./operations-workspace";

export const dynamic = "force-dynamic";

/**
 * Command center / operations (F1 + F2 + F4) — honesty-first read surface.
 * Wired to GET /api/v1/operations, which aggregates LIVE signals only (failed
 * sends, the open action queue, provider health, lead-lifecycle health). No
 * illustration data; each section degrades to an honest "couldn't load" rather
 * than a fake state. Server-rendered (pure display + deep links into the inbox).
 */
export default async function OperationsPage() {
  let data: OperationsResponse | null = null;
  let loadFailed = false;

  try {
    data = await apiFetch<OperationsResponse>("/api/v1/operations");
  } catch (err) {
    loadFailed = true;
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[/operations] failed to load operations:", detail);
  }

  if (loadFailed || !data) {
    return <PageLoadError />;
  }

  return <OperationsWorkspace data={data} />;
}
