"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Pencil } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Settings compact-card grid (2026 compactness pass, per Christian's spec).
 * Summary-first: each area renders as a small card — status pill, 1–2 facts,
 * one clear action. The full (unchanged) section form only mounts into view
 * when the card is expanded; expanding one card collapses the others. Pure
 * presentation shell: all facts/forms are provided by the server page, so no
 * behavior, validation, or readiness logic changes here.
 */

export type SettingsCardDef = {
  id: string;
  icon: ReactNode;
  title: string;
  /** Status pill (StatusDot / StatusTag) — same truth the accordions showed. */
  status?: ReactNode;
  /** 1–2 compact fact lines/rows shown while collapsed. */
  facts: ReactNode;
  /** Localized label for the expand button ("Edit" / "Manage" / "View details"). */
  expandLabel: string;
  closeLabel: string;
  /** Optional extra action (e.g. an "Open Properties" link) next to expand. */
  extraAction?: ReactNode;
  /** Full section content (the existing form), mounted when expanded. */
  children: ReactNode;
  /** Full-width card (used for the bottom Plan & pilot strip). */
  wide?: boolean;
};

export function SettingsCards({ cards }: { cards: SettingsCardDef[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {cards.map((c) => {
        const open = openId === c.id;
        return (
          <section
            key={c.id}
            className={cn(
              "flex flex-col rounded-xl border border-border bg-card shadow-soft transition-shadow",
              (open || c.wide) && "sm:col-span-2",
              open && "shadow-elevated",
            )}
          >
            {/* Header */}
            <div className="flex items-center gap-2.5 px-4 pt-3.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                {c.icon}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground">
                {c.title}
              </span>
              {c.status ? <span className="shrink-0">{c.status}</span> : null}
            </div>

            {/* Facts (collapsed summary) */}
            <div className="px-4 pb-1 pt-2.5 text-[12.5px]">{c.facts}</div>

            {/* Actions */}
            <div className="mt-auto flex items-center gap-2 px-4 pb-3.5 pt-1.5">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : c.id)}
                aria-expanded={open}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted"
              >
                {open ? (
                  <ChevronDown className="h-3.5 w-3.5 rotate-180" aria-hidden />
                ) : (
                  <Pencil className="h-3 w-3" aria-hidden />
                )}
                {open ? c.closeLabel : c.expandLabel}
              </button>
              {c.extraAction}
            </div>

            {/* Expanded — the full existing section, unchanged */}
            {open ? (
              <div className="border-t border-border/60 px-4 pb-5 pt-3.5">
                {c.children}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/** One compact "label → value" fact row used inside card summaries. */
export function FactRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "good" | "warn" | "neutral";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-right font-medium",
          tone === "good"
            ? "text-brand"
            : tone === "warn"
              ? "text-amber-700 dark:text-amber-300"
              : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}
