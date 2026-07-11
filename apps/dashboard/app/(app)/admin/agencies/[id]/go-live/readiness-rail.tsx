import { Card } from "@/components/ui/card";
import type { ReadinessResponse } from "@/lib/api/types";
import { isDone } from "@/app/(app)/settings/sections/readiness-display";

import { visibleBlockers } from "./go-live-display";

/**
 * Right-rail readiness summary for the admin go-live screen (approved mockups).
 * Pure display over the SAME server recompute the page already renders — the
 * ring % is done/total of the real readiness items, the blocker count is the
 * real (self-filtered) blockedBy list. Never invents "ready"; adds no actions.
 * English-only (admin surface).
 */
export function ReadinessRail({ readiness }: { readiness: ReadinessResponse }) {
  const total = readiness.items.length;
  const done = readiness.items.filter((i) => isDone(i.status)).length;
  const blockers = visibleBlockers(readiness.goLive.blockedBy).length;
  const inProgress = Math.max(0, total - done);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // SVG progress ring — r=34, C = 2πr ≈ 213.6.
  const C = 213.6;
  const dash = (pct / 100) * C;
  const ringColor =
    blockers > 0 ? "text-amber-500" : pct === 100 ? "text-brand" : "text-brand";

  return (
    <Card className="gap-4 p-4">
      <h2 className="text-sm font-semibold text-foreground">Readiness summary</h2>

      <div className="flex items-center gap-4">
        <div className="relative h-20 w-20 shrink-0">
          <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
            <circle
              cx="40" cy="40" r="34" fill="none"
              className="stroke-muted" strokeWidth="7"
            />
            <circle
              cx="40" cy="40" r="34" fill="none"
              className={`stroke-current ${ringColor}`}
              strokeWidth="7" strokeLinecap="round"
              strokeDasharray={`${dash} ${C - dash}`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[17px] font-bold leading-none text-foreground tabular-nums">
              {pct}%
            </span>
            <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
              ready
            </span>
          </div>
        </div>

        <ul className="flex min-w-0 flex-col gap-1.5 text-[12.5px]">
          <li className="flex items-center gap-2">
            <span aria-hidden className="h-2 w-2 rounded-full bg-brand" />
            <span className="font-semibold text-foreground tabular-nums">{done}</span>
            <span className="text-muted-foreground">Complete</span>
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="font-semibold text-foreground tabular-nums">{inProgress}</span>
            <span className="text-muted-foreground">Need action</span>
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden className="h-2 w-2 rounded-full bg-red-500" />
            <span className="font-semibold text-foreground tabular-nums">{blockers}</span>
            <span className="text-muted-foreground">Go-live blockers</span>
          </li>
        </ul>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Last checked{" "}
        {new Date(readiness.computedAt).toLocaleString(undefined, {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })}
        {" · "}re-computed on every status change.
      </p>
    </Card>
  );
}
