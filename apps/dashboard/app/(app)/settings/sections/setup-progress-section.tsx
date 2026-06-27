import { Check, AlertTriangle, Clock } from "lucide-react";

import type { ReadinessItem, ReadinessResponse } from "@/lib/api/types";
import {
  statusLabel,
  statusTone,
  isDone,
  summarize,
  type ChipTone,
} from "./readiness-display";

/**
 * Setup Progress (workboard D2) — the top strip of Settings, driven by the live
 * GET /api/v1/readiness model. Replaces the older setup_checklist-derived strip
 * when readiness loads (the page falls back to ChecklistSection if it doesn't).
 *
 * Honest by construction: every row's status comes straight from the readiness
 * signal; nothing is upgraded to "ready". The headline bar counts only the
 * agency's own items, so the always-blocked admin go-live item never drags it.
 * Per-item copy (label/uiCopy) is server-provided (English source of truth) —
 * see readiness-display for the localization follow-up (D9).
 */
const TONE_CLS: Record<ChipTone, string> = {
  good: "bg-brand-soft text-brand",
  info: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  muted: "bg-muted text-muted-foreground",
};

export function SetupProgressSection({ readiness }: { readiness: ReadinessResponse }) {
  const { agencyItems, aivenaItems, done, total, pct } = summarize(readiness.items);

  return (
    <section className="rounded-xl bg-card text-card-foreground shadow-elevated ring-1 ring-foreground/10">
      <div className="flex flex-col gap-3.5 px-5 py-4">
        <div className="flex items-baseline gap-3">
          <span className="text-[14px] font-semibold text-foreground">Setup progress</span>
          <span className="text-[12px] text-muted-foreground">{done} of {total} ready</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} aria-hidden />
        </div>

        <div className="mt-1 flex flex-col gap-0.5">
          {agencyItems.map((it) => (
            <ItemRow key={it.id} item={it} />
          ))}
        </div>

        {aivenaItems.length > 0 ? (
          <div className="mt-2 border-t border-border/60 pt-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden />
              AIVENA is handling
            </div>
            <div className="flex flex-col gap-0.5">
              {aivenaItems.map((it) => (
                <ItemRow key={it.id} item={it} muted />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ItemRow({ item, muted }: { item: ReadinessItem; muted?: boolean }) {
  const done = isDone(item.status);
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span
        aria-hidden
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          done ? "bg-brand text-brand-fg" : muted ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
        }`}
      >
        {done ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-foreground">{item.label}</span>
          <Chip status={item.status} />
        </div>
        <p className="text-[11.5px] leading-snug text-muted-foreground">{item.uiCopy}</p>
      </div>
    </div>
  );
}

function Chip({ status }: { status: ReadinessItem["status"] }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE_CLS[statusTone(status)]}`}>
      {statusLabel(status)}
    </span>
  );
}
