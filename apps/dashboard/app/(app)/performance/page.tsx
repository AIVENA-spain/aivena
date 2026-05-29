import { apiFetch, ApiError } from "@/lib/api/client";
import { PageLoadError } from "@/components/shell/page-error";
import type { PerformanceResponse } from "@/lib/api/types";

import { PerformanceWorkspace } from "./performance-workspace";

export const dynamic = "force-dynamic";

/**
 * Performance — honesty-first (Law 1: NOT a demo-allowed surface). Wired to the
 * dashboard_performance RPC; renders real aggregates or honest empty/low-sample
 * states, never illustration numbers. Server-rendered (pure display, no
 * interactivity); the Daily/Weekly/Monthly toggle is intentionally omitted —
 * range is fixed week-to-date for the pilot (the RPC is already param'd).
 */
export default async function PerformancePage() {
  let data: PerformanceResponse | null = null;
  let loadFailed = false;

  try {
    data = await apiFetch<PerformanceResponse>("/api/v1/overview/performance");
  } catch (err) {
    loadFailed = true;
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[/performance] failed to load performance:", detail);
  }

  if (loadFailed || !data) {
    return <PageLoadError />;
  }

  return <PerformanceWorkspace data={data} />;
}
