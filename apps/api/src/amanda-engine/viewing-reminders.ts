// Amanda engine — viewing day-before reminder rung (design §11.1: unreminded
// no-shows run 25-40%; reminders roughly halve them). Rides the ALREADY
// APPROVED 13-language viewing_reminder_v1 template through the live send_queue
// executor (opt-out law there) — no new template, no new sender. The claim RPC
// (DEFINER, cross-agency) marks reminder_sent atomically and only fires for
// engine-enabled agencies in their local daytime; enqueue is idempotent per
// booking. Google Calendar's own 24h/2h popups stay the belt underneath.
//
// Approved template vars (verified against the live 13-language set):
//   {{1}} first name · {{2}} agency name · {{3}} date · {{4}} time · {{5}} property

import { sql } from 'drizzle-orm';
import { db, withAgency } from '../../../../packages/db/client';
import { reminderDateParts, reminderGreetingName, reminderPropertyLabel, type ReminderRow } from './viewing-reminders-lib';

export { reminderDateParts, reminderGreetingName, reminderPropertyLabel, type ReminderRow } from './viewing-reminders-lib';

export async function sweepViewingReminders(limit = 25): Promise<{ enqueued: number }> {
  const rows = (await db.execute(
    sql`SELECT * FROM public.pick_and_mark_viewing_reminders(${limit})`,
  )) as unknown as ReminderRow[];

  let enqueued = 0;
  for (const r of rows) {
    try {
      const { date, time } = reminderDateParts(Date.parse(r.scheduled_at), r.tz, r.lead_language);
      const greeting = reminderGreetingName(r.lead_first_name, r.lead_language);
      const propertyLabel = reminderPropertyLabel(r.property_title, r.lead_language);
      await withAgency(r.agency_id, async (tx) => {
        await tx.execute(sql`
          INSERT INTO send_queue (idempotency_key, agency_id, lead_id, channel, hub, template_key, template_variables, priority, requested_by, requested_at, expiry_at)
          VALUES (
            ${'viewing-reminder:' + r.booking_id}, ${r.agency_id}, ${r.lead_id}::uuid, 'whatsapp', 'twilio',
            'viewing_reminder_v1',
            jsonb_build_object(
              '1', ${greeting}::text, '2', ${r.agency_name}::text,
              '3', ${date}::text, '4', ${time}::text, '5', ${propertyLabel}::text,
              'lead_phone', ${r.lead_phone}::text, 'first_name', ${r.lead_first_name || null}::text, 'agency_name', ${r.agency_name}::text
            ),
            'high', 'amanda_viewing_reminder', now(), now() + interval '4 hours'
          )
          ON CONFLICT (idempotency_key) DO NOTHING
        `);
      });
      enqueued++;
    } catch (err) {
      // The mark already happened — the WhatsApp reminder is lost for this
      // booking but the Google Calendar popups remain; log loudly.
      console.error('[amanda-reminders] enqueue failed for booking', r.booking_id,
        err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : 'error');
    }
  }
  return { enqueued };
}
