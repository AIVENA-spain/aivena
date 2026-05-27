"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ChevronsUpDown,
  ImageIcon,
  Inbox,
  LayoutGrid,
  LineChart,
  LogOut,
  Settings,
  Shield,
  type LucideIcon,
} from "lucide-react";

import { logoutAction } from "@/app/(auth)/actions";
import type { UserContext } from "@/lib/auth/context";
import { userInitial } from "@/lib/auth/initials";
import { ADMIN_NAV, PRIMARY_NAV, type NavItem } from "./nav-config";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ICONS: Record<NavItem["iconName"], LucideIcon> = {
  overview: LayoutGrid,
  inbox: Inbox,
  performance: LineChart,
  content: ImageIcon,
  settings: Settings,
  admin: Shield,
};

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  item,
  active,
  label,
  badge,
  soonLabel,
}: {
  item: NavItem;
  active: boolean;
  label: string;
  badge?: number | null;
  /** Localized label for the "Soon" pill, only rendered if item.soon is set. */
  soonLabel: string;
}) {
  const Icon = ICONS[item.iconName];
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2.5 rounded-[9px] px-3 py-2 text-[13px] font-medium transition-colors",
        active
          ? "bg-brand-soft text-brand"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden strokeWidth={1.8} />
      <span className="truncate">{label}</span>
      {item.soon ? (
        <span
          className={cn(
            "ml-auto whitespace-nowrap rounded-full px-1.5 py-[1px] font-mono text-[8.5px] font-medium uppercase tracking-[0.04em]",
            active
              ? "bg-brand text-brand-fg"
              : "bg-muted text-muted-foreground",
          )}
        >
          {soonLabel}
        </span>
      ) : typeof badge === "number" && badge > 0 ? (
        <span
          className={cn(
            "ml-auto rounded-full px-1.5 py-[1px] text-[10px] font-semibold",
            active
              ? "bg-brand text-brand-fg"
              : "bg-foreground text-background",
          )}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

export function Sidebar({
  ctx,
  inboxCount,
}: {
  ctx: UserContext;
  /** Live count for the Inbox badge. Null while loading or unwired. */
  inboxCount: number | null;
}) {
  const pathname = usePathname();
  const tNav = useTranslations("nav");
  const tBar = useTranslations("topbar");
  const role = ctx.activeAgency?.role ?? null;

  const primary = role
    ? PRIMARY_NAV.filter((item) => item.roles.includes(role))
    : [];
  const admin = ctx.isAivenaStaff ? ADMIN_NAV : [];

  const active = ctx.activeAgency;
  const showSwitcher = ctx.memberships.length > 1 || ctx.isAivenaStaff;
  const initial = userInitial(ctx);
  const userLabel = ctx.email;
  const subLabel = active?.agency.displayName ?? tBar("noActiveAgency");

  return (
    <aside className="hidden h-screen w-[210px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      {/* Brand block */}
      <div className="flex items-center gap-2.5 px-4 pt-5 pb-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-[14px] font-bold leading-none text-brand">
          A
        </div>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-[13px] font-bold tracking-[0.02em] text-foreground">
            {tNav("brandName")}
          </span>
          <span className="font-mono text-[9.5px] tracking-[0.02em] text-muted-foreground">
            {tNav("brandSubtitle")}
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
        {primary.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(pathname, item.href)}
            label={tNav(item.tKey)}
            badge={item.tKey === "inbox" ? inboxCount : null}
            soonLabel={tNav("soonBadge")}
          />
        ))}
      </nav>

      {/* AIVENA Admin (staff only) */}
      {admin.length > 0 ? (
        <div className="border-t border-sidebar-border px-3 pt-3 pb-2">
          <div className="px-3 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {tNav("adminSectionLabel")}
          </div>
          <div className="flex flex-col gap-0.5">
            {admin.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isActive(pathname, item.href)}
                label={tNav(item.tKey)}
                soonLabel={tNav("soonBadge")}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* User / agency footer pin — dropdown for switcher + log-out */}
      <div className="border-t border-sidebar-border p-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex w-full items-center gap-2.5 rounded-[9px] p-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={tBar("userMenu")}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-[12px] font-semibold text-background">
              {initial}
            </span>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-[12.5px] font-semibold text-foreground">
                {userLabel}
              </span>
              <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                {subLabel}
              </span>
            </span>
            <ChevronsUpDown
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-60">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {tBar("signedInAs")}
              </span>
              <span className="truncate text-sm font-medium text-foreground">
                {ctx.email}
              </span>
            </DropdownMenuLabel>
            {showSwitcher ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {tBar("switchAgency")}
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
                      {m.role}
                      {m.agency.region ? ` · ${m.agency.region}` : ""}
                    </span>
                  </DropdownMenuItem>
                ))}
                {ctx.isAivenaStaff ? (
                  <DropdownMenuItem disabled className="gap-2">
                    <Shield className="h-4 w-4" aria-hidden />
                    {tBar("allAgenciesAdmin")}
                  </DropdownMenuItem>
                ) : null}
              </>
            ) : null}
            <DropdownMenuSeparator />
            <form action={logoutAction}>
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground hover:bg-muted"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                {tBar("logOut")}
              </button>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
