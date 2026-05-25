"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Building2,
  CheckSquare,
  ClipboardCheck,
  Home,
  Inbox,
  Megaphone,
  Phone,
  Settings,
  Shield,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import type { UserContext } from "@/lib/auth/context";
import { ADMIN_NAV, PRIMARY_NAV, type NavItem } from "./nav-config";
import { cn } from "@/lib/utils";

const ICONS: Record<NavItem["iconName"], LucideIcon> = {
  home: Home,
  approvals: ClipboardCheck,
  users: Users,
  inbox: Inbox,
  building: Building2,
  check: CheckSquare,
  phone: Phone,
  megaphone: Megaphone,
  team: UsersRound,
  settings: Settings,
  shield: Shield,
};

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  item,
  active,
  label,
}: {
  item: NavItem;
  active: boolean;
  label: string;
}) {
  const Icon = ICONS[item.iconName];
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span>{label}</span>
    </Link>
  );
}

export function Sidebar({ ctx }: { ctx: UserContext }) {
  const pathname = usePathname();
  const tNav = useTranslations("nav");
  const role = ctx.activeAgency?.role ?? null;

  const primary = role
    ? PRIMARY_NAV.filter((item) => item.roles.includes(role))
    : [];

  const admin = ctx.isAivenaStaff ? ADMIN_NAV : [];

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
      <div className="flex h-14 items-center border-b border-border px-5">
        <span className="font-mono text-sm font-medium tracking-[0.18em] text-foreground">
          AIVENA
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {primary.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(pathname, item.href)}
            label={tNav(item.tKey)}
          />
        ))}
      </nav>
      {admin.length > 0 ? (
        <div className="border-t border-border p-3">
          <div className="px-3 pb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {tNav("adminSectionLabel")}
          </div>
          <div className="flex flex-col gap-1">
            {admin.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isActive(pathname, item.href)}
                label={tNav(item.tKey)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
