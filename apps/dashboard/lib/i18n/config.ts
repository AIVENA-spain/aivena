/**
 * The locales the dashboard UI catalogue ships (one messages/<code>.json per
 * entry). These are the canonical 13 supported languages and use **'no'** for
 * Norwegian (matching agency_settings.dashboard_display_language and the DB
 * CHECK constraints). The per-user `user_preferences.ui_language` column uses a
 * DIFFERENT, narrower system ('nb', 10 codes) — see USER_PREF_LOCALES — so the
 * two are bridged by catalogLocaleFor().
 */
export const SUPPORTED_LOCALES = [
  "en",
  "es",
  "de",
  "nl",
  "fr",
  "pl",
  "sv",
  "no",
  "da",
  "fi",
  "ru",
  "it",
  "pt",
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
 * Bridge ANY language code (per-user `ui_language` in the 'nb' system, OR
 * agency-level `dashboard_display_language` in the 'no' system) onto a catalog
 * file that exists. Norwegian is stored as 'nb' at the per-user layer (DB
 * CHECK) but the catalog file is 'no', so alias nb→no. Unknown codes fall back
 * to English.
 */
const CATALOG_ALIAS: Record<string, Locale> = {
  nb: "no",
};

export function catalogLocaleFor(code: string | null | undefined): Locale {
  if (!code) return DEFAULT_LOCALE;
  const aliased = CATALOG_ALIAS[code] ?? code;
  return isLocale(aliased) ? aliased : DEFAULT_LOCALE;
}

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
  de: "Deutsch",
  nl: "Nederlands",
  fr: "Français",
  pl: "Polski",
  sv: "Svenska",
  no: "Norsk",
  da: "Dansk",
  fi: "Suomi",
  ru: "Русский",
  it: "Italiano",
  pt: "Português",
};

/**
 * The languages a user can pick for their PERSONAL dashboard UI language. This
 * is DB-limited: `user_preferences.ui_language`'s CHECK constraint allows only
 * these 10 codes and uses 'nb' for Norwegian. Until Vega widens that CHECK to
 * the canonical 13 ('no' + da/fi/pt), the per-user picker offers this subset;
 * the agency-level default + the catalog support all 13. The per-user picker
 * (preferences-form) renders from this list so it never writes a code the DB
 * would reject.
 */
export const USER_PREF_LOCALES = [
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

export type UserPrefLocale = (typeof USER_PREF_LOCALES)[number];

export const USER_PREF_LOCALE_NAMES: Record<UserPrefLocale, string> = {
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
