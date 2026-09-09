import { describe, expect, it, vi } from 'vitest';
import { CALL_BUDGET_MS, boundedCall, isTransient } from './studio-bounded-call';
import {
  STALE_AFTER_MS, beginStage, describeStall, endStage, isStalled, openProgress, ownsRun,
} from './studio-progress';

/**
 * A live generation (ebc34869, 2026-09-08) ran for over ten minutes and would have run forever: the
 * writer and the editor were the only calls in Studio with no AbortController, and nothing was
 * written to the row between insert and completion, so the record could not even say which stage it
 * was in. `editPlan` already branched on a `TIMED_OUT` outcome that nothing could produce.
 *
 * These tests hold the three properties that failure needed: every call ends, a stalled run can
 * describe itself, and a run that comes back from the dead cannot publish.
 */

const HEADERS = { 'content-type': 'application/json' };
const call = (fetchImpl: typeof fetch, over: Partial<Parameters<typeof boundedCall>[0]> = {}) =>
  boundedCall<{ ok: boolean }>({
    label: 'writer', url: 'https://example.invalid/v1/messages', headers: HEADERS,
    body: {}, timeoutMs: 50, fetchImpl, ...over,
  });

/** A request that never answers — the exact shape of the live failure. */
const hangs: typeof fetch = (_u, init) => new Promise((_res, rej) => {
  init?.signal?.addEventListener('abort', () => {
    const e = new Error('aborted'); e.name = 'AbortError'; rej(e);
  });
});
const ok = (body: unknown): typeof fetch => async () =>
  ({ ok: true, status: 200, json: async () => body, text: async () => '' }) as unknown as Response;
const status = (code: number): typeof fetch => async () =>
  ({ ok: false, status: code, json: async () => ({}), text: async () => 'upstream said no' }) as unknown as Response;

describe('every model call ends', () => {
  it('gives up on a request that never answers, instead of waiting forever', async () => {
    const r = await call(hangs, { retryTransient: false });
    expect(r.outcome).toBe('TIMED_OUT');
    expect(r.detail).toMatch(/no response within/);
  });

  it('keeps a timeout, a dead socket and a rejection as three different answers', async () => {
    const dead: typeof fetch = async () => { throw new Error('ECONNRESET'); };
    expect((await call(hangs, { retryTransient: false })).outcome).toBe('TIMED_OUT');
    expect((await call(dead, { retryTransient: false })).outcome).toBe('NETWORK_FAILED');
    expect((await call(status(400), { retryTransient: false })).outcome).toBe('HTTP_ERROR');
    const notJson: typeof fetch = async () =>
      ({ ok: true, status: 200, json: async () => { throw new Error('nope'); } }) as unknown as Response;
    expect((await call(notJson)).outcome).toBe('MALFORMED');
  });

  it('retries a transient failure exactly ONCE, never three times', async () => {
    const spy = vi.fn(hangs);
    const r = await call(spy as unknown as typeof fetch);
    expect(spy).toHaveBeenCalledTimes(2);       // one try, one retry — not three
    expect(r.outcome).toBe('TIMED_OUT');
    expect(r.attempts).toHaveLength(2);
  });

  it('does not retry a rejection that will never fix itself', async () => {
    const spy = vi.fn(status(400));
    await call(spy as unknown as typeof fetch);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 and a 500, because those do fix themselves', () => {
    expect(isTransient('HTTP_ERROR', 429)).toBe(true);
    expect(isTransient('HTTP_ERROR', 503)).toBe(true);
    expect(isTransient('HTTP_ERROR', 400)).toBe(false);
    expect(isTransient('MALFORMED')).toBe(false);
  });

  it('keeps the first attempt on the record even when the retry succeeds', async () => {
    let n = 0;
    const flaky: typeof fetch = (u, i) => (n++ === 0 ? hangs(u, i) : ok({ ok: true })(u, i));
    const r = await call(flaky);
    expect(r.outcome).toBe('OK');
    expect(r.attempts).toHaveLength(2);
    expect(r.attempts[0].outcome).toBe('TIMED_OUT');   // the slow first try is not forgotten
    expect(r.attempts[1].outcome).toBe('OK');
  });

  // Generous on purpose: a flaky timeout costs an agent their post, a slow one costs three minutes.
  it('budgets the writer above the editor, and both well above what they measured', () => {
    expect(CALL_BUDGET_MS.EDITOR).toBeGreaterThan(6 * 18_000);   // measured 18.0s
    expect(CALL_BUDGET_MS.WRITER).toBeGreaterThan(CALL_BUDGET_MS.EDITOR);
    expect(CALL_BUDGET_MS.WRITER).toBeGreaterThan(150_000);      // Studio's existing ceiling
  });
});

describe('a stalled run can say what it was doing', () => {
  const t = (s: number) => new Date(Date.UTC(2026, 8, 8, 21, 0, s)).toISOString();
  const fresh = () => openProgress({
    attemptId: 'a1b2c3d4-0000', tier: 'low', signal: 'nothing_checkable',
    researched: false, at: t(0),
  });

  it('names the stage before the call runs, not after', () => {
    const p = beginStage(fresh(), 'writer', t(42));
    expect(p.stage).toBe('writer');
    expect(p.stages[p.stages.length - 1]).toEqual({ stage: 'writer', startedAt: t(42) });
    expect(p.stages[p.stages.length - 1]?.ms).toBeUndefined();   // still running — that absence IS the signal
  });

  it('closes a stage however it ended, including a timeout', () => {
    let p = beginStage(fresh(), 'writer', t(10));
    p = endStage(p, 'writer', t(190), { ms: 180_000, outcome: 'TIMED_OUT', calls: 1 });
    expect(p.stages[p.stages.length - 1]).toMatchObject({ stage: 'writer', ms: 180_000, outcome: 'TIMED_OUT' });
    expect(p.lastProgressAt).toBe(t(190));
  });

  it('measures staleness from the last heartbeat, never from when the job started', () => {
    let p = fresh();
    // twenty minutes old, but it moved a second ago — a long researched post is not a stalled one
    p = endStage(beginStage(p, 'research', t(0)), 'research', t(1199), { ms: 1_199_000 });
    const now = Date.parse(t(1200));
    expect(isStalled(p, now, STALE_AFTER_MS)).toBe(false);
  });

  it('calls a run stalled once the heartbeat goes quiet past the window', () => {
    const p = beginStage(fresh(), 'writer', t(0));
    expect(isStalled(p, Date.parse(t(0)) + STALE_AFTER_MS + 1, STALE_AFTER_MS)).toBe(true);
    expect(isStalled(p, Date.parse(t(0)) + STALE_AFTER_MS - 1, STALE_AFTER_MS)).toBe(false);
  });

  it('describes itself the way the diagnosis needed', () => {
    let p = fresh();
    p = endStage(beginStage(p, 'card match', t(0)), 'card match', t(2), { ms: 2000 });
    p = beginStage(p, 'writer', t(30));
    const line = describeStall(p, Date.parse(t(630)));
    expect(line).toContain('LOW');
    expect(line).toContain('card match completed');
    expect(line).toContain('writer started');
    expect(line).toMatch(/no progress for 600s/);
  });

  it('leaves the window comfortably above one bounded call plus its retry', () => {
    expect(STALE_AFTER_MS).toBeGreaterThan(2 * CALL_BUDGET_MS.WRITER);
  });
});

/**
 * Christian's zombie: the job hangs, the reaper fails it, then the old request finally returns and
 * publishes anyway. Ownership is what stops that, and it is checked before anything is written.
 */
describe('a run that comes back from the dead cannot publish', () => {
  const mine = 'a1b2c3d4-1111';
  const row = (over: Record<string, unknown> = {}) => ({
    status: 'processing',
    result_metadata: { progress: { attemptId: mine } },
    ...over,
  });

  it('lets the owning execution finish normally', () => {
    expect(ownsRun(row(), mine).ok).toBe(true);
  });

  it('refuses an execution whose row was already reaped', () => {
    const r = ownsRun(row({ status: 'failed' }), mine);
    expect(r.ok).toBe(false);
    expect(r.why).toMatch(/already failed/);
  });

  it('refuses an execution whose row was already completed', () => {
    expect(ownsRun(row({ status: 'completed' }), mine).ok).toBe(false);
  });

  it('refuses an execution that lost the row to a newer attempt', () => {
    const r = ownsRun(row({ result_metadata: { progress: { attemptId: 'ffffffff-9999' } } }), mine);
    expect(r.ok).toBe(false);
    expect(r.why).toMatch(/lost the row/);
  });

  it('refuses when the row has gone', () => {
    expect(ownsRun(null, mine).ok).toBe(false);
  });

  // An older row written before progress existed has no attempt id; the status check still governs.
  it('does not lock out a run that predates attempt ids', () => {
    expect(ownsRun({ status: 'processing', result_metadata: {} }, mine).ok).toBe(true);
  });
});

/**
 * THE FULL SEQUENCE, as Christian described it:
 *   1. job hangs · 2. reaper marks it failed · 3. old request returns · 4. zombie publishes anyway
 *
 * Step 4 is the one that must not happen. This walks the whole thing against a fake row so the
 * pieces are tested where they actually meet, not only one at a time.
 */
describe('hang → reap → late return → refused', () => {
  const t = (s: number) => new Date(Date.UTC(2026, 8, 8, 21, 0, s)).toISOString();

  it('never lets a reaped run publish, even when its request finally comes back', () => {
    const attemptId = 'a1b2c3d4-writer';
    // 1. the run starts, routes LOW, matches a card, then enters the writer and goes quiet
    let p = openProgress({ attemptId, at: t(0), tier: 'low', signal: 'nothing_checkable' });
    p = endStage(beginStage(p, 'card match', t(1)), 'card match', t(3), { ms: 2000 });
    p = beginStage(p, 'writer', t(4));
    const row: Record<string, unknown> = { status: 'processing', result_metadata: { progress: p } };

    // 2. eight minutes of silence — the reaper sees a stalled run and fails the row
    const now = Date.parse(t(600));
    expect(isStalled(p, now, STALE_AFTER_MS)).toBe(true);
    expect(describeStall(p, now)).toContain('card match completed');
    row.status = 'failed';

    // 3. the hung request finally returns and the old execution tries to publish
    // 4. it is refused, because the row is no longer processing
    const verdict = ownsRun(row as Parameters<typeof ownsRun>[0], attemptId);
    expect(verdict.ok).toBe(false);
    expect(verdict.why).toMatch(/already failed/);
  });

  it('lets a slow but living run finish, because staleness is a heartbeat not an age', () => {
    const attemptId = 'a1b2c3d4-slow';
    let p = openProgress({ attemptId, at: t(0), tier: 'high', signal: 'risk_class' });
    // a researched post: fifteen minutes old, but every stage has been reporting in
    for (const [stage, at, done] of [
      ['card match', 2, 4], ['research', 5, 400], ['source facts', 401, 700],
      ['writer', 701, 880], ['editor', 881, 899],
    ] as Array<[string, number, number]>) {
      p = endStage(beginStage(p, stage, t(at)), stage, t(done), { ms: (done - at) * 1000 });
    }
    expect(isStalled(p, Date.parse(t(900)), STALE_AFTER_MS)).toBe(false);
    expect(ownsRun({ status: 'processing', result_metadata: { progress: p } }, attemptId).ok).toBe(true);
  });
});
