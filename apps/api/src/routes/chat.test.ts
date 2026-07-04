import { describe, it, expect } from 'vitest';
import { validateContact, mapCaptureError, createRateLimiter } from './chat-lib';

describe('validateContact — consent + validation + normalisation', () => {
  it('rejects a missing/false consent', () => {
    expect(validateContact({ name: 'A', email: 'a@b.co' })).toEqual({ ok: false, error: expect.stringMatching(/consent/i) });
    expect(validateContact({ consent: false, name: 'A' })).toEqual({ ok: false, error: expect.stringMatching(/consent/i) });
  });

  it('rejects when there is nothing to capture', () => {
    expect(validateContact({ consent: true })).toEqual({ ok: false, error: expect.stringMatching(/name, email, or phone/i) });
    expect(validateContact({ consent: true, name: '   ' })).toEqual({ ok: false, error: expect.stringMatching(/name, email, or phone/i) });
  });

  it('validates email + phone format when provided', () => {
    expect(validateContact({ consent: true, email: 'not-an-email' })).toEqual({ ok: false, error: expect.stringMatching(/valid email/i) });
    expect(validateContact({ consent: true, phone: 'abc' })).toEqual({ ok: false, error: expect.stringMatching(/valid phone/i) });
  });

  it('accepts a valid capture and normalises fields', () => {
    const r = validateContact({
      consent: true, name: '  Amanda Visitor ', email: 'a@b.co', phone: '+34 600 111 222',
      intent: 'buyer', budget: '€300k–400k', budgetMax: 400000, location: 'Torrevieja',
      bedroomsMin: '2', propertyType: 'apartment', language: 'en',
      context: { pageUrl: 'https://x/listings', referrer: 'https://g' },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.name).toBe('Amanda Visitor');
    expect(r.input.email).toBe('a@b.co');
    expect(r.input.budgetMax).toBe(400000);
    expect(r.input.bedroomsMin).toBe(2);
    expect(r.input.consent).toBe(true);
    expect(r.input.pageUrl).toBe('https://x/listings');
  });

  it('sanitises + caps the transcript, coercing unknown directions to inbound', () => {
    const r = validateContact({
      consent: true, name: 'A',
      transcript: [
        { direction: 'inbound', content: 'hi' },
        { direction: 'outbound', content: 'hello' },
        { direction: 'weird', content: 'coerced' },
        { direction: 'inbound', content: '' }, // dropped (empty)
        { content: 'no direction' },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.transcript).toEqual([
      { direction: 'inbound', content: 'hi' },
      { direction: 'outbound', content: 'hello' },
      { direction: 'inbound', content: 'coerced' },
      { direction: 'inbound', content: 'no direction' },
    ]);
  });

  it('length-caps long input (abuse guard)', () => {
    const r = validateContact({ consent: true, name: 'x'.repeat(500) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.name!.length).toBe(120);
  });
});

describe('mapCaptureError — friendly, no enumeration', () => {
  it('maps input errors to 400', () => {
    expect(mapCaptureError('consent_required').status).toBe(400);
    expect(mapCaptureError('nothing_to_capture').status).toBe(400);
  });
  it('hides agency existence/test-gating behind one 404', () => {
    expect(mapCaptureError('agency_not_found')).toEqual({ msg: expect.any(String), status: 404 });
    expect(mapCaptureError('agency_not_enabled').status).toBe(404);
    expect(mapCaptureError('anything_else').status).toBe(404);
    // never leaks the raw code
    expect(mapCaptureError('agency_not_enabled').msg).not.toMatch(/enabled|test/i);
  });
});

describe('createRateLimiter — sliding window', () => {
  it('allows up to the limit, then blocks, then recovers after the window', () => {
    const allow = createRateLimiter(3, 1000);
    const k = 'ip:slug';
    expect(allow(k, 0)).toBe(true);
    expect(allow(k, 100)).toBe(true);
    expect(allow(k, 200)).toBe(true);
    expect(allow(k, 300)).toBe(false); // 4th within the window
    expect(allow(k, 1300)).toBe(true); // first three aged out
  });
  it('is per-key', () => {
    const allow = createRateLimiter(1, 1000);
    expect(allow('a', 0)).toBe(true);
    expect(allow('a', 0)).toBe(false);
    expect(allow('b', 0)).toBe(true);
  });
});
