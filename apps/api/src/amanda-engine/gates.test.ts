import { describe, it, expect } from 'vitest';
import { draftNumbersGrounded } from './gates';
import type { ToolEvent } from './tools';

const searchEvent = (data: unknown): ToolEvent => ({
  tool: 'search_properties',
  input: {},
  result: { ok: true, simulated: false, queued: null, refused: null, data },
});

describe('numeric grounding — space-thousands + buyer echo (live demo 2026-08-28)', () => {
  it('the live failure: "under 500 000€" echoed back must ground against the buyer message', () => {
    const buyer = 'Minst 3 soverom, helst med basseng og sørvendt, under 500 000€ og så nært den norske skolen som mulig';
    const draft = 'Flott! Jeg leter etter noe med 3 soverom og basseng under 500 000€ i nærheten av skolen.';
    // Without the buyer text: "500 000" (space thousands) is one number now —
    // ungrounded as a whole, never a phantom lone "000".
    const bare = draftNumbersGrounded(draft, []);
    expect(bare.ok).toBe(false);
    expect(bare.offending.some((o) => o.replace(/[\s ]/g, '') === '500000')).toBe(true);
    expect(bare.offending).not.toContain('000');
    // With the buyer's own message as numeric grounding: passes.
    expect(draftNumbersGrounded(draft, [], [buyer]).ok).toBe(true);
  });

  it('dot/space/plain forms cross-match against structured tool data', () => {
    const ev = searchEvent({ results: [{ price: 148500, bedrooms: 2 }] });
    expect(draftNumbersGrounded('Listed at €148.500 — lovely spot.', [ev]).ok).toBe(true);
    expect(draftNumbersGrounded('Listed at 148 500 € — lovely spot.', [ev]).ok).toBe(true);
    expect(draftNumbersGrounded('It has 2 bedrooms.', [ev]).ok).toBe(true);
  });

  it('a genuinely invented price still dies', () => {
    const ev = searchEvent({ results: [{ price: 148500 }] });
    const r = draftNumbersGrounded('A steal at €99.000!', [ev], ['I want something nice']);
    expect(r.ok).toBe(false);
  });

  it('adjacent separate numbers never merge across a space boundary word', () => {
    // "3 soverom, 500 000€": rooms=3, price=500000 — the 3 must not fuse into the price.
    const buyer = 'ca 500 000€';
    const r = draftNumbersGrounded('Rundt 500 000€ altså.', [], [buyer]);
    expect(r.ok).toBe(true);
  });
});
