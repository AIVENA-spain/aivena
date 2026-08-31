// Amanda engine — deterministic datetime resolver (design §4: "the model NEVER
// emits absolute datetimes from relative phrases"). The preferred path is
// slot-id based (propose_viewing_slots generates server-side slots and the
// buyer taps one), so this resolver handles the free-text fallback: a buyer
// writes "viernes a las 17" and the ENGINE — not the model — converts it using
// the agency's IANA timezone and a fresh now(). Anything ambiguous returns a
// clarify result; resolved times in the past are rejected. EN + ES core; other
// languages route through clarification (the proposal echo is always explicit,
// so a mis-parse cannot silently survive).
//
// No external tz library: zonedTimeToUtc uses the standard iterative
// Intl.DateTimeFormat offset technique (DST-safe for real-world offsets).

export type ResolveOk = {
  ok: true;
  utcISO: string;
  /** What Amanda must echo back, explicit and unambiguous. */
  explicit: { weekday: string; day: number; month: number; year: number; hour: number; minute: number };
};
export type ResolveFail = { ok: false; reason: 'ambiguous_time' | 'missing_time' | 'past' | 'unparseable' };
export type ResolveResult = ResolveOk | ResolveFail;

const WEEKDAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

/**
 * Weekday names in EVERY language AIVENA supports, index 0 = Sunday.
 *
 * This resolver understood English and Spanish only — so a Norwegian buyer
 * saying "torsdag", a German saying "Donnerstag" or a Pole saying "czwartek"
 * was simply not understood, and the booking fell back to generic times. For a
 * product whose whole promise is answering people in their own language, the
 * part that reads WHEN they are free spoke two of thirteen (found 2026-08-31,
 * about to be tested by a Norwegian buyer).
 *
 * Written accent-stripped, because the caller strips first — but note that
 * strip only removes COMBINING marks: Swedish 'söndag' folds to 'sondag' while
 * Norwegian 'søndag' keeps its ø, since ø is its own letter and does not
 * decompose. Both spellings are listed, along with the ASCII forms people
 * actually type on a phone.
 */
const WEEKDAYS_ALL: string[][] = [
  // Sunday
  ['sunday', 'domingo', 'sonntag', 'zondag', 'dimanche', 'domenica', 'niedziela',
   'sondag', 'søndag', 'sunnuntai', 'воскресенье'],
  // Monday
  ['monday', 'lunes', 'montag', 'maandag', 'lundi', 'lunedi', 'segunda', 'poniedzialek',
   'mandag', 'maanantai', 'понедельник'],
  // Tuesday
  ['tuesday', 'martes', 'dienstag', 'dinsdag', 'mardi', 'martedi', 'terca', 'wtorek',
   'tisdag', 'tirsdag', 'tiistai', 'вторник'],
  // Wednesday
  ['wednesday', 'miercoles', 'mittwoch', 'woensdag', 'mercredi', 'mercoledi', 'quarta',
   'sroda', 'onsdag', 'keskiviikko', 'среда'],
  // Thursday
  ['thursday', 'jueves', 'donnerstag', 'donderdag', 'jeudi', 'giovedi', 'quinta',
   'czwartek', 'torsdag', 'torstai', 'четверг'],
  // Friday
  ['friday', 'viernes', 'freitag', 'vrijdag', 'vendredi', 'venerdi', 'sexta', 'piatek',
   'fredag', 'perjantai', 'пятница'],
  // Saturday
  ['saturday', 'sabado', 'samstag', 'zaterdag', 'samedi', 'sabato', 'sobota',
   'lordag', 'lørdag', 'lauantai', 'суббота'],
];
const MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Wall-clock parts of a UTC instant in a timezone. */
export function wallClockInZone(utcMs: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short',
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  const wdIdx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour) % 24, minute: Number(parts.minute), weekday: wdIdx,
  };
}

/** UTC instant for a wall-clock time in a timezone (iterative offset, DST-safe). */
export function zonedTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): number {
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 3; i++) {
    const wc = wallClockInZone(guess, timeZone);
    const asUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute);
    const want = Date.UTC(y, m - 1, d, hh, mm);
    const diff = want - asUtc;
    if (diff === 0) return guess;
    guess += diff;
  }
  return guess;
}

/** Extract a time from the phrase. Bare hours 1–7 with no am/pm/h marker are
 *  AMBIGUOUS (could be 17:00) — clarify instead of guessing (design §4). */
export function parseTime(phrase: string): { hour: number; minute: number } | 'ambiguous' | null {
  const p = stripAccents(phrase.toLowerCase());
  let m = p.match(/\b(\d{1,2})[:.](\d{2})\b/);                     // 17:00 / 17.30
  if (m) {
    const h = Number(m[1]); const min = Number(m[2]);
    if (h <= 23 && min <= 59) return { hour: h, minute: min };
  }
  m = p.match(/\b(\d{1,2})\s?(am|pm)\b/);                          // 5pm
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[2] === 'pm') h += 12;
    return { hour: h, minute: 0 };
  }
  m = p.match(/\b(\d{1,2})\s?h(?:rs?)?\b/);                        // 17h
  if (m && Number(m[1]) <= 23) return { hour: Number(m[1]), minute: 0 };
  m = p.match(/\b(?:a las|at|om|um|kl\.?)\s+(\d{1,2})\b(?![:.\d])/); // a las 5 / at 5
  if (m) {
    const h = Number(m[1]);
    if (h >= 8 && h <= 23) return { hour: h, minute: 0 };
    if (h >= 1 && h <= 7) return 'ambiguous';                      // morning or evening?
    return null;
  }
  return null;
}

/** Resolve day+time phrase → UTC instant in the agency timezone. */
export function resolveDatetimePhrase(phrase: string, nowUtcMs: number, timeZone: string): ResolveResult {
  const p = stripAccents(phrase.toLowerCase());
  const now = wallClockInZone(nowUtcMs, timeZone);

  const time = parseTime(p);
  if (time === 'ambiguous') return { ok: false, reason: 'ambiguous_time' };

  let target: { y: number; m: number; d: number } | null = null;

  if (/\b(today|hoy)\b/.test(p)) {
    target = { y: now.year, m: now.month, d: now.day };
  } else if (/\b(tomorrow|manana)\b/.test(p)) {
    const t = wallClockInZone(nowUtcMs + 24 * 3600_000, timeZone);
    target = { y: t.year, m: t.month, d: t.day };
  }

  if (!target) {
    // Weekday name → nearest future occurrence (today allowed only with a
    // still-future time; plain weekday today means NEXT week's, clarified by echo).
    for (const [idx, names] of WEEKDAYS_ALL.map((n, i) => [i, n] as const)) {
      // Unicode-aware boundary. \b is defined on ASCII word characters only, so
      // \bчетверг\b never matches — Cyrillic letters are not \w. Every
      // non-Latin language would have silently failed this lookup while the
      // Latin ones passed, which is the worst kind of half-working.
      if (names.some((n) => new RegExp(`(?<![\\p{L}\\p{N}])${n}(?![\\p{L}\\p{N}])`, 'u').test(p))) {
        let delta = (idx - now.weekday + 7) % 7;
        if (delta === 0) {
          const sameDayOk = time && typeof time === 'object' && (time.hour > now.hour || (time.hour === now.hour && time.minute > now.minute));
          if (!sameDayOk) delta = 7;
        }
        const t = wallClockInZone(nowUtcMs + delta * 24 * 3600_000, timeZone);
        target = { y: t.year, m: t.month, d: t.day };
        break;
      }
    }
  }

  if (!target) {
    // "30 de agosto" / "august 30" / "30/08"
    let m = p.match(/\b(\d{1,2})\s+de\s+([a-z]+)\b/) ?? p.match(/\b([a-z]+)\s+(\d{1,2})\b/);
    if (m) {
      const [a, b] = [m[1], m[2]];
      const day = Number(/^\d+$/.test(a) ? a : b);
      const monthName = /^\d+$/.test(a) ? b : a;
      const mi = MONTHS_ES.indexOf(monthName) >= 0 ? MONTHS_ES.indexOf(monthName) : MONTHS_EN.indexOf(monthName);
      if (mi >= 0 && day >= 1 && day <= 31) {
        const y = mi + 1 < now.month || (mi + 1 === now.month && day < now.day) ? now.year + 1 : now.year;
        target = { y, m: mi + 1, d: day };
      }
    }
    if (!target) {
      m = p.match(/\b(\d{1,2})[/-](\d{1,2})\b/);
      if (m) {
        const day = Number(m[1]); const month = Number(m[2]);   // EU order: dd/mm
        if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
          const y = month < now.month || (month === now.month && day < now.day) ? now.year + 1 : now.year;
          target = { y, m: month, d: day };
        }
      }
    }
  }

  if (!target) return { ok: false, reason: 'unparseable' };
  if (!time) return { ok: false, reason: 'missing_time' };

  const utcMs = zonedTimeToUtc(target.y, target.m, target.d, time.hour, time.minute, timeZone);
  if (utcMs <= nowUtcMs) return { ok: false, reason: 'past' };

  const wc = wallClockInZone(utcMs, timeZone);
  return {
    ok: true,
    utcISO: new Date(utcMs).toISOString(),
    explicit: { weekday: WEEKDAYS_EN[wc.weekday], day: wc.day, month: wc.month, year: wc.year, hour: wc.hour, minute: wc.minute },
  };
}

/**
 * A DAY without a time — "Thursday", "all day Thursday", "the 4th".
 *
 * The single most common sentence in booking a viewing is "I'm free Thursday",
 * and resolveDatetimePhrase rejects it with missing_time because it is built to
 * pin an exact instant. The caller then fell back to generic slots, and Amanda
 * — seeing Tuesday and Wednesday come back — told a buyer who was free all
 * Thursday that Thursday was not possible, on a day her calendar was open
 * 13:00-20:00 (live, 2026-08-31).
 *
 * Reuses the full phrase parser rather than duplicating it: probe with a late
 * time so a same-day mention stays today, and keep only the date.
 */
export function resolvePreferredDay(
  phrase: string,
  nowUtcMs: number,
  timeZone: string,
): { year: number; month: number; day: number } | null {
  const direct = resolveDatetimePhrase(phrase, nowUtcMs, timeZone);
  if (direct.ok) return { year: direct.explicit.year, month: direct.explicit.month, day: direct.explicit.day };
  if (direct.reason !== 'missing_time') return null;
  const probe = resolveDatetimePhrase(`${phrase} 23:59`, nowUtcMs, timeZone);
  return probe.ok ? { year: probe.explicit.year, month: probe.explicit.month, day: probe.explicit.day } : null;
}
