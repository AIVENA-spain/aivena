// Amanda engine — viewing-reminder pure parts (db-free; the worker wires them).

import { wallClockInZone } from './datetime-resolver';

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

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Explicit, tz-correct date + time strings for the template (pure, tested). */
export function reminderDateParts(scheduledAtMs: number, tz: string): { date: string; time: string } {
  const wc = wallClockInZone(scheduledAtMs, tz);
  return {
    date: `${wc.day} ${MONTHS[wc.month - 1]}`,
    time: `${wc.hour}:${String(wc.minute).padStart(2, '0')}`,
  };
}
