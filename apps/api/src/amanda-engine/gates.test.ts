import { describe, it, expect } from 'vitest';
import { draftNumbersGrounded, runGates, classifyDraft, type Verifier } from './gates';
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

/**
 * Live failure 2026-08-30: Marte re-asked a question Amanda had answered 13
 * hours earlier. Amanda answered from what she had already said, called NO
 * tools (she already knew), and the gates rejected the draft as ungrounded —
 * so the buyer got the office-holding line for a question already answered.
 * Continuity is not invention.
 */
describe('conversation history grounds a repeat answer', () => {
  const yes: Verifier = async () => true;
  const alreadyTold = ['The Norwegian school is in Ciudad Quesada. MI4010 is 195 000 EUR, MI3321 is 220 000 EUR.'];

  it('numbers Amanda already sent this buyer are grounded on a second telling', async () => {
    const draft = 'MI4010 is 195 000 EUR and MI3321 is 220 000 EUR.';
    const withoutHistory = await runGates(draft, [], yes, [], []);
    expect(withoutHistory.failures.some((f) => f.startsWith('ungrounded_numbers'))).toBe(true);

    const withHistory = await runGates(draft, [], yes, [], [], alreadyTold);
    expect(withHistory.ok).toBe(true);
  });

  it('a number that was NEVER said is still caught', async () => {
    const draft = 'There is also one at 149 000 EUR.';
    const r = await runGates(draft, [], yes, [], [], alreadyTold);
    expect(r.failures.some((f) => f.startsWith('ungrounded_numbers'))).toBe(true);
  });

  it('history reaches the verifier as supporting context, not just the number check', async () => {
    let seen: string[] | undefined;
    const spy: Verifier = async (_d, _t, authoritative) => {
      seen = authoritative;
      return true;
    };
    await runGates('MI4010 is 195 000 EUR.', [], spy, ['office said so'], [], alreadyTold);
    expect(seen).toContain('office said so');
    expect(seen).toContain(alreadyTold[0]);
  });
});

/**
 * Pins the AUDITED coverage boundary of the deterministic price gate
 * (2026-08-31). These are not aspirational — they record what the gate does and
 * does not see, so nobody assumes protection that is not there, and so a future
 * change that alters the boundary shows up here rather than in a buyer's chat.
 */
describe('price gate — audited coverage boundary', () => {
  const noTools: ToolEvent[] = [];

  it('CATCHES a price with a currency marker beside it', () => {
    for (const draft of ['The villa is 390.000 €', 'Prisen er 390 000 EUR', 'It is €390,000']) {
      expect(draftNumbersGrounded(draft, noTools).ok, draft).toBe(false);
    }
  });

  it('grounds that same price when the office actually said it', () => {
    const r = draftNumbersGrounded('The villa is 390.000 €', noTools, ['The price is 390000 EUR']);
    expect(r.ok).toBe(true);
  });

  it('DOES NOT catch a scale word or a bare number — known, deliberate, verifier-covered', () => {
    for (const draft of ['Den koster 1,2 millioner euro', 'Prisen er 390000']) {
      expect(draftNumbersGrounded(draft, noTools).ok, draft).toBe(true);
    }
  });

  it('and that is WHY those drafts must still be fact-bearing (so the verifier sees them)', () => {
    // The safety of the gap depends entirely on this staying true.
    expect(classifyDraft('Den koster 1,2 millioner euro')).toBe('fact_bearing');
    expect(classifyDraft('Prisen er 390000')).toBe('fact_bearing');
  });
});
