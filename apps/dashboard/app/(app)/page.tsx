import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { apiFetch, ApiError } from "@/lib/api/client";
import { getCurrentUserContext } from "@/lib/auth/context";
import { PageLoadError } from "@/components/shell/page-error";
import type {
  ActivityResponse,
  NeedsYouResponse,
  OverviewKpisResponse,
} from "@/lib/api/types";
import { OverviewWorkspace } from "./overview/overview-workspace";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const ctx = await getCurrentUserContext();
  if (!ctx) redirect("/login");

  const locale = await getLocale();

  let kpis: OverviewKpisResponse | null = null;
  let needs: NeedsYouResponse = { rows: [] };
  let activity: ActivityResponse = { rows: [] };
  let loadFailed = false;

  try {
    const [kpisRes, needsRes, activityRes] = await Promise.all([
      apiFetch<OverviewKpisResponse>(
        "/api/v1/overview/kpis?period_days=7",
      ),
      apiFetch<NeedsYouResponse>("/api/v1/overview/needs-you?limit=50"),
      apiFetch<ActivityResponse>(
        "/api/v1/overview/recent-activity?limit=20",
      ),
    ]);
    kpis = kpisRes;
    needs = needsRes;
    activity = activityRes;
  } catch (err) {
    loadFailed = true;
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[/overview] failed to load:", detail);
  }

  if (loadFailed) {
    return <PageLoadError />;
  }

  return (
    <OverviewWorkspace
      locale={locale}
      kpis={kpis}
      needsYou={needs.rows}
      activity={activity.rows}
    />
  );
}
