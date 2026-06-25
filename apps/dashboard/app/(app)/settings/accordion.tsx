"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Settings accordion section — a collapsible card matching the finalized
 * accordion mockup. The header carries an icon, title, subtitle and a status
 * slot (dot / tag / badge); the body animates open via the grid-rows trick.
 * Each section owns its open state; `defaultOpen` opens it on first render.
 */
export function AccordionSection({
  icon,
  title,
  subtitle,
  status,
  defaultOpen,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  status?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));

  return (
    <section className="overflow-hidden rounded-xl bg-card text-card-foreground shadow-elevated ring-1 ring-foreground/10">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3.5 px-5 py-4 text-left transition-colors hover:bg-muted/40"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-muted text-muted-foreground">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-tight text-foreground">{title}</span>
          {subtitle ? (
            <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">{subtitle}</span>
          ) : null}
        </span>
        {status ? <span className="flex shrink-0 items-center">{status}</span> : null}
        <ChevronDown
          aria-hidden
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div className={`grid transition-all duration-200 ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <div className="border-t border-border/60 px-5 pb-6 pt-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

/** Small status chips used in the accordion headers + setup strip. */
export function StatusDot() {
  return <span aria-hidden className="h-2 w-2 rounded-full bg-brand" />;
}

export function StatusTag({ tone, children }: { tone: "warn" | "neutral"; children: ReactNode }) {
  const cls =
    tone === "warn"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
      : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${cls}`}>{children}</span>
  );
}
