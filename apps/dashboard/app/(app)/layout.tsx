import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { apiFetch } from "@/lib/api/client";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n/config";
import { intlLocaleFor } from "@/lib/i18n/date-locale";
import type { TasksResponse } from "@/lib/api/types";
import { getCurrentUserContext } from "@/lib/auth/context";
import { NoAgencyState } from "@/components/shell/no-agency-state";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

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

  // ─── Cookie-vs-DB locale reconciliation ──────────────────────────────────
  // DB (`user_preferences.ui_language`) is authoritative for authenticated
  // users. The `aivena_ui_language` cookie is normally written by Settings,
  // but can drift (e.g. cookie set to "es" during earlier testing, DB later
  // set to "en"). When they disagree, `i18n/request.ts` honours the cookie
  // and we get the mixed-locale signature — English UI strings (from the
  // English-copy `messages/*.json`) plus Spanish Intl date output. This
  // block heals that drift on NEXT render (cookies read at request start
  // are already committed for THIS render). Two-tick self-heal is fine.
  //
  // Failure is silent: if the cookie write throws or the prefs row was
  // unreadable, we just skip reconciliation this render — locale resolution
  // continues to use whatever cookie value already exists.
  //
  // TODO(when-login-action-lands, pre-pilot): the login action should set
  // the cookie from `user_preferences.ui_language` at login time. That
  // eliminates the two-tick self-heal in favor of zero-tick.
  //
  // See FIX 1 diagnosis from 2026-05-27.
  try {
    if (ctx.uiLanguage && isLocale(ctx.uiLanguage)) {
      const cookieStore = await cookies();
      const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
      if (cookieLocale !== ctx.uiLanguage) {
        cookieStore.set(LOCALE_COOKIE, ctx.uiLanguage, {
          path: "/",
          maxAge: ONE_YEAR_SECONDS,
          sameSite: "lax",
        });
      }
    }
  } catch {
    // Cookie write failed (e.g. headers already sent) — fall through.
  }

  const inboxCount = await getInboxCount();

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
      <Sidebar ctx={ctx} inboxCount={inboxCount} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar ctx={ctx} greetingKey={greetingKey} dateLabel={dateLabel} />
        <main className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
