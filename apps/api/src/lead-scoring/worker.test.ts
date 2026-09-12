import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { Tx } from '../../../../packages/db/client';
import { LEAD_SCORING_AGENCIES, LEAD_SCORING_MODE } from '../lib/automation-status';
import {
  KEEP_NEWEST_MESSAGES,
  MAX_INPUT_CHARS,
  MAX_RUN_COST_USD,
  QUIET_MINUTES,
  buildScoringInput,
  burstIsMeaningful,
  isTrivialMessage,
  pickDueLeads,
  runScoringTick,
  scoringAllowedFor,
  shouldStartScoringWorker,
  writeShadowRecord,
} from './worker';
import { worstCaseCostUsd, type ModelCall } from './extract';
import type { ScoredConversation } from './score-conversation';

const dialect = new PgDialect();
const sqlText = (q: SQL): string => dialect.sqlToQuery(q).sql;
const NOW = Date.parse('2026-09-12T12:00:00Z');
const mustNotRun = async (): Promise<never> => {
  throw new Error('must not run');
};

describe('Stage 2: the demo agency only, shadow only, and every brake before the database', () => {
  it('scoring is switched on for exactly one agency, in shadow mode', () => {
    expect(LEAD_SCORING_AGENCIES).toEqual(['demo-costa-homes-pilot01']);
    expect(LEAD_SCORING_MODE).toBe('shadow');
    expect(shouldStartScoringWorker()).toBe(true);
  });
  it('with no agency allowed, a tick makes ZERO database calls and never calls the model', async () => {
    let transactions = 0;
    const r = await runScoringTick({
      allowed: [],
      withAgency: async () => {
        transactions += 1;
        throw new Error('must not open a transaction');
      },
      call: mustNotRun,
    });
    expect(transactions).toBe(0);
    expect(r).toEqual({ agencies: 0, scored: 0, failed: 0, skippedTrivial: 0 });
  });
  it('the stop-only brake stops a tick before any database call', async () => {
    const r = await runScoringTick({ allowed: ['demo-costa-homes-pilot01'], paused: () => true, withAgency: mustNotRun, call: mustNotRun });
    expect(r).toEqual({ agencies: 0, scored: 0, failed: 0, skippedTrivial: 0 });
  });
  it('the scorer refuses an agency that is not allowed, before touching the database', async () => {
    expect(scoringAllowedFor('some-other-agency')).toBe(false);
    const tx = { execute: mustNotRun } as unknown as Tx;
    const scored = { ok: true, error: null, score: 50, band: 'warm', temperature: 'warm', explanation: 'Warm 50', facts: {}, discarded: [], guards: [], timeNotes: [], inputTokens: 1, outputTokens: 1, costUsd: 0, stopReason: 'end_turn' } as ScoredConversation;
    await expect(writeShadowRecord(tx, 'some-other-agency', '00000000-0000-0000-0000-000000000000', scored)).rejects.toThrow('not allowed');
  });
  it('write mode does not exist in Stage 2', async () => {
    await expect(runScoringTick({ allowed: ['a'], mode: 'write', withAgency: mustNotRun, call: mustNotRun })).rejects.toThrow('only shadow mode');
  });
});

describe('shadow mode: one audit row, nothing else', () => {
  it('a full tick for an allowed agency writes only INSERT INTO ai_classifications', async () => {
    const statements: string[] = [];
    const message = 'Hi, is the villa IC-81596 still available? We would like to view it this Thursday. Our budget is up to €400,000.';
    const tx = {
      execute: async (q: SQL) => {
        const s = sqlText(q);
        statements.push(s);
        if (/count\(\*\)::int AS n FROM ai_classifications/.test(s)) return [{ n: 0 }];
        if (/FROM leads l/.test(s)) return [{ lead_id: 'L1', last_inbound_at: new Date(NOW - 45 * 60_000).toISOString(), last_run_at: null, runs_today: 0 }];
        if (/FROM conversation_messages/.test(s)) return [{ direction: 'inbound', content: message, created_at: new Date(NOW - 45 * 60_000).toISOString() }];
        return [];
      },
    } as unknown as Tx;
    const answer = {
      real_lead: true, not_a_lead_reason: null, intent: 'real',
      budget: { state: 'clear', quote: 'L1: Our budget is up to €400,000' }, area: { state: 'none', quote: null }, need: { state: 'none', quote: null },
      specific_property: { state: 'discussed', quote: 'L1: is the villa IC-81596 still available' },
      concrete_question: { present: false, quote: null }, asked_for_listings_or_photos: { present: false, quote: null },
      timing: { state: 'within_30_days', quote: 'L1: this Thursday' }, viewing: { state: 'wants_to_view', within_7_days: null, quote: 'L1: We would like to view it this Thursday' },
      financing_ready: { present: false, quote: null }, decision: { state: 'none', quote: null }, negative: { state: 'none', quote: null }, reason: 'x',
    };
    const call: ModelCall = async () => ({ status: 200, body: { content: [{ text: JSON.stringify(answer) }], usage: { input_tokens: 1000, output_tokens: 200 }, stop_reason: 'end_turn' } });
    const r = await runScoringTick({ allowed: ['agency-a'], withAgency: async (_a, fn) => fn(tx), call, nowMs: () => NOW });
    const writes = statements.filter((s) => /^\s*(insert|update|delete)\b/i.test(s));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^\s*INSERT INTO ai_classifications/);
    expect(statements.join('\n')).not.toMatch(/UPDATE leads|send_queue|dashboard_tasks|INSERT INTO lead_events|summary\s*=/i);
    expect(r).toMatchObject({ agencies: 1, scored: 1, failed: 0 });
  });
});

describe("the input: the check's shape, under a hard cap (Christian, 2026-09-12)", () => {
  const msg = (i: number, chars: number, from: 'lead' | 'agency' = 'lead') => ({
    at: new Date(NOW - (500 - i) * 60_000).toISOString(),
    from,
    text: `m${i} ${'x'.repeat(chars)}`,
  });
  const earlierMsg = (i: number, chars: number) => ({ at: new Date(NOW - (2000 - i) * 60_000).toISOString(), text: `e${i} ${'y'.repeat(chars)}` });

  it('a normal conversation is passed through whole, with the older lead messages and no note', () => {
    const built = buildScoringInput('2026-09-12T12:00:00Z', [msg(1, 50), msg(2, 50, 'agency')], [earlierMsg(1, 50)]);
    expect(built.input.conversation).toHaveLength(2);
    expect(built.input.earlierLeadMessages).toHaveLength(1);
    expect(built.trimmed).toBeNull();
  });
  it('a very long history drops the older messages first, then the oldest of the window, and says so', () => {
    const built = buildScoringInput(
      '2026-09-12T12:00:00Z',
      Array.from({ length: 30 }, (_, i) => msg(i, 1_000)),
      Array.from({ length: 20 }, (_, i) => earlierMsg(i, 1_000)),
    );
    expect(built.input.earlierLeadMessages ?? []).toHaveLength(0);
    expect(built.input.conversation.length).toBeLessThan(30);
    expect(built.trimmed).toMatch(/left out .*older lead messages/);
    expect(built.trimmed).toMatch(/left out the .*oldest messages/);
    // The newest message is always kept, whatever was dropped.
    expect(built.input.conversation[built.input.conversation.length - 1]?.text).toContain('m29');
  });
  it('the newest messages are never dropped: a huge one is shortened instead, and reported', () => {
    const built = buildScoringInput('2026-09-12T12:00:00Z', Array.from({ length: 10 }, (_, i) => msg(i, 9_000)), []);
    expect(built.input.conversation).toHaveLength(KEEP_NEWEST_MESSAGES);
    expect(built.trimmed).toMatch(/shortened .*very long messages/);
    expect(built.input.conversation[built.input.conversation.length - 1]?.text.startsWith('m9 ')).toBe(true);
  });
  it('however long the conversation, one run can never cost more than the cap', () => {
    const built = buildScoringInput(
      '2026-09-12T12:00:00Z',
      Array.from({ length: 200 }, (_, i) => msg(i, 5_000)),
      Array.from({ length: 50 }, (_, i) => earlierMsg(i, 5_000)),
    );
    expect(worstCaseCostUsd(built.input)).toBeLessThanOrEqual(MAX_RUN_COST_USD);
    expect(JSON.stringify(built.input).length).toBeLessThan(MAX_INPUT_CHARS * 2);
  });
});

describe('cadence (Christian, 2026-09-11)', () => {
  const row = (minutesAgo: number, over: Record<string, unknown> = {}) => ({
    lead_id: 'L',
    last_inbound_at: new Date(NOW - minutesAgo * 60_000).toISOString(),
    last_run_at: null,
    runs_today: 0,
    ...over,
  });
  it(`waits for ${QUIET_MINUTES} minutes of quiet after the last message`, () => {
    expect(pickDueLeads([row(10)], NOW)).toHaveLength(0);
    expect(pickDueLeads([row(31)], NOW)).toHaveLength(1);
  });
  it('one conversation = one run: nothing new since the last run means nothing to do', () => {
    expect(pickDueLeads([row(60, { last_run_at: new Date(NOW - 30 * 60_000).toISOString() })], NOW)).toHaveLength(0);
  });
  it('at most 2 automatic runs per lead per day (the next morning catches up)', () => {
    expect(pickDueLeads([row(60, { runs_today: 2 })], NOW)).toHaveLength(0);
    expect(pickDueLeads([row(60, { runs_today: 1 })], NOW)).toHaveLength(1);
  });
  it('tiny messages do not count on their own', () => {
    for (const t of ['ok', 'Takk!', 'thanks', '👍', 'Hei', 'gracias']) expect(isTrivialMessage(t)).toBe(true);
    for (const t of ['Ja det passer', 'Kunne vi faktisk tatt det imrg isteden?', 'Do you have villas with a pool?']) expect(isTrivialMessage(t)).toBe(false);
  });
  it('...unless they answer a question the agency asked in the hour before', () => {
    const conv = (gapMinutes: number) => [
      { at: new Date(NOW - (gapMinutes + 1) * 60_000).toISOString(), from: 'agency' as const, text: 'Shall I book Thursday at 17:00?' },
      { at: new Date(NOW - 60_000).toISOString(), from: 'lead' as const, text: 'ok' },
    ];
    expect(burstIsMeaningful(conv(20), 0)).toBe(true);
    expect(burstIsMeaningful(conv(24 * 60), 0)).toBe(false);
  });
});
