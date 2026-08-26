import { describe, it, expect } from 'vitest';
import {
  mergeExtraction, slotFilled, askableSlots, filterRejected,
  disengagementScore, nudgeAllowed, emptyLeadState, COOLING_THRESHOLD, LIFETIME_NUDGE_CAP,
} from './lead-state-lib';

describe('mergeExtraction — supersession-aware (latest wins)', () => {
  it('a newer budget replaces the old one', () => {
    let s = mergeExtraction({}, { budget_max: { value: 300_000, at: '' } }, '2026-08-01T10:00:00Z');
    s = mergeExtraction(s, { budget_max: { value: 250_000, at: '' } }, '2026-08-20T10:00:00Z');
    expect(s.budget_max?.value).toBe(250_000);
    expect(s.budget_max?.at).toBe('2026-08-20T10:00:00Z');
  });
  it('a stale extraction never overwrites a newer value', () => {
    let s = mergeExtraction({}, { budget_max: { value: 250_000, at: '' } }, '2026-08-20T10:00:00Z');
    s = mergeExtraction(s, { budget_max: { value: 300_000, at: '' } }, '2026-08-01T10:00:00Z');
    expect(s.budget_max?.value).toBe(250_000);
  });
  it('rejected properties accumulate uniquely, never replaced', () => {
    let s = mergeExtraction({}, { rejected_property_ids: ['p1', 'p2'] }, '2026-08-01T00:00:00Z');
    s = mergeExtraction(s, { rejected_property_ids: ['p2', 'p3'] }, '2026-08-02T00:00:00Z');
    expect(s.rejected_property_ids).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('intel slots — never re-ask (§10 B2)', () => {
  it('empty state has all slots askable; filled slots drop out', () => {
    expect(askableSlots({})).toContain('budget_max');
    const s = mergeExtraction({}, { budget_max: { value: 250_000, at: '' }, timeline: { value: 'this autumn', at: '' } }, '2026-08-20T10:00:00Z');
    expect(slotFilled(s, 'budget_max')).toBe(true);
    expect(askableSlots(s)).not.toContain('budget_max');
    expect(askableSlots(s)).not.toContain('timeline');
    expect(askableSlots(s)).toContain('financing');
  });
});

describe('filterRejected — a rejected property can never be re-pitched', () => {
  it('filters every suggestion payload', () => {
    const s = mergeExtraction({}, { rejected_property_ids: ['p2'] }, '2026-08-01T00:00:00Z');
    expect(filterRejected(s, [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]).map((p) => p.id)).toEqual(['p1', 'p3']);
  });
});

describe('disengagement score (§10 B3)', () => {
  it('latency blowout + brevity collapse crosses the cooling threshold', () => {
    const score = disengagementScore({
      currentGapMs: 30 * 3600_000,
      buyerMedianGapMs: 2 * 3600_000,
      lastTwoReplies: ['ok', 'vale'],
      hadLongerBaseline: true,
      declinedSuggestionNoCounter: false,
    });
    expect(score).toBeGreaterThanOrEqual(COOLING_THRESHOLD);
  });
  it('an engaged buyer scores low', () => {
    const score = disengagementScore({
      currentGapMs: 10 * 60_000,
      buyerMedianGapMs: 30 * 60_000,
      lastTwoReplies: ['That sounds great, can you tell me about the community fees?'],
      hadLongerBaseline: true,
      declinedSuggestionNoCounter: false,
    });
    expect(score).toBeLessThan(COOLING_THRESHOLD);
  });
});

describe('nudgeAllowed — the §10 B4 law', () => {
  const base = { engagement: 'cooling' as const, valueNudgesSent: 0, lastBuyerMessageAtMs: 0, nowMs: 25 * 3600_000, hasValuePayload: true };
  it('allows exactly the sanctioned nudge', () => {
    expect(nudgeAllowed(base).allowed).toBe(true);
  });
  it('never without a value payload', () => {
    expect(nudgeAllowed({ ...base, hasValuePayload: false })).toEqual({ allowed: false, reason: 'no_value_payload' });
  });
  it('never inside 24h of the buyer\'s last message', () => {
    expect(nudgeAllowed({ ...base, nowMs: 23 * 3600_000 }).allowed).toBe(false);
  });
  it('lifetime cap is absolute', () => {
    expect(nudgeAllowed({ ...base, valueNudgesSent: LIFETIME_NUDGE_CAP })).toEqual({ allowed: false, reason: 'lifetime_cap' });
  });
  it('active and dormant states never nudge', () => {
    expect(nudgeAllowed({ ...base, engagement: 'active' }).allowed).toBe(false);
    expect(nudgeAllowed({ ...base, engagement: 'dormant' }).allowed).toBe(false);
  });
});

describe('emptyLeadState', () => {
  it('starts active with zero nudges', () => {
    expect(emptyLeadState()).toEqual({ data: {}, engagement: 'active', valueNudgesSent: 0, lastNudgeAt: null });
  });
});
