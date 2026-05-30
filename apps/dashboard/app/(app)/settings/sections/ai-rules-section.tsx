"use client";

import { useCallback, useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { saveAiRulesAction, saveWorkingHoursAction, type AiRulesPayload, type DaySlotPayload } from "../section-actions";
import type { DashboardToggles, SettingsResponse, WorkingHours } from "@/lib/api/types";

const DAYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;
type DayKey = (typeof DAYS)[number];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Subset of IANA zones we surface in the timezone select. The DB column
// accepts any text; we keep the list focused on the regions Christian's
// agencies operate in. The current value (even if outside this list) is still
// rendered — the select just adds it as a one-off option.
const COMMON_TIMEZONES = [
  "Europe/Madrid",
  "Europe/London",
  "Europe/Lisbon",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Rome",
  "Europe/Warsaw",
  "Europe/Oslo",
  "Europe/Stockholm",
  "Europe/Helsinki",
  "Europe/Moscow",
  "Atlantic/Canary",
  "UTC",
];

/**
 * AI reply rules — Law-1 sensitive surface. Real toggles that persist to
 * agency_settings.reply_rules.dashboard_toggles, AND the honest sub-line
 * below the heading. The toggles do not currently drive automation; that's
 * the "automation engine" that lands later. The sub-line says so.
 *
 * Quiet hours below is fully live — W3 (the follow-up worker) already reads
 * agency_settings.working_hours.
 */
export function AiRulesSection({
  initialToggles,
  initialWorkingHours,
  initialTimezone,
}: {
  initialToggles: DashboardToggles;
  initialWorkingHours: WorkingHours;
  initialTimezone: string;
}) {
  const t = useTranslations("settings.aiRules");

  const [toggles, setToggles] = useState<DashboardToggles>(initialToggles);
  const [toggleSaving, startToggleSaving] = useTransition();
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [toggleSavedAt, setToggleSavedAt] = useState<number | null>(null);

  const flip = useCallback(
    (key: keyof DashboardToggles) => {
      const next = { ...toggles, [key]: !toggles[key] };
      const prev = toggles;
      setToggles(next);
      setToggleError(null);
      const payload: AiRulesPayload = {
        draft_replies_auto: next.draft_replies_auto,
        auto_send_cold: next.auto_send_cold,
        require_approval_hot: next.require_approval_hot,
        auto_whatsapp_recovery: next.auto_whatsapp_recovery,
      };
      startToggleSaving(async () => {
        const res = await saveAiRulesAction(payload);
        if (res.ok) {
          setToggleSavedAt(Date.now());
        } else {
          setToggles(prev);
          setToggleError(res.error);
        }
      });
    },
    [toggles],
  );

  return (
    <Card id="ai-rules" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="rounded-md border border-amber-300/50 bg-amber-50/60 px-4 py-3 text-[12px] leading-snug text-amber-900 dark:border-amber-300/30 dark:bg-amber-500/10 dark:text-amber-100">
          {t("honestSubLine")}
        </div>

        <div className="flex flex-col divide-y divide-border/60">
          <ToggleRow
            label={t("toggleDraftLabel")}
            help={t("toggleDraftHelp")}
            on={toggles.draft_replies_auto}
            onChange={() => flip("draft_replies_auto")}
          />
          <ToggleRow
            label={t("toggleColdLabel")}
            help={t("toggleColdHelp")}
            on={toggles.auto_send_cold}
            onChange={() => flip("auto_send_cold")}
          />
          <ToggleRow
            label={t("toggleHotLabel")}
            help={t("toggleHotHelp")}
            on={toggles.require_approval_hot}
            onChange={() => flip("require_approval_hot")}
          />
          <ToggleRow
            label={t("toggleWhatsappLabel")}
            help={t("toggleWhatsappHelp")}
            on={toggles.auto_whatsapp_recovery}
            onChange={() => flip("auto_whatsapp_recovery")}
          />
        </div>

        <div aria-live="polite" className="text-[11.5px]">
          {toggleSaving ? (
            <span className="text-muted-foreground">{t("savedToggleToast")}</span>
          ) : toggleError ? (
            <span className="text-red-600 dark:text-red-300" role="alert">{toggleError}</span>
          ) : toggleSavedAt ? (
            <span className="text-brand">{t("savedToggleToast")}</span>
          ) : null}
        </div>

        <QuietHoursBlock
          initialWorkingHours={initialWorkingHours}
          initialTimezone={initialTimezone}
        />
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  label,
  help,
  on,
  onChange,
}: {
  label: string;
  help: string;
  on: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="flex-1">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        <div className="text-[11.5px] text-muted-foreground">{help}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={onChange}
        className={`relative h-6 w-11 rounded-full transition-colors ${
          on ? "bg-brand" : "bg-muted-foreground/30"
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow-sm transition-all ${
            on ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
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
  const [days, setDays] = useState<Record<DayKey, DaySlotPayload>>({
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

  const tzOptions = [...new Set([timezone, ...COMMON_TIMEZONES])];

  const updateDay = useCallback(
    (day: DayKey, patch: Partial<DaySlotPayload>) => {
      setDays((d) => ({ ...d, [day]: { ...d[day], ...patch } }));
    },
    [],
  );

  const onSave = useCallback(() => {
    setError(null);
    for (const key of DAYS) {
      const slot = days[key];
      if (!TIME_RE.test(slot.start) || !TIME_RE.test(slot.end)) {
        setError(`${t(("day" + capitalize(key)) as DayLabelKey)}: ${t("startLabel")}/${t("endLabel")}`);
        return;
      }
    }
    startSaving(async () => {
      const res = await saveWorkingHoursAction({
        working_hours: {
          monday: days.monday,
          tuesday: days.tuesday,
          wednesday: days.wednesday,
          thursday: days.thursday,
          friday: days.friday,
          saturday: days.saturday,
          sunday: days.sunday,
          timezone,
        },
        timezone,
      });
      if (res.ok) {
        setSavedAt(Date.now());
      } else {
        setError(res.error);
      }
    });
  }, [days, timezone, t]);

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-6">
      <div>
        <h3 className="text-[14px] font-semibold text-foreground">{t("quietTitle")}</h3>
        <p className="text-[12px] text-muted-foreground">{t("quietSubtitle")}</p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={tzId} className="text-[12px] font-medium text-foreground">
          {t("timezoneLabel")}
        </label>
        <select
          id={tzId}
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {tzOptions.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
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
            {DAYS.map((day) => {
              const slot = days[day];
              return (
                <tr key={day} className="border-t border-border/60">
                  <td className="py-2 pr-3 font-medium text-foreground">
                    {t(("day" + capitalize(day)) as DayLabelKey)}
                  </td>
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={slot.enabled}
                      onClick={() => updateDay(day, { enabled: !slot.enabled })}
                      className={`relative h-5 w-9 rounded-full transition-colors ${
                        slot.enabled ? "bg-brand" : "bg-muted-foreground/30"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-card shadow-sm transition-all ${
                          slot.enabled ? "left-[18px]" : "left-0.5"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="py-2 pr-3">
                    <Input
                      type="time"
                      value={slot.start}
                      onChange={(e) => updateDay(day, { start: e.target.value })}
                      disabled={!slot.enabled}
                      className="h-8 max-w-[110px] font-mono text-[12px]"
                    />
                  </td>
                  <td className="py-2">
                    <Input
                      type="time"
                      value={slot.end}
                      onChange={(e) => updateDay(day, { end: e.target.value })}
                      disabled={!slot.enabled}
                      className="h-8 max-w-[110px] font-mono text-[12px]"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11.5px] text-muted-foreground">{t("quietFramingNote")}</p>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={onSave} disabled={saving}>
          {t("saveQuietBtn")}
        </Button>
        {error ? (
          <p className="text-xs text-red-600 dark:text-red-300" role="alert">
            {error}
          </p>
        ) : savedAt ? (
          <p className="text-xs text-brand" aria-live="polite">
            {t("savedQuietToast")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type DayLabelKey =
  | "dayMonday"
  | "dayTuesday"
  | "dayWednesday"
  | "dayThursday"
  | "dayFriday"
  | "daySaturday"
  | "daySunday";

function pickSlot(raw: unknown): DaySlotPayload {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return {
      enabled: typeof o.enabled === "boolean" ? o.enabled : false,
      start: typeof o.start === "string" && TIME_RE.test(o.start) ? o.start : "09:00",
      end: typeof o.end === "string" && TIME_RE.test(o.end) ? o.end : "18:00",
    };
  }
  return { enabled: false, start: "09:00", end: "18:00" };
}

function capitalize(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1);
}
