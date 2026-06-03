"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ImageIcon,
  Inbox,
  LayoutGrid,
  LineChart,
  Settings,
  Shield,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { UserContext } from "@/lib/auth/context";
import { ADMIN_NAV, PRIMARY_NAV, type NavItem } from "./nav-config";
import { cn } from "@/lib/utils";
import { AccountChip } from "./account-chip";

const ICONS: Record<NavItem["iconName"], LucideIcon> = {
  overview: LayoutGrid,
  inbox: Inbox,
  performance: LineChart,
  content: ImageIcon,
  studio: Sparkles,
  matches: Users,
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
  brandName,
}: {
  ctx: UserContext;
  /** Live count for the Inbox badge. Null while loading or unwired. */
  inboxCount: number | null;
  /**
   * Agency brand name from `dashboard_settings().branding.brand_name`. Threaded
   * through from the layout so the account chip popover stays consistent with
   * what Settings shows. Null tolerated — the chip falls back to displayName
   * (and finally the email domain) so the line is never blank.
   */
  brandName: string | null;
}) {
  const pathname = usePathname();
  const tNav = useTranslations("nav");
  const role = ctx.activeAgency?.role ?? null;

  const primary = role
    ? PRIMARY_NAV.filter((item) => item.roles.includes(role))
    : [];
  const admin = ctx.isAivenaStaff ? ADMIN_NAV : [];

  return (
    <aside className="hidden min-h-screen w-[210px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
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

      {/* Account chip — single-line footer row: avatar + email + chevron.
          The chip owns its own px-3 py-3 so this wrapper is just the
          top-border divider that anchors it to the sidebar foot. Popover
          (DropdownMenu) opens upward on click with the full identity row
          (full email, full brand name) and a sign-out action. Agency
          switcher is intentionally absent — multi-agency switching isn't
          supported yet, and the old switcher chip's double-ellipsis read
          as broken. */}
      <div className="mt-auto border-t border-foreground/10">
        <AccountChip
          email={ctx.email}
          brandName={brandName}
          agencyDisplayName={ctx.activeAgency?.agency.displayName ?? null}
        />
      </div>
    </aside>
  );
}
