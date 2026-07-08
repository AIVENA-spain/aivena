"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  List,
  Loader2,
  MapPin,
  Plus,
  Search,
  TriangleAlert,
  User,
  UserPlus,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { MetricCard } from "@/components/ui/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
import { intlLocaleFor } from "@/lib/i18n/date-locale";
import type { BookingRow, LeadPickerRow, PropertyRow } from "@/lib/api/types";
import {
  cancelViewingAction,
  createViewingAction,
  quickCreateLeadAction,
  searchLeadsAction,
  updateViewingAction,
  type ViewingInput,
} from "./viewings-actions";

type ViewMode = "month" | "list";

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

/* ── workspace ───────────────────────────────────────────────────────────── */

export function ViewingsWorkspace({
  bookings,
  properties,
}: {
  bookings: BookingRow[];
  properties: PropertyRow[];
}) {
  const t = useTranslations("viewings");
  const locale = intlLocaleFor(useLocale());
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("month");
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
        />
        <MetricCard
          icon={CalendarCheck}
          label={t("cardTotal")}
          value={totalCount}
        />
        <MetricCard
          icon={UserPlus}
          label={t("cardManual")}
          value={manualCount}
        />
      </div>

      {view === "month" ? (
        <MonthGrid
          bookings={bookings}
          locale={locale}
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
    </div>
  );
}

/* ── month grid ──────────────────────────────────────────────────────────── */

function MonthGrid({
  bookings,
  locale,
  onPickDay,
  onPickBooking,
}: {
  bookings: BookingRow[];
  locale: string;
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
      {/* Month nav */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-[14px] font-semibold capitalize text-foreground">{monthName}</span>
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
      <div className="grid grid-cols-7 border-b border-border bg-muted/30">
        {weekdayNames.map((w) => (
          <div
            key={w}
            className="px-2 py-1.5 text-center font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground"
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
          return (
            <div
              key={i}
              role="button"
              tabIndex={0}
              onClick={() => onPickDay(key)}
              onKeyDown={(e) => e.key === "Enter" && onPickDay(key)}
              className={cn(
                "min-h-[74px] cursor-pointer border-b border-r border-border/60 p-1.5 align-top transition-colors hover:bg-muted/40 sm:min-h-[88px]",
                !inMonth && "bg-muted/20 opacity-50",
                (i + 1) % 7 === 0 && "border-r-0",
                i >= 35 && "border-b-0",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-5 w-5 items-center justify-center rounded-full font-mono text-[10.5px]",
                  isToday
                    ? "bg-brand text-white font-semibold"
                    : "text-muted-foreground",
                )}
              >
                {d.getDate()}
              </span>
              <div className="mt-1 flex flex-col gap-1">
                {dayBookings.slice(0, 2).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPickBooking(b);
                    }}
                    className={cn(
                      "truncate rounded-md px-1.5 py-0.5 text-left text-[10px] font-medium leading-tight",
                      b.status === "cancelled" || b.status === "no_show"
                        ? "bg-muted text-muted-foreground line-through"
                        : "bg-brand-soft text-brand hover:brightness-95",
                    )}
                    title={b.lead_name ?? undefined}
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
            <button
              key={b.id}
              type="button"
              onClick={() => onPick(b)}
              className={cn(
                "flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left shadow-elevated transition-colors hover:bg-muted/30",
                muted && "opacity-80",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="text-[14px] font-semibold text-foreground">
                    {b.lead_name ?? "—"}
                  </span>
                  <span className="text-[12.5px] text-muted-foreground">
                    {b.property_title ?? "—"}
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
            </button>
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
        ? `${presetDate}T10:00`
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
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
                {booking?.lead_name ?? "—"}
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
