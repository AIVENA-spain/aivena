import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { apiFetch } from "@/lib/api/client";
import type { TasksResponse } from "@/lib/api/types";
import { getCurrentUserContext } from "@/lib/auth/context";
import { NoAgencyState } from "@/components/shell/no-agency-state";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

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

  const inboxCount = await getInboxCount();

  // Server-time greeting + date label. Locale-aware date format (uses the
  // user's UI language). Server timezone may differ from the user's; for
  // Spain/EU users on an EU server (Railway) this is accurate; the rare
  // mismatch ("Good evening" at the timezone boundary) is acceptable.
  const now = new Date();
  const locale = await getLocale();
  const greetingKey = greetingForHour(now.getHours());
  const dateLabel = now.toLocaleDateString(locale, {
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
