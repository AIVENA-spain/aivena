import { intlLocaleFor } from "./i18n/date-locale";

/**
 * Canonical display formatters for the dashboard (2026 redesign).
 * One source of truth so every surface shows money/area the same, premium way:
 * `€285,000`, not `285,000 EUR`.
 *
 * GROUPING IS LOCALE-AWARE (2026-09-02). It used to be hardcoded en-GB for
 * every language, which is not a cosmetic difference: in Spanish, German and
 * Norwegian a comma is the DECIMAL separator, so a 285,000 EUR villa rendered
 * as "€285,000" reads as TWO HUNDRED AND EIGHTY-FIVE EUROS. Pass the resolved
 * app locale (useLocale() in a client component, getLocale() on the server) and
 * a Spanish agent sees €285.000.
 *
 * The SYMBOL-first shape is deliberate and unchanged — that was the design
 * decision; only the digit grouping follows the reader.
 */

/** App locale -> BCP-47 for digit grouping. Falls back to en-GB (the previous
 *  hardcoded behaviour) so an unresolved locale never changes today's output. */
function groupingLocale(appLocale?: string | null): string {
  if (!appLocale) return "en-GB";
  try {
    return intlLocaleFor(appLocale);
  } catch {
    return "en-GB";
  }
}

const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: "€",
  GBP: "£",
  USD: "$",
};

/**
 * Format a property price as a clean, symbol-prefixed, thousands-grouped value:
 * `€285,000`. EUR/GBP/USD use their glyph; anything else prefixes the ISO code
 * (`AED 285,000`). Null/blank/non-numeric → the fallback (default "—"); pass a
 * "Price on request" label as the fallback where that reads better.
 */
export function formatPrice(
  price: number | string | null | undefined,
  currency?: string | null,
  opts?: { fallback?: string; locale?: string },
): string {
  const fallback = opts?.fallback ?? "—";
  if (price === null || price === undefined || price === "") return fallback;
  let num: number;
  if (typeof price === "number") {
    num = price;
  } else {
    const cleaned = String(price).replace(/[^0-9.-]/g, "");
    // Require at least one digit — a non-numeric string ("n/a", "TBD") must fall
    // back, not become "€0" (empty cleaned string would coerce to 0).
    num = /\d/.test(cleaned) ? Number(cleaned) : NaN;
  }
  if (!Number.isFinite(num)) return fallback;
  const grouped = Math.round(num).toLocaleString(groupingLocale(opts?.locale));
  const code = (currency ?? "EUR").toUpperCase();
  const sym = CURRENCY_SYMBOL[code];
  return sym ? `${sym}${grouped}` : `${code} ${grouped}`;
}

/** `120 m²` or the fallback when area is missing. */
export function formatArea(
  area: number | string | null | undefined,
  opts?: { fallback?: string; locale?: string },
): string {
  const fallback = opts?.fallback ?? "—";
  if (area === null || area === undefined || area === "") return fallback;
  const num = typeof area === "number" ? area : Number(area);
  if (!Number.isFinite(num)) return fallback;
  return `${Math.round(num).toLocaleString(groupingLocale(opts?.locale))} m²`;
}
