import { getLocale, getTranslations } from "next-intl/server";
import { CalendarClock, MapPin, User } from "lucide-react";

import { apiFetch, ApiError } from "@/lib/api/client";
import { PageLoadError } from "@/components/shell/page-error";
import { intlLocaleFor } from "@/lib/i18n/date-locale";
import type { BookingRow, BookingsResponse } from "@/lib/api/types";

export const dynamic = "force-dynamic";

/**
 * Viewings — in-app view of confirmed bookings (W11-lite). Read-only. Confirmed
 * viewings sync to Google Calendar AND show here so agents don't lose sight of
 * them. Bookings table is empty at pilot, so the honest empty state is the
 * common path. Dates use the app locale (not OS), per the shell convention.
 */
export default async function ViewingsPage() {
  const t = await getTranslations("viewings");
  const locale = intlLocaleFor(await getLocale());
  const dtf = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  let bookings: BookingRow[] = [];
  try {
    const res = await apiFetch<BookingsResponse>("/api/v1/bookings");
    bookings = res.bookings;
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[/viewings] load failed:", detail);
    return <PageLoadError />;
  }

  // is_upcoming is computed in SQL (DB clock) so this render stays pure.
  const upcoming = bookings
    .filter((b) => b.is_upcoming)
    .sort((a, b) => time(a.scheduled_at) - time(b.scheduled_at));
  const past = bookings
    .filter((b) => !b.is_upcoming)
    .sort((a, b) => time(b.scheduled_at) - time(a.scheduled_at));

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">{t("subtitle")}</p>

      {bookings.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <CalendarClock className="h-6 w-6" aria-hidden strokeWidth={1.7} />
          </div>
          <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
        </div>
      ) : (
        <>
          <Section
            heading={t("upcoming")}
            rows={upcoming}
            dtf={dtf}
            t={t}
            emptyLine={t("noUpcoming")}
          />
          {past.length > 0 ? (
            <Section heading={t("past")} rows={past} dtf={dtf} t={t} muted />
          ) : null}
        </>
      )}
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
}: {
  heading: string;
  rows: BookingRow[];
  dtf: Intl.DateTimeFormat;
  t: Awaited<ReturnType<typeof getTranslations<"viewings">>>;
  emptyLine?: string;
  muted?: boolean;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {heading}
      </h2>
      {rows.length === 0 ? (
        emptyLine ? (
          <p className="text-sm text-muted-foreground">{emptyLine}</p>
        ) : null
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((b) => (
            <ViewingRow key={b.id} b={b} dtf={dtf} t={t} muted={muted} />
          ))}
        </div>
      )}
    </section>
  );
}

function ViewingRow({
  b,
  dtf,
  t,
  muted,
}: {
  b: BookingRow;
  dtf: Intl.DateTimeFormat;
  t: Awaited<ReturnType<typeof getTranslations<"viewings">>>;
  muted?: boolean;
}) {
  const when = b.scheduled_at ? dtf.format(new Date(b.scheduled_at)) : "—";
  return (
    <article
      className={`flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-elevated ${muted ? "opacity-80" : ""}`}
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
          {when}
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
        <p className="text-[12.5px] leading-snug text-muted-foreground">
          {b.notes}
        </p>
      ) : null}
    </article>
  );
}

function StatusPill({
  status,
  t,
}: {
  status: string;
  t: Awaited<ReturnType<typeof getTranslations<"viewings">>>;
}) {
  const known = [
    "requested",
    "confirmed",
    "cancelled",
    "rescheduled",
    "completed",
    "no_show",
  ].includes(status);
  const tone =
    status === "confirmed"
      ? "border-brand/30 bg-brand-soft text-brand"
      : status === "cancelled" || status === "no_show"
        ? "border-border bg-muted text-muted-foreground"
        : "border-border bg-card text-muted-foreground";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${tone}`}
    >
      {known ? t(("status_" + status) as StatusKey) : status}
    </span>
  );
}

function time(iso: string | null): number {
  return iso ? new Date(iso).getTime() : 0;
}

type StatusKey =
  | "status_requested"
  | "status_confirmed"
  | "status_cancelled"
  | "status_rescheduled"
  | "status_completed"
  | "status_no_show";
