import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Check, AlertTriangle } from "lucide-react";

import type { ReadinessItem } from "@/lib/api/types";
import { statusLabelKey, statusTone, isDone, type ChipTone } from "./readiness-display";

/**
 * Property catalogue (Settings group 3, per the approved mockups) — READ-ONLY.
 * Shows the live catalog readiness items (O5 `catalog.*` signals) verbatim; the
 * actual import/management lives on the Properties page, linked below. Honest
 * by construction: statuses come straight from /api/v1/readiness — when the
 * readiness read isn't available we say so instead of inventing a state.
 */
const TONE_CLS: Record<ChipTone, string> = {
  good: "bg-brand-soft text-brand",
  info: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  muted: "bg-muted text-muted-foreground",
};

export async function CatalogueSection({ items }: { items: ReadinessItem[] }) {
  const t = await getTranslations("settings.readiness");
  const ta = await getTranslations("settings.accordion");

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">
          {ta("catalogueUnavailable")}
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {items.map((it) => {
            const done = isDone(it.status);
            return (
              <div key={it.id} className="flex items-start gap-2.5 py-1.5">
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    done
                      ? "bg-brand text-brand-fg"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                  }`}
                >
                  {done ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-foreground">{it.label}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE_CLS[statusTone(it.status)]}`}
                    >
                      {t(`status.${statusLabelKey(it.status)}`)}
                    </span>
                  </div>
                  <p className="text-[11.5px] leading-snug text-muted-foreground">{it.uiCopy}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Link
        href="/properties"
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted"
      >
        {ta("catalogueOpenProperties")}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </div>
  );
}
