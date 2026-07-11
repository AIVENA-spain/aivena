import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import type { ReadinessItem, ReadinessProviderState, ReadinessResponse } from "@/lib/api/types";
import {
  statusTone,
  orderItems,
  isDone,
  type ChipTone,
} from "@/app/(app)/settings/sections/readiness-display";

import {
  STATUS_LABEL,
  sectionForItem,
  SECTION_ORDER,
  SECTION_LABEL,
  providerPlainText,
  providerItemId,
  blockerLabel,
  type GoLiveSection,
} from "./go-live-display";

/**
 * Detailed readiness for the admin go-live screen (issue B) — the per-check
 * detail BELOW the summary card + control. Grouped into 4 plain sections; within
 * each, the checks that still need action show first and the already-"ready"
 * checks collapse behind a "N ready" disclosure, so the page isn't a wall of
 * orange. Provider checks show plain copy with raw fields behind a "Technical
 * details" disclosure. Honest: each chip is the server status, never invented.
 * English-only (admin surface).
 */

const TONE_CLS: Record<ChipTone, string> = {
  good: "bg-brand-soft text-brand",
  info: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  warn: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  muted: "bg-muted text-muted-foreground",
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

function ItemRow({ item, provider }: { item: ReadinessItem; provider?: ReadinessProviderState }) {
  const mainCopy = provider ? providerPlainText(provider) : item.uiCopy;
  // Not-yet-ready checks use the specific admin label ("Legal agency name not
  // confirmed"), matching the summary card; ready checks keep the neutral label.
  const title = isDone(item.status) ? item.label : blockerLabel(item.id, item.label);
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13px] font-medium text-foreground">{title}</span>
        <span className="text-[12px] text-muted-foreground">{mainCopy}</span>
        {provider ? (
          <details className="mt-0.5 text-[11px] text-muted-foreground/80">
            <summary className="cursor-pointer select-none text-muted-foreground/70 hover:text-muted-foreground">
              Technical details
            </summary>
            <div className="mt-1 flex flex-col gap-0.5 pl-1 font-mono">
              <span>detail: {provider.detail}</span>
              <span>source: {provider.source}</span>
            </div>
          </details>
        ) : null}
      </div>
      <Chip tone={statusTone(item.status)}>{STATUS_LABEL[item.status]}</Chip>
    </li>
  );
}

function Section({
  title,
  items,
  providerFor,
}: {
  title: string;
  items: ReadinessItem[];
  providerFor: (id: string) => ReadinessProviderState | undefined;
}) {
  const todo = items.filter((i) => !isDone(i.status));
  const done = items.filter((i) => isDone(i.status));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold text-foreground">{title}</h3>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
            todo.length > 0
              ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
          )}
        >
          {todo.length > 0
            ? `${todo.length} need${todo.length === 1 ? "s" : ""} action`
            : "All ready"}
        </span>
      </div>

      {todo.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border/60">
          {todo.map((it) => (
            <ItemRow key={it.id} item={it} provider={providerFor(it.id)} />
          ))}
        </ul>
      ) : null}

      {done.length > 0 ? (
        <details className="text-[12px]">
          <summary className="cursor-pointer select-none py-1 text-muted-foreground hover:text-foreground">
            {done.length} ready ✓
          </summary>
          <ul className="flex flex-col divide-y divide-border/40 opacity-80">
            {done.map((it) => (
              <ItemRow key={it.id} item={it} provider={providerFor(it.id)} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function ReadinessPanel({ readiness }: { readiness: ReadinessResponse }) {
  const providerById = new Map(readiness.providers.map((p) => [providerItemId(p.provider), p]));
  const providerFor = (id: string) => providerById.get(id);

  const bySection: Record<GoLiveSection, ReadinessItem[]> = {
    setup: [],
    providers: [],
    legal: [],
    safety: [],
  };
  for (const it of orderItems(readiness.items)) bySection[sectionForItem(it.id)].push(it);

  return (
    <Card className="gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Readiness checks</h2>
        <span className="text-[11px] text-muted-foreground">
          computed{" "}
          {new Date(readiness.computedAt).toLocaleString(undefined, {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      {SECTION_ORDER.map((section) =>
        bySection[section].length > 0 ? (
          <Section
            key={section}
            title={SECTION_LABEL[section]}
            items={bySection[section]}
            providerFor={providerFor}
          />
        ) : null,
      )}
    </Card>
  );
}
