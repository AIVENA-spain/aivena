import * as React from "react";

import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/ui-tone";

/**
 * Shared status pill / badge (2026 redesign). Replaces the ~6 hand-rolled inline
 * pill implementations (overview StatusPill, inbox StateBadge, tasks Pill,
 * agencies badges, matches fit pill). One restrained semantic palette driven by
 * `tone` (see lib/ui-tone). `soft` (default) = tinted; `solid` = filled (counts,
 * strong emphasis). Uppercase is opt-in via `uppercase` for the small SaaS pill.
 */

const SOFT: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground ring-border",
  success: "bg-brand-soft text-brand ring-brand/20",
  warning:
    "bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-300",
  danger: "bg-red-500/12 text-red-600 ring-red-500/25 dark:text-red-300",
  info: "bg-slate-500/10 text-slate-600 ring-slate-400/20 dark:text-slate-300",
};

const SOLID: Record<Tone, string> = {
  neutral: "bg-foreground text-background ring-transparent",
  success: "bg-brand text-brand-fg ring-transparent",
  warning: "bg-amber-500 text-white ring-transparent",
  danger: "bg-red-500 text-white ring-transparent",
  info: "bg-slate-600 text-white ring-transparent",
};

const SIZE = {
  sm: "px-1.5 py-[1px] text-[10px] gap-1",
  md: "px-2 py-0.5 text-[11px] gap-1",
} as const;

export function Badge({
  tone = "neutral",
  variant = "soft",
  size = "md",
  uppercase = false,
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & {
  tone?: Tone;
  variant?: "soft" | "solid";
  size?: keyof typeof SIZE;
  uppercase?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full font-semibold ring-1 ring-inset",
        SIZE[size],
        variant === "solid" ? SOLID[tone] : SOFT[tone],
        uppercase && "uppercase tracking-wide",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
