import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

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



/* ── W11 manual viewings: create / update / cancel via Vega's RPCs ─────────
   All three RPCs raise P0001 with a stable message token; map each to a
   friendly line (Law-2) and pass anything unknown through the generic. */

const VIEWING_ERRORS: Record<string, string> = {
  viewing_time_in_past: 'That time is in the past — please pick a future time.',
  viewing_duration_out_of_range: 'Duration must be between 15 minutes and 8 hours.',
  lead_not_found: 'That lead could not be found.',
  property_not_found: 'That property could not be found.',
  booking_not_found: 'That viewing could not be found.',
  booking_type_mismatch: 'That booking is not a viewing.',
  booking_not_editable: 'This viewing can no longer be changed.',
  booking_not_cancellable: 'This viewing is already cancelled or completed.',
  insufficient_role: "Your role can't manage viewings — ask an owner or agent.",
};
const GENERIC_VIEWING =
  'Something went wrong saving that viewing — please try again, and contact support if it persists.';

type PgErrorShape = { code: string; message: string };
function asPgError(err: unknown): PgErrorShape | null {
  const SQLSTATE = /^[A-Z0-9]{5}$/;
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (typeof cur !== 'object') return null;
    const e = cur as Record<string, unknown>;
    const code = typeof e.code === 'string' ? e.code : null;
    const message = typeof e.message === 'string' ? e.message : null;
    if (code && message && SQLSTATE.test(code)) return { code, message };
    cur = e.cause;
  }
  return null;
}

function viewingError(c: import('hono').Context, err: unknown, scope: string) {
  const pg = asPgError(err);
  if (pg && pg.code === 'P0001' && Object.prototype.hasOwnProperty.call(VIEWING_ERRORS, pg.message)) {
    return c.json({ error: VIEWING_ERRORS[pg.message], code: pg.message }, 422);
  }
  console.error(`[/bookings ${scope}] failed:`, err);
  return c.json({ error: GENERIC_VIEWING }, 500);
}

async function readJson(c: import('hono').Context): Promise<Record<string, unknown>> {
  try {
    const raw = await c.req.json();
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

// POST /api/v1/bookings — create a manual viewing. p_send_confirmation is
// deliberately NOT exposed: manual creation never sends (v1 contract).
route.post('/', async (c) => {
  const tx = c.get('tx');
  const b = await readJson(c);
  const leadId = str(b.lead_id);
  const scheduledAt = str(b.scheduled_at);
  const duration = Number.isInteger(b.duration_minutes) ? (b.duration_minutes as number) : 60;
  if (!leadId) return c.json({ error: 'Please pick a lead for the viewing.' }, 400);
  if (!scheduledAt) return c.json({ error: 'Please pick a date and time.' }, 400);
  try {
    const result = await tx.execute(sql`
      SELECT * FROM create_manual_viewing(
        ${leadId}::uuid, ${scheduledAt}::timestamptz, ${duration}::int,
        ${str(b.property_id)}::uuid, ${str(b.location)}, ${str(b.notes)},
        ${str(b.agent_name)}, false
      )
    `);
    const rows = result as unknown as Array<{ booking_id: string; calendar_sync_status: string }>;
    return c.json({ ok: true, bookingId: rows[0]?.booking_id, calendarSyncStatus: rows[0]?.calendar_sync_status ?? null });
  } catch (err) {
    return viewingError(c, err, 'create');
  }
});

// PATCH /api/v1/bookings/:id — reschedule / edit. Only provided fields change
// (the RPC COALESCEs nulls to current values).
route.patch('/:id', async (c) => {
  const tx = c.get('tx');
  const id = c.req.param('id');
  const b = await readJson(c);
  const duration = Number.isInteger(b.duration_minutes) ? (b.duration_minutes as number) : null;
  try {
    const result = await tx.execute(sql`
      SELECT * FROM update_viewing(
        ${id}::uuid, ${str(b.scheduled_at)}::timestamptz, ${duration}::int,
        ${str(b.property_id)}::uuid, ${str(b.location)}, ${str(b.agent_name)}, ${str(b.notes)}
      )
    `);
    const rows = result as unknown as Array<{ booking_id: string; calendar_sync_status: string }>;
    return c.json({ ok: true, bookingId: rows[0]?.booking_id, calendarSyncStatus: rows[0]?.calendar_sync_status ?? null });
  } catch (err) {
    return viewingError(c, err, 'update');
  }
});

// POST /api/v1/bookings/:id/cancel
route.post('/:id/cancel', async (c) => {
  const tx = c.get('tx');
  const id = c.req.param('id');
  const b = await readJson(c);
  try {
    const result = await tx.execute(sql`
      SELECT * FROM cancel_viewing(${id}::uuid, ${str(b.reason)})
    `);
    const rows = result as unknown as Array<{ booking_id: string; cancelled_sends: number }>;
    return c.json({ ok: true, bookingId: rows[0]?.booking_id, cancelledSends: rows[0]?.cancelled_sends ?? 0 });
  } catch (err) {
    return viewingError(c, err, 'cancel');
  }
});

// GET /api/v1/bookings/lead-search?q=… — lead picker (RLS-fenced).
route.get('/lead-search', async (c) => {
  const tx = c.get('tx');
  const q = (c.req.query('q') ?? '').trim();
  try {
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    const result = await tx.execute(sql`
      SELECT id, full_name, email, phone, language
        FROM leads
       WHERE agency_id = current_setting('app.current_agency_id', true)
         AND (${q} = '' OR full_name ILIKE ${like} OR email ILIKE ${like} OR phone ILIKE ${like})
       ORDER BY last_contact_at DESC NULLS LAST, created_at DESC
       LIMIT 20
    `);
    return c.json({ leads: result as unknown as Array<Record<string, unknown>> });
  } catch (err) {
    console.error('[/bookings lead-search] failed:', err);
    return c.json({ error: 'Failed to search leads' }, 500);
  }
});

// POST /api/v1/bookings/quick-lead — inline lead creation from the viewing
// modal: name + at least one contact detail. Fenced by the leads_isolation
// RLS policy (agency GUC) on the agency-context tx.
route.post('/quick-lead', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  const b = await readJson(c);
  const name = str(b.full_name);
  const email = str(b.email);
  const phone = str(b.phone);
  if (!name) return c.json({ error: 'Please enter the lead\'s name.' }, 400);
  if (!email && !phone) {
    return c.json({ error: 'Add an email or phone number so the lead can be reached.' }, 400);
  }
  try {
    const dedup = `manual:${agencyId}:${(email ?? phone ?? randomUUID()).toLowerCase()}`;
    const result = await tx.execute(sql`
      INSERT INTO leads (
        agency_id, full_name, email, phone,
        source, source_type, channel, lead_type, status, pipeline_stage,
        followup_paused, dedup_key, received_at
      ) VALUES (
        ${agencyId}, ${name}, ${email}, ${phone},
        'dashboard_manual', 'manual', 'manual', 'buyer', 'new', 'intake',
        true, ${dedup}, now()
      )
      ON CONFLICT (dedup_key) DO UPDATE
        SET full_name = COALESCE(leads.full_name, EXCLUDED.full_name),
            updated_at = now()
      RETURNING id, full_name, email, phone, language
    `);
    const rows = result as unknown as Array<Record<string, unknown>>;
    return c.json({ ok: true, lead: rows[0] });
  } catch (err) {
    console.error('[/bookings quick-lead] failed:', err);
    return c.json({ error: 'Couldn\'t create that lead — please try again.' }, 500);
  }
});

export default route;
