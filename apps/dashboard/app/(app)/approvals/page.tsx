import { getLocale } from "next-intl/server";

import { apiFetch, ApiError } from "@/lib/api/client";
import { PageLoadError } from "@/components/shell/page-error";
import type { InboxResponse, SettingsResponse } from "@/lib/api/types";

import { InboxWorkspace } from "./inbox-workspace";

/**
 * Build an author_user_id → email map from the team read-contract so notes can
 * show who wrote them (never the raw uuid). Best-effort: a failed settings load
 * just means notes fall back to a calm "Teammate" label — never blocks the inbox.
 */
async function getAuthorMap(): Promise<Record<string, string>> {
  try {
    const res = await apiFetch<SettingsResponse>("/api/v1/settings");
    const map: Record<string, string> = {};
    for (const m of res.team?.members ?? []) {
      if (m.user_id && m.email) map[m.user_id] = m.email;
    }
    return map;
  } catch {
    return {};
  }
}

export const dynamic = "force-dynamic";

/**
 * Inbox (lives at /approvals — URL preserved to avoid breaking deep-links).
 *
 * Server fetches the `dashboard_inbox` RPC — it spans every bucket
 * (needs_you + handled_*) so a conversation stays visible after Approve & Send,
 * and carries the conversation id, the cleaned latest-inbound preview, and the
 * last-outbound classification the state badges need. Conversation threads are
 * fetched lazily client-side per lead via a server action.
 *
 * The Overview's "Open in Inbox" link can pass `?lead=<taskId>` to pre-select
 * a lead in the workspace.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string; leadId?: string }>;
}) {
  const { lead, leadId } = await searchParams;
  const locale = await getLocale();

  let rows: InboxResponse["rows"] = [];
  let loadFailed = false;
  let authors: Record<string, string> = {};

  try {
    // Inbox is the critical load; the author map is best-effort alongside it.
    const [res, authorMap] = await Promise.all([
      apiFetch<InboxResponse>("/api/v1/overview/inbox?limit=100&days=30"),
      getAuthorMap(),
    ]);
    rows = res.rows;
    authors = authorMap;
  } catch (err) {
    loadFailed = true;
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[/approvals] failed to load inbox:", detail);
  }

  if (loadFailed) {
    return <PageLoadError />;
  }

  return (
    <InboxWorkspace
      locale={locale}
      rows={rows}
      initialTaskId={lead}
      initialLeadId={leadId}
      authors={authors}
    />
  );
}
