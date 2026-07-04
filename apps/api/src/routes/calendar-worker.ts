import { sql } from 'drizzle-orm';
import { db } from '../../../../packages/db/client';
import { buildRefreshRequest, isExpiring } from './calendar-oauth-lib';
import {
  buildCalendarEvent, parseGoogleTokenResponse, syncOneBooking,
  type SyncBookingDeps, type BookingForEvent,
} from './calendar-lib';

/**
 * DRAFT Google Calendar sync worker (Packet 2 · L1). NOT scheduled/enabled
 * anywhere — nothing calls pollCalendarSyncs (watcher enablement is gated). It is
 * doubly inert: returns early without the Google secrets. When enabled (prod +
 * secrets), it claims pending syncs via the existing RPC, pushes each confirmed
 * viewing to Google Calendar, and marks the booking synced/failed via the
 * existing mark_* RPCs. The per-booking branching lives in the unit-tested
 * syncOneBooking(); all real Google IO is fetch(), only exercised when enabled.
 * Never invents a booking.
 */
const PROVIDER = 'google_calendar';
const GOOGLE_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

type ClaimedRow = {
  booking_id: string; agency_id: string; scheduled_at: string;
  duration_minutes: number; location: string | null; lead_full_name: string | null;
};

export async function pollCalendarSyncs(limit = 10): Promise<{ processed: number }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { processed: 0 }; // inert until configured

  const claimed = (await db.execute(sql`
    SELECT booking_id, agency_id, scheduled_at, duration_minutes, location, lead_full_name
    FROM public.pick_and_claim_pending_calendar_syncs(${limit})
  `)) as unknown as ClaimedRow[];

  const deps: SyncBookingDeps = {
    getAccessToken: (agencyId) => getFreshAccessToken(agencyId, clientId, clientSecret),
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
    markSynced: async (id, eventId) => { await db.execute(sql`SELECT public.mark_booking_calendar_synced(${id}::uuid, ${eventId})`); },
    markTransient: async (id, err) => { await db.execute(sql`SELECT public.mark_booking_calendar_failed_transient(${id}::uuid, ${err}, ${300})`); },
    markPermanent: async (id, err) => { await db.execute(sql`SELECT public.mark_booking_calendar_failed_permanent(${id}::uuid, ${err}, ${'google_permanent'})`); },
  };

  for (const row of claimed) {
    const b: BookingForEvent = {
      scheduledAt: typeof row.scheduled_at === 'string' ? row.scheduled_at : new Date(row.scheduled_at).toISOString(),
      durationMinutes: row.duration_minutes,
      location: row.location,
      leadName: row.lead_full_name,
      propertyTitle: null, // property title lookup added at wiring-approval
      agentName: null,
    };
    await syncOneBooking({ bookingId: row.booking_id, agencyId: row.agency_id, event: buildCalendarEvent(b) }, deps);
  }
  return { processed: claimed.length };
}

/** Read the agency's Google cred; refresh the access token if it's expiring. */
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
      ${parsed.scopes}::text[], ${null}, ${null}
    )
  `);
  return parsed.accessToken;
}
