import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { Tx } from '../../../../packages/db/client';
import { LEAD_SCORING_AGENCIES, LEAD_SCORING_MODE } from '../lib/automation-status';
import {
  QUIET_MINUTES,
  burstIsMeaningful,
  isTrivialMessage,
  pickDueLeads,
  runScoringTick,
  scoringAllowedFor,
  shouldStartScoringWorker,
  writeShadowRecord,
} from './worker';
import type { ModelCall } from './extract';
import type { ScoredConversation } from './score-conversation';

const dialect = new PgDialect();
const sqlText = (q: SQL): string => dialect.sqlToQuery(q).sql;
const NOW = Date.parse('2026-09-11T12:00:00Z');
const mustNotRun = async (): Promise<never> => {
  throw new Error('must not run');
};

describe('OFF means off (Stage 1)', () => {
  it('Stage 1 ships with no agency allowed, in shadow mode, and the worker does not start', () => {
    expect(LEAD_SCORING_AGENCIES).toEqual([]);
    expect(LEAD_SCORING_MODE).toBe('shadow');
    expect(shouldStartScoringWorker()).toBe(false);
  });
  it('with no agency allowed, a tick makes ZERO database calls and never calls the model', async () => {
    let transactions = 0;
    const r = await runScoringTick({
      withAgency: async () => {
        transactions += 1;
        throw new Error('must not open a transaction');
      },
      call: mustNotRun,
    });
    expect(transactions).toBe(0);
    expect(r).toEqual({ agencies: 0, scored: 0, failed: 0, skippedTrivial: 0 });
  });
  it('the scorer refuses an agency that is not allowed, before touching the database', async () => {
    expect(scoringAllowedFor('demo-costa-homes-pilot01')).toBe(false);
    const tx = { execute: mustNotRun } as unknown as Tx;
    const scored = { ok: true, error: null, score: 50, band: 'warm', temperature: 'warm', explanation: 'Warm 50', facts: {}, discarded: [], guards: [], inputTokens: 1, outputTokens: 1, costUsd: 0, stopReason: 'end_turn' } as ScoredConversation;
    await expect(writeShadowRecord(tx, 'demo-costa-homes-pilot01', '00000000-0000-0000-0000-000000000000', scored)).rejects.toThrow('not allowed');
  });
  it('write mode does not exist in Stage 1', async () => {
    await expect(runScoringTick({ allowed: ['a'], mode: 'write', withAgency: mustNotRun, call: mustNotRun })).rejects.toThrow('only shadow mode');
  });
});

describe('shadow mode (for a later, separately approved stage): one audit row, nothing else', () => {
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
