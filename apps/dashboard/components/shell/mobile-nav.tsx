"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Menu, X } from "lucide-react";

import type { UserContext } from "@/lib/auth/context";
import { ADMIN_NAV, PRIMARY_NAV } from "./nav-config";
import { AccountChip } from "./account-chip";
import { NavLink, isActive } from "./sidebar";

/**
 * Mobile navigation (G3). Below `md` the desktop sidebar is `display:none`, so
 * without this the operator has no way to switch sections on a phone. This adds
 * a hamburger (in the topbar) that opens a left drawer with the SAME nav items,
 * reusing `NavLink` + `nav-config` + `AccountChip` — no new sections, no nav
 * changes (so `/tasks` and Command Center stay out, exactly as on desktop). The
 * whole thing is `md:hidden`; the desktop layout is untouched. Boring on purpose.
 */
export function MobileNav({
  ctx,
  inboxCount,
  brandName,
}: {
  ctx: UserContext;
  inboxCount: number | null;
  brandName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const tNav = useTranslations("nav");

  const role = ctx.activeAgency?.role ?? null;
  const primary = role ? PRIMARY_NAV.filter((item) => item.roles.includes(role)) : [];
  const admin = ctx.isAivenaStaff ? ADMIN_NAV : [];

  const close = () => setOpen(false);

  // Close on Escape while open (basic, boring; no full focus-trap).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Hamburger — mobile only; hidden from md up so desktop is unchanged. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-soft transition-colors hover:bg-muted hover:text-foreground md:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden strokeWidth={1.8} />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={tNav("brandName")}>
          {/* Backdrop — click to close */}
          <div
            className="absolute inset-0 bg-foreground/30 backdrop-blur-[1px]"
            onClick={close}
            aria-hidden
          />

          {/* Drawer panel — mirrors the desktop sidebar's structure/styling */}
          <aside className="absolute inset-y-0 left-0 flex w-[240px] max-w-[82%] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl">
            {/* Brand + close */}
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
              <button
                type="button"
                onClick={close}
                aria-label="Close menu"
                className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {/* Primary nav — same items as desktop; closes the drawer on navigate */}
            <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
              {primary.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={isActive(pathname, item.href)}
                  label={tNav(item.tKey)}
                  badge={item.tKey === "inbox" ? inboxCount : null}
                  soonLabel={tNav("soonBadge")}
                  onNavigate={close}
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
                      onNavigate={close}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {/* Account chip footer — same as desktop */}
            <div className="mt-auto border-t border-foreground/10">
              <AccountChip
                email={ctx.email}
                brandName={brandName}
                agencyDisplayName={ctx.activeAgency?.agency.displayName ?? null}
              />
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
