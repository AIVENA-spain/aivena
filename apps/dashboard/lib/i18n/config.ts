/**
 * The locales we support in the dashboard UI catalogue. Mirrors the CHECK
 * constraint on user_preferences.ui_language in the database — keep these in
 * lockstep when adding a language.
 */
export const SUPPORTED_LOCALES = [
  "en",
  "es",
  "pl",
  "nb",
  "fr",
  "nl",
  "de",
  "ru",
  "sv",
  "it",
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_COOKIE = "aivena_ui_language";
export const THEME_COOKIE = "aivena_theme";

export function isLocale(value: string | undefined): value is Locale {
  if (!value) return false;
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Map ANY language code (per-user `ui_language` OR agency-level
 * `dashboard_display_language`, which uses the 13-code 'no' system) onto a
 * catalog file that actually exists right now.
 *
 * The two code systems differ: user_preferences uses 'nb' for Norwegian; the
 * agency columns use 'no'. The catalog is currently the 10-file 'nb' set, so
 * agency 'no' aliases to 'nb', and the three 13-system languages without a
 * catalog yet (da/fi/pt) fall back to English. Phase 4 renames nb→no and adds
 * da/fi/pt — at which point this alias table flips and shrinks.
 */
const CATALOG_ALIAS: Record<string, Locale> = {
  no: "nb",
};

export function catalogLocaleFor(
  code: string | null | undefined,
): Locale {
  if (!code) return DEFAULT_LOCALE;
  const aliased = CATALOG_ALIAS[code] ?? code;
  return isLocale(aliased) ? aliased : DEFAULT_LOCALE;
}

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
  pl: "Polski",
  nb: "Norsk bokmål",
  fr: "Français",
  nl: "Nederlands",
  de: "Deutsch",
  ru: "Русский",
  sv: "Svenska",
  it: "Italiano",
};
