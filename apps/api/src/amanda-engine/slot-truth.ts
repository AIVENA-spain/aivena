// Amanda engine — proposed viewing times must be SEEN, and dates must agree
// (Christian 2026-09-19). Pure — no db, fully tested.
//
// Live 2026-09-19 08:46: propose_viewing_slots created two pending actions
// (Monday 21 September 11:00 and 12:00) while the reply said "let me check what
// we have free tomorrow and I'll come straight back with times". The buyer never
// saw the times, nothing could send them later, and "tomorrow" (Sunday) matched
// neither slot. Echoing the labels was a prompt instruction only; these checks
// make it law.

import { normalizeLeadLanguage } from './validators';
import { wallClockInZone } from './datetime-resolver';

export interface ProposedSlot {
  label: string;          // "Monday 21 September, 11:00" — agency wall clock (slotLabel)
  startISO: string;
  pendingActionId: string;
}

export interface ProposedSlots {
  slots: ProposedSlot[];
  timezone: string | null;
}

type ToolEventLike = { tool: string; result: { ok: boolean; refused?: unknown; data?: unknown } };

/** Every slot the engine proposed in THIS turn (real or shadow-simulated). */
export function proposedSlotsThisTurn(events: ToolEventLike[]): ProposedSlots {
  const slots: ProposedSlot[] = [];
  let timezone: string | null = null;
  for (const ev of events) {
    if (ev.tool !== 'propose_viewing_slots' || !ev.result.ok || ev.result.refused) continue;
    const data = ev.result.data as { slots?: ProposedSlot[]; timezone?: string } | undefined;
    if (!Array.isArray(data?.slots)) continue;
    for (const s of data.slots) if (s && typeof s.label === 'string') slots.push(s);
    if (typeof data?.timezone === 'string') timezone = data.timezone;
  }
  return { slots, timezone };
}

const INTL_LOCALE: Record<string, string> = {
  en: 'en-GB', es: 'es-ES', de: 'de-DE', nl: 'nl-NL', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT',
  pl: 'pl-PL', sv: 'sv-SE', nb: 'nb-NO', da: 'da-DK', fi: 'fi-FI', ru: 'ru-RU',
};

// Unicode-aware word edges: \b is ASCII-only in JS, so "wrócę", "ø", "завтра"
// would never match next to a space.
const L = String.raw`[\p{L}\p{N}_]`;
const B = String.raw`(?<!${L})`;
const E = String.raw`(?!${L})`;

/** Wall-clock parts of a slot, read from its own label (the agency's clock). */
function labelParts(label: string): { day: number; hour: number; minute: number; weekdayEn: string } | null {
  const m = /^([A-Za-z]+) (\d{1,2}) [A-Za-z]+, (\d{1,2}):(\d{2})$/.exec(label.trim());
  if (!m) return null;
  return { weekdayEn: m[1], day: Number(m[2]), hour: Number(m[3]), minute: Number(m[4]) };
}

function weekdayNames(slot: ProposedSlot, tz: string | null, lang: string | null): string[] {
  const names = new Set<string>();
  const p = labelParts(slot.label);
  if (p) names.add(p.weekdayEn.toLowerCase());
  const at = Date.parse(slot.startISO);
  if (tz && Number.isFinite(at)) {
    for (const code of new Set([lang ?? 'en', 'en'])) {
      const loc = INTL_LOCALE[code];
      if (!loc) continue;
      for (const weekday of ['long', 'short'] as const) {
        names.add(new Intl.DateTimeFormat(loc, { weekday, timeZone: tz }).format(at).toLowerCase().replace(/\.$/, ''));
      }
    }
  }
  return [...names].filter((n) => n.length >= 2);
}

function timeShown(text: string, hour: number, minute: number): boolean {
  const h = String(hour);
  const mm = String(minute).padStart(2, '0');
  const hh = `0?${h}`;
  const exact = new RegExp(String.raw`${B}${hh}\s?[:.h]\s?${mm}${E}`, 'iu');       // 11:00 · 11.00 · 11h00 · 11 h 00
  if (exact.test(text)) return true;
  if (minute !== 0) return false;
  // Whole hours are often written without minutes: "kl. 11", "um 11 Uhr", "at 11am", "alle 11", "às 11h".
  const bare = new RegExp(
    String.raw`(?:${B}(?:kl|klo|klockan|kello|at|um|alle|às|as|a las|à|a|o|godz|в)\.?\s*${hh}${E}(?![:.]\d))|(?:${B}${hh}\s?(?:h|uhr|am|pm|horas?|ч)${E})`,
    'iu',
  );
  return bare.test(text);
}

function dayShown(text: string, slot: ProposedSlot, tz: string | null, lang: string | null): boolean {
  const p = labelParts(slot.label);
  if (p && new RegExp(String.raw`(?<!\p{N})${p.day}(?!\p{N})`, 'u').test(text)) return true;
  const lower = text.toLowerCase();
  return weekdayNames(slot, tz, lang).some((n) => new RegExp(`${B}${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${E}`, 'iu').test(lower));
}

/** The proposed slots the draft does NOT show (time AND day). Empty = all shown. */
export function slotsNotShown(draft: string, proposed: ProposedSlots, leadLanguage: string | null): ProposedSlot[] {
  const lang = normalizeLeadLanguage(leadLanguage);
  return proposed.slots.filter((s) => {
    const p = labelParts(s.label);
    if (!p) return !draft.includes(s.label);
    return !(timeShown(draft, p.hour, p.minute) && dayShown(draft, s, proposed.timezone, lang));
  });
}

// ── Relative days ("today", "tomorrow", "the day after") must match the slots.
// Offset 2 is matched (and blanked) first so "pasado mañana" is not also "mañana".
const RELATIVE_DAY_WORDS: Array<{ offset: 0 | 1 | 2; re: RegExp }> = [
  {
    offset: 2,
    re: new RegExp(
      String.raw`${B}(?:the day after tomorrow|pasado mañana|übermorgen|overmorgen|après-demain|dopodomani|depois de amanhã|pojutrze|i övermorgon|övermorgon|i overmorgen|ylihuomenna|послезавтра)${E}`,
      'giu',
    ),
  },
  {
    offset: 1,
    re: new RegExp(
      String.raw`${B}(?:tomorrow|(?<!${B}(?:la|esta|por la|de la)\s)mañana|(?<!${B}(?:guten|god|goede|am|jeden|heute|diesen)\s)morgen(?:ochtend|middag|avond|früh)?|demain|domani|amanhã|jutro|imorgon|i morgon|i morgen|huomenna|завтра)${E}`,
      'giu',
    ),
  },
  {
    offset: 0,
    re: new RegExp(
      String.raw`${B}(?:today|tonight|this (?:afternoon|evening)|hoy|esta tarde|heute|vandaag|aujourd'hui|ce soir|oggi|stasera|hoje|dzisiaj|dziś|idag|i dag|ikväll|i kväll|i kveld|i aften|tänään|сегодня)${E}`,
      'giu',
    ),
  },
];

function localDayNumber(utcMs: number, tz: string): number {
  const wc = wallClockInZone(utcMs, tz);
  return Math.floor(Date.UTC(wc.year, wc.month - 1, wc.day) / 86_400_000);
}

/**
 * Relative day words in the draft that no proposed slot falls on. The live
 * reply said "i morgen" (Sunday) while both slots were Monday. Only judged when
 * slots were proposed this turn; a draft that names no relative day passes.
 */
export function relativeDayMismatches(draft: string, proposed: ProposedSlots, nowMs: number): string[] {
  if (proposed.slots.length === 0 || !proposed.timezone) return [];
  const tz = proposed.timezone;
  const today = localDayNumber(nowMs, tz);
  const offsets = new Set(
    proposed.slots
      .map((s) => Date.parse(s.startISO))
      .filter((t) => Number.isFinite(t))
      .map((t) => localDayNumber(t, tz) - today),
  );
  let text = draft.replace(/[’‘]/g, "'");
  const bad: string[] = [];
  for (const { offset, re } of RELATIVE_DAY_WORDS) {
    text = text.replace(re, (word) => {
      if (!offsets.has(offset)) bad.push(word);
      return ' ';
    });
  }
  return bad;
}

// ── The deterministic line, used only when the model still hides the times
// after its one regeneration. Pre-vetted: no numbers beyond the slots, no promise.
const SLOT_LINE: Record<string, { intro: string; or: string; ask: string }> = {
  en: { intro: 'Free viewing times', or: 'or', ask: 'Which suits you best?' },
  es: { intro: 'Horarios libres para la visita', or: 'o', ask: '¿Cuál te viene mejor?' },
  de: { intro: 'Freie Besichtigungstermine', or: 'oder', ask: 'Welcher passt dir am besten?' },
  nl: { intro: 'Vrije bezichtigingstijden', or: 'of', ask: 'Welke past jou het best?' },
  fr: { intro: 'Créneaux de visite disponibles', or: 'ou', ask: 'Lequel vous convient le mieux ?' },
  it: { intro: 'Orari liberi per la visita', or: 'o', ask: 'Quale ti va meglio?' },
  pt: { intro: 'Horários livres para a visita', or: 'ou', ask: 'Qual te dá mais jeito?' },
  pl: { intro: 'Wolne terminy oglądania', or: 'lub', ask: 'Który ci najbardziej pasuje?' },
  sv: { intro: 'Lediga visningstider', or: 'eller', ask: 'Vilken passar dig bäst?' },
  nb: { intro: 'Ledige visningstider', or: 'eller', ask: 'Hvilken passer best for deg?' },
  da: { intro: 'Ledige fremvisningstider', or: 'eller', ask: 'Hvilken passer dig bedst?' },
  fi: { intro: 'Vapaat esittelyajat', or: 'tai', ask: 'Mikä sopii sinulle parhaiten?' },
  ru: { intro: 'Свободное время для просмотра', or: 'или', ask: 'Какое вам удобнее?' },
};

export function slotLine(proposed: ProposedSlots, leadLanguage: string | null, withQuestion: boolean): string {
  const lang = normalizeLeadLanguage(leadLanguage) ?? 'en';
  const words = SLOT_LINE[lang] ?? SLOT_LINE.en;
  const loc = INTL_LOCALE[lang] ?? INTL_LOCALE.en;
  const tz = proposed.timezone;
  const items = proposed.slots.map((s) => {
    const at = Date.parse(s.startISO);
    if (!tz || !Number.isFinite(at)) return s.label;
    const day = new Intl.DateTimeFormat(loc, { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(at);
    const time = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(at);
    return `${day}, ${time}`;
  });
  const list = items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ${words.or} ${items[items.length - 1]}`;
  const sep = /\s$/.test(words.intro) ? '' : lang === 'fr' ? ' : ' : ': ';
  return `${words.intro}${sep}${list}.${withQuestion ? ` ${words.ask}` : ''}`;
}
