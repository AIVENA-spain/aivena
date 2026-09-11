import { describe, it, expect } from 'vitest';
import { correctedOutboundKind, originOf, sentLabel } from './outbound-origin';

describe('originOf — who asked for a message (send_queue.requested_by)', () => {
  it('reads the values the live queue and code write', () => {
    expect(originOf('amanda_engine')).toBe('automatic');
    expect(originOf('operator_approved')).toBe('person');
    expect(originOf('operator_reengage')).toBe('person');
    // "Answer it" on a hand-off (send_custom_reply) — the send that would have read "Auto-handled".
    expect(originOf('operator_custom_reply')).toBe('person');
    expect(originOf('operator_voice_recovery')).toBe('person');
    expect(originOf('amanda_viewing_reminder')).toBe('reminder');
  });

  it('never guesses: anything unrecognised or missing is unknown', () => {
    expect(originOf('vega-w6-test')).toBe('unknown');
    expect(originOf(null)).toBe('unknown');
    expect(originOf('  ')).toBe('unknown');
  });
});

describe('sentLabel — "Auto-reply sent" only for what Amanda sent', () => {
  it('labels by origin', () => {
    expect(sentLabel('automatic')).toBe('Auto-reply sent');
    expect(sentLabel('person')).toBe('Sent by your team');
    expect(sentLabel('reminder')).toBe('Viewing reminder sent');
    expect(sentLabel('unknown')).toBe('WhatsApp message sent');
  });
});

describe('correctedOutboundKind — a reply a person sent is never "Auto-handled"', () => {
  it("turns 'auto' into 'operator' only when a person asked for the send", () => {
    expect(correctedOutboundKind('auto', 'person')).toBe('operator');
    expect(correctedOutboundKind('auto', 'automatic')).toBe('auto');
    expect(correctedOutboundKind('auto', 'unknown')).toBe('auto');
    expect(correctedOutboundKind('auto', undefined)).toBe('auto');
  });

  it('never touches any other kind', () => {
    expect(correctedOutboundKind('operator', 'automatic')).toBe('operator');
    expect(correctedOutboundKind(null, 'person')).toBeNull();
  });
});
