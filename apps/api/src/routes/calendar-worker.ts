import { sql } from 'drizzle-orm';
import { db, withAgency } from '../../../../packages/db/client';
import { buildRefreshRequest, isExpiring } from './calendar-oauth-lib';
import {
  buildCalendarEvent, parseGoogleTokenResponse, shouldSkipCalendarSync, syncOneBooking,
  type SyncBookingDeps, type BookingForEvent,
} from './calendar-lib';

/**
 * Google Calendar sync worker (Packet 2 · L2 wiring). Scheduled from index.ts
 * (every 5 minutes, gated on googleConfig()) — it replaces the abandoned n8n
 * watcher path, which never refreshed tokens. Doubly inert: returns early
 * without the Google secrets. Each tick claims pending syncs via the existing
 * RPC (FOR UPDATE SKIP LOCKED — safe across instances), enriches them with the
 * booking status + property title + agent name the claim payload doesn't carry,
 * skips cancelled/no-show viewings (→ not_required, never a ghost event), and
 * pushes the rest to Google Calendar, marking synced/failed via the existing
 * mark_* RPCs. The per-booking branching lives in the unit-tested
 * syncOneBooking(); all real Google IO is fetch(). Never invents a booking.
 *
 * RLS: bookings has FORCED agency-scoped row security and aivena_app does not
 * bypass it, so every per-agency read/write below runs inside withAgency (each
 * mark is its own short transaction — none is held open across Google IO). The
 * mark + context queries are therefore RLS-correct as-is; ONLY the cross-agency
 * claim RPC (SECURITY INVOKER, sees zero rows as aivena_app) still needs a
 * SECURITY DEFINER migration before the worker moves real rows — see the
 * wiring report / parking lot.
 */
const PROVIDER = 'google_calendar';
const GOOGLE_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const TRANSIENT_BACKOFF_SEC = 300;

type ClaimedRow = {
  booking_id: string; agency_id: string; scheduled_at: string;
  duration_minutes: number; location: string | null; lead_full_name: string | null;
};

/** Per-booking context the claim RPC doesn't return: live booking status
 *  (cancelled/no_show ⇒ skip) + property title + agent name for the event body. */
type BookingContextRow = {
  booking_id: string; booking_status: string; agent_name: string | null; notes: string | null;
  external_calendar_id: string | null;
  property_title: string | null; property_ref: string | null; property_zone: string | null; property_city: string | null;
  lead_phone: string | null; lead_email: string | null; lead_language: string | null;
};

/** Fire-and-forget nudge: run one sync pass NOW (booking created/rescheduled).
 *  Safe to call concurrently with the scheduled sweep — the claim RPC uses
 *  FOR UPDATE SKIP LOCKED, so overlapping runs never double-sync a booking.
 *  The 30-min sweep remains the safety net for non-API booking writes. */
export function nudgeCalendarSync(): void {
  void pollCalendarSyncs().catch((err) =>
    console.error('[calendar/worker] nudge failed', err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'error'),
  );
}

export async function pollCalendarSyncs(limit = 10): Promise<{ processed: number }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { processed: 0 }; // inert until configured

  const claimed = (await db.execute(sql`
    SELECT booking_id, agency_id, scheduled_at, duration_minutes, location, lead_full_name
    FROM public.pick_and_claim_pending_calendar_syncs(${limit})
  `)) as unknown as ClaimedRow[];
  if (claimed.length === 0) return { processed: 0 };

  // Group by agency so every follow-up read/write runs agency-scoped (RLS).
  const byAgency = new Map<string, ClaimedRow[]>();
  for (const row of claimed) {
    const list = byAgency.get(row.agency_id) ?? [];
    list.push(row);
    byAgency.set(row.agency_id, list);
  }

  for (const [agencyId, rows] of byAgency) {
    // One context lookup per agency batch (bookings → properties). If it fails,
    // the claimed rows must NOT stay stranded in 'syncing' (the claim RPC never
    // re-picks that status) — put them back on the retry path and move on.
    let context: Map<string, BookingContextRow>;
    try {
      context = await fetchBookingContext(agencyId, rows.map((r) => r.booking_id));
    } catch (err) {
      console.error('[calendar/worker] context lookup failed — re-queueing agency batch as transient', agencyId,
        err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'error');
      for (const row of rows) await safeMarkTransient(agencyId, row.booking_id, 'context_lookup_failed');
      continue;
    }

    const deps = depsFor(agencyId, clientId, clientSecret);
    for (const row of rows) {
      const ctx = context.get(row.booking_id);
      try {
        if (shouldSkipCalendarSync(ctx?.booking_status)) {
          // Cancelled/no-show after enqueue: release the claimed row to
          // not_required instead of creating an event for a dead viewing.
          await withAgency(agencyId, async (tx) => {
            await tx.execute(sql`SELECT public.mark_booking_calendar_not_required(${row.booking_id}::uuid)`);
          });
          continue;
        }
        const b: BookingForEvent = {
          scheduledAt: typeof row.scheduled_at === 'string' ? row.scheduled_at : new Date(row.scheduled_at).toISOString(),
          durationMinutes: row.duration_minutes,
          location: row.location,
          leadName: row.lead_full_name,
          leadPhone: ctx?.lead_phone ?? null,
          leadEmail: ctx?.lead_email ?? null,
          leadLanguage: ctx?.lead_language ?? null,
          propertyTitle: ctx?.property_title ?? null,
          propertyRef: ctx?.property_ref ?? null,
          propertyZone: ctx?.property_zone ?? null,
          propertyCity: ctx?.property_city ?? null,
          agentName: ctx?.agent_name ?? null,
          notes: ctx?.notes ?? null,
        };
        await syncOneBooking({
          bookingId: row.booking_id, agencyId: row.agency_id, event: buildCalendarEvent(b),
          existingEventId: ctx?.external_calendar_id ?? null,   // present ⇒ reschedule: PATCH, don't duplicate
        }, deps);
      } catch (err) {
        // A thrown row (network blip mid-refresh, DB hiccup) must not abort the
        // rest of the batch NOR strand this booking in 'syncing' — best-effort
        // transient mark keeps it on the retry path.
        // FIRST LINE ONLY. Drizzle's DrizzleQueryError message is
        // `Failed query: <sql>\nparams: <bind values>` — and this catch wraps
        // syncOneBooking, whose FIRST statement is deps.getAccessToken →
        // store_agency_oauth_credential(agencyId, provider, ACCESS_TOKEN,
        // REFRESH_TOKEN, …). syncOneBooking has no try/catch of its own, so a
        // DB failure there put live Google tokens into the logs. The sibling
        // delete path (line ~203) and calendar.ts already do it this way.
        console.error('[calendar/worker] booking sync threw', row.booking_id,
          err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'error');
        await safeMarkTransient(agencyId, row.booking_id, 'worker_exception');
      }
    }
  }
  return { processed: claimed.length };
}

/** The injectable IO for syncOneBooking, agency-scoped: each mark_* runs in its
 *  own short withAgency transaction (RLS) — never held open across Google IO. */
function depsFor(agencyId: string, clientId: string, clientSecret: string): SyncBookingDeps {
  return {
    getAccessToken: (aid) => getFreshAccessToken(aid, clientId, clientSecret),
    insertEvent: async (accessToken, event) => {
      const resp = await fetch(GOOGLE_EVENTS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      let eventId: string | null = null;
      try { eventId = ((await resp.json()) as { id?: string }).id ?? null; } catch { /* body may be empty on error */ }
      return { status: resp.status, eventId };
    },
    updateEvent: async (accessToken, eventId, event) => {
      const resp = await fetch(`${GOOGLE_EVENTS_URL}/${encodeURIComponent(eventId)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      let id: string | null = null;
      try { id = ((await resp.json()) as { id?: string }).id ?? null; } catch { /* body may be empty on error */ }
      return { status: resp.status, eventId: id };
    },
    markSynced: async (id, eventId) => {
      await withAgency(agencyId, async (tx) => { await tx.execute(sql`SELECT public.mark_booking_calendar_synced(${id}::uuid, ${eventId})`); });
    },
    markTransient: async (id, err) => {
      await withAgency(agencyId, async (tx) => { await tx.execute(sql`SELECT public.mark_booking_calendar_failed_transient(${id}::uuid, ${err}, ${TRANSIENT_BACKOFF_SEC})`); });
    },
    markPermanent: async (id, err) => {
      await withAgency(agencyId, async (tx) => { await tx.execute(sql`SELECT public.mark_booking_calendar_failed_permanent(${id}::uuid, ${err}, ${'google_permanent'})`); });
    },
  };
}

/** Cancel-side cleanup: delete the booking's Google event (fire-and-forget from
 *  the cancel route — NEVER throws). 404/410 count as success (already gone).
 *  On success the booking is released to not_required with the event id cleared,
 *  so a later un-cancel/re-queue would create a fresh event cleanly. */
export async function deleteCalendarEventForBooking(bookingId: string, agencyId: string): Promise<void> {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return;   // calendar not configured — nothing to clean
    const rows = await withAgency(agencyId, async (tx) =>
      (await tx.execute(sql`SELECT external_calendar_id FROM public.bookings WHERE id = ${bookingId}::uuid`)) as unknown as Array<{ external_calendar_id: string | null }>,
    );
    const eventId = rows[0]?.external_calendar_id;
    if (!eventId) return;                     // never synced — nothing in Google
    const token = await getFreshAccessToken(agencyId, clientId, clientSecret);
    if (!token) return;
    const resp = await fetch(`${GOOGLE_EVENTS_URL}/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.ok || resp.status === 404 || resp.status === 410) {
      await withAgency(agencyId, async (tx) => {
        await tx.execute(sql`
          UPDATE public.bookings
          SET calendar_sync_status = 'not_required', external_calendar_id = NULL,
              calendar_sync_last_error = 'viewing_cancelled', calendar_sync_next_retry_at = NULL,
              updated_at = now()
          WHERE id = ${bookingId}::uuid
        `);
      });
    } else {
      console.error('[calendar/worker] event delete failed', bookingId, resp.status);
    }
  } catch (err) {
    console.error('[calendar/worker] event delete threw', bookingId, err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'error');
  }
}

/** Batch lookup of booking status + agent name + property title, agency-scoped (RLS). */
async function fetchBookingContext(agencyId: string, bookingIds: string[]): Promise<Map<string, BookingContextRow>> {
  const rows = await withAgency(agencyId, async (tx) =>
    (await tx.execute(sql`
      SELECT b.id AS booking_id, b.status::text AS booking_status, b.agent_name, b.notes,
             b.external_calendar_id,
             p.title AS property_title, p.external_id AS property_ref,
             p.raw_payload->>'zone' AS property_zone, p.location_city AS property_city,
             l.phone AS lead_phone, l.email AS lead_email, l.language AS lead_language
      FROM public.bookings b
      LEFT JOIN public.properties p ON p.id = b.property_id
      LEFT JOIN public.leads l ON l.id = b.lead_id
      WHERE b.id = ANY(string_to_array(${bookingIds.join(',')}, ',')::uuid[])
    `)) as unknown as BookingContextRow[],
  );
  return new Map(rows.map((r) => [r.booking_id, r]));
}

/** Best-effort transient re-queue — a failure here only logs (the row is retried
 *  once the DB recovers; nothing else can be done from a worker tick). */
async function safeMarkTransient(agencyId: string, bookingId: string, err: string): Promise<void> {
  try {
    await withAgency(agencyId, async (tx) => {
      await tx.execute(sql`SELECT public.mark_booking_calendar_failed_transient(${bookingId}::uuid, ${err}, ${TRANSIENT_BACKOFF_SEC})`);
    });
  } catch (markErr) {
    console.error('[calendar/worker] transient re-queue failed', bookingId, markErr instanceof Error ? markErr.message : 'error');
  }
}

/** Read the agency's Google cred; refresh the access token if it's expiring.
 *  Uses the SECURITY DEFINER credential RPCs — no agency context needed. */
async function getFreshAccessToken(agencyId: string, clientId: string, clientSecret: string): Promise<string | null> {
  const rows = (await db.execute(sql`
    SELECT * FROM public.get_agency_oauth_credential(${agencyId}, ${PROVIDER})
  `)) as unknown as Array<{ access_token: string | null; refresh_token: string | null; expires_at: string | null; status: string | null }>;
  const cred = rows[0];
  if (!cred || cred.status !== 'active' || !cred.access_token) return null;  // 'active' = CHECK-valid connected

  const expMs = cred.expires_at ? new Date(cred.expires_at).getTime() : 0;
  if (!isExpiring(expMs, Date.now())) return cred.access_token;
  if (!cred.refresh_token) return cred.access_token; // can't refresh; try the existing token

  const req = buildRefreshRequest({ refreshToken: cred.refresh_token, clientId, clientSecret });
  const resp = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  if (!resp.ok) return cred.access_token;
  const parsed = parseGoogleTokenResponse((await resp.json()) as Record<string, unknown>, Date.now());
  await db.execute(sql`
    SELECT * FROM public.store_agency_oauth_credential(
      ${agencyId}, ${PROVIDER}, ${parsed.accessToken}, ${parsed.refreshToken},
      ${parsed.tokenType}, ${new Date(parsed.expiresAtMs).toISOString()}::timestamptz,
      string_to_array(nullif(${parsed.scopes.join(',')}, ''), ','), ${null}, ${null}
    )
  `);
  return parsed.accessToken;
}
