import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { getLlmKey } from '../amanda-llm';
import { anthropicCaller } from '../../lead-scoring/extract';
import { runScoringCheck, type CheckReport } from '../../lead-scoring/check';
import { SCORING_FIXTURES } from '../../lead-scoring/fixtures';
import { safeErr } from '../../lib/safe-error';

/**
 * Admin → Scoring check (internal, staff only; Stage 1, approved by Christian 2026-09-11).
 *
 * Mounted under /api/v1/admin, where requireAivenaStaff answers every non-staff caller with 404: agencies can neither
 * see nor reach it. It runs the 11 fixture conversations through the real scorer with the SERVER's key (getLlmKey,
 * the same path as Amanda). It reads no leads and writes nothing: the report is kept in memory for an hour and
 * returned to the page. One run at a time, at most 10 a day, each capped at $0.05 (about $0.035 in practice).
 *
 *   POST /          start a run → 202 { runId }
 *   GET  /:runId    progress, then the full report
 */
const route = new Hono();

export const MAX_RUNS_PER_DAY = 10;
const KEEP_MS = 60 * 60_000;

type CheckRun = {
  id: string;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  done: number;
  total: number;
  report: CheckReport | null;
  error: string | null;
};

const runs = new Map<string, CheckRun>();
let activeRunId: string | null = null;
let day = '';
let runsToday = 0;

function prune(now = Date.now()): void {
  for (const [id, r] of runs) if (r.status !== 'running' && now - Date.parse(r.startedAt) > KEEP_MS) runs.delete(id);
}

route.post('/', (c) => {
  prune();
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    runsToday = 0;
  }
  if (activeRunId) return c.json({ ok: false, error: 'A scoring check is already running.', runId: activeRunId }, 409);
  if (runsToday >= MAX_RUNS_PER_DAY) {
    return c.json({ ok: false, error: `Today's limit of ${MAX_RUNS_PER_DAY} scoring checks has been reached.` }, 429);
  }
  runsToday += 1;
  const run: CheckRun = {
    id: randomUUID(),
    status: 'running',
    startedAt: new Date().toISOString(),
    done: 0,
    total: SCORING_FIXTURES.length,
    report: null,
    error: null,
  };
  runs.set(run.id, run);
  activeRunId = run.id;
  void runScoringCheck(anthropicCaller(getLlmKey), {
    onProgress: (done, total) => {
      run.done = done;
      run.total = total;
    },
  })
    .then((report) => {
      run.report = report;
      run.status = 'done';
      // One line, no conversation text, no key.
      console.info(`[scoring-check] ${report.cases.length} cases · $${report.totalCostUsd} · ${report.verdict}`);
    })
    .catch((err) => {
      run.status = 'failed';
      run.error = 'The scoring check could not finish. Please try again.';
      console.error('[scoring-check] failed:', safeErr(err));
    })
    .finally(() => {
      activeRunId = null;
    });
  return c.json({ ok: true, runId: run.id }, 202);
});

route.get('/:runId', (c) => {
  const run = runs.get(c.req.param('runId'));
  if (!run) return c.json({ ok: false, error: 'That check run is no longer available. Run it again.' }, 404);
  return c.json({ ok: true, run });
});

export default route;
