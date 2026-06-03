import { Hono } from 'hono';
import { sql } from 'drizzle-orm';

/**
 * Bookings / viewings read surface (W11-lite). Read-only for this pass — the
 * dashboard Viewings page lists upcoming + past appointments. Runs as
 * aivena_app inside the agency-context tx (RLS-scoped). Joins the lead name and
 * (nullable) property title for display. status is a Postgres enum — cast to
 * text so the JSON is a plain string.
 */
const route = new Hono();

route.get('/', async (c) => {
  const tx = c.get('tx');
  try {
    const result = await tx.execute(sql`
      SELECT b.id,
             b.lead_id,
             l.full_name        AS lead_name,
             b.property_id,
             p.title            AS property_title,
             b.scheduled_at,
             b.duration_minutes,
             b.location,
             b.agent_name,
             b.status::text     AS status,
             b.notes,
             b.booking_type,
             -- "Upcoming" computed server-side with the DB clock so the page
             -- render stays pure (no Date.now() in the component).
             (b.scheduled_at IS NOT NULL
                AND b.scheduled_at >= now()
                AND b.status NOT IN ('cancelled','no_show','completed')
             )                  AS is_upcoming
        FROM bookings b
        JOIN leads l       ON l.id = b.lead_id
        LEFT JOIN properties p ON p.id = b.property_id
       WHERE b.agency_id = current_setting('app.current_agency_id', true)
       ORDER BY b.scheduled_at ASC NULLS LAST
       LIMIT 500
    `);
    const rows = result as unknown as Array<Record<string, unknown>>;
    return c.json({ bookings: rows });
  } catch (err) {
    console.error('[/bookings GET] read failed:', err);
    return c.json({ error: 'Failed to load viewings' }, 500);
  }
});

export default route;
