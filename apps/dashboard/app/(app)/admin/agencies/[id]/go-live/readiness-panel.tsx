import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import type { ReadinessResponse } from "@/lib/api/types";
import {
  statusTone,
  orderItems,
  isDone,
  type ChipTone,
} from "@/app/(app)/settings/sections/readiness-display";

import { STATUS_LABEL, PILOT_STATUS_LABEL, visibleBlockers } from "./go-live-display";

/**
 * Read-only readiness panel for the admin go-live surface (C4). Renders the
 * TARGET agency's live recompute exactly as the server reports it — current
 * pilot status, blockers, every readiness item, and provider/config state. It
 * NEVER invents "ready": each chip is the honest status straight from the model.
 * English-only (admin surface, brief §12).
 */

const TONE_CLS: Record<ChipTone, string> = {
  good: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  info: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  warn: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  muted: "bg-muted text-muted-foreground",
};

const PILOT_TONE: Record<string, string> = {
  live: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  ready_for_pilot: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  setup: "bg-muted text-muted-foreground",
  paused: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  blocked: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex flex-none items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        TONE_CLS[tone],
      )}
    >
      {children}
    </span>
  );
}

export function ReadinessPanel({ readiness }: { readiness: ReadinessResponse }) {
  const items = orderItems(readiness.items);
  const labelById = new Map(readiness.items.map((i) => [i.id, i.label]));
  // Mirror the server's go-live gate — it strips the self-referential lifecycle item,
  // so the panel must too (else a ready agency shows a blocker the transition ignores).
  const blockers = visibleBlockers(readiness.goLive.blockedBy);
  const doneCount = readiness.items.filter((i) => isDone(i.status)).length;
  const pilot = readiness.pilotStatus;

  return (
    <Card className="gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Go-live readiness</h2>
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span>Current status</span>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
              pilot ? (PILOT_TONE[pilot] ?? "bg-muted text-muted-foreground") : "bg-muted text-muted-foreground",
            )}
          >
            {pilot ? PILOT_STATUS_LABEL[pilot] : "Unknown"}
          </span>
        </div>
      </div>

      <p className="text-[12.5px] text-muted-foreground">
        {doneCount} of {readiness.items.length} checks done · computed{" "}
        {new Date(readiness.computedAt).toLocaleString(undefined, {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>

      {/* Blockers — what stands between this agency and go-live, from the server. */}
      {blockers.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5 dark:border-amber-500/25 dark:bg-amber-500/10">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 flex-none" aria-hidden />
            Blocking go-live
          </div>
          <ul className="mt-1.5 flex flex-col gap-1 text-[12.5px] text-amber-800 dark:text-amber-200/90">
            {blockers.map((id) => (
              <li key={id}>· {labelById.get(id) ?? id}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-[12.5px] text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5 flex-none" aria-hidden />
          No readiness blockers reported by the server.
        </div>
      )}

      {/* Every readiness item — honest status, flat (staff see the whole picture). */}
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Checks
        </h3>
        <ul className="flex flex-col divide-y divide-border/60">
          {items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 py-2">
              <div className="flex min-w-0 flex-col">
                <span className="text-[13px] font-medium text-foreground">{item.label}</span>
                <span className="text-[12px] text-muted-foreground">{item.uiCopy}</span>
              </div>
              <Chip tone={statusTone(item.status)}>{STATUS_LABEL[item.status]}</Chip>
            </li>
          ))}
        </ul>
      </div>

      {/* Provider / config connections. */}
      {readiness.providers.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Providers &amp; config
          </h3>
          <ul className="flex flex-col divide-y divide-border/60">
            {readiness.providers.map((p) => (
              <li key={p.provider} className="flex items-start justify-between gap-3 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="text-[13px] font-medium capitalize text-foreground">
                    {p.provider.replace(/_/g, " ")}
                  </span>
                  <span className="text-[12px] text-muted-foreground">{p.detail}</span>
                </div>
                <Chip tone={statusTone(p.status)}>{STATUS_LABEL[p.status]}</Chip>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
