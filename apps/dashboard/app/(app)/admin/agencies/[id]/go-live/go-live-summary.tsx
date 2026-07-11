import { AlertTriangle, Ban, CheckCircle2, Lock, PauseCircle, Rocket } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import type { ReadinessResponse } from "@/lib/api/types";

import {
  visibleBlockers,
  blockerLabel,
  goLiveState,
  GO_LIVE_STATE_LABEL,
  PILOT_STATUS_LABEL,
  type GoLiveState,
} from "./go-live-display";

/**
 * Top-of-page verdict for the admin go-live screen (issue B): answers "is this
 * agency ready, and if not, why?" before the operator reads anything else. Pure
 * display over the server's readiness recompute — it never invents "ready"; the
 * verdict is derived from the real (self-blocker-filtered) blocker list and the
 * live pilot_status. English-only (admin surface).
 */

const STATE_STYLE: Record<
  GoLiveState,
  { card: string; iconWrap: string; Icon: typeof AlertTriangle }
> = {
  live: {
    card: "border-brand/30 bg-brand-soft/60",
    iconWrap: "bg-brand-soft text-brand",
    Icon: Rocket,
  },
  ready: {
    card: "border-brand/25 bg-brand-soft/40",
    iconWrap: "bg-brand-soft text-brand",
    Icon: CheckCircle2,
  },
  not_ready: {
    card: "border-amber-300 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10",
    iconWrap: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
    Icon: AlertTriangle,
  },
  paused: {
    card: "border-amber-300 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10",
    iconWrap: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
    Icon: PauseCircle,
  },
  blocked: {
    card: "border-red-300 bg-red-50/60 dark:border-red-500/30 dark:bg-red-500/10",
    iconWrap: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
    Icon: Ban,
  },
};

export function GoLiveSummary({ readiness }: { readiness: ReadinessResponse }) {
  const blockers = visibleBlockers(readiness.goLive.blockedBy);
  const state = goLiveState(readiness.pilotStatus, blockers.length);
  const style = STATE_STYLE[state];
  const Icon = style.Icon;

  const itemById = new Map(readiness.items.map((i) => [i.id, i]));
  const reasons = blockers.map((id) => blockerLabel(id, itemById.get(id)?.label ?? id));
  const shown = reasons.slice(0, 4);
  const more = reasons.length - shown.length;

  const sentence =
    state === "not_ready"
      ? `This agency is not ready because ${blockers.length} check${blockers.length === 1 ? "" : "s"} still need action:`
      : state === "ready"
        ? "No readiness blockers. Going live still needs the four manual confirmations below."
        : state === "live"
          ? "This agency is live."
          : state === "paused"
            ? "This agency is paused — resume it from the controls below."
            : "This agency is blocked — review the controls below.";

  return (
    <Card className={cn("gap-3 border-2 p-4", style.card)}>
      <div className="flex items-start gap-3">
        <span className={cn("flex h-9 w-9 flex-none items-center justify-center rounded-lg", style.iconWrap)}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-foreground">{GO_LIVE_STATE_LABEL[state]}</span>
            <span className="text-[11px] text-muted-foreground">
              pilot status:{" "}
              <span className="font-medium capitalize text-foreground">
                {readiness.pilotStatus ? PILOT_STATUS_LABEL[readiness.pilotStatus] : "unknown"}
              </span>
            </span>
          </div>
          <p className="text-[13px] text-muted-foreground">{sentence}</p>
        </div>
      </div>

      {state === "not_ready" ? (
        <ul className="flex flex-col gap-1 pl-1 text-[12.5px] text-foreground">
          {shown.map((r, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-amber-500" aria-hidden />
              {r}
            </li>
          ))}
          {more > 0 ? (
            <li className="pl-3 text-[12px] text-muted-foreground">+ {more} more (see the checks below)</li>
          ) : null}
        </ul>
      ) : null}

      {/* Go-live lock line — always shown until the agency is actually live. */}
      {state !== "live" ? (
        <div className="flex items-center gap-1.5 rounded-md bg-background/50 px-2.5 py-1.5 text-[12px] text-muted-foreground">
          <Lock className="h-3.5 w-3.5 flex-none" aria-hidden />
          {blockers.length > 0
            ? `Go-live is locked — resolve ${blockers.length} blocker${blockers.length === 1 ? "" : "s"} and confirm the 4 manual gates below.`
            : "Go-live is locked until the 4 manual confirmations below are made."}
        </div>
      ) : null}
    </Card>
  );
}
