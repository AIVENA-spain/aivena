import { describe, it, expect, vi } from 'vitest';
import { AMANDA_MODES, parseAmandaMode, dispatchDecision, runActionTool, effectiveMode, type ToolClass } from './modes';

const ACTION_CLASSES: ToolClass[] = ['reply', 'commitment', 'internal_write'];

describe('parseAmandaMode — fails closed', () => {
  it('accepts every known mode', () => {
    for (const m of AMANDA_MODES) expect(parseAmandaMode(m)).toBe(m);
  });
  it('maps unknown/missing/garbage to off', () => {
    for (const bad of [undefined, null, '', 'FULL', 'auto', 42, {}]) {
      expect(parseAmandaMode(bad)).toBe('off');
    }
  });
});

describe('SHADOW is defanged by construction (design §4)', () => {
  it('never invokes the real effect for ANY non-read tool class', async () => {
    for (const toolClass of ACTION_CLASSES) {
      const real = vi.fn(async () => 'REAL_EFFECT');
      const res = await runActionTool('shadow', toolClass, real, { simulatedData: { would: 'have' } });
      expect(real).not.toHaveBeenCalled();
      expect(res.simulated).toBe(true);
      expect(res.data).toEqual({ would: 'have' });
    }
  });
  it('still executes reads (needed for realistic drafts)', async () => {
    const real = vi.fn(async () => ['prop1']);
    const res = await runActionTool('shadow', 'read', real);
    expect(real).toHaveBeenCalledOnce();
    expect(res.simulated).toBe(false);
    expect(res.data).toEqual(['prop1']);
  });
});

describe('OFF and unknown modes refuse everything', () => {
  it('off refuses all classes including reads', async () => {
    for (const toolClass of ['read', ...ACTION_CLASSES] as ToolClass[]) {
      const real = vi.fn(async () => 'x');
      const res = await runActionTool('off', toolClass, real);
      expect(real).not.toHaveBeenCalled();
      expect(res.ok).toBe(false);
      expect(res.refused).toBe('amanda_mode_off');
    }
  });
});

describe('APPROVAL — everything outbound is a draft; internal writes are real', () => {
  it('replies queue as drafts, never send', async () => {
    const real = vi.fn(async () => 'sent');
    const queue = vi.fn(async () => ({ draftId: 'd1' }));
    const res = await runActionTool('approval', 'reply', real, { queue });
    expect(real).not.toHaveBeenCalled();
    expect(queue).toHaveBeenCalledWith('draft');
    expect(res.queued).toBe('draft');
  });
  it('commitment actions also ride the draft', () => {
    expect(dispatchDecision('approval', 'commitment')).toEqual({ kind: 'queue_draft' });
  });
  it('ask_agency-style internal writes execute for real (§3b: the ticket is real)', async () => {
    const real = vi.fn(async () => ({ ticketId: 't1' }));
    const res = await runActionTool('approval', 'internal_write', real);
    expect(real).toHaveBeenCalledOnce();
    expect(res.data).toEqual({ ticketId: 't1' });
  });
});

describe('ASSISTED — replies auto-send, bookings stay one-tap', () => {
  it('replies execute', () => {
    expect(dispatchDecision('assisted', 'reply')).toEqual({ kind: 'execute' });
  });
  it('commitment actions queue one-tap, never execute directly', async () => {
    const real = vi.fn(async () => 'booked');
    const queue = vi.fn(async () => ({ pendingActionId: 'p1' }));
    const res = await runActionTool('assisted', 'commitment', real, { queue });
    expect(real).not.toHaveBeenCalled();
    expect(queue).toHaveBeenCalledWith('one_tap');
    expect(res.queued).toBe('one_tap');
  });
});

describe('FULL — executes (validator gates live inside executeReal)', () => {
  it('commitment actions run the real effect', async () => {
    const real = vi.fn(async () => ({ bookingId: 'b1' }));
    const res = await runActionTool('full', 'commitment', real);
    expect(real).toHaveBeenCalledOnce();
    expect(res.data).toEqual({ bookingId: 'b1' });
  });
});

describe('effectiveMode — per-conversation override (Christian 2026-08-29)', () => {
  it('agency off is an absolute kill switch — no override resurrects her', () => {
    for (const override of ['full', 'assisted', 'approval', 'shadow', 'off', null]) {
      expect(effectiveMode('off', override)).toBe('off');
    }
  });

  it('with no override the conversation follows the agency dial', () => {
    expect(effectiveMode('approval', null)).toBe('approval');
    expect(effectiveMode('assisted', undefined)).toBe('assisted');
    expect(effectiveMode('full', '')).toBe('full');
  });

  it('an override wins inside a live agency — in both directions', () => {
    expect(effectiveMode('approval', 'full')).toBe('full');   // "Amanda handles this one"
    expect(effectiveMode('full', 'off')).toBe('off');         // "I'll handle this one"
  });

  it('an unrecognised stored override falls silent, never sends', () => {
    expect(effectiveMode('full', 'sometimes')).toBe('off');
    expect(effectiveMode('full', 'FULL')).toBe('off');
  });
});
