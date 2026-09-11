import { afterEach, describe, it, expect, vi } from 'vitest';
import { anthropicCaller, costUsd, extractFacts, parseAnswer, type ModelCall } from './extract';
import { SCORING_FIXTURES } from './fixtures';

const input = SCORING_FIXTURES.find((f) => f.id === 3)!.input;
const VALID = {
  real_lead: true,
  not_a_lead_reason: null,
  intent: 'real',
  budget: { state: 'none', quote: null },
  area: { state: 'none', quote: null },
  need: { state: 'none', quote: null },
  specific_property: { state: 'availability_only', quote: 'is this villa still available?' },
  concrete_question: { present: false, quote: null },
  asked_for_listings_or_photos: { present: false, quote: null },
  timing: { state: 'unknown', quote: null },
  viewing: { state: 'none', within_7_days: null, quote: null },
  financing_ready: { present: false, quote: null },
  decision: { state: 'none', quote: null },
  negative: { state: 'none', quote: null },
  reason: 'Asked if one listing is available.',
};
const reply = (text: string, stopReason = 'end_turn', status = 200): ModelCall => async () => ({
  status,
  body: { content: [{ type: 'text', text }], usage: { input_tokens: 1000, output_tokens: 200 }, stop_reason: stopReason },
});

afterEach(() => vi.unstubAllGlobals());

describe('extractFacts: only a complete, valid answer is used', () => {
  it('reads one compact JSON answer, with its real cost', async () => {
    const r = await extractFacts(input, reply(JSON.stringify(VALID)));
    expect(r.ok).toBe(true);
    expect(r.costUsd).toBeCloseTo(0.002, 6);
  });
  it('strips code fences', async () => {
    expect((await extractFacts(input, reply('```json\n' + JSON.stringify(VALID) + '\n```'))).ok).toBe(true);
  });
  it('never reads a cut-off answer (run 1: the long Norwegian conversation)', async () => {
    const r = await extractFacts(input, reply(JSON.stringify(VALID).slice(0, 80), 'max_tokens'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/cut off/);
  });
  it('rejects an invalid value instead of guessing what it meant', async () => {
    const r = await extractFacts(input, reply(JSON.stringify({ ...VALID, need: { state: 'present', quote: 'villa' } })));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/need="present"/);
  });
  it('a failed model call is a failure, not a score', async () => {
    const r = await extractFacts(input, reply('', 'end_turn', 500));
    expect(r.ok).toBe(false);
  });
  it('text that is not JSON is not an answer', () => {
    expect(parseAnswer('I think this lead is warm.')).toBeNull();
  });
  it('costs follow the $1 / $5 per million list price', () => {
    expect(costUsd(1_000_000, 0)).toBe(1);
    expect(costUsd(0, 1_000_000)).toBe(5);
  });
});

describe("anthropicCaller: the server's key, and nothing else", () => {
  it('with no key on the server it makes no call at all', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await anthropicCaller(async () => null)({ system: 's', user: 'u', maxTokens: 10 });
    expect(r.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('the key goes only into the request header: never into the body', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ content: [{ text: '{}' }], usage: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    await anthropicCaller(async () => 'test-key-not-real')({ system: 's', user: 'u', maxTokens: 10 });
    const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('test-key-not-real');
    expect(String(init.body)).not.toContain('test-key-not-real');
  });
  it('asks for temperature 0, so the same conversation gets the same answer (v1.4; the first check ran at the default 1.0)', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ content: [{ text: '{}' }], usage: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    await anthropicCaller(async () => 'test-key-not-real')({ system: 's', user: 'u', maxTokens: 10 });
    const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toMatchObject({ temperature: 0 });
  });
  it('a network failure never throws, and never includes the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    }));
    const r = await anthropicCaller(async () => 'test-key-not-real')({ system: 's', user: 'u', maxTokens: 10 });
    expect(r.status).toBe(599);
    expect(JSON.stringify(r)).not.toContain('test-key-not-real');
  });
});
