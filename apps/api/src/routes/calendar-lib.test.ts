import { describe, it, expect, vi } from 'vitest';
import {
  parseGoogleTokenResponse, buildCalendarEvent, classifyGoogleStatus,
  shouldSkipCalendarSync, syncOneBooking, type SyncBookingDeps,
} from './calendar-lib';

describe('parseGoogleTokenResponse', () => {
  it('normalises a full token response', () => {
    const p = parseGoogleTokenResponse(
      { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'a b', token_type: 'Bearer' },
      1_000_000,
    );
    expect(p).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresAtMs: 1_000_000 + 3_600_000, scopes: ['a', 'b'], tokenType: 'Bearer' });
  });
  it('keeps refreshToken null when Google omits it (plain refresh)', () => {
    expect(parseGoogleTokenResponse({ access_token: 'AT', expires_in: 3600 }, 0).refreshToken).toBeNull();
  });
  it('throws when access_token is missing', () => {
    expect(() => parseGoogleTokenResponse({ expires_in: 3600 }, 0)).toThrow(/access_token/);
  });
});

const emptyEventExtras = {
  leadPhone: null, leadEmail: null, leadLanguage: null,
  propertyRef: null, propertyZone: null, propertyCity: null, notes: null,
};

describe('buildCalendarEvent — deterministic event body', () => {
  it('builds summary/description/times/location from a booking', () => {
    const ev = buildCalendarEvent({
      scheduledAt: '2026-08-01T10:00:00.000Z', durationMinutes: 45,
      location: 'Calle Mayor 1', leadName: 'Jane Buyer', propertyTitle: 'Sea-view apartment', agentName: 'Ana',
      ...emptyEventExtras,
    });
    expect(ev.summary).toBe('Viewing: Sea-view apartment — Jane Buyer');
    expect(ev.start.dateTime).toBe('2026-08-01T10:00:00.000Z');
    expect(ev.end.dateTime).toBe('2026-08-01T10:45:00.000Z');
    expect(ev.location).toBe('Calle Mayor 1');
    expect(ev.description).toMatch(/Ana/);
  });
  it('handles missing property/lead + bad duration', () => {
    const ev = buildCalendarEvent({ scheduledAt: '2026-08-01T10:00:00.000Z', durationMinutes: 0, location: null, leadName: null, propertyTitle: null, agentName: null, ...emptyEventExtras });
    expect(ev.summary).toBe('Viewing — Buyer');
    expect(ev.end.dateTime).toBe('2026-08-01T11:00:00.000Z'); // defaults to 60 min
    expect(ev.location).toBeUndefined();
  });
  it('sets the 24h + 2h agent reminders on every event', () => {
    const ev = buildCalendarEvent({ scheduledAt: '2026-08-01T10:00:00.000Z', durationMinutes: 30, location: null, leadName: null, propertyTitle: null, agentName: null, ...emptyEventExtras });
    expect(ev.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 1440 }, { method: 'popup', minutes: 120 }] });
  });
  it('falls back to zone+city as the place and enriches the notes when the booking has no location', () => {
    const ev = buildCalendarEvent({
      scheduledAt: '2026-08-01T10:00:00.000Z', durationMinutes: 45,
      location: null, leadName: 'Jane Buyer', propertyTitle: 'Sea-view apartment', agentName: null,
      leadPhone: '+47 900 00 000', leadEmail: 'jane@example.com', leadLanguage: 'nb',
      propertyRef: 'IC-26537', propertyZone: 'Playa del Cura', propertyCity: 'Torrevieja', notes: 'Bring keys',
    });
    expect(ev.location).toBe('Playa del Cura, Torrevieja');
    expect(ev.description).toContain('Phone: +47 900 00 000');
    expect(ev.description).toContain('Property: Sea-view apartment (IC-26537)');
    expect(ev.description).toContain('Area: Playa del Cura, Torrevieja');
    expect(ev.description).toContain('Notes: Bring keys');
  });
});

describe('classifyGoogleStatus', () => {
  it('429 + 5xx are transient; the rest permanent', () => {
    expect(classifyGoogleStatus(429)).toBe('transient');
    expect(classifyGoogleStatus(503)).toBe('transient');
    expect(classifyGoogleStatus(400)).toBe('permanent');
    expect(classifyGoogleStatus(401)).toBe('permanent');
    expect(classifyGoogleStatus(404)).toBe('permanent');
  });
});

describe('shouldSkipCalendarSync — cancelled/no-show viewings never get an event', () => {
  it('skips cancelled + no_show', () => {
    expect(shouldSkipCalendarSync('cancelled')).toBe(true);
    expect(shouldSkipCalendarSync('no_show')).toBe(true);
  });
  it('syncs every live booking status', () => {
    expect(shouldSkipCalendarSync('requested')).toBe(false);
    expect(shouldSkipCalendarSync('confirmed')).toBe(false);
    expect(shouldSkipCalendarSync('rescheduled')).toBe(false);
    expect(shouldSkipCalendarSync('completed')).toBe(false);
  });
  it('does not skip when the status is unknown (missing context row)', () => {
    expect(shouldSkipCalendarSync(null)).toBe(false);
    expect(shouldSkipCalendarSync(undefined)).toBe(false);
  });
});

describe('syncOneBooking — orchestration with mocked IO (no live Google)', () => {
  function mkDeps(over: Partial<SyncBookingDeps> = {}): SyncBookingDeps {
    return {
      getAccessToken: vi.fn().mockResolvedValue('AT'),
      insertEvent: vi.fn().mockResolvedValue({ status: 200, eventId: 'evt_1' }),
      updateEvent: vi.fn().mockResolvedValue({ status: 200, eventId: 'evt_up' }),
      markSynced: vi.fn().mockResolvedValue(undefined),
      markTransient: vi.fn().mockResolvedValue(undefined),
      markPermanent: vi.fn().mockResolvedValue(undefined),
      ...over,
    };
  }
  const input = { bookingId: 'b1', agencyId: 'ag1', event: { summary: 's', description: 'd', start: { dateTime: 'x' }, end: { dateTime: 'y' } } };

  it('200 + eventId → synced', async () => {
    const d = mkDeps();
    expect(await syncOneBooking(input, d)).toEqual({ bookingId: 'b1', result: 'synced' });
    expect(d.markSynced).toHaveBeenCalledWith('b1', 'evt_1');
  });
  it('429 → transient (retry)', async () => {
    const d = mkDeps({ insertEvent: vi.fn().mockResolvedValue({ status: 429 }) });
    expect((await syncOneBooking(input, d)).result).toBe('transient');
    expect(d.markTransient).toHaveBeenCalled();
  });
  it('400 → permanent', async () => {
    const d = mkDeps({ insertEvent: vi.fn().mockResolvedValue({ status: 400 }) });
    expect((await syncOneBooking(input, d)).result).toBe('permanent');
    expect(d.markPermanent).toHaveBeenCalled();
  });
  it('existing event id → PATCH path, never a duplicate insert', async () => {
    const d = mkDeps();
    const r = await syncOneBooking({ ...input, existingEventId: 'evt_old' }, d);
    expect(r.result).toBe('synced');
    expect(d.updateEvent).toHaveBeenCalledWith('AT', 'evt_old', input.event);
    expect(d.insertEvent).not.toHaveBeenCalled();
    expect(d.markSynced).toHaveBeenCalledWith('b1', 'evt_up');
  });
  it('PATCH 2xx without a body keeps the known event id', async () => {
    const d = mkDeps({ updateEvent: vi.fn().mockResolvedValue({ status: 204, eventId: null }) });
    await syncOneBooking({ ...input, existingEventId: 'evt_old' }, d);
    expect(d.markSynced).toHaveBeenCalledWith('b1', 'evt_old');
  });
  it('PATCH 404 (event deleted in Google by hand) falls back to a fresh insert', async () => {
    const d = mkDeps({ updateEvent: vi.fn().mockResolvedValue({ status: 404 }) });
    const r = await syncOneBooking({ ...input, existingEventId: 'evt_gone' }, d);
    expect(r.result).toBe('synced');
    expect(d.insertEvent).toHaveBeenCalled();
    expect(d.markSynced).toHaveBeenCalledWith('b1', 'evt_1');
  });
  it('no credential → permanent (no_calendar_credential), never calls Google', async () => {
    const d = mkDeps({ getAccessToken: vi.fn().mockResolvedValue(null) });
    expect((await syncOneBooking(input, d)).result).toBe('permanent');
    expect(d.insertEvent).not.toHaveBeenCalled();
    expect(d.markPermanent).toHaveBeenCalledWith('b1', 'no_calendar_credential');
  });
});
