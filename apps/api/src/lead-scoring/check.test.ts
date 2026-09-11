import { describe, it, expect, vi } from 'vitest';
import { computeVerdict, matchesExpected, runScoringCheck, type CheckCase } from './check';
import { SCORING_FIXTURES } from './fixtures';
import type { ModelCall } from './extract';

const c = (over: Partial<CheckCase>): CheckCase => ({
  id: 1,
  title: 't',
  minor: false,
  expected: { score: 50, band: 'warm', why: '' },
  actual: { score: 50, band: 'warm', temperature: 'warm' },
  ok: true,
  explanation: 'Warm 50',
  discarded: [],
  guards: [],
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  error: null,
  ...over,
});

describe("computeVerdict: Christian's acceptance standard, including the quote rule", () => {
  it('everything as expected and nothing discarded is GREEN', () => {
    expect(computeVerdict([c({})]).verdict).toBe('GREEN');
  });
  it('a quote the verifier caught and discarded is ACCEPTABLE when the band is right, and it is reported', () => {
    const v = computeVerdict([c({ discarded: ['specific_property=discussed: quote not in the lead\'s own words'] })]);
    expect(v.verdict).toBe('ACCEPTABLE');
    expect(v.reasons.join(' ')).toMatch(/caught and discarded/);
  });
  it('a same-band score difference is ACCEPTABLE', () => {
    expect(computeVerdict([c({ actual: { score: 58, band: 'warm', temperature: 'warm' }, ok: false })]).verdict).toBe('ACCEPTABLE');
  });
  it('a wrong band on a serious case is NOT ACCEPTABLE', () => {
    expect(computeVerdict([c({ actual: { score: 76, band: 'hot', temperature: 'hot' }, ok: false })]).verdict).toBe('NOT ACCEPTABLE');
  });
  it('a band slip on a case marked minor is ACCEPTABLE', () => {
    expect(computeVerdict([c({ minor: true, actual: { score: 30, band: 'early_interest', temperature: 'cold' }, ok: false })]).verdict).toBe('ACCEPTABLE');
  });
  it('a failed, cut-off or invalid answer is NOT ACCEPTABLE', () => {
    expect(computeVerdict([c({ actual: null, ok: false, error: 'answer was cut off, so it was not read' })]).verdict).toBe('NOT ACCEPTABLE');
  });
  it('bought elsewhere that is not "lost" is NOT ACCEPTABLE', () => {
    const v = computeVerdict([c({ id: 10, expected: { score: null, band: 'lost', why: '' }, actual: { score: 20, band: 'very_cold', temperature: 'cold' }, ok: false })]);
    expect(v.verdict).toBe('NOT ACCEPTABLE');
    expect(v.namedChecks).toEqual([{ label: 'Bought elsewhere is lost: no score, no temperature', pass: false }]);
  });
});

describe('matchesExpected', () => {
  it('lost must have no score at all', () => {
    expect(matchesExpected({ score: null, band: 'lost', why: '' }, { score: null, band: 'lost', temperature: null })).toBe(true);
    expect(matchesExpected({ score: null, band: 'lost', why: '' }, { score: 10, band: 'lost', temperature: 'cold' })).toBe(false);
  });
  it('a range is honoured', () => {
    expect(matchesExpected({ score: 38, band: 'early_interest', range: [38, 42], why: '' }, { score: 42, band: 'early_interest', temperature: 'cold' })).toBe(true);
  });
});

describe('runScoringCheck: fixtures only, capped, never throws', () => {
  it('runs all 11 fixtures and reports every failure instead of throwing', async () => {
    const progress = vi.fn();
    const fail: ModelCall = async () => ({ status: 500, body: {} });
    const report = await runScoringCheck(fail, { onProgress: progress });
    expect(report.cases).toHaveLength(SCORING_FIXTURES.length);
    expect(report.verdict).toBe('NOT ACCEPTABLE');
    expect(report.totalCostUsd).toBe(0);
    expect(progress).toHaveBeenCalledTimes(SCORING_FIXTURES.length);
  });
  it('the cost cap is checked before every call: with no budget, the model is never called', async () => {
    const call = vi.fn<ModelCall>();
    const report = await runScoringCheck(call, { capUsd: 0 });
    expect(call).not.toHaveBeenCalled();
    expect(report.cases.every((x) => x.error?.startsWith('not run'))).toBe(true);
  });
  it('a perfect answer scores its case exactly', async () => {
    const fx = SCORING_FIXTURES.find((f) => f.id === 3)!;
    const answer = {
      real_lead: true, not_a_lead_reason: null, intent: 'real',
      budget: { state: 'none', quote: null }, area: { state: 'none', quote: null }, need: { state: 'none', quote: null },
      specific_property: { state: 'availability_only', quote: 'is this villa still available?' },
      concrete_question: { present: false, quote: null }, asked_for_listings_or_photos: { present: false, quote: null },
      timing: { state: 'unknown', quote: null }, viewing: { state: 'none', within_7_days: null, quote: null },
      financing_ready: { present: false, quote: null }, decision: { state: 'none', quote: null }, negative: { state: 'none', quote: null },
      reason: 'x',
    };
    const call: ModelCall = async () => ({ status: 200, body: { content: [{ text: JSON.stringify(answer) }], usage: { input_tokens: 1200, output_tokens: 250 }, stop_reason: 'end_turn' } });
    const report = await runScoringCheck(call, { fixtures: [fx] });
    expect(report.cases[0]).toMatchObject({ ok: true, actual: { score: 50, band: 'warm' } });
    expect(report.verdict).toBe('GREEN');
  });
});
