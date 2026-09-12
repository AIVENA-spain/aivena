/**
 * Dates (v1.5, approved by Christian 2026-09-12). The AI resolves a weekday or "next week" against the date of the
 * MESSAGE it appears in and returns a real date; CODE decides whether that date is near, far or already past. It was
 * the other way round before, and the AI read "torsdag" in a twelve-day-old conversation as the coming Thursday.
 *
 * The score itself never decays. A date that has passed only removes a "within 7 days" bonus that was never earned,
 * and is reported, so the urgency layer (Stage 3b) can say "viewing date passed" without weakening the lead's quality.
 */
import type { Facts } from './types';

const DAY_MS = 86_400_000;

/** A real calendar date, written the one way we accept it. Anything else is not a date and is never guessed. */
export const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** Whole days from the day of `nowIso` to that date: 0 is today, negative means it has passed. */
export function daysFromNow(date: string, nowIso: string): number {
  const now = new Date(nowIso);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.parse(`${date}T00:00:00Z`) - today) / DAY_MS);
}

export type Dated = { facts: Facts; notes: string[] };

/** Reads the dates the AI resolved and decides, in code, what they mean today. Every change is reported. */
export function applyDates(f: Facts, nowIso: string): Dated {
  const facts: Facts = JSON.parse(JSON.stringify(f)) as Facts;
  const notes: string[] = [];

  const v = facts.viewing;
  if (v && v.state && v.state !== 'none') {
    if (isDate(v.date)) {
      const days = daysFromNow(v.date, nowIso);
      v.within_7_days = days >= 0 && days <= 7;
      if (days < 0) notes.push(`the viewing date (${v.date}) has already passed`);
    } else if (v.within_7_days === true) {
      // The AI may not decide this: without a date there is nothing to measure.
      v.within_7_days = null;
      notes.push('no viewing date was given, so "within 7 days" was not counted');
    }
  }

  const t = facts.timing;
  if (t && isDate(t.date)) {
    const days = daysFromNow(t.date, nowIso);
    const was = t.state;
    t.state = days < 0 ? 'unknown' : days <= 30 ? 'within_30_days' : 'later';
    if (days < 0) notes.push(`the date they named (${t.date}) has already passed`);
    else if (was !== t.state) notes.push(`timing read from the date ${t.date}: ${t.state.replace(/_/g, ' ')}`);
  }

  return { facts, notes };
}
