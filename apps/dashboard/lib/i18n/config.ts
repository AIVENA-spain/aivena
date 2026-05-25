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
