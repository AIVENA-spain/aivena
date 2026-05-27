"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bell, CalendarDays, Search } from "lucide-react";

import type { UserContext } from "@/lib/auth/context";
import { PRIMARY_NAV, ADMIN_NAV } from "./nav-config";
import { ThemeSwitcher } from "./theme-switcher";

function activeNavTKey(
  pathname: string,
): (typeof PRIMARY_NAV)[number]["tKey"] | "allAgencies" | "overview" {
  const all = [...PRIMARY_NAV, ...ADMIN_NAV];
  // Longest-prefix match so /approvals/:id resolves to the inbox item.
  const sorted = [...all].sort((a, b) => b.href.length - a.href.length);
  for (const item of sorted) {
    if (item.href === "/") {
      if (pathname === "/") return item.tKey;
    } else if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      return item.tKey;
    }
  }
  return "overview";
}

export function Topbar({
  ctx,
  greetingKey,
  dateLabel,
}: {
  ctx: UserContext;
  /** Pre-computed on the server so client hydration matches. */
  greetingKey: "greetingMorning" | "greetingAfternoon" | "greetingEvening";
  dateLabel: string;
}) {
  const pathname = usePathname();
  const tNav = useTranslations("nav");
  const tBar = useTranslations("topbar");

  const titleKey = activeNavTKey(pathname);
  const title = tNav(titleKey);
  const agencyName = ctx.activeAgency?.agency.displayName ?? "";
  const firstNameRaw = ctx.email.split("@")[0]?.split(".")[0] ?? "";
  const firstName = firstNameRaw
    ? firstNameRaw.charAt(0).toUpperCase() + firstNameRaw.slice(1)
    : "";
  const greeting = tBar(greetingKey);

  return (
    <header className="flex h-16 items-center gap-3 border-b border-border bg-card px-6">
      {/* Title + subtitle */}
      <div className="flex min-w-0 flex-col leading-tight">
        <h1 className="text-[19px] font-bold tracking-[-0.02em] text-foreground">
          {title}
        </h1>
        <p className="truncate text-[12.5px] text-muted-foreground">
          {greeting}
          {firstName ? `, ${firstName}` : ""} 👋
          {agencyName ? ` — ${agencyName}` : ""}
        </p>
      </div>

      {/* Right cluster */}
      <div className="ml-auto flex items-center gap-2">
        {/*
          Global search — visual only at this step. The form has no action
          and submission is a no-op; wiring (typeahead, scope to active
          agency) lands in a later step per the design plan.
        */}
        <form
          role="search"
          onSubmit={(e) => e.preventDefault()}
          className="hidden lg:block"
        >
          <label className="relative block">
            <span className="sr-only">{tBar("searchPlaceholder")}</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              autoComplete="off"
              spellCheck={false}
              placeholder={tBar("searchPlaceholder")}
              className="h-9 w-64 rounded-lg border border-border bg-card pl-8 pr-3 text-[12.5px] text-foreground shadow-soft placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </form>

        <div className="hidden items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-[12px] text-muted-foreground shadow-soft sm:flex">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
          <span>{dateLabel}</span>
        </div>

        <ThemeSwitcher />

        {/*
          Notification bell — visual only at Phase 1. The unread count is a
          // DATA-SEAM: bind to <notifications> read contract from Vega when ready.
          We deliberately do NOT show a fabricated badge.
        */}
        <button
          type="button"
          aria-label={tBar("notificationsLabel")}
          disabled
          className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-soft transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Bell className="h-4 w-4" aria-hidden strokeWidth={1.7} />
        </button>
      </div>
    </header>
  );
}
