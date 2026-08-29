"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Clock3,
  ChevronLeft,
  ChevronRight,
  Info,
  List,
  Loader2,
  MapPin,
  Phone,
  Plus,
  Search,
  TriangleAlert,
  User,
  UserPlus,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { langLabel } from "@/app/(app)/matches/_shared";
import { AvailabilityEditor, toRange, type BlockedSlot } from "@/components/amanda/availability-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { MetricCard } from "@/components/ui/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
import { intlLocaleFor } from "@/lib/i18n/date-locale";
import type { AmandaSettingsResponse, BookingRow, LeadPickerRow, PropertyRow } from "@/lib/api/types";
import {
  cancelViewingAction,
  createViewingAction,
  quickCreateLeadAction,
  searchLeadsAction,
  updateViewingAction,
  type ViewingInput,
} from "./viewings-actions";
import { saveAmandaSettingsAction } from "@/app/(app)/settings/section-actions";

type CalendarNote = { date: string; from: number; to: number; note: string; color?: string };

// Note colours (red/green reserved for blocked/booked). Static class maps —
// Tailwind cannot see dynamically-built class names.
const NOTE_COLORS = ["violet", "blue", "amber", "pink", "teal", "slate"] as const;
const NOTE_CHIP: Record<string, string> = {
  violet: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  blue: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  pink: "bg-pink-500/15 text-pink-700 dark:text-pink-400",
  teal: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
  slate: "bg-slate-500/15 text-slate-700 dark:text-slate-400",
};
const NOTE_DOT: Record<string, string> = {
  violet: "bg-violet-500",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  pink: "bg-pink-500",
  teal: "bg-teal-500",
  slate: "bg-slate-500",
};
const NOTE_SWATCH: Record<string, string> = NOTE_DOT;
const noteChip = (c?: string) => NOTE_CHIP[c ?? "violet"] ?? NOTE_CHIP.violet;
const noteDot = (c?: string) => NOTE_DOT[c ?? "violet"] ?? NOTE_DOT.violet;

type ViewMode = "day" | "week" | "month" | "list";

/* ── date helpers (all local-time; the dashboard convention) ─────────────── */

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fromDatetimeLocal(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const DURATIONS = [30, 45, 60, 90, 120];

/* ── display helpers ─────────────────────────────────────────────────────── */

/**
 * "zone, city" when the zone is known, else just the city — properties have no
 * street-address column, so this is the most precise place line we can show.
 */
function zoneCity(zone: string | null, city: string | null): string | null {
  if (zone && city) return `${zone}, ${city}`;
  return zone ?? city;
}

/** Ref + zone/city in one muted line, e.g. "IC-28746 · El Raso, Guardamar". */
function propertyMeta(ref: string | null, zone: string | null, city: string | null): string | null {
  const line = [ref, zoneCity(zone, city)].filter(Boolean).join(" · ");
  return line || null;
}

/** tel: URIs must not contain spaces/formatting — keep digits and a leading +. */
function telHref(phone: string): string {
  return `tel:${phone.replace(/[^+\d]/g, "")}`;
}

/* ── workspace ───────────────────────────────────────────────────────────── */

export function ViewingsWorkspace({
  bookings,
  properties,
  amanda,
}: {
  bookings: BookingRow[];
  properties: PropertyRow[];
  amanda: AmandaSettingsResponse | null;
}) {
  const t = useTranslations("viewings");
  const locale = intlLocaleFor(useLocale());
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("week");
  // Availability drawer (Christian: edit hours/blocked days right here, not
  // buried in Settings). blockedDates mirrors saves instantly into the grid.
  const [availOpen, setAvailOpen] = useState(false);
  const [blockedDates, setBlockedDates] = useState<string[]>(
    amanda?.settings?.blocked_dates ?? [],
  );
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>(
    amanda?.settings?.blocked_slots ?? [],
  );
  const [weekHours, setWeekHours] = useState<Record<string, number[]> | null>(
    amanda?.settings?.viewing_hours_by_weekday ?? null,
  );
  const [calendarNotes, setCalendarNotes] = useState<CalendarNote[]>(
    amanda?.settings?.calendar_notes ?? [],
  );
  // Tap-a-square editor (Christian 2026-08-28): the tapped date+hour IS the
  // thing being edited — quick block/unblock, a note Amanda will know, or a
  // viewing right there.
  const [slotEdit, setSlotEdit] = useState<{ date: string; hour: number } | null>(null);
  const [modal, setModal] = useState<
    | { kind: "create"; presetDate?: string }
    | { kind: "edit"; booking: BookingRow }
    | null
  >(null);

  const dtf = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  const closeAndRefresh = useCallback(
    (changed: boolean) => {
      setModal(null);
      if (changed) router.refresh();
    },
    [router],
  );

  // Honest, data-driven summary — useful even with little data (0-states read as
  // intentional). Upcoming uses the server-computed is_upcoming flag.
  const upcomingCount = bookings.filter((b) => b.is_upcoming).length;
  const totalCount = bookings.length;
  const manualCount = bookings.filter(
    (b) => (b.booking_type ?? "").toLowerCase() === "manual",
  ).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <>
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
              {(
                [
                  { key: "day", label: t("dayView"), icon: CalendarClock },
                  { key: "week", label: t("weekView"), icon: CalendarCheck },
                  { key: "month", label: t("monthView"), icon: CalendarDays },
                  { key: "list", label: t("listView"), icon: List },
                ] as const
              ).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  aria-pressed={view === key}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                    view === key
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
            {amanda?.configured ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setAvailOpen(true)}
              >
                <Clock3 className="h-3.5 w-3.5" aria-hidden />
                {t("availability")}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              onClick={() => setModal({ kind: "create" })}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t("newViewing")}
            </Button>
          </>
        }
      />

      {/* Summary — honest data-driven counts */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          icon={CalendarClock}
          label={t("cardUpcoming")}
          value={upcomingCount}
          tone="brand"
        />
        <MetricCard
          icon={CalendarCheck}
          label={t("cardTotal")}
          value={totalCount}
          tone="emerald"
        />
        <MetricCard
          icon={UserPlus}
          label={t("cardManual")}
          value={manualCount}
          tone="violet"
        />
      </div>

      {/* Honest stub-state note — bookings live in AIVENA; real Google Calendar
          sync is a later, gated step. So an agent is never surprised a viewing
          isn't on their actual Google calendar. */}
      <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {t("syncNote")}
      </p>

      {view === "day" || view === "week" ? (
        <TimeGrid
          key={view}
          days={view === "week" ? 7 : 1}
          bookings={bookings}
          locale={locale}
          blockedDates={blockedDates}
          blockedSlots={blockedSlots}
          calendarNotes={calendarNotes}
          weekHours={weekHours}
          onPickSlot={(date, hour) => setSlotEdit({ date, hour })}
          onPickBooking={(b) => setModal({ kind: "edit", booking: b })}
        />
      ) : view === "month" ? (
        <MonthGrid
          bookings={bookings}
          locale={locale}
          blockedDates={blockedDates}
          blockedSlots={blockedSlots}
          calendarNotes={calendarNotes}
          weekHours={weekHours}
          onPickDay={(date) => setModal({ kind: "create", presetDate: date })}
          onPickBooking={(b) => setModal({ kind: "edit", booking: b })}
        />
      ) : (
        <ListView
          bookings={bookings}
          dtf={dtf}
          t={t}
          onPickBooking={(b) => setModal({ kind: "edit", booking: b })}
        />
      )}

      {modal ? (
        <ViewingModal
          mode={modal.kind}
          booking={modal.kind === "edit" ? modal.booking : null}
          presetDate={modal.kind === "create" ? modal.presetDate : undefined}
          properties={properties}
          onClose={closeAndRefresh}
        />
      ) : null}

      {slotEdit ? (
        <SlotEditor
          date={slotEdit.date}
          hour={slotEdit.hour}
          locale={locale}
          blockedDates={blockedDates}
          blockedSlots={blockedSlots}
          calendarNotes={calendarNotes}
          onClose={() => setSlotEdit(null)}
          onNewViewing={() => {
            const preset = `${slotEdit.date}T${String(slotEdit.hour).padStart(2, "0")}:00`;
            setSlotEdit(null);
            setModal({ kind: "create", presetDate: preset });
          }}
          onSaved={(nextDates, nextSlots, nextNotes) => {
            setBlockedDates(nextDates);
            setBlockedSlots(nextSlots);
            setCalendarNotes(nextNotes);
          }}
        />
      ) : null}

      {/* Availability drawer — the same shared editor as Settings. */}
      {availOpen ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-foreground/40"
          onClick={() => setAvailOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("availability")}
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-[440px] flex-col gap-4 overflow-y-auto border-l border-border bg-card p-5 shadow-elevated"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[15px] font-semibold text-foreground">{t("availability")}</h3>
                <p className="text-[12px] text-muted-foreground">{t("availabilityHint")}</p>
              </div>
              <button
                type="button"
                aria-label={t("close")}
                onClick={() => setAvailOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <AvailabilityEditor
              initialHours={amanda?.settings?.viewing_hours_by_weekday}
              initialBlocked={amanda?.settings?.blocked_dates}
              initialSlots={amanda?.settings?.blocked_slots}
              initialDuration={amanda?.settings?.viewing_duration_min}
              initialNotice={amanda?.settings?.viewing_notice_hours}
              onSaved={(hours, blocked, slots) => {
                setWeekHours(hours);
                setBlockedDates(blocked);
                setBlockedSlots(slots);
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── time grid (day + week views, Christian 2026-08-28: "standard should be a
   week so you see clearly what times doesnt work and what times is open") ──
   One hour-by-hour grid: OPEN hours on the card ground, closed/outside hours
   grey, breaks + blocked hours + blocked days red — the same red language as
   the availability panel — and the actual viewings positioned at their time. */

const GRID_H_START = 8;
const GRID_H_END = 22;
const HOUR_PX = 34;

function startOfWeekLocal(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday-first
  return x;
}

function TimeGrid({
  days,
  bookings,
  locale,
  blockedDates,
  blockedSlots,
  calendarNotes,
  weekHours,
  onPickSlot,
  onPickBooking,
}: {
  days: 1 | 7;
  bookings: BookingRow[];
  locale: string;
  blockedDates: string[];
  blockedSlots: BlockedSlot[];
  calendarNotes: CalendarNote[];
  weekHours: Record<string, number[]> | null;
  onPickSlot: (isoDate: string, hour: number) => void;
  onPickBooking: (b: BookingRow) => void;
}) {
  const t = useTranslations("viewings");
  const [anchor, setAnchor] = useState(() => {
    const now = new Date();
    return days === 7 ? startOfWeekLocal(now) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const [todayKey] = useState(() => ymd(new Date()));

  const cols = useMemo(
    () =>
      Array.from({ length: days }, (_, i) => {
        const d = new Date(anchor);
        d.setDate(anchor.getDate() + i);
        return d;
      }),
    [anchor, days],
  );

  const headFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric" }),
    [locale],
  );
  const rangeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }),
    [locale],
  );
  const tf = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
    [locale],
  );
  const label =
    days === 1
      ? new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(anchor)
      : `${headFmt.format(cols[0])} – ${rangeFmt.format(cols[cols.length - 1])}`;

  const byDay = useMemo(() => {
    const m = new Map<string, BookingRow[]>();
    for (const b of bookings) {
      if (!b.scheduled_at) continue;
      const key = ymd(new Date(b.scheduled_at));
      const arr = m.get(key) ?? [];
      arr.push(b);
      m.set(key, arr);
    }
    return m;
  }, [bookings]);

  const hours = Array.from({ length: GRID_H_END - GRID_H_START }, (_, i) => GRID_H_START + i);
  const shift = (dir: -1 | 1) => {
    const d = new Date(anchor);
    d.setDate(anchor.getDate() + dir * days);
    setAnchor(d);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-elevated">
      <div className="flex items-center justify-between border-b border-border bg-brand-soft/50 px-4 py-3">
        <span className="text-[15px] font-bold capitalize text-brand">{label}</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={t("prevMonth")}
            onClick={() => shift(-1)}
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              setAnchor(days === 7 ? startOfWeekLocal(now) : new Date(now.getFullYear(), now.getMonth(), now.getDate()));
            }}
            className="rounded-md border border-border px-2.5 py-1.5 text-[11.5px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {t("today")}
          </button>
          <button
            type="button"
            aria-label={t("nextMonth")}
            onClick={() => shift(1)}
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className={days === 7 ? "min-w-[760px]" : "min-w-[340px]"}>
          {/* Column headers */}
          <div className="grid border-b border-border bg-brand-soft/30" style={{ gridTemplateColumns: `48px repeat(${days}, 1fr)` }}>
            <div />
            {cols.map((d) => {
              const key = ymd(d);
              const isToday = key === todayKey;
              return (
                <div key={key} className="px-2 py-1.5 text-center">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10.5px] font-semibold capitalize",
                      isToday ? "bg-brand text-white" : "text-brand/90",
                    )}
                  >
                    {headFmt.format(d)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Hour rows */}
          <div className="grid" style={{ gridTemplateColumns: `48px repeat(${days}, 1fr)` }}>
            {/* time axis */}
            <div className="flex flex-col">
              {hours.map((h) => (
                <div
                  key={h}
                  style={{ height: HOUR_PX }}
                  className="border-b border-r border-border/60 pr-1.5 text-right font-mono text-[9.5px] leading-[1] text-muted-foreground"
                >
                  <span className="relative top-1">{String(h).padStart(2, "0")}:00</span>
                </div>
              ))}
            </div>
            {cols.map((d) => {
              const key = ymd(d);
              const isBlockedDay = blockedDates.includes(key);
              const range = weekHours ? toRange(weekHours[String(d.getDay())]) : null;
              const dayBlocks = blockedSlots.filter((b) => b.date === key);
              const dayBookings = byDay.get(key) ?? [];
              const dayNotes = calendarNotes.filter((n) => n.date === key);
              return (
                <div key={key} className="relative border-r border-border/60 last:border-r-0">
                  {hours.map((h) => {
                    const closed =
                      range !== null &&
                      (!range.open || h < range.from || h >= range.to);
                    const inBreak =
                      range?.open && range.breakFrom != null && range.breakTo != null && h >= range.breakFrom && h < range.breakTo;
                    const inSlotBlock = dayBlocks.some((b) => h >= b.from && h < b.to);
                    const red = isBlockedDay || inBreak || inSlotBlock;
                    const note = dayNotes.find((n) => h >= n.from && h < n.to);
                    const showNoteText = note && h === note.from;
                    return (
                      <div
                        key={h}
                        role="button"
                        tabIndex={0}
                        onClick={() => onPickSlot(key, h)}
                        onKeyDown={(e) => e.key === "Enter" && onPickSlot(key, h)}
                        title={note ? note.note : red ? t("blockedDay") : closed ? t("closedDay") : undefined}
                        style={{ height: HOUR_PX }}
                        className={cn(
                          "relative cursor-pointer overflow-hidden border-b border-border/40 transition-colors",
                          red ? "bg-red-500/10 hover:bg-red-500/15" : closed ? "bg-muted/40 hover:bg-muted/60" : "hover:bg-brand-soft/30",
                        )}
                      >
                        {showNoteText ? (
                          // The note TEXT lives in the calendar itself (Christian
                          // 2026-08-28): full line in Day view, truncated in Week.
                          <span
                            className={cn(
                              "mx-1 mt-0.5 block w-fit max-w-[calc(100%-8px)] truncate rounded px-1.5 py-px font-medium",
                              noteChip(note.color),
                              days === 1 ? "text-[11px]" : "text-[9.5px]",
                            )}
                          >
                            {note.note}
                          </span>
                        ) : note ? (
                          <span aria-hidden className={cn("absolute right-1 top-1 h-1.5 w-1.5 rounded-full", noteDot(note.color))} />
                        ) : null}
                      </div>
                    );
                  })}
                  {/* bookings positioned at their real time */}
                  {dayBookings.map((b) => {
                    if (!b.scheduled_at) return null;
                    const dt = new Date(b.scheduled_at);
                    const startH = dt.getHours() + dt.getMinutes() / 60;
                    if (startH >= GRID_H_END || startH < GRID_H_START - 1) return null;
                    const top = Math.max(0, (startH - GRID_H_START) * HOUR_PX);
                    const height = Math.max(20, ((b.duration_minutes ?? 60) / 60) * HOUR_PX - 2);
                    const dead = b.status === "cancelled" || b.status === "no_show";
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPickBooking(b);
                        }}
                        style={{ top, height }}
                        title={[b.lead_name, b.lead_phone, propertyMeta(b.property_ref, b.property_zone, b.property_city)].filter(Boolean).join(" · ") || undefined}
                        className={cn(
                          "absolute inset-x-1 overflow-hidden rounded-md border-l-2 px-1.5 py-0.5 text-left text-[10px] font-medium leading-tight",
                          dead
                            ? "border-transparent bg-muted text-muted-foreground line-through"
                            : b.status === "completed"
                              ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                              : "border-transparent bg-brand text-white shadow-sm hover:brightness-110",
                        )}
                      >
                        {tf.format(dt)} {b.lead_name ?? "—"}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── slot editor (tap-a-square, Christian 2026-08-28) ─────────────────────
   The tapped date+hour is the thing being edited: quick block/unblock that
   hour (or unblock a blocked day), write a note Amanda will genuinely know
   (it rides her agency context for the next 14 days), or start a viewing at
   exactly that time. Saves immediately — no separate Save step. */

function SlotEditor({
  date,
  hour,
  locale,
  blockedDates,
  blockedSlots,
  calendarNotes,
  onClose,
  onNewViewing,
  onSaved,
}: {
  date: string;
  hour: number;
  locale: string;
  blockedDates: string[];
  blockedSlots: BlockedSlot[];
  calendarNotes: CalendarNote[];
  onClose: () => void;
  onNewViewing: () => void;
  onSaved: (dates: string[], slots: BlockedSlot[], notes: CalendarNote[]) => void;
}) {
  const t = useTranslations("viewings");
  const dayBlocked = blockedDates.includes(date);
  const hourBlocked = blockedSlots.some((b) => b.date === date && hour >= b.from && hour < b.to);
  const existingNote = calendarNotes.find((n) => n.date === date && hour >= n.from && hour < n.to) ?? null;

  const [note, setNote] = useState(existingNote?.note ?? "");
  const [noteColor, setNoteColor] = useState<string>(existingNote?.color ?? "violet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${date}T12:00:00`),
  );
  const hh = (n: number) => `${String(n).padStart(2, "0")}:00`;

  async function persist(nextDates: string[], nextSlots: BlockedSlot[], nextNotes: CalendarNote[], close: boolean) {
    setBusy(true);
    setError(null);
    const res = await saveAmandaSettingsAction({
      blocked_dates: nextDates,
      blocked_slots: nextSlots,
      calendar_notes: nextNotes,
    });
    setBusy(false);
    if (res.ok) {
      onSaved(nextDates, nextSlots, nextNotes);
      if (close) onClose();
    } else {
      setError(res.error);
    }
  }

  function toggleHourBlock() {
    if (dayBlocked) {
      void persist(blockedDates.filter((d) => d !== date), blockedSlots, calendarNotes, true);
      return;
    }
    const next = hourBlocked
      ? blockedSlots.filter((b) => !(b.date === date && hour >= b.from && hour < b.to))
      : [...blockedSlots, { date, from: hour, to: hour + 1 }];
    void persist(blockedDates, next, calendarNotes, true);
  }

  function saveNote() {
    const trimmed = note.trim().slice(0, 240);
    const without = calendarNotes.filter((n) => !(n.date === date && hour >= n.from && hour < n.to));
    const next = trimmed ? [...without, { date, from: hour, to: hour + 1, note: trimmed, color: noteColor }] : without;
    void persist(blockedDates, blockedSlots, next, true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[360px] rounded-xl border border-border bg-card p-4 shadow-elevated"
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-[14px] font-semibold capitalize text-foreground">{title}</h3>
            <p className="font-mono text-[12px] tabular-nums text-brand">{hh(hour)} – {hh(hour + 1)}</p>
          </div>
          <button
            type="button"
            aria-label={t("close")}
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={toggleHourBlock}
            className={cn(
              "rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors",
              dayBlocked || hourBlocked
                ? "bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-400"
                : "bg-muted/60 text-foreground hover:bg-muted",
            )}
          >
            {dayBlocked ? t("unblockDayAction") : hourBlocked ? t("unblockHourAction") : t("blockHourAction")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onNewViewing}
            className="rounded-lg bg-brand-soft px-3 py-2 text-left text-[13px] font-medium text-brand hover:brightness-95"
          >
            {t("newViewingHere")}
          </button>

          <div className="mt-1 flex flex-col gap-1.5">
            <label htmlFor="slot-note" className="text-[12px] font-semibold text-foreground">
              {t("noteLabel")}
            </label>
            <p className="text-[11px] text-muted-foreground">{t("noteHint")}</p>
            <textarea
              id="slot-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
              maxLength={240}
              rows={2}
              placeholder={t("notePlaceholder")}
              className="min-h-[52px] rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
            <div className="flex items-center gap-1.5" role="radiogroup" aria-label={t("noteColor")}>
              {NOTE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={noteColor === c}
                  aria-label={c}
                  onClick={() => setNoteColor(c)}
                  className={cn(
                    "h-5 w-5 rounded-full transition-transform",
                    NOTE_SWATCH[c],
                    noteColor === c ? "scale-110 ring-2 ring-foreground/40 ring-offset-1 ring-offset-card" : "opacity-60 hover:opacity-100",
                  )}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={saveNote} disabled={busy || (!note.trim() && !existingNote)}>
                {busy ? t("saving") : existingNote && !note.trim() ? t("removeNote") : t("saveNote")}
              </Button>
            </div>
          </div>
        </div>
        {error ? <p className="mt-2 text-[12px] text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}

/* ── month grid ──────────────────────────────────────────────────────────── */

function MonthGrid({
  bookings,
  locale,
  blockedDates,
  blockedSlots,
  calendarNotes,
  weekHours,
  onPickDay,
  onPickBooking,
}: {
  bookings: BookingRow[];
  locale: string;
  blockedDates: string[];
  blockedSlots: BlockedSlot[];
  calendarNotes: CalendarNote[];
  weekHours: Record<string, number[]> | null;
  onPickDay: (isoDate: string) => void;
  onPickBooking: (b: BookingRow) => void;
}) {
  const t = useTranslations("viewings");
  // First-of-month anchor; initialised client-side (no Date during SSR render
  // mismatch risk — this component only mounts client-side anyway).
  const [anchor, setAnchor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [todayKey] = useState(() => ymd(new Date()));

  const monthName = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(anchor),
    [locale, anchor],
  );
  const weekdayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
    // Monday-first (European convention).
    return Array.from({ length: 7 }, (_, i) =>
      fmt.format(new Date(2024, 0, i + 1)), // 2024-01-01 was a Monday
    );
  }, [locale]);

  const byDay = useMemo(() => {
    const m = new Map<string, BookingRow[]>();
    for (const b of bookings) {
      if (!b.scheduled_at) continue;
      const key = ymd(new Date(b.scheduled_at));
      const arr = m.get(key) ?? [];
      arr.push(b);
      m.set(key, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""));
    }
    return m;
  }, [bookings]);

  // 42 cells, Monday-first.
  const cells = useMemo(() => {
    const firstWeekday = (anchor.getDay() + 6) % 7; // Mon=0
    const start = new Date(anchor);
    start.setDate(1 - firstWeekday);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [anchor]);

  const tf = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
    [locale],
  );

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-elevated">
      {/* Month nav — brand-tinted band so the calendar reads as its own object */}
      <div className="flex items-center justify-between border-b border-border bg-brand-soft/50 px-4 py-3">
        <span className="text-[15px] font-bold capitalize text-brand">{monthName}</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={t("prevMonth")}
            onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))}
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              setAnchor(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
            className="rounded-md border border-border px-2.5 py-1.5 text-[11.5px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {t("today")}
          </button>
          <button
            type="button"
            aria-label={t("nextMonth")}
            onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))}
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-border bg-brand-soft/30">
        {weekdayNames.map((w, wi) => (
          <div
            key={w}
            className={cn(
              "px-2 py-1.5 text-center font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em]",
              wi >= 5 ? "text-brand/60" : "text-brand/90",
            )}
          >
            {w}
          </div>
        ))}
      </div>

      {/* Cells */}
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const key = ymd(d);
          const inMonth = d.getMonth() === anchor.getMonth();
          const dayBookings = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          const isBlocked = blockedDates.includes(key);
          // Weekly availability, painted into the calendar (Christian
          // 2026-08-28): a closed weekday, a recurring break, and one-off
          // hour blocks all show as red markers — red = not available.
          const dayRange = weekHours ? toRange(weekHours[String(d.getDay())]) : null;
          const isClosedWeekday = !isBlocked && dayRange !== null && !dayRange.open;
          const daySlotBlocks = isBlocked ? [] : blockedSlots.filter((b) => b.date === key);
          const breakChip =
            !isBlocked && dayRange?.open && dayRange.breakFrom != null && dayRange.breakTo != null
              ? `${dayRange.breakFrom}–${dayRange.breakTo}`
              : null;
          return (
            <div
              key={i}
              role="button"
              tabIndex={0}
              onClick={() => onPickDay(key)}
              onKeyDown={(e) => e.key === "Enter" && onPickDay(key)}
              title={isBlocked ? t("blockedDay") : undefined}
              className={cn(
                "min-h-[56px] cursor-pointer border-b border-r border-border/60 p-1.5 align-top transition-colors hover:bg-muted/40 sm:min-h-[68px]",
                !inMonth && "bg-muted/20 opacity-50",
                inMonth && isWeekend && !isBlocked && "bg-muted/25",
                isBlocked && "bg-red-500/10 hover:bg-red-500/15",
                isClosedWeekday && "bg-muted/40",
                isToday && "bg-brand-soft/40 ring-1 ring-inset ring-brand/30",
                (i + 1) % 7 === 0 && "border-r-0",
                i >= 35 && "border-b-0",
              )}
            >
              <span className="flex items-center gap-1">
                <span
                  className={cn(
                    "inline-flex h-5 w-5 items-center justify-center rounded-full font-mono text-[10.5px]",
                    isToday
                      ? "bg-brand text-white font-semibold"
                      : isBlocked
                        ? "font-semibold text-red-700 dark:text-red-400"
                        : dayBookings.length > 0
                          ? "bg-brand-soft font-semibold text-brand"
                          : "text-muted-foreground",
                  )}
                >
                  {d.getDate()}
                </span>
                {isBlocked ? (
                  <span className="truncate text-[8.5px] font-semibold uppercase tracking-wide text-red-700/80 dark:text-red-400/80">
                    {t("blockedDay")}
                  </span>
                ) : isClosedWeekday ? (
                  <span className="truncate text-[8.5px] font-medium uppercase tracking-wide text-muted-foreground/70">
                    {t("closedDay")}
                  </span>
                ) : null}
              </span>
              <div className="mt-1 flex flex-col gap-0.5">
                {inMonth && breakChip ? (
                  <span
                    title={t("blockedDay")}
                    className="w-fit rounded bg-red-500/10 px-1 py-px font-mono text-[8.5px] tabular-nums text-red-700/90 dark:text-red-400/90"
                  >
                    {breakChip}
                  </span>
                ) : null}
                {inMonth
                  ? daySlotBlocks.slice(0, 2).map((b) => (
                      <span
                        key={`${b.date}-${b.from}`}
                        title={t("blockedDay")}
                        className="w-fit rounded bg-red-500/10 px-1 py-px font-mono text-[8.5px] tabular-nums text-red-700/90 dark:text-red-400/90"
                      >
                        {b.from}–{b.to}
                      </span>
                    ))
                  : null}
                {inMonth
                  ? calendarNotes
                      .filter((n) => n.date === key)
                      .slice(0, 1)
                      .map((n) => (
                        <span
                          key={`note-${n.date}-${n.from}`}
                          title={n.note}
                          className={cn("w-fit max-w-full truncate rounded px-1 py-px text-[8.5px] font-medium", noteChip(n.color))}
                        >
                          {n.note}
                        </span>
                      ))
                  : null}
                {dayBookings.slice(0, 2).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPickBooking(b);
                    }}
                    className={cn(
                      "truncate rounded-md border-l-2 px-1.5 py-0.5 text-left text-[10px] font-medium leading-tight",
                      b.status === "cancelled" || b.status === "no_show"
                        ? "border-transparent bg-muted text-muted-foreground line-through"
                        : b.status === "completed"
                          ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400"
                          : "border-transparent bg-brand text-white shadow-sm hover:brightness-110",
                    )}
                    // Hover tooltip with the essentials (phone · ref · zone/city)
                    // — the click-through modal shows the same, clickable.
                    title={
                      [
                        b.lead_name,
                        b.lead_phone,
                        propertyMeta(b.property_ref, b.property_zone, b.property_city),
                      ]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                  >
                    {b.scheduled_at ? tf.format(new Date(b.scheduled_at)) : ""}{" "}
                    {b.lead_name ?? "—"}
                  </button>
                ))}
                {dayBookings.length > 2 ? (
                  <span className="px-1.5 font-mono text-[9px] text-muted-foreground">
                    +{dayBookings.length - 2}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── list view (the previous page layout, now tap-to-edit) ──────────────── */

function ListView({
  bookings,
  dtf,
  t,
  onPickBooking,
}: {
  bookings: BookingRow[];
  dtf: Intl.DateTimeFormat;
  t: ReturnType<typeof useTranslations<"viewings">>;
  onPickBooking: (b: BookingRow) => void;
}) {
  const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);
  const upcoming = bookings
    .filter((b) => b.is_upcoming)
    .sort((a, b) => time(a.scheduled_at) - time(b.scheduled_at));
  const past = bookings
    .filter((b) => !b.is_upcoming)
    .sort((a, b) => time(b.scheduled_at) - time(a.scheduled_at));

  if (bookings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card">
        <EmptyState
          icon={CalendarClock}
          title={t("emptyTitle")}
          description={t("emptyBody")}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Section heading={t("upcoming")} rows={upcoming} dtf={dtf} t={t} emptyLine={t("noUpcoming")} onPick={onPickBooking} />
      {past.length > 0 ? (
        <Section heading={t("past")} rows={past} dtf={dtf} t={t} muted onPick={onPickBooking} />
      ) : null}
    </div>
  );
}

function Section({
  heading,
  rows,
  dtf,
  t,
  emptyLine,
  muted,
  onPick,
}: {
  heading: string;
  rows: BookingRow[];
  dtf: Intl.DateTimeFormat;
  t: ReturnType<typeof useTranslations<"viewings">>;
  emptyLine?: string;
  muted?: boolean;
  onPick: (b: BookingRow) => void;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {heading}
      </h2>
      {rows.length === 0 ? (
        emptyLine ? <p className="text-sm text-muted-foreground">{emptyLine}</p> : null
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((b) => (
            // div+role (not <button>) so the nested tel: link stays valid HTML —
            // same pattern as the MonthGrid day cells.
            <div
              key={b.id}
              role="button"
              tabIndex={0}
              onClick={() => onPick(b)}
              onKeyDown={(e) => e.key === "Enter" && onPick(b)}
              className={cn(
                "flex cursor-pointer flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left shadow-elevated transition-colors hover:bg-muted/30",
                muted && "opacity-80",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="flex items-baseline gap-2 text-[14px] font-semibold text-foreground">
                    {b.lead_name ?? "—"}
                    {b.lead_language ? (
                      <span className="text-[11px] font-normal text-muted-foreground">
                        {langLabel(b.lead_language)}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[12.5px] text-muted-foreground">
                    {b.property_title ?? "—"}
                    {propertyMeta(b.property_ref, b.property_zone, b.property_city) ? (
                      <span className="font-mono text-[11px]">
                        {" · "}
                        {propertyMeta(b.property_ref, b.property_zone, b.property_city)}
                      </span>
                    ) : null}
                  </span>
                </div>
                <StatusPill status={b.status} t={t} />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 text-foreground">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                  {b.scheduled_at ? dtf.format(new Date(b.scheduled_at)) : "—"}
                  {b.duration_minutes != null ? (
                    <span className="text-muted-foreground">
                      · {t("minutes", { n: b.duration_minutes })}
                    </span>
                  ) : null}
                </span>
                {b.lead_phone ? (
                  <a
                    href={telHref(b.lead_phone)}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline"
                  >
                    <Phone className="h-3.5 w-3.5" aria-hidden />
                    {b.lead_phone}
                  </a>
                ) : null}
                {b.location ? (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    {b.location}
                  </span>
                ) : null}
                {b.agent_name ? (
                  <span className="inline-flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" aria-hidden />
                    {b.agent_name}
                  </span>
                ) : null}
              </div>
              {b.notes ? (
                <p className="text-[12.5px] leading-snug text-muted-foreground">{b.notes}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function StatusPill({
  status,
  t,
}: {
  status: string;
  t: ReturnType<typeof useTranslations<"viewings">>;
}) {
  const known = [
    "requested", "confirmed", "cancelled", "rescheduled", "completed", "no_show",
  ].includes(status);
  const tone =
    status === "confirmed"
      ? "border-brand/30 bg-brand-soft text-brand"
      : status === "cancelled" || status === "no_show"
        ? "border-border bg-muted text-muted-foreground"
        : "border-border bg-card text-muted-foreground";
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${tone}`}>
      {known ? t(("status_" + status) as StatusKey) : status}
    </span>
  );
}

type StatusKey =
  | "status_requested" | "status_confirmed" | "status_cancelled"
  | "status_rescheduled" | "status_completed" | "status_no_show";

/* ── create/edit modal ───────────────────────────────────────────────────── */

function ViewingModal({
  mode,
  booking,
  presetDate,
  properties,
  onClose,
}: {
  mode: "create" | "edit";
  booking: BookingRow | null;
  presetDate?: string;
  properties: PropertyRow[];
  onClose: (changed: boolean) => void;
}) {
  const t = useTranslations("viewings");

  const [lead, setLead] = useState<LeadPickerRow | null>(
    booking ? { id: booking.lead_id, full_name: booking.lead_name, email: null, phone: null, language: null } : null,
  );
  const [when, setWhen] = useState(() =>
    booking
      ? toDatetimeLocal(booking.scheduled_at)
      : presetDate
        ? presetDate.includes("T") ? presetDate : `${presetDate}T10:00`
        : "",
  );
  const [duration, setDuration] = useState(booking?.duration_minutes ?? 60);
  const [propertyId, setPropertyId] = useState(booking?.property_id ?? "");
  const [location, setLocation] = useState(booking?.location ?? "");
  const [agent, setAgent] = useState(booking?.agent_name ?? "");
  const [notes, setNotes] = useState(booking?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const editable =
    mode === "create" ||
    ["requested", "confirmed", "rescheduled"].includes(booking?.status ?? "");

  // Ref + zone/city line for the selected property: the booking's join fields
  // when the selection is unchanged (they carry the zone), else the catalogue
  // row (external_id + city — the properties list does not carry zone).
  const selectedPropertyInfo =
    booking && propertyId && propertyId === booking.property_id
      ? propertyMeta(booking.property_ref, booking.property_zone, booking.property_city)
      : propertyMeta(
          properties.find((p) => p.id === propertyId)?.external_id ?? null,
          null,
          properties.find((p) => p.id === propertyId)?.location_city ?? null,
        );

  async function onSave() {
    setError(null);
    if (mode === "create" && !lead) {
      setError(t("errNeedLead"));
      return;
    }
    const iso = fromDatetimeLocal(when);
    if (!iso) {
      setError(t("errNeedTime"));
      return;
    }
    const input: ViewingInput = {
      scheduled_at: iso,
      duration_minutes: duration,
      property_id: propertyId || null,
      location: location.trim() || null,
      agent_name: agent.trim() || null,
      notes: notes.trim() || null,
    };
    setBusy(true);
    const res =
      mode === "create"
        ? await createViewingAction({ ...input, lead_id: lead?.id })
        : await updateViewingAction(booking!.id, input);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onClose(true);
  }

  async function onCancelViewing() {
    setBusy(true);
    setError(null);
    const res = await cancelViewingAction(booking!.id, cancelReason.trim() || null);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onClose(true);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === "create" ? t("newViewing") : t("editViewing")}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 px-4 py-10"
      onClick={() => onClose(false)}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="text-[15px] font-semibold text-foreground">
              {mode === "create" ? t("newViewing") : t("editViewing")}
            </span>
            {booking ? <StatusPill status={booking.status} t={t} /> : null}
          </div>
          <button
            type="button"
            onClick={() => onClose(false)}
            aria-label={t("closeModal")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-5">
          {/* Lead */}
          {mode === "create" ? (
            <LeadPicker value={lead} onChange={setLead} />
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label>{t("leadLabel")}</Label>
              <div className="flex flex-col gap-0.5 rounded-md border border-border bg-muted/40 px-3 py-2">
                <span className="text-sm text-foreground">{booking?.lead_name ?? "—"}</span>
                {booking?.lead_phone || booking?.lead_language ? (
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground">
                    {booking?.lead_phone ? (
                      <a
                        href={telHref(booking.lead_phone)}
                        className="inline-flex items-center gap-1 font-mono hover:text-foreground hover:underline"
                      >
                        <Phone className="h-3 w-3" aria-hidden />
                        {booking.lead_phone}
                      </a>
                    ) : null}
                    {booking?.lead_language ? (
                      <span>{langLabel(booking.lead_language)}</span>
                    ) : null}
                  </span>
                ) : null}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vw-when">{t("dateTimeLabel")}</Label>
              <Input
                id="vw-when"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                disabled={!editable}
                className="font-mono text-[12.5px]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vw-dur">{t("durationLabel")}</Label>
              <select
                id="vw-dur"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                disabled={!editable}
                className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground disabled:opacity-60"
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {t("minutes", { n: d })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vw-prop">{t("propertyLabel")}</Label>
            <select
              id="vw-prop"
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              disabled={!editable}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground disabled:opacity-60"
            >
              <option value="">{t("propertyNone")}</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.external_id} — {p.title}
                </option>
              ))}
            </select>
            {selectedPropertyInfo ? (
              <p className="font-mono text-[11px] text-muted-foreground">
                {selectedPropertyInfo}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vw-loc">{t("locationLabel")}</Label>
            <Input
              id="vw-loc"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={!editable}
              placeholder={t("locationPh")}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vw-agent">{t("agentLabel")}</Label>
            <Input
              id="vw-agent"
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              disabled={!editable}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vw-notes">{t("notesLabel")}</Label>
            <textarea
              id="vw-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!editable}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
            />
          </div>

          {error ? (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-300"
            >
              <TriangleAlert className="h-4 w-4 flex-none" aria-hidden />
              {error}
            </div>
          ) : null}

          {/* Footer actions */}
          <div className="flex items-center justify-between gap-3 pt-1">
            {mode === "edit" && editable ? (
              cancelOpen ? (
                <div className="flex flex-1 items-center gap-2">
                  <Input
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder={t("cancelReasonPh")}
                    className="h-9 text-[12.5px]"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={onCancelViewing}
                  >
                    {t("confirmCancel")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setCancelOpen(false)}
                  >
                    {t("keepViewing")}
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="text-rose-600 dark:text-rose-300"
                  onClick={() => setCancelOpen(true)}
                >
                  {t("cancelViewingBtn")}
                </Button>
              )
            ) : (
              <span />
            )}
            {!cancelOpen && editable ? (
              <Button type="button" onClick={onSave} disabled={busy} className="gap-1.5">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {mode === "create" ? t("createBtn") : t("saveBtn")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── lead picker (search + inline quick-create) ──────────────────────────── */

function LeadPicker({
  value,
  onChange,
}: {
  value: LeadPickerRow | null;
  onChange: (l: LeadPickerRow | null) => void;
}) {
  const t = useTranslations("viewings");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<LeadPickerRow[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback((term: string) => {
    setSearching(true);
    searchLeadsAction(term).then((res) => {
      setSearching(false);
      if (res.ok) {
        setResults(res.data);
        setOpen(true);
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function onInput(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => runSearch(v), 300);
  }

  async function onQuickCreate() {
    setError(null);
    if (!newName.trim()) {
      setError(t("errLeadName"));
      return;
    }
    if (!newEmail.trim() && !newPhone.trim()) {
      setError(t("errLeadContact"));
      return;
    }
    setCreateBusy(true);
    const res = await quickCreateLeadAction({
      full_name: newName.trim(),
      email: newEmail.trim() || null,
      phone: newPhone.trim() || null,
    });
    setCreateBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onChange(res.data);
    setCreating(false);
    setOpen(false);
  }

  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label>{t("leadLabel")}</Label>
        <div className="flex items-center justify-between rounded-md border border-brand/40 bg-brand-soft px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">
              {value.full_name ?? "—"}
            </div>
            {value.email || value.phone ? (
              <div className="truncate text-[11px] text-muted-foreground">
                {value.email ?? value.phone}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t("changeLead")}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="vw-lead">{t("leadLabel")}</Label>
      {!creating ? (
        <div className="relative">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="vw-lead"
              value={q}
              onChange={(e) => onInput(e.target.value)}
              onFocus={() => runSearch(q)}
              placeholder={t("leadSearchPh")}
              className="pl-9"
              autoComplete="off"
            />
          </div>
          {open ? (
            <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-card shadow-elevated">
              {searching ? (
                <div className="flex items-center gap-2 px-3 py-2.5 text-[12.5px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  {t("searching")}
                </div>
              ) : (
                <>
                  {results.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => {
                        onChange(l);
                        setOpen(false);
                      }}
                      className="flex w-full flex-col px-3 py-2 text-left hover:bg-muted/50"
                    >
                      <span className="text-[13px] font-medium text-foreground">
                        {l.full_name ?? "—"}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {l.email ?? l.phone ?? ""}
                      </span>
                    </button>
                  ))}
                  {results.length === 0 ? (
                    <div className="px-3 py-2.5 text-[12.5px] text-muted-foreground">
                      {t("noLeadsFound")}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(true);
                      setNewName(q);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-[12.5px] font-medium text-brand hover:bg-muted/50"
                  >
                    <UserPlus className="h-3.5 w-3.5" aria-hidden />
                    {t("newLeadToggle")}
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-muted/30 p-3">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("leadName")}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder={t("leadEmail")}
            />
            <Input
              type="tel"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder={t("leadPhone")}
            />
          </div>
          {error ? (
            <p className="text-xs text-rose-600 dark:text-rose-300" role="alert">{error}</p>
          ) : null}
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={onQuickCreate} disabled={createBusy} className="gap-1.5">
              {createBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {t("createLead")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
              {t("backToSearch")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
