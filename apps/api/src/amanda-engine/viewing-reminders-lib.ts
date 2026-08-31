// Amanda engine — viewing-reminder pure parts (db-free; the worker wires them).

import { wallClockInZone } from './datetime-resolver';
import { normalizeLeadLanguage } from './validators';

export interface ReminderRow {
  booking_id: string;
  agency_id: string;
  lead_id: string;
  lead_phone: string;
  lead_first_name: string;
  lead_language: string;
  agency_name: string;
  scheduled_at: string;
  property_title: string | null;
  tz: string;
}

/** Greeting filler for a lead we have no name for. The reminder template is
 *  "Hei {{1}}, ..." in every language, so {{1}} cannot be empty — Meta rejects
 *  a blank variable. It used to be the English word "there" for EVERY language,
 *  which put "Hola there," in front of a Spanish buyer.
 *
 *  en/nb/da/sv/fi/nl/de/fr/es are idiomatic ("Hei du", "Hallo daar",
 *  "Bonjour a vous", "Hola buenas"). it/pt/pl/ru are the least-bad in-language
 *  choice and are FLAGGED FOR NATIVE REVIEW — in those languages the natural
 *  nameless form is the bare greeting, which would need a second template
 *  variant without {{1}} (a Meta submission, so a product call, not a code one).
 *  Being in-language is already strictly better than the English word. */
const NAMELESS_GREETING: Record<string, string> = {
  en: 'there', nb: 'du', da: 'du', sv: 'du', fi: 'vaan',
  nl: 'daar', de: 'du', fr: 'a vous', es: 'buenas',
  it: 'a te', pt: 'a ti', pl: 'tam', ru: 'druzhe',
};

/** Never returns an empty string: Meta rejects a blank template variable. */
export function reminderGreetingName(firstName: string | null | undefined, language: string): string {
  const name = (firstName ?? '').trim();
  if (name) return name;
  const lang = normalizeLeadLanguage(language) ?? 'en';
  return NAMELESS_GREETING[lang] ?? NAMELESS_GREETING.en;
}

/** Same family as the greeting: template slot {{5}} is "The property is {{5}}."
 *  in 13 languages, and a booking with no property title used to drop the
 *  English words "the property" into all of them. */
const NAMELESS_PROPERTY: Record<string, string> = {
  en: 'the property', es: 'la propiedad', de: 'die Immobilie', fr: 'le bien',
  nl: 'de woning', it: "l'immobile", pt: 'o imovel', pl: 'nieruchomosc',
  ru: 'obyekt', sv: 'bostaden', nb: 'boligen', da: 'boligen', fi: 'asunto',
};

export function reminderPropertyLabel(title: string | null | undefined, language: string): string {
  const t = (title ?? '').trim();
  if (t) return t;
  const lang = normalizeLeadLanguage(language) ?? 'en';
  return NAMELESS_PROPERTY[lang] ?? NAMELESS_PROPERTY.en;
}

/** Our language codes are bare primary subtags, and a bare tag resolves to the
 *  wrong REGION for two of them: 'en' resolves to en-US ("August 28") when this
 *  is a Costa Blanca product selling to British and European buyers who write
 *  "28 August", and 'pt' resolves to pt-BR when the approved templates are in
 *  European Portuguese. Region only affects presentation here, never meaning. */
const DATE_LOCALE: Record<string, string> = { en: 'en-GB', pt: 'pt-PT' };

/** Explicit, tz-correct AND language-correct date + time for the template.
 *  The month name used to be hardcoded English while viewing_reminder_v1 exists
 *  in 13 languages, so a Norwegian buyer read a Norwegian sentence containing
 *  "3 September". Intl gives both the localised month AND the locale's own
 *  day/month order ("3. september", "September 3"). The wall clock still comes
 *  from wallClockInZone — it is the tested path and handles the hour-24 trap —
 *  and is re-formatted in UTC so the zone is applied exactly once. */
export function reminderDateParts(scheduledAtMs: number, tz: string, language = 'en'): { date: string; time: string } {
  const wc = wallClockInZone(scheduledAtMs, tz);
  const lang = normalizeLeadLanguage(language) ?? 'en';
  const asUtc = new Date(Date.UTC(wc.year, wc.month - 1, wc.day));
  let date: string;
  try {
    // An unsupported tag throws RangeError; never let that kill a reminder.
    date = new Intl.DateTimeFormat(DATE_LOCALE[lang] ?? lang, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(asUtc);
  } catch {
    date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(asUtc);
  }
  return { date, time: `${wc.hour}:${String(wc.minute).padStart(2, '0')}` };
}
