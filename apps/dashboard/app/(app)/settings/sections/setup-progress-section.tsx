import { getTranslations } from "next-intl/server";
import { Check, AlertTriangle, Clock } from "lucide-react";

import type { ReadinessItem, ReadinessResponse } from "@/lib/api/types";
import {
  statusLabelKey,
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
 *
 * Localization (D9): the fixed chrome (headings + status chips) is localized via
 * settings.readiness.*; per-item label/uiCopy is API-provided (English).
 */
const TONE_CLS: Record<ChipTone, string> = {
  good: "bg-brand-soft text-brand",
  info: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  muted: "bg-muted text-muted-foreground",
};

export async function SetupProgressSection({ readiness }: { readiness: ReadinessResponse }) {
  const t = await getTranslations("settings.readiness");
  const { agencyItems, aivenaItems, done, total, pct } = summarize(readiness.items);
  const statusText = (it: ReadinessItem) => t(`status.${statusLabelKey(it.status)}`);

  // Honest headline pill straight from the same pct as the bar — never
  // upgraded: 100% → Complete, ≥50% → Great progress, else In progress.
  const healthKey =
    pct >= 100 ? "healthComplete" : pct >= 50 ? "healthGood" : "healthInProgress";
  const healthCls =
    pct >= 50
      ? "bg-brand-soft text-brand"
      : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";

  return (
    <section className="rounded-xl bg-card text-card-foreground shadow-elevated ring-1 ring-foreground/10">
      <div className="flex flex-col gap-3.5 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[15px] font-semibold text-foreground">{t("healthTitle")}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${healthCls}`}>
            {t(healthKey)}
          </span>
          <span className="ml-auto text-[12px] font-medium text-muted-foreground">
            {t("count", { done, total })}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} aria-hidden />
        </div>

        {/* Full per-item truth stays one click away — nothing hidden, just
            tidied for non-technical users (native <details>, no JS). */}
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {t("viewTechnical")}
          </summary>
          <div className="mt-2 flex flex-col gap-0.5">
            {agencyItems.map((it) => (
              <ItemRow key={it.id} item={it} statusText={statusText(it)} />
            ))}
          </div>

          {aivenaItems.length > 0 ? (
            <div className="mt-2 border-t border-border/60 pt-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <Clock className="h-3 w-3" aria-hidden />
                {t("aivenaHandling")}
              </div>
              <div className="flex flex-col gap-0.5">
                {aivenaItems.map((it) => (
                  <ItemRow key={it.id} item={it} statusText={statusText(it)} muted />
                ))}
              </div>
            </div>
          ) : null}
        </details>
      </div>
    </section>
  );
}

function ItemRow({ item, statusText, muted }: { item: ReadinessItem; statusText: string; muted?: boolean }) {
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
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE_CLS[statusTone(item.status)]}`}>
            {statusText}
          </span>
        </div>
        <p className="text-[11.5px] leading-snug text-muted-foreground">{item.uiCopy}</p>
      </div>
    </div>
  );
}
