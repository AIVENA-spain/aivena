import { SUPPORTED_LOCALES, type Locale } from "./config";

/**
 * Single source of truth for converting an AIVENA app locale (the 2-letter
 * code stored on `user_preferences.ui_language` and mirrored to the
 * `aivena_ui_language` cookie) into a BCP-47 tag suitable for the JavaScript
 * `Intl.*` APIs (`Intl.RelativeTimeFormat`, `Intl.DateTimeFormat`, plus the
 * `toLocale*String` family).
 *
 * Every date-rendering surface in the dashboard MUST route through this
 * helper. Passing `navigator.language` or letting an `Intl` constructor pick
 * its runtime default is forbidden — that bypasses the app's resolved locale
 * and yields the "English UI, Spanish dates" mixed-locale bug.
 *
 * INTENTIONALLY OMITTED: a `dateFnsLocaleFor()` companion that would map to
 * `date-fns/locale` objects. The dashboard does not currently depend on
 * `date-fns` (verified May 2026 — `date-fns` is not in apps/dashboard/
 * package.json and is not imported anywhere under apps/dashboard). All
 * formatting today goes through native `Intl.*`. If `date-fns` is added in
 * the future, extend this file with the companion at that point — do NOT
 * pull date-fns in just to satisfy a helper signature. (YAGNI.)
 *
 * TODO(when-date-fns-lands): add `dateFnsLocaleFor(appLocale: Locale): Locale`
 * by importing from "date-fns/locale" — keep the same map keys as below.
 */

const BCP47: Record<Locale, string> = {
  en: "en-US",
  es: "es",
  de: "de",
  nl: "nl",
  fr: "fr",
  pl: "pl",
  sv: "sv",
  no: "nb-NO",
  da: "da",
  fi: "fi",
  ru: "ru",
  it: "it",
  pt: "pt",
};

function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Return a BCP-47 tag for the given AIVENA app locale, with a safe fallback
 * to `en-US` for any unrecognised input. Always pass the result of this
 * function to `Intl.RelativeTimeFormat`, `Intl.DateTimeFormat`, or
 * `Date.prototype.toLocale*String` — never pass `navigator.language`, never
 * pass `undefined`.
 */
export function intlLocaleFor(appLocale: string): string {
  if (isLocale(appLocale)) return BCP47[appLocale];
  return BCP47.en;
}
