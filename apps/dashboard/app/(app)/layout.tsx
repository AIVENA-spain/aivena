import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { apiFetch } from "@/lib/api/client";
import { LOCALE_COOKIE, catalogLocaleFor } from "@/lib/i18n/config";
import { intlLocaleFor } from "@/lib/i18n/date-locale";
import type { SettingsResponse, TasksResponse } from "@/lib/api/types";
import { getCurrentUserContext } from "@/lib/auth/context";
import { NoAgencyState } from "@/components/shell/no-agency-state";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { AssistantWidget } from "@/components/shell/assistant-widget";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

type GreetingKey =
  | "greetingMorning"
  | "greetingAfternoon"
  | "greetingEvening";

function greetingForHour(hour: number): GreetingKey {
  if (hour < 12) return "greetingMorning";
  if (hour < 18) return "greetingAfternoon";
  return "greetingEvening";
}

async function getInboxCount(): Promise<number | null> {
  try {
    const res = await apiFetch<TasksResponse>(
      "/api/v1/tasks?type=suggested_reply&status=pending",
    );
    return res.tasks.length;
  } catch {
    // Silent fallback — the badge just doesn't show. The technical error
    // is already logged downstream by apiFetch's caller pattern.
    return null;
  }
}

async function getSettings(): Promise<SettingsResponse | null> {
  // One settings read serves two needs: the account-chip brand name AND the
  // agency-default dashboard language used in the locale precedence below.
  // Silent fallback to null — the chip falls back to displayName/email domain
  // and the locale falls back to the per-user value or English.
  try {
    return await apiFetch<SettingsResponse>("/api/v1/settings");
  } catch {
    return null;
  }
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getCurrentUserContext();
  if (!ctx) redirect("/login");

  if (ctx.memberships.length === 0) {
    return <NoAgencyState email={ctx.email} />;
  }

  const [inboxCount, settings] = await Promise.all([
    getInboxCount(),
    getSettings(),
  ]);
  const brandName = settings?.branding?.brand_name ?? null;

  // ─── Locale resolution + cookie reconciliation ───────────────────────────
  // Precedence (v1.14.5): the user's personal `ui_language` wins; falling back
  // to the agency's `dashboard_display_language` default; falling back to 'en'.
  // catalogLocaleFor() maps both code systems (per-user 'nb', agency 'no', and
  // the not-yet-shipped da/fi/pt) onto a catalog file that exists, so a fresh
  // agent with no personal preference still lands on the agency default without
  // a missing-catalog crash.
  //
  // The `aivena_ui_language` cookie is what `i18n/request.ts` reads at request
  // start. When the resolved locale and the cookie disagree, we heal on the
  // NEXT render (cookies for THIS render are already committed). Two-tick
  // self-heal is fine. Failure is silent.
  //
  // TODO(when-login-action-lands, pre-pilot): set the cookie at login time to
  // eliminate the two-tick self-heal in favor of zero-tick.
  try {
    const resolved = catalogLocaleFor(
      ctx.uiLanguage ?? settings?.dashboard_display_language ?? null,
    );
    const cookieStore = await cookies();
    const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
    if (cookieLocale !== resolved) {
      cookieStore.set(LOCALE_COOKIE, resolved, {
        path: "/",
        maxAge: ONE_YEAR_SECONDS,
        sameSite: "lax",
      });
    }
  } catch {
    // Cookie write failed (e.g. headers already sent) — fall through.
  }

  // Server-time greeting + date label. Locale-aware date format (uses the
  // user's UI language). Server timezone may differ from the user's; for
  // Spain/EU users on an EU server (Railway) this is accurate; the rare
  // mismatch ("Good evening" at the timezone boundary) is acceptable.
  const now = new Date();
  const locale = await getLocale();
  const greetingKey = greetingForHour(now.getHours());
  const dateLabel = now.toLocaleDateString(intlLocaleFor(locale), {
    day: "numeric",
    month: "short",
  });

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar ctx={ctx} inboxCount={inboxCount} brandName={brandName} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          ctx={ctx}
          greetingKey={greetingKey}
          dateLabel={dateLabel}
          inboxCount={inboxCount}
        />
        <main className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
      <AssistantWidget />
    </div>
  );
}
