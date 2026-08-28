"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { saveAmandaSettingsAction } from "@/app/(app)/settings/section-actions";

// Engine-accepted start hours are 8-21, so opening runs 8:00-22:00.
const GRID_DAYS = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sat, Sun — agency-week order
const FROM_HOURS = Array.from({ length: 14 }, (_, i) => 8 + i);   // 8..21

/** Per-day view over the engine's hour-array shape: open = min..max+1, and a
 *  mid-day gap renders as ONE break (multiple gaps merge into their span).
 *  Exported: the Viewings month grid derives its closed/break markers from it. */
export function toRange(hs: number[] | undefined): {
  open: boolean; from: number; to: number; breakFrom: number | null; breakTo: number | null;
} {
  if (!hs || hs.length === 0) return { open: false, from: 10, to: 19, breakFrom: null, breakTo: null };
  const sorted = [...hs].sort((a, b) => a - b);
  const from = sorted[0];
  const to = sorted[sorted.length - 1] + 1;
  let breakFrom: number | null = null;
  let breakTo: number | null = null;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > 1) {
      if (breakFrom === null) breakFrom = sorted[i - 1] + 1;
      breakTo = sorted[i];
    }
  }
  return { open: true, from, to, breakFrom, breakTo };
}
function toHours(from: number, to: number, breakFrom?: number | null, breakTo?: number | null): number[] {
  const hs = Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
  if (breakFrom != null && breakTo != null && breakTo > breakFrom) {
    return hs.filter((h) => h < breakFrom || h >= breakTo);
  }
  return hs;
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
export type BlockedSlot = { date: string; from: number; to: number };

export function AvailabilityEditor({
  initialHours,
  initialBlocked,
  initialSlots,
  onSaved,
}: {
  initialHours: Record<string, number[]> | undefined;
  initialBlocked: string[] | undefined;
  initialSlots?: BlockedSlot[];
  onSaved?: (hours: Record<string, number[]>, blocked: string[], slots: BlockedSlot[]) => void;
}) {
  const t = useTranslations("settings.amanda");
  const locale = useLocale();

  const [hours, setHours] = useState<Record<string, number[]>>(
    initialHours ?? { "1": [11, 17], "2": [11, 17], "3": [11, 17], "4": [11, 17], "5": [11, 17], "6": [11] },
  );
  const [blocked, setBlocked] = useState<string[]>(initialBlocked ?? []);
  const [slots, setSlots] = useState<BlockedSlot[]>(initialSlots ?? []);
  const [blockDraft, setBlockDraft] = useState("");
  const [blockFrom, setBlockFrom] = useState<number | "">("");   // "" = all day
  const [blockTo, setBlockTo] = useState<number | "">("");
  const [showInfo, setShowInfo] = useState(false);
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

  function addBlocked(date: string, from?: number | "", to?: number | "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < localDateStr(0)) return;
    setSavedAt(null);
    if (typeof from === "number" && typeof to === "number" && to > from) {
      // Hour block on that date only — the day itself stays open.
      setSlots((prev) =>
        prev.some((x) => x.date === date && x.from === from && x.to === to)
          ? prev
          : [...prev, { date, from, to }].sort((a, b) => a.date.localeCompare(b.date) || a.from - b.from),
      );
    } else {
      setBlocked((prev) => (prev.includes(date) ? prev : [...prev, date].sort()));
    }
    setBlockDraft("");
    setBlockFrom("");
    setBlockTo("");
  }

  function onSave() {
    if (gridEmpty || saving) return;
    setSaveError(null);
    startSaving(async () => {
      const res = await saveAmandaSettingsAction({
        viewing_hours_by_weekday: hours,
        blocked_dates: blocked,
        blocked_slots: slots,
      });
      if (res.ok) {
        setSavedAt(Date.now());
        onSaved?.(hours, blocked, slots);
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
          <span className="flex flex-wrap items-center gap-2">
            <h4 className="text-[12.5px] font-semibold text-foreground">{t("hoursTitle")}</h4>
            <button
              type="button"
              aria-expanded={showInfo}
              onClick={() => setShowInfo((v) => !v)}
              className="flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-500/15 dark:text-red-400"
            >
              <span aria-hidden className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[8.5px]">i</span>
              {t("whatIsRed")}
            </button>
          </span>
          <p className="text-[11.5px] text-muted-foreground">{t("hoursHint")}</p>
          {showInfo ? (
            <p className="mt-1.5 rounded-md bg-red-500/10 px-2.5 py-1.5 text-[11.5px] text-red-700 dark:text-red-400">
              {t("availabilityInfo")}
            </p>
          ) : null}
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
                    {r.breakFrom != null && r.breakTo != null ? (
                      <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-1 text-[11.5px] tabular-nums text-red-700 dark:text-red-400">
                        <select
                          value={r.breakFrom}
                          aria-label={t("breakLabel")}
                          onChange={(e) => {
                            const bf = Number(e.target.value);
                            setDay(day, toHours(r.from, r.to, bf, Math.max(bf + 1, r.breakTo ?? bf + 1)));
                          }}
                          className="bg-transparent tabular-nums focus:outline-none"
                        >
                          {FROM_HOURS.filter((h) => h > r.from && h < r.to - 1).map((h) => (
                            <option key={h} value={h}>{hh(h)}</option>
                          ))}
                        </select>
                        –
                        <select
                          value={r.breakTo}
                          aria-label={t("breakLabel")}
                          onChange={(e) => setDay(day, toHours(r.from, r.to, r.breakFrom, Number(e.target.value)))}
                          className="bg-transparent tabular-nums focus:outline-none"
                        >
                          {FROM_HOURS.filter((h) => h > (r.breakFrom ?? r.from) && h < r.to).map((h) => (
                            <option key={h} value={h}>{hh(h)}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          aria-label={t("removeBreak")}
                          onClick={() => setDay(day, toHours(r.from, r.to))}
                          className="rounded p-0.5 opacity-70 hover:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ) : r.to - r.from >= 3 ? (
                      <button
                        type="button"
                        onClick={() => {
                          const mid = Math.floor((r.from + r.to) / 2);
                          setDay(day, toHours(r.from, r.to, mid, mid + 1));
                        }}
                        className="rounded-md px-2 py-1 text-[11.5px] font-medium text-red-700 hover:bg-red-500/10 dark:text-red-400"
                      >
                        {t("addBreak")}
                      </button>
                    ) : null}
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
          <select
            value={blockFrom}
            aria-label={t("fromLabel")}
            onChange={(e) => {
              const v = e.target.value === "" ? "" : Number(e.target.value);
              setBlockFrom(v);
              if (v !== "" && (blockTo === "" || (blockTo as number) <= v)) setBlockTo(v + 1);
              if (v === "") setBlockTo("");
            }}
            className="h-8 rounded-md border border-border bg-background px-1.5 text-[12.5px] tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
          >
            <option value="">{t("allDay")}</option>
            {FROM_HOURS.map((h) => (
              <option key={h} value={h}>{hh(h)}</option>
            ))}
          </select>
          {blockFrom !== "" ? (
            <>
              <span className="text-[12px] text-muted-foreground">–</span>
              <select
                value={blockTo}
                aria-label={t("toLabel")}
                onChange={(e) => setBlockTo(Number(e.target.value))}
                className="h-8 rounded-md border border-border bg-background px-1.5 text-[12.5px] tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
              >
                {FROM_HOURS.filter((h) => h + 1 > (blockFrom as number)).map((h) => (
                  <option key={h + 1} value={h + 1}>{hh(h + 1)}</option>
                ))}
              </select>
            </>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => addBlocked(blockDraft, blockFrom, blockTo)} disabled={!blockDraft}>
            {t("addDate")}
          </Button>
        </div>
        {blocked.length > 0 || slots.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {slots.map((sl) => (
              <li key={`${sl.date}-${sl.from}`} className="flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 text-[11.5px] tabular-nums text-red-700 dark:text-red-400">
                {sl.date} · {hh(sl.from)}–{hh(sl.to)}
                <button
                  type="button"
                  aria-label={t("unblock")}
                  onClick={() => {
                    setSavedAt(null);
                    setSlots((prev) => prev.filter((x) => !(x.date === sl.date && x.from === sl.from && x.to === sl.to)));
                  }}
                  className="rounded p-0.5 opacity-70 hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
            {blocked.map((d) => (
              <li key={d} className="flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 text-[11.5px] tabular-nums text-red-700 dark:text-red-400">
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
