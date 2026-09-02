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
  // Kept in step with LANG_ALIASES (apps/api validators) and the DB trigger
  // normalize_lead_language(). Storage is canonicalising on 'nb'; the catalogue
  // FILE is messages/no.json, so 'nb' aliases onto it here rather than renaming
  // a file three sessions touch.
  nb: "no",
  nn: "no",
  nob: "no",
  dk: "da",
  se: "sv",
};

/**
 * Resolve a stored/browser code onto a catalogue that exists, or null when it
 * is not a language we ship. Use this — never bare isLocale() — anywhere a code
 * arrives from OUTSIDE the catalogue: a cookie, the DB, or Accept-Language.
 *
 * Why null matters: catalogLocaleFor() folds "unknown" and "English" into the
 * same answer, which is right for rendering but wrong for DETECTION. A browser
 * sending "nb" must be recognised as Norwegian, not treated as unknown and then
 * silently rendered in English.
 */
export function catalogLocaleOrNull(code: string | null | undefined): Locale | null {
  if (!code) return null;
  const base = code.trim().toLowerCase().split("-")[0];
  const aliased = CATALOG_ALIAS[base] ?? base;
  return isLocale(aliased) ? aliased : null;
}

export function catalogLocaleFor(code: string | null | undefined): Locale {
  return catalogLocaleOrNull(code) ?? DEFAULT_LOCALE;
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
 * The languages a user can pick for their PERSONAL dashboard UI language.
 *
 * This used to be a 10-code subset because user_preferences.ui_language carried
 * TWO overlapping CHECK constraints and both applied, so the effective set was
 * their intersection — which silently excluded Danish, Finnish and Portuguese
 * even though messages/da.json, fi.json and pt.json ship COMPLETE. Those agents
 * fell back to English with a finished translation sitting unused.
 *
 * Migration unblock_da_fi_pt_and_canonical_nb (2026-09-02) collapsed the pair
 * into ONE constraint over the canonical 13, so this list is now the full set.
 * Norwegian stays 'nb' here: that is canonical in storage everywhere (leads,
 * agency_settings, the 24 Meta-approved templates), and catalogLocaleFor maps it
 * onto the messages/no.json catalogue file.
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
  "da",
  "fi",
  "pt",
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
  da: "Dansk",
  fi: "Suomi",
  pt: "Português",
};
