import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Shared KPI / metric card (2026 redesign). Replaces the per-page inline KpiCard
 * definitions (overview, performance) so every metric across the dashboard reads
 * identically: a calm neutral icon chip, a large navy value, an optional green/
 * red delta, and an optional caption. No rainbow tones — the icon chip is neutral;
 * only the delta carries colour (up = green/good, down = red).
 */
export function MetricCard({
  icon: Icon,
  label,
  value,
  delta,
  caption,
  className,
}: {
  icon?: LucideIcon;
  label: string;
  value: React.ReactNode;
  /** Signed percentage/number delta. Positive → green up, negative → red down. */
  delta?: number | null;
  caption?: string | null;
  className?: string;
}) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const up = hasDelta && (delta as number) >= 0;
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-soft",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-medium text-muted-foreground">
          {label}
        </span>
        {Icon ? (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="h-4 w-4" aria-hidden strokeWidth={1.8} />
          </span>
        ) : null}
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="text-[28px] font-bold leading-none tracking-[-0.02em] text-foreground tabular-nums">
          {value}
        </span>
        {hasDelta ? (
          <span
            className={cn(
              "mb-0.5 inline-flex items-center gap-0.5 text-[11.5px] font-semibold",
              up ? "text-brand" : "text-red-600 dark:text-red-300",
            )}
          >
            {up ? (
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />
            )}
            {Math.abs(delta as number)}%
          </span>
        ) : null}
      </div>
      {caption ? (
        <span className="text-[11px] text-muted-foreground">{caption}</span>
      ) : null}
    </div>
  );
}
