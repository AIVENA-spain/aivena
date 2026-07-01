"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Sub-nav for a single agency. Overview ships in Phase 1; Settings, Branding,
 * Team and Audit arrive in later phases and render as disabled "Soon" tabs
 * until then.
 */
const TABS: { key: string; label: string; seg: string; ready: boolean }[] = [
  { key: "overview", label: "Overview", seg: "", ready: true },
  { key: "golive", label: "Go-Live", seg: "go-live", ready: true },
  { key: "settings", label: "Settings", seg: "settings", ready: false },
  { key: "branding", label: "Branding", seg: "branding", ready: false },
  { key: "team", label: "Team", seg: "team", ready: false },
  { key: "audit", label: "Audit", seg: "audit", ready: false },
];

export function AgencyTabs({ agencyId }: { agencyId: string }) {
  const pathname = usePathname();
  const base = `/admin/agencies/${agencyId}`;

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border">
      {TABS.map((t) => {
        const href = t.seg ? `${base}/${t.seg}` : base;
        const active = t.seg
          ? pathname === href
          : pathname === base;
        if (!t.ready) {
          return (
            <span
              key={t.key}
              className="flex cursor-not-allowed items-center gap-1.5 whitespace-nowrap px-3 py-2 text-[13px] text-muted-foreground/60"
              title="Coming in a later phase"
            >
              {t.label}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                Soon
              </span>
            </span>
          );
        }
        return (
          <Link
            key={t.key}
            href={href}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] transition-colors",
              active
                ? "border-brand font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
