// Amanda engine — pure availability logic (house pattern: importable without a
// database, so tests need no env). backends-db re-exports for existing callers.

import { wallClockInZone, zonedTimeToUtc } from './datetime-resolver';

export interface AmandaAgencySettings {
  timezone: string;                       // default Europe/Madrid
  viewingDurationMin: number;             // default 60
  viewingNoticeHours: number;             // default 24
  /** 0=Sun..6=Sat → candidate viewing start hours (agency-local). */
  viewingHoursByWeekday: Record<number, number[]>;
  /** Agency-local YYYY-MM-DD dates Amanda must never book (holidays, days off). */
  blockedDates: string[];
  /** One-off HOUR blocks on a specific date (a meeting, the dentist) —
   *  start hours from..to-1 on that agency-local date are unbookable. */
  blockedSlots: Array<{ date: string; from: number; to: number }>;
}

const DEFAULT_VIEWING_HOURS: Record<number, number[]> = { 1: [11, 17], 2: [11, 17], 3: [11, 17], 4: [11, 17], 5: [11, 17], 6: [11] };

/** Agency-configured viewing hours — buyer-research 2026-08-28 caught that
 *  this was hardcoded to the default, silently ignoring any configured hours
 *  (Saturday-afternoon/evening slots, which international buyers ask for,
 *  could never be offered). Shape: { "1": [10, 12, 17], ... } weekday 0-6 →
 *  start hours 8-21; anything malformed falls back per-entry to nothing and
 *  a fully-empty parse falls back to the default. */
function parseViewingHours(raw: unknown): Record<number, number[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_VIEWING_HOURS;
  const out: Record<number, number[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const day = Number(k);
    if (!Number.isInteger(day) || day < 0 || day > 6 || !Array.isArray(v)) continue;
    const hours = v.filter((h): h is number => typeof h === 'number' && Number.isInteger(h) && h >= 8 && h <= 21);
    if (hours.length) out[day] = [...new Set(hours)].sort((a, b) => a - b);
  }
  return Object.keys(out).length ? out : DEFAULT_VIEWING_HOURS;
}

export function parseAmandaSettings(raw: unknown): AmandaAgencySettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
  return {
    timezone: typeof o.timezone === 'string' && o.timezone ? o.timezone : 'Europe/Madrid',
    viewingDurationMin: num(o.viewing_duration_min, 60),
    viewingNoticeHours: num(o.viewing_notice_hours, 24),
    viewingHoursByWeekday: parseViewingHours(o.viewing_hours_by_weekday),
    blockedDates: Array.isArray(o.blocked_dates)
      ? (o.blocked_dates as unknown[]).filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 120)
      : [],
    blockedSlots: Array.isArray(o.blocked_slots)
      ? (o.blocked_slots as unknown[])
          .filter((s): s is { date: string; from: number; to: number } => {
            const x = s as { date?: unknown; from?: unknown; to?: unknown };
            return (
              typeof x?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) &&
              typeof x.from === 'number' && Number.isInteger(x.from) &&
              typeof x.to === 'number' && Number.isInteger(x.to) &&
              x.from >= 8 && x.to > x.from && x.to <= 22
            );
          })
          .slice(0, 120)
      : [],
  };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function slotLabel(utcMs: number, tz: string): string {
  const wc = wallClockInZone(utcMs, tz);
  const mm = String(wc.minute).padStart(2, '0');
  return `${WEEKDAY_NAMES[wc.weekday]} ${wc.day} ${MONTH_NAMES[wc.month - 1]}, ${wc.hour}:${mm}`;
}

/** Candidate slot starts (UTC ms) walking forward from now+notice, using the
 *  agency's viewing hours, up to 14 days out. Pure — unit-testable. */
export function candidateSlots(nowMs: number, s: AmandaAgencySettings, limit = 12): number[] {
  const out: number[] = [];
  const earliest = nowMs + s.viewingNoticeHours * 3600_000;
  for (let day = 0; day < 14 && out.length < limit; day++) {
    const probe = nowMs + day * 24 * 3600_000;
    const wc = wallClockInZone(probe, s.timezone);
    // Blocked days (holidays, days off — set in the dashboard) are skipped
    // entirely: Amanda can never propose a slot on one.
    const dateStr = `${wc.year}-${String(wc.month).padStart(2, '0')}-${String(wc.day).padStart(2, '0')}`;
    if (s.blockedDates.includes(dateStr)) continue;
    // One-off hour blocks: a meeting on THIS date removes just those hours.
    const dayBlocks = s.blockedSlots.filter((b) => b.date === dateStr);
    const hours = (s.viewingHoursByWeekday[wc.weekday] ?? []).filter(
      (h) => !dayBlocks.some((b) => h >= b.from && h < b.to),
    );
    for (const h of hours) {
      const base = zonedTimeToUtc(wc.year, wc.month, wc.day, h, 0, s.timezone);   // DST-safe
      if (base >= earliest) out.push(base);
      if (out.length >= limit) break;
    }
  }
  return out;
}

