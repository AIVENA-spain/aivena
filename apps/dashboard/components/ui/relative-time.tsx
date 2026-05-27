"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";

import { intlLocaleFor } from "@/lib/i18n/date-locale";

/**
 * Renders a timestamp as a human-readable relative string ("3 minutes ago",
 * "yesterday", "in 2 hours") in the user's resolved app locale.
 *
 * Why this is a client component:
 *   Relative formatting depends on `Date.now()`, which differs between the
 *   server's render time and the client's hydration time. A server-rendered
 *   "5 minutes ago" can disagree with the client's "6 minutes ago" string,
 *   producing a React hydration mismatch and visible flicker. To avoid that:
 *
 *   1. The initial render (server + first client paint) shows a STABLE
 *      absolute date — deterministic across passes, no Date.now() involved.
 *   2. After mount, a useEffect swaps the display to the relative string and
 *      thereafter ticks once a minute so it stays current while the page is
 *      open.
 *   3. Locale comes from `useLocale()`, so when the user flips language in
 *      Settings (which writes the i18n cookie + refreshes the route tree),
 *      this component re-renders with the new locale automatically. We
 *      never read `navigator.language`.
 *
 * Usage: `<RelativeTime iso={someIsoString} />`. The wrapper element is a
 * `<time dateTime={iso}>` for assistive-tech and SEO friendliness.
 */
export function RelativeTime({
  iso,
  className,
}: {
  iso: string;
  className?: string;
}) {
  const appLocale = useLocale();
  const bcp47 = intlLocaleFor(appLocale);

  // Stable absolute date for SSR + first paint. The formatter is constructed
  // each render, but the inputs and output are deterministic in iso+locale.
  const absolute = useMemo(
    () => formatAbsolute(iso, bcp47),
    [iso, bcp47],
  );

  // Display state — starts at the absolute string so server and client agree.
  const [display, setDisplay] = useState<string>(absolute);

  useEffect(() => {
    if (!iso) return;
    const tick = () => setDisplay(formatRelative(iso, bcp47));
    tick();
    // Re-tick every minute so "3 minutes ago" advances while the page is open.
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [iso, bcp47]);

  if (!iso) return null;

  return (
    <time dateTime={iso} className={className}>
      {display}
    </time>
  );
}

// ---------- formatters ----------

function formatAbsolute(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
  });
}

function formatRelative(iso: string, locale: string): string {
  const date = new Date(iso);
  const then = date.getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((then - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, "second");

  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");

  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");

  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return rtf.format(days, "day");

  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return rtf.format(months, "month");

  const years = Math.round(months / 12);
  return rtf.format(years, "year");
}
