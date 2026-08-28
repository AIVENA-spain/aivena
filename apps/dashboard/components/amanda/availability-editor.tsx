"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { saveAmandaSettingsAction } from "@/app/(app)/settings/section-actions";

// Engine-accepted start hours are 8-21, so opening runs 8:00-22:00.
const GRID_DAYS = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sat, Sun — agency-week order
const FROM_HOURS = Array.from({ length: 14 }, (_, i) => 8 + i);   // 8..21

/** Per-day range view over the engine's hour-array shape: open = min..max+1.
 *  (Non-contiguous stored hours render as their spanning range.) */
function toRange(hs: number[] | undefined): { open: boolean; from: number; to: number } {
  if (!hs || hs.length === 0) return { open: false, from: 10, to: 19 };
  return { open: true, from: Math.min(...hs), to: Math.max(...hs) + 1 };
}
function toHours(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}
function hh(n: number): string {
  return `${String(n).padStart(2, "0")}:00`;
}

function localDateStr(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Amanda availability editor — the ONE shared control for viewing hours +
 * blocked days, embedded in Settings and in the Viewings drawer (Christian:
 * "they can easily modify it from there"). Saves only its own two fields;
 * the empty-grid trap is refused client- AND server-side.
 */
export function AvailabilityEditor({
  initialHours,
  initialBlocked,
  onSaved,
}: {
  initialHours: Record<string, number[]> | undefined;
  initialBlocked: string[] | undefined;
  onSaved?: (hours: Record<string, number[]>, blocked: string[]) => void;
}) {
  const t = useTranslations("settings.amanda");
  const locale = useLocale();

  const [hours, setHours] = useState<Record<string, number[]>>(
    initialHours ?? { "1": [11, 17], "2": [11, 17], "3": [11, 17], "4": [11, 17], "5": [11, 17], "6": [11] },
  );
  const [blocked, setBlocked] = useState<string[]>(initialBlocked ?? []);
  const [blockDraft, setBlockDraft] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const gridEmpty = GRID_DAYS.every((d) => (hours[String(d)] ?? []).length === 0);

  function setDay(day: number, hs: number[]) {
    setSavedAt(null);
    setHours((prev) => ({ ...prev, [String(day)]: hs }));
  }

  function copyToAll(day: number) {
    setSavedAt(null);
    setHours((prev) => {
      const src = prev[String(day)] ?? [];
      const next: Record<string, number[]> = {};
      for (const d of GRID_DAYS) next[String(d)] = [...src];
      return next;
    });
  }

  function addBlocked(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < localDateStr(0)) return;
    setSavedAt(null);
    setBlocked((prev) => (prev.includes(date) ? prev : [...prev, date].sort()));
    setBlockDraft("");
  }

  function onSave() {
    if (gridEmpty || saving) return;
    setSaveError(null);
    startSaving(async () => {
      const res = await saveAmandaSettingsAction({
        viewing_hours_by_weekday: hours,
        blocked_dates: blocked,
      });
      if (res.ok) {
        setSavedAt(Date.now());
        onSaved?.(hours, blocked);
      } else {
        setSaveError(res.error);
      }
    });
  }

  // Localized short weekday names straight from the browser locale — no keys.
  const dayName = (day: number) => {
    // 2026-08-23 was a Sunday; day 0..6 maps onto that anchor week.
    const anchor = new Date(Date.UTC(2026, 7, 23 + day));
    return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(anchor);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Viewing-hours tap grid — Amanda only ever offers these start times. */}
      <div className="flex flex-col gap-2">
        <div>
          <h4 className="text-[12.5px] font-semibold text-foreground">{t("hoursTitle")}</h4>
          <p className="text-[11.5px] text-muted-foreground">{t("hoursHint")}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          {GRID_DAYS.map((day) => {
            const r = toRange(hours[String(day)]);
            return (
              <div key={day} className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-pressed={r.open}
                  onClick={() => setDay(day, r.open ? [] : toHours(r.from, r.to))}
                  className={
                    r.open
                      ? "w-14 rounded-md bg-brand px-2 py-1.5 text-[12px] font-semibold capitalize text-white transition-colors"
                      : "w-14 rounded-md bg-muted/60 px-2 py-1.5 text-[12px] font-medium capitalize text-muted-foreground transition-colors hover:bg-muted"
                  }
                >
                  {dayName(day)}
                </button>
                {r.open ? (
                  <>
                    <select
                      value={r.from}
                      aria-label={t("fromLabel")}
                      onChange={(e) => {
                        const from = Number(e.target.value);
                        setDay(day, toHours(from, Math.max(from + 1, r.to)));
                      }}
                      className="h-8 rounded-md border border-border bg-background px-1.5 text-[12.5px] tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
                    >
                      {FROM_HOURS.map((h) => (
                        <option key={h} value={h}>{hh(h)}</option>
                      ))}
                    </select>
                    <span className="text-[12px] text-muted-foreground">–</span>
                    <select
                      value={r.to}
                      aria-label={t("toLabel")}
                      onChange={(e) => setDay(day, toHours(r.from, Number(e.target.value)))}
                      className="h-8 rounded-md border border-border bg-background px-1.5 text-[12.5px] tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
                    >
                      {FROM_HOURS.filter((h) => h + 1 > r.from).map((h) => (
                        <option key={h + 1} value={h + 1}>{hh(h + 1)}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => copyToAll(day)}
                      className="rounded-md px-2 py-1 text-[11.5px] font-medium text-brand hover:bg-brand-soft"
                    >
                      {t("copyToAll")}
                    </button>
                  </>
                ) : (
                  <span className="text-[12px] text-muted-foreground">{t("closedLabel")}</span>
                )}
              </div>
            );
          })}
        </div>
        {gridEmpty ? <p className="text-[11.5px] text-destructive">{t("hoursEmptyWarning")}</p> : null}
      </div>

      {/* Blocked days — holidays, days off; Amanda never books these. */}
      <div className="flex flex-col gap-2">
        <div>
          <h4 className="text-[12.5px] font-semibold text-foreground">{t("blockedTitle")}</h4>
          <p className="text-[11.5px] text-muted-foreground">{t("blockedHint")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => addBlocked(localDateStr(0))}>
            {t("blockToday")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => addBlocked(localDateStr(1))}>
            {t("blockTomorrow")}
          </Button>
          <input
            type="date"
            value={blockDraft}
            min={localDateStr(0)}
            onChange={(e) => setBlockDraft(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-[12.5px] text-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
            aria-label={t("addDate")}
          />
          <Button size="sm" variant="outline" onClick={() => addBlocked(blockDraft)} disabled={!blockDraft}>
            {t("addDate")}
          </Button>
        </div>
        {blocked.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {blocked.map((d) => (
              <li key={d} className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11.5px] tabular-nums text-amber-700 dark:text-amber-400">
                {d}
                <button
                  type="button"
                  aria-label={t("unblock")}
                  onClick={() => {
                    setSavedAt(null);
                    setBlocked((prev) => prev.filter((x) => x !== d));
                  }}
                  className="rounded p-0.5 opacity-70 hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onSave} disabled={saving || gridEmpty}>
          {saving ? t("saving") : t("save")}
        </Button>
        {savedAt && !saving && !saveError ? (
          <span className="text-[12px] text-brand">{t("saved")}</span>
        ) : null}
      </div>
      {saveError ? <p className="text-[12px] text-destructive">{saveError}</p> : null}
    </div>
  );
}
