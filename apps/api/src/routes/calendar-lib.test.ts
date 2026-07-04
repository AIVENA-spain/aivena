import { describe, it, expect, vi } from 'vitest';
import {
  parseGoogleTokenResponse, buildCalendarEvent, classifyGoogleStatus,
  syncOneBooking, type SyncBookingDeps,
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

describe('buildCalendarEvent — deterministic event body', () => {
  it('builds summary/description/times/location from a booking', () => {
    const ev = buildCalendarEvent({
      scheduledAt: '2026-08-01T10:00:00.000Z', durationMinutes: 45,
      location: 'Calle Mayor 1', leadName: 'Jane Buyer', propertyTitle: 'Sea-view apartment', agentName: 'Ana',
    });
    expect(ev.summary).toBe('Viewing: Sea-view apartment — Jane Buyer');
    expect(ev.start.dateTime).toBe('2026-08-01T10:00:00.000Z');
    expect(ev.end.dateTime).toBe('2026-08-01T10:45:00.000Z');
    expect(ev.location).toBe('Calle Mayor 1');
    expect(ev.description).toMatch(/Ana/);
  });
  it('handles missing property/lead + bad duration', () => {
    const ev = buildCalendarEvent({ scheduledAt: '2026-08-01T10:00:00.000Z', durationMinutes: 0, location: null, leadName: null, propertyTitle: null, agentName: null });
    expect(ev.summary).toBe('Viewing — Buyer');
    expect(ev.end.dateTime).toBe('2026-08-01T11:00:00.000Z'); // defaults to 60 min
    expect(ev.location).toBeUndefined();
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

describe('syncOneBooking — orchestration with mocked IO (no live Google)', () => {
  function mkDeps(over: Partial<SyncBookingDeps> = {}): SyncBookingDeps {
    return {
      getAccessToken: vi.fn().mockResolvedValue('AT'),
      insertEvent: vi.fn().mockResolvedValue({ status: 200, eventId: 'evt_1' }),
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
  it('no credential → permanent (no_calendar_credential), never calls Google', async () => {
    const d = mkDeps({ getAccessToken: vi.fn().mockResolvedValue(null) });
    expect((await syncOneBooking(input, d)).result).toBe('permanent');
    expect(d.insertEvent).not.toHaveBeenCalled();
    expect(d.markPermanent).toHaveBeenCalledWith('b1', 'no_calendar_credential');
  });
});
