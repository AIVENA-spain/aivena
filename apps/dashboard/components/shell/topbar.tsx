"use client";

import { ChevronsUpDown, LogOut, ShieldCheck, UserCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { logoutAction } from "@/app/(auth)/actions";
import type { UserContext } from "@/lib/auth/context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const triggerClass =
  "flex h-9 items-center gap-2 rounded-md px-2 text-left font-normal hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "bg-green-500/15 text-green-700 dark:text-green-300 ring-green-500/30"
      : status === "trial" || status === "pilot"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30"
        : "bg-muted text-muted-foreground ring-border";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset ${tone}`}
    >
      {status}
    </span>
  );
}

export function Topbar({ ctx }: { ctx: UserContext }) {
  const t = useTranslations("topbar");
  const active = ctx.activeAgency;
  const showSwitcher = ctx.memberships.length > 1 || ctx.isAivenaStaff;

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex min-w-0 items-center gap-3">
        {active ? (
          showSwitcher ? (
            <DropdownMenu>
              <DropdownMenuTrigger className={triggerClass}>
                <AgencyLabel
                  name={active.agency.displayName}
                  region={active.agency.region}
                  status={active.agency.status}
                />
                <ChevronsUpDown
                  className="h-3.5 w-3.5 text-muted-foreground"
                  aria-hidden
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("switchAgency")}
                </DropdownMenuLabel>
                {ctx.memberships.map((m) => (
                  <DropdownMenuItem
                    key={m.agencyId}
                    className="flex flex-col items-start gap-0.5 py-2"
                    disabled
                  >
                    <span className="text-sm font-medium text-foreground">
                      {m.agency.displayName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {m.role} · {m.agency.region ?? "—"}
                    </span>
                  </DropdownMenuItem>
                ))}
                {ctx.isAivenaStaff ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem disabled className="gap-2">
                      <ShieldCheck className="h-4 w-4" aria-hidden />
                      {t("allAgenciesAdmin")}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="px-2">
              <AgencyLabel
                name={active.agency.displayName}
                region={active.agency.region}
                status={active.agency.status}
              />
            </div>
          )
        ) : (
          <span className="px-2 text-sm text-muted-foreground">
            {t("noActiveAgency")}
          </span>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger className={triggerClass} aria-label={t("userMenu")}>
          <UserCircle2
            className="h-5 w-5 text-muted-foreground"
            aria-hidden
          />
          <span className="hidden text-sm text-foreground sm:inline">
            {ctx.email}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("signedInAs")}
            </span>
            <span className="truncate text-sm font-medium text-foreground">
              {ctx.email}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <form action={logoutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground hover:bg-muted"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              {t("logOut")}
            </button>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

function AgencyLabel({
  name,
  region,
  status,
}: {
  name: string;
  region: string | null;
  status: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate text-sm font-medium text-foreground">
        {name}
      </span>
      {region ? (
        <span className="text-xs text-muted-foreground">· {region}</span>
      ) : null}
      <StatusBadge status={status} />
    </span>
  );
}
