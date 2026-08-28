"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AmandaSettingsResponse } from "@/lib/api/types";
import {
  saveAmandaSettingsAction,
  addAmandaKnowledgeAction,
  removeAmandaKnowledgeAction,
} from "../section-actions";

// The FULL engine-accepted range (8-21) — review-caught: a narrower grid
// makes any out-of-grid configured hour an invisible, unremovable phantom.
const GRID_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const GRID_DAYS = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sat, Sun — agency-week order

function localDateStr(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Amanda auto-mode card (design §6 "smallest lovable settings"): the mode is
 * READ-ONLY (the dial is promoted by evidence, never self-served), two viewing
 * numbers are editable, and "Things Amanda should know" is the screened
 * knowledge box — every save passes the §5 scrubber and a rejection shows its
 * honest reason, never a silent drop. Ships dark: pre-migration the API says
 * configured:false and the card renders one honest line.
 */
export function AmandaSection({ data }: { data: AmandaSettingsResponse | null }) {
  const t = useTranslations("settings.amanda");
  const locale = useLocale();

  const [duration, setDuration] = useState<number>(data?.settings?.viewing_duration_min ?? 60);
  const [notice, setNotice] = useState<number>(data?.settings?.viewing_notice_hours ?? 24);
  const [hours, setHours] = useState<Record<string, number[]>>(
    data?.settings?.viewing_hours_by_weekday ?? { "1": [11, 17], "2": [11, 17], "3": [11, 17], "4": [11, 17], "5": [11, 17], "6": [11] },
  );
  const [blocked, setBlocked] = useState<string[]>(data?.settings?.blocked_dates ?? []);
  const [blockDraft, setBlockDraft] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const [entries, setEntries] = useState(data?.knowledge ?? []);
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, startAdding] = useTransition();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removing, startRemoving] = useTransition();

  if (!data || !data.configured) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border/60 p-4">
        <Header t={t} mode={null} />
        <p className="text-[12px] text-muted-foreground">{t("notSetUp")}</p>
      </div>
    );
  }

  const gridEmpty = GRID_DAYS.every((d) => (hours[String(d)] ?? []).length === 0);

  function onSave() {
    if (gridEmpty) return;   // mirrored server-side; the inline warning explains
    setSaveError(null);
    startSaving(async () => {
      const res = await saveAmandaSettingsAction({
        viewing_duration_min: duration,
        viewing_notice_hours: notice,
        viewing_hours_by_weekday: hours,
        blocked_dates: blocked,
      });
      if (res.ok) setSavedAt(Date.now());
      else setSaveError(res.error);
    });
  }

  function toggleHour(day: number, hour: number) {
    setHours((prev) => {
      const cur = prev[String(day)] ?? [];
      const next = cur.includes(hour) ? cur.filter((h) => h !== hour) : [...cur, hour].sort((a, b) => a - b);
      return { ...prev, [String(day)]: next };
    });
  }

  function addBlocked(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < localDateStr(0)) return;
    setBlocked((prev) => (prev.includes(date) ? prev : [...prev, date].sort()));
    setBlockDraft("");
  }

  // Localized short weekday names straight from the browser locale — no keys.
  const dayName = (day: number) => {
    // 2026-08-23 was a Sunday; day 0..6 maps onto that anchor week.
    const anchor = new Date(Date.UTC(2026, 7, 23 + day));
    return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(anchor);
  };

  function onAdd() {
    const content = draft.trim();
    if (!content || adding) return;
    setAddError(null);
    startAdding(async () => {
      const res = await addAmandaKnowledgeAction(content);
      if (res.ok) {
        setEntries((prev) => [...prev, { id: res.data.id, content: res.data.content, status: "active", createdAt: res.data.createdAt }]);
        setDraft("");
      } else if ("reason" in res) {
        // Scrubber verdict → honest, specific copy (never a silent drop).
        setAddError(t(`rejected_${res.reason}` as never));
      } else {
        setAddError(res.error);
      }
    });
  }

  function onRemove(id: string) {
    startRemoving(async () => {
      const res = await removeAmandaKnowledgeAction(id);
      if (res.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
        setConfirmRemove(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border/60 p-4">
      <Header t={t} mode={data.mode ?? "off"} />

      {/* Viewing numbers — the two knobs the engine actually reads today. */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
          {t("durationLabel")}
          <input
            type="number"
            min={15}
            max={240}
            step={15}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="h-8 w-24 rounded-md border border-border bg-background px-2 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
          {t("noticeLabel")}
          <input
            type="number"
            min={1}
            max={168}
            value={notice}
            onChange={(e) => setNotice(Number(e.target.value))}
            className="h-8 w-24 rounded-md border border-border bg-background px-2 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
        </label>
        <Button size="sm" onClick={onSave} disabled={saving || gridEmpty}>
          {saving ? t("saving") : t("save")}
        </Button>
        {savedAt && !saving && !saveError ? (
          <span className="text-[12px] text-brand">{t("saved")}</span>
        ) : null}
      </div>
      {saveError ? <p className="text-[12px] text-destructive">{saveError}</p> : null}

      {/* Viewing-hours tap grid — Amanda only ever offers these start times. */}
      <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
        <div>
          <h4 className="text-[12.5px] font-semibold text-foreground">{t("hoursTitle")}</h4>
          <p className="text-[11.5px] text-muted-foreground">{t("hoursHint")}</p>
        </div>
        <div className="overflow-x-auto">
          <div className="flex min-w-[420px] flex-col gap-1">
            {GRID_DAYS.map((day) => (
              <div key={day} className="flex items-center gap-1.5">
                <span className="w-10 shrink-0 text-[11.5px] font-medium capitalize text-muted-foreground">{dayName(day)}</span>
                <div className="flex flex-wrap gap-1">
                  {GRID_HOURS.map((h) => {
                    const on = (hours[String(day)] ?? []).includes(h);
                    return (
                      <button
                        key={h}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleHour(day, h)}
                        className={`rounded-md px-2 py-1 text-[11.5px] tabular-nums transition-colors ${
                          on
                            ? "bg-brand text-brand-foreground"
                            : "bg-muted/60 text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {String(h).padStart(2, "0")}:00
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
        {gridEmpty ? <p className="text-[11.5px] text-destructive">{t("hoursEmptyWarning")}</p> : null}
      </div>

      {/* Blocked days — holidays, days off; Amanda never books these. */}
      <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
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
              <li key={d} className="flex items-center gap-1 rounded-full bg-muted/60 px-2.5 py-1 text-[11.5px] tabular-nums text-foreground">
                {d}
                <button
                  type="button"
                  aria-label={t("unblock")}
                  onClick={() => setBlocked((prev) => prev.filter((x) => x !== d))}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-[11px] text-muted-foreground">{t("hoursSaveNote")}</p>
      </div>

      {/* Things Amanda should know — screened at save (design §5). */}
      <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
        <div>
          <h4 className="text-[12.5px] font-semibold text-foreground">{t("knowledgeTitle")}</h4>
          <p className="text-[11.5px] text-muted-foreground">{t("knowledgeHint")}</p>
        </div>
        {entries.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex items-start justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-[12.5px] text-foreground"
              >
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{e.content}</span>
                {confirmRemove === e.id ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onRemove(e.id)}
                      disabled={removing}
                      className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-destructive hover:bg-destructive/10"
                    >
                      {t("confirmRemove")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(null)}
                      className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                    >
                      {t("cancel")}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={t("remove")}
                    onClick={() => setConfirmRemove(e.id)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onAdd();
            }}
            placeholder={t("knowledgePlaceholder")}
            maxLength={800}
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
          <Button size="sm" variant="outline" onClick={onAdd} disabled={adding || !draft.trim()}>
            {adding ? t("adding") : t("add")}
          </Button>
        </div>
        {addError ? <p className="text-[12px] text-destructive">{addError}</p> : null}
      </div>
    </div>
  );
}

function Header({
  t,
  mode,
}: {
  t: ReturnType<typeof useTranslations<"settings.amanda">>;
  mode: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"
      >
        <Sparkles className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[13px] font-semibold text-foreground">{t("title")}</h3>
        <p className="truncate text-[11.5px] text-muted-foreground">{t("subtitle")}</p>
      </div>
      {mode ? (
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-[10.5px] font-semibold ${
            mode === "off" ? "bg-muted text-muted-foreground" : "bg-brand-soft text-brand"
          }`}
        >
          {t(`mode_${mode}` as never)}
        </span>
      ) : null}
    </div>
  );
}
