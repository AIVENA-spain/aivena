import { describe, it, expect } from 'vitest';
import { sendBlockedByOptIn } from './optout-guard';

describe('sendBlockedByOptIn — whatsapp-send-execute opt-out guard (P3 fix)', () => {
  it('REFUSES a blocked lead (unchanged behavior)', () => {
    expect(sendBlockedByOptIn('blocked')).toBe(true);
  });
  it('REFUSES an opted_out lead (the P3 fix)', () => {
    expect(sendBlockedByOptIn('opted_out')).toBe(true);
  });
  it('ALLOWS normal deliverable states through the guard (behavior unchanged)', () => {
    // These pass the guard (false = not blocked); the send then proceeds to the
    // existing config/phone/template gates exactly as before.
    for (const s of ['opted_in', 'unknown', 'subscribed', '', null, undefined]) {
      expect(sendBlockedByOptIn(s as string | null | undefined)).toBe(false);
    }
  });
  it('only these two states block — no accidental over-blocking', () => {
    expect(['blocked', 'opted_out'].filter((s) => sendBlockedByOptIn(s))).toEqual(['blocked', 'opted_out']);
  });
});
