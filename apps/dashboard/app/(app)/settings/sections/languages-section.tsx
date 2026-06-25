"use client";

import { useCallback, useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  saveAgencyLanguagesAction,
  saveWorkingHoursAction,
  type DaySlotPayload,
} from "../section-actions";
import type { WorkingHours } from "@/lib/api/types";

export const SUPPORTED_LANGUAGE_CODES = [
  "es", "en", "no", "sv", "da", "de", "nl", "fr", "it", "pt", "ru", "pl", "fi",
] as const;
type LangCode = (typeof SUPPORTED_LANGUAGE_CODES)[number];

const WH_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type WhDayKey = (typeof WH_DAYS)[number];
const WH_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const COMMON_TIMEZONES = [
  "Europe/Madrid", "Europe/London", "Europe/Lisbon", "Europe/Paris", "Europe/Berlin",
  "Europe/Amsterdam", "Europe/Rome", "Europe/Warsaw", "Europe/Oslo", "Europe/Stockholm",
  "Europe/Helsinki", "Europe/Moscow", "Atlantic/Canary", "UTC",
];

type LangNameKey =
  | "name_es" | "name_en" | "name_no" | "name_sv" | "name_da"
  | "name_de" | "name_nl" | "name_fr" | "name_it" | "name_pt"
  | "name_ru" | "name_pl" | "name_fi";

/**
 * Languages & working hours — accordion body. Languages render READ-ONLY
 * (add/remove disabled until the agencies-vs-agency_settings read/write drift
 * is reconciled). Translation target is editable. Working hours editable, with
 * the email-follow-ups-only caveat (timezone source fixed by Chat 3 / W3).
 */
export function LanguagesSection({
  initial,
  translationTarget,
  initialWorkingHours,
  initialTimezone,
}: {
  initial: string[];
  translationTarget: string;
  initialWorkingHours: WorkingHours;
  initialTimezone: string;
}) {
  const t = useTranslations("settings.languages");

  const langs = initial.filter((c) => (SUPPORTED_LANGUAGE_CODES as readonly string[]).includes(c));

  const [target, setTarget] = useState(translationTarget);
  const [agencySaving, startAgencySaving] = useTransition();
  const [agencyError, setAgencyError] = useState<string | null>(null);

  const saveTarget = useCallback((next: string, prev: string) => {
    setTarget(next);
    setAgencyError(null);
    startAgencySaving(async () => {
      const res = await saveAgencyLanguagesAction({ translation_target_language: next });
      if (!res.ok) { setTarget(prev); setAgencyError(res.error); }
    });
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>{t("serveLabel")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          {langs.map((code) => (
            <span key={code} className="rounded-full border border-border bg-muted/40 px-3 py-1 text-[12px] font-medium text-muted-foreground">
              {t(("name_" + code) as LangNameKey)}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">{t("languagesReadOnlyNote")}</p>
      </div>

      <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
        <Label htmlFor="translation-target">{t("translateInto")}</Label>
        <select
          id="translation-target"
          value={target}
          disabled={agencySaving}
          onChange={(e) => saveTarget(e.target.value, target)}
          className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {(SUPPORTED_LANGUAGE_CODES as readonly LangCode[]).map((code) => (
            <option key={code} value={code}>{t(("name_" + code) as LangNameKey)}</option>
          ))}
        </select>
        <p className="max-w-md text-[11px] text-muted-foreground">{t("translateIntoHelp")}</p>
        {agencyError ? <p className="text-xs text-red-600 dark:text-red-300" role="alert">{agencyError}</p> : null}
      </div>

      <QuietHoursBlock initialWorkingHours={initialWorkingHours} initialTimezone={initialTimezone} />
    </div>
  );
}

function QuietHoursBlock({
  initialWorkingHours,
  initialTimezone,
}: {
  initialWorkingHours: WorkingHours;
  initialTimezone: string;
}) {
  const t = useTranslations("settings.aiRules");
  const tzId = useId();

  const [timezone, setTimezone] = useState(initialTimezone || "Europe/Madrid");
  const [days, setDays] = useState<Record<WhDayKey, DaySlotPayload>>({
    monday: pickSlot(initialWorkingHours?.monday),
    tuesday: pickSlot(initialWorkingHours?.tuesday),
    wednesday: pickSlot(initialWorkingHours?.wednesday),
    thursday: pickSlot(initialWorkingHours?.thursday),
    friday: pickSlot(initialWorkingHours?.friday),
    saturday: pickSlot(initialWorkingHours?.saturday),
    sunday: pickSlot(initialWorkingHours?.sunday),
  });
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  const tzOptions = [...new Set([timezone, ...COMMON_TIMEZONES])];

  const updateDay = useCallback(
    (day: WhDayKey, patch: Partial<DaySlotPayload>) => setDays((d) => ({ ...d, [day]: { ...d[day], ...patch } })),
    [],
  );

  const onSave = useCallback(() => {
    setError(null);
    for (const key of WH_DAYS) {
      const slot = days[key];
      if (!WH_TIME_RE.test(slot.start) || !WH_TIME_RE.test(slot.end)) {
        setError(`${t(("day" + capWh(key)) as WhDayLabelKey)}: ${t("startLabel")}/${t("endLabel")}`);
        return;
      }
    }
    startSaving(async () => {
      const res = await saveWorkingHoursAction({
        working_hours: {
          monday: days.monday, tuesday: days.tuesday, wednesday: days.wednesday,
          thursday: days.thursday, friday: days.friday, saturday: days.saturday,
          sunday: days.sunday, timezone,
        },
        timezone,
      });
      if (res.ok) setSavedAt(Date.now());
      else setError(res.error);
    });
  }, [days, timezone, t]);

  return (
    <div className="flex flex-col gap-3 border-t border-border/60 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-foreground">{t("quietTitle")}</h3>
          <p className="text-[11.5px] text-muted-foreground">{t("hoursSummaryHelp")}</p>
        </div>
        <button type="button" onClick={() => setExpanded((v) => !v)} className="shrink-0 text-[12px] font-medium text-brand hover:underline">
          {expanded ? t("hoursDoneBtn") : t("editHoursBtn")}
        </button>
      </div>

      <div className="flex flex-col gap-1">
        {hoursSegments(days).map((seg) => {
          const from = t(("day" + capWh(WH_DAYS[seg.from])) as WhDayLabelKey).slice(0, 3);
          const to = t(("day" + capWh(WH_DAYS[seg.to])) as WhDayLabelKey).slice(0, 3);
          return (
            <div key={seg.from} className="flex items-center justify-between text-[12.5px]">
              <span className="font-medium text-foreground">{seg.from === seg.to ? from : `${from}–${to}`}</span>
              {seg.slot.enabled ? (
                <span className="font-mono text-muted-foreground">{seg.slot.start}–{seg.slot.end}</span>
              ) : (
                <span className="text-muted-foreground">{t("closedLabel")}</span>
              )}
            </div>
          );
        })}
        <p className="mt-0.5 text-[11px] text-muted-foreground">{t("timezoneLabel")}: <span className="font-mono">{timezone}</span></p>
      </div>

      {expanded ? (
        <div className="flex flex-col gap-3 border-t border-border/60 pt-3">
          <div className="flex flex-col gap-2">
            <label htmlFor={tzId} className="text-[12px] font-medium text-foreground">{t("timezoneLabel")}</label>
            <select id={tzId} value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {tzOptions.map((tz) => (<option key={tz} value={tz}>{tz}</option>))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full max-w-2xl text-[12.5px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="w-32 pb-1 font-semibold"></th>
                  <th className="w-20 pb-1 font-semibold">{t("enabledLabel")}</th>
                  <th className="w-28 pb-1 font-semibold">{t("startLabel")}</th>
                  <th className="w-28 pb-1 font-semibold">{t("endLabel")}</th>
                </tr>
              </thead>
              <tbody>
                {WH_DAYS.map((day) => {
                  const slot = days[day];
                  return (
                    <tr key={day} className="border-t border-border/60">
                      <td className="py-1 pr-3 font-medium text-foreground">{t(("day" + capWh(day)) as WhDayLabelKey)}</td>
                      <td className="py-1 pr-3">
                        <button type="button" role="switch" aria-checked={slot.enabled} onClick={() => updateDay(day, { enabled: !slot.enabled })} className={`relative h-5 w-9 rounded-full transition-colors ${slot.enabled ? "bg-brand" : "bg-muted-foreground/30"}`}>
                          <span aria-hidden className={`absolute top-0.5 h-4 w-4 rounded-full bg-card shadow-sm transition-all ${slot.enabled ? "left-[18px]" : "left-0.5"}`} />
                        </button>
                      </td>
                      <td className="py-1 pr-3"><Input type="time" value={slot.start} onChange={(e) => updateDay(day, { start: e.target.value })} disabled={!slot.enabled} className="h-7 max-w-[110px] font-mono text-[12px]" /></td>
                      <td className="py-1"><Input type="time" value={slot.end} onChange={(e) => updateDay(day, { end: e.target.value })} disabled={!slot.enabled} className="h-7 max-w-[110px] font-mono text-[12px]" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11.5px] text-muted-foreground">{t("quietFramingNote")}</p>
          <div className="flex items-center gap-3">
            <Button type="button" size="sm" onClick={onSave} disabled={saving}>{t("saveQuietBtn")}</Button>
            {error ? (
              <p className="text-xs text-red-600 dark:text-red-300" role="alert">{error}</p>
            ) : savedAt ? (
              <p className="text-xs text-brand" aria-live="polite">{t("savedQuietToast")}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type WhDayLabelKey =
  | "dayMonday" | "dayTuesday" | "dayWednesday" | "dayThursday"
  | "dayFriday" | "daySaturday" | "daySunday";

function pickSlot(raw: unknown): DaySlotPayload {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return {
      enabled: typeof o.enabled === "boolean" ? o.enabled : false,
      start: typeof o.start === "string" && WH_TIME_RE.test(o.start) ? o.start : "09:00",
      end: typeof o.end === "string" && WH_TIME_RE.test(o.end) ? o.end : "18:00",
    };
  }
  return { enabled: false, start: "09:00", end: "18:00" };
}

function capWh(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function sameSlot(a: DaySlotPayload, b: DaySlotPayload): boolean {
  if (a.enabled !== b.enabled) return false;
  if (!a.enabled) return true;
  return a.start === b.start && a.end === b.end;
}

function hoursSegments(days: Record<WhDayKey, DaySlotPayload>): Array<{ from: number; to: number; slot: DaySlotPayload }> {
  const segs: Array<{ from: number; to: number; slot: DaySlotPayload }> = [];
  for (let i = 0; i < WH_DAYS.length; ) {
    const cur = days[WH_DAYS[i]];
    let j = i;
    while (j + 1 < WH_DAYS.length && sameSlot(days[WH_DAYS[j + 1]], cur)) j++;
    segs.push({ from: i, to: j, slot: cur });
    i = j + 1;
  }
  return segs;
}
