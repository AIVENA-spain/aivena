"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { toRange } from "@/components/amanda/availability-editor";
import { saveAgentAction, type AgentRow } from "@/app/(app)/settings/section-actions";

/**
 * One agent's shift hours (Christian 2026-08-29: the roster needs "office and
 * work hours, unavailable hours").
 *
 * These are NOT the agency's viewing hours — those live in the calendar and
 * decide when Amanda offers a viewing. THESE decide when Amanda may ping THIS
 * agent, which is the promise printed at the top of the roster: "only in their
 * working hours". Same day-grid shape as the calendar editor so the two read
 * the same, and the same 8..21 engine-accepted range.
 */
const GRID_DAYS = [1, 2, 3, 4, 5, 6, 0];
const FROM_HOURS = Array.from({ length: 14 }, (_, i) => 8 + i);

function toHours(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}
const hh = (n: number) => `${String(n).padStart(2, "0")}:00`;

export function AgentHoursEditor({
  agent,
  onSaved,
  onClose,
}: {
  agent: AgentRow;
  onSaved: (hours: Record<string, number[]>) => void;
  onClose: () => void;
}) {
  const t = useTranslations("settings.agents");
  const locale = useLocale();
  const [hours, setHours] = useState<Record<string, number[]>>(
    agent.work_hours ?? { "1": toHours(9, 18), "2": toHours(9, 18), "3": toHours(9, 18), "4": toHours(9, 18), "5": toHours(9, 18) },
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const dayName = (day: number) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" })
      .format(new Date(Date.UTC(2026, 7, 23 + day)));

  function setDay(day: number, hs: number[]) {
    setHours((prev) => ({ ...prev, [String(day)]: hs }));
  }

  function onSave() {
    setError(null);
    startSaving(async () => {
      const res = await saveAgentAction({
        id: agent.id,
        full_name: agent.full_name,
        whatsapp_e164: agent.whatsapp_e164,
        email: agent.email ?? undefined,
        office: agent.office ?? undefined,
        languages: agent.languages,
        work_hours: hours,
      });
      if (res.ok) {
        onSaved(hours);
        onClose();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border/60 bg-background p-3">
      <div>
        <h5 className="text-[12.5px] font-semibold text-foreground">
          {t("hoursTitle", { name: agent.full_name })}
        </h5>
        <p className="text-[11px] text-muted-foreground">{t("hoursHint")}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        {GRID_DAYS.map((day) => {
          const r = toRange(hours[String(day)]);
          return (
            <div key={day} className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setDay(day, r.open ? [] : toHours(9, 18))}
                className={`w-14 shrink-0 rounded-md px-2 py-1 text-[11.5px] font-semibold ${
                  r.open ? "bg-brand text-brand-fg" : "bg-muted text-muted-foreground"
                }`}
              >
                {dayName(day)}
              </button>
              {r.open ? (
                <>
                  <select
                    value={r.from}
                    onChange={(e) => setDay(day, toHours(Number(e.target.value), Math.max(Number(e.target.value) + 1, r.to)))}
                    className="h-7 rounded-md border border-border bg-background px-1.5 text-[12px] text-foreground"
                  >
                    {FROM_HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}
                  </select>
                  <span aria-hidden className="text-muted-foreground">–</span>
                  <select
                    value={r.to}
                    onChange={(e) => setDay(day, toHours(r.from, Number(e.target.value)))}
                    className="h-7 rounded-md border border-border bg-background px-1.5 text-[12px] text-foreground"
                  >
                    {FROM_HOURS.filter((h) => h > r.from).concat([22]).map((h) => <option key={h} value={h}>{hh(h)}</option>)}
                  </select>
                </>
              ) : (
                <span className="text-[11.5px] text-muted-foreground">{t("dayOff")}</span>
              )}
            </div>
          );
        })}
      </div>

      {error ? <p className="text-[11.5px] text-destructive">{error}</p> : null}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onSave} disabled={saving}>
          {saving ? t("saving") : t("saveHours")}
        </Button>
        <button type="button" onClick={onClose} className="text-[11.5px] text-muted-foreground hover:text-foreground">
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
