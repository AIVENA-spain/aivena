import { getLocale } from "next-intl/server";

import { apiFetch, ApiError } from "@/lib/api/client";
import { PageLoadError } from "@/components/shell/page-error";
import type { NeedsYouResponse } from "@/lib/api/types";

import { InboxWorkspace } from "./inbox-workspace";

export const dynamic = "force-dynamic";

/**
 * Inbox (lives at /approvals — URL preserved to avoid breaking deep-links).
 *
 * Server fetches the `needs-you` RPC (same source the Overview uses) — that
 * shape carries the lead_type we need to split Buyers from Sellers, plus the
 * area / channel fields the 3-pane summary expects. Conversation threads are
 * fetched lazily client-side per lead via a server action.
 *
 * The Overview's "Open in Inbox" link can pass `?lead=<taskId>` to pre-select
 * a lead in the workspace.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string }>;
}) {
  const { lead } = await searchParams;
  const locale = await getLocale();

  let rows: NeedsYouResponse["rows"] = [];
  let loadFailed = false;

  try {
    const res = await apiFetch<NeedsYouResponse>(
      "/api/v1/overview/needs-you?limit=100",
    );
    rows = res.rows;
  } catch (err) {
    loadFailed = true;
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[/approvals] failed to load needs-you:", detail);
  }

  if (loadFailed) {
    return <PageLoadError />;
  }

  return (
    <InboxWorkspace
      locale={locale}
      rows={rows}
      initialTaskId={lead}
    />
  );
}
