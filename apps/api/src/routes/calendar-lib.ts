/**
 * Google Calendar — PURE helpers (Packet 2 · L1 wiring, build-only).
 * NO network, NO DB. Token-response parsing, event-body building, error
 * classification, and an injectable per-booking sync orchestrator (all real IO
 * is passed in as deps, so it's unit-testable with mocks — no live Google call).
 * Request builders + state signing live in calendar-oauth-lib.ts.
 */

// ── Google token response → normalised credential fields ─────────────────────
export type GoogleTokenResponse = {
  access_token?: unknown; refresh_token?: unknown; expires_in?: unknown;
  scope?: unknown; token_type?: unknown;
};
export type ParsedToken = {
  accessToken: string; refreshToken: string | null; expiresAtMs: number;
  scopes: string[]; tokenType: string;
};

/** Parse Google's /token JSON. Throws on a missing access_token. `nowMs` injected. */
export function parseGoogleTokenResponse(json: GoogleTokenResponse, nowMs: number): ParsedToken {
  const accessToken = typeof json.access_token === 'string' ? json.access_token : '';
  if (!accessToken) throw new Error('google_token_missing_access_token');
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : Number(json.expires_in);
  const expiresAtMs = nowMs + (Number.isFinite(expiresIn) ? Math.max(0, Math.trunc(expiresIn)) : 0) * 1000;
  const scopes = typeof json.scope === 'string' && json.scope.trim() ? json.scope.trim().split(/\s+/) : [];
  return {
    accessToken,
    refreshToken: typeof json.refresh_token === 'string' && json.refresh_token ? json.refresh_token : null,
    expiresAtMs,
    scopes,
    tokenType: typeof json.token_type === 'string' ? json.token_type : 'Bearer',
  };
}

// ── Booking → Google Calendar event body ─────────────────────────────────────
export type BookingForEvent = {
  scheduledAt: string;          // ISO
  durationMinutes: number;
  location: string | null;
  leadName: string | null;
  leadPhone: string | null;
  leadEmail: string | null;
  leadLanguage: string | null;
  propertyTitle: string | null;
  propertyRef: string | null;   // catalogue external_id (e.g. IC-26537)
  propertyZone: string | null;  // district from the import (no street addresses exist yet)
  propertyCity: string | null;
  agentName: string | null;
  notes: string | null;         // the booking's own notes
};
export type GoogleEvent = {
  summary: string;
  description: string;
  location?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  reminders?: { useDefault: boolean; overrides: Array<{ method: 'popup' | 'email'; minutes: number }> };
};

/** Deterministic event body from a confirmed viewing. No network. */
export function buildCalendarEvent(b: BookingForEvent): GoogleEvent {
  const startMs = new Date(b.scheduledAt).getTime();
  const dur = Number.isFinite(b.durationMinutes) && b.durationMinutes > 0 ? b.durationMinutes : 60;
  const endMs = startMs + dur * 60_000;
  const t = (v: string | null | undefined): string | null => (v?.trim() ? v.trim() : null);
  const who = t(b.leadName) ?? 'Buyer';
  const what = t(b.propertyTitle);
  // Best available place line: the booking's own free-text location wins (the
  // agent typed the actual meeting point); otherwise district + city from the
  // catalogue. The catalogue holds NO street addresses yet — when that field
  // lands, it slots in here ahead of zone/city.
  const area = [t(b.propertyZone), t(b.propertyCity)].filter(Boolean).join(', ');
  const place = t(b.location) ?? (area || null);
  const ev: GoogleEvent = {
    summary: what ? `Viewing: ${what} — ${who}` : `Viewing — ${who}`,
    description: [
      `Lead: ${who}`,
      t(b.leadPhone) ? `Phone: ${t(b.leadPhone)}` : null,
      t(b.leadEmail) ? `Email: ${t(b.leadEmail)}` : null,
      t(b.leadLanguage) ? `Language: ${t(b.leadLanguage)}` : null,
      what ? `Property: ${what}${t(b.propertyRef) ? ` (${t(b.propertyRef)})` : ''}` : null,
      area ? `Area: ${area}` : null,
      t(b.agentName) ? `Agent: ${t(b.agentName)}` : null,
      t(b.notes) ? `Notes: ${t(b.notes)}` : null,
      'Booked via AIVENA.',
    ].filter(Boolean).join('\n'),
    start: { dateTime: new Date(startMs).toISOString() },
    end: { dateTime: new Date(endMs).toISOString() },
    // Two agent-facing reminders (Christian, 2026-08-26): 24 h + 2 h before.
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 1440 }, { method: 'popup', minutes: 120 }] },
  };
  if (place) ev.location = place;
  return ev;
}

// ── Cancelled-skip decision (worker wiring) ──────────────────────────────────
/**
 * True when a claimed booking must NOT get a calendar event — the viewing is
 * not happening. The claim RPC picks rows by calendar_sync_status alone, so a
 * booking cancelled AFTER enqueue is still claimed; the worker checks the live
 * booking status and marks those not_required instead of creating a ghost event.
 */
export function shouldSkipCalendarSync(bookingStatus: string | null | undefined): boolean {
  return bookingStatus === 'cancelled' || bookingStatus === 'no_show';
}

// ── Error classification (retry vs give up) ──────────────────────────────────
export type SyncOutcome = 'transient' | 'permanent';
/** Map an HTTP status from Google to a retry decision. 429 + 5xx = transient. */
export function classifyGoogleStatus(status: number): SyncOutcome {
  if (status === 429 || (status >= 500 && status <= 599)) return 'transient';
  return 'permanent';
}

// ── Injectable per-booking sync orchestrator (testable with mocks) ───────────
export type SyncBookingInput = { bookingId: string; agencyId: string; event: GoogleEvent };
export type SyncBookingDeps = {
  /** Fresh access token for the agency (refresh handled by the caller/helper). */
  getAccessToken: (agencyId: string) => Promise<string | null>;
  /** POST the event to Google; returns { status, eventId? }. */
  insertEvent: (accessToken: string, event: GoogleEvent) => Promise<{ status: number; eventId?: string | null }>;
  markSynced: (bookingId: string, eventId: string) => Promise<void>;
  markTransient: (bookingId: string, error: string) => Promise<void>;
  markPermanent: (bookingId: string, error: string) => Promise<void>;
};
export type SyncBookingResult = { bookingId: string; result: 'synced' | 'transient' | 'permanent' };

/**
 * Sync one booking to Google Calendar. All IO is injected → no live network here.
 * Never invents a booking; only writes the sync-state RPCs. `pollCalendarSyncs`
 * (the draft worker) wires the real deps around this.
 */
export async function syncOneBooking(input: SyncBookingInput, deps: SyncBookingDeps): Promise<SyncBookingResult> {
  const token = await deps.getAccessToken(input.agencyId);
  if (!token) {
    await deps.markPermanent(input.bookingId, 'no_calendar_credential');
    return { bookingId: input.bookingId, result: 'permanent' };
  }
  const { status, eventId } = await deps.insertEvent(token, input.event);
  if (status >= 200 && status < 300 && eventId) {
    await deps.markSynced(input.bookingId, eventId);
    return { bookingId: input.bookingId, result: 'synced' };
  }
  if (classifyGoogleStatus(status) === 'transient') {
    await deps.markTransient(input.bookingId, `google_http_${status}`);
    return { bookingId: input.bookingId, result: 'transient' };
  }
  await deps.markPermanent(input.bookingId, `google_http_${status}`);
  return { bookingId: input.bookingId, result: 'permanent' };
}
