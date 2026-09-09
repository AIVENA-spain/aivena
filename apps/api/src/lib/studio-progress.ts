/**
 * WHAT A RUNNING GENERATION IS DOING, WRITTEN DOWN WHILE IT RUNS.
 *
 * The routing decision, the cost record and the stage timings were all persisted only when a
 * generation FINISHED. So the one run that most needed them — a job stuck for ten minutes — had an
 * empty record, and the route had to be reconstructed by re-running the router over the topic by
 * hand. That is the same silent-failure pattern as a checker that cannot fire.
 *
 * A stalled generation must now be able to say:
 *
 *     LOW → card match completed → WRITER started 21:03:42 → no progress since
 *
 * Stage boundaries only. A database write per deterministic helper would be noise; a write before
 * and after each external model or research call is what makes a hang locatable.
 *
 * OWNERSHIP. Every execution stamps an attempt id. Once a run has been reaped, its attempt is no
 * longer the active one, so an old request that finally returns cannot come back and publish —
 * Christian's zombie scenario, 2026-09-08: "job hangs; reaper marks it failed; old network request
 * unexpectedly returns; zombie job continues and publishes anyway."
 *
 * Pure: no env, no network, no database.
 */
import type { Tier } from './studio-risk-route';

export interface StageRecord {
  stage: string;
  startedAt: string;
  /** absent while the stage is still running — that absence is the signal */
  ms?: number;
  outcome?: string;
}

/** The tier, or an honest "not decided yet" for the moments before routing runs. */
export type RecordedTier = Tier | 'undecided';

export interface ProgressRecord {
  /** which execution owns this row. A reaped run's attempt is no longer the active one. */
  attemptId: string;
  tier: RecordedTier;
  signal: string;
  researched: boolean;
  /** the stage currently running, or the last one that ran */
  stage: string;
  stageStartedAt: string;
  /** the heartbeat. Staleness is measured from here, never from when the job started. */
  lastProgressAt: string;
  startedAt: string;
  calls: number;
  /** what is KNOWN to have been spent. A hung call's tokens are unknowable, so they are absent
   *  rather than estimated — Christian, 2026-09-08: "record what is actually known." */
  costUsd: number;
  escalated: boolean;
  stages: StageRecord[];
}

export const openProgress = (o: {
  attemptId: string; at: string; tier?: RecordedTier; signal?: string; researched?: boolean;
}): ProgressRecord => ({
  attemptId: o.attemptId,
  tier: o.tier ?? 'undecided', signal: o.signal ?? 'not routed yet',
  researched: o.researched ?? false,
  stage: 'starting', stageStartedAt: o.at, lastProgressAt: o.at, startedAt: o.at,
  calls: 0, costUsd: 0, escalated: false, stages: [],
});

/** A stage is about to run. Written BEFORE the call, so a hang is attributed to the right step. */
export function beginStage(p: ProgressRecord, stage: string, at: string): ProgressRecord {
  return {
    ...p, stage, stageStartedAt: at, lastProgressAt: at,
    stages: [...p.stages, { stage, startedAt: at }],
  };
}

/** The stage returned — however it returned. An outcome of TIMED_OUT is progress too. */
export function endStage(
  p: ProgressRecord, stage: string, at: string,
  o: { ms: number; outcome?: string; calls?: number; costUsd?: number } = { ms: 0 },
): ProgressRecord {
  const stages = [...p.stages];
  for (let i = stages.length - 1; i >= 0; i--) {
    if (stages[i].stage === stage && stages[i].ms === undefined) {
      stages[i] = { ...stages[i], ms: o.ms, outcome: o.outcome };
      break;
    }
  }
  return {
    ...p, lastProgressAt: at, stages,
    calls: o.calls ?? p.calls,
    costUsd: o.costUsd ?? p.costUsd,
  };
}

/**
 * Has this run stopped making progress?
 *
 * Measured from the LAST HEARTBEAT, never from when the job started. Christian, 2026-09-08: "do not
 * simply say processing > X minutes → failed, because a legitimate HIGH-risk generation could
 * someday take longer." A researched post that is still moving through its stages is healthy at
 * fifteen minutes; a LOW post that has not moved for eight is not.
 */
export function isStalled(p: ProgressRecord | null | undefined, nowMs: number, staleMs: number): boolean {
  if (!p?.lastProgressAt) return false;
  const last = Date.parse(p.lastProgressAt);
  return Number.isFinite(last) && nowMs - last > staleMs;
}

/**
 * The stale window, chosen from the call budgets rather than picked.
 *
 * The longest a single stage can legitimately go quiet is one bounded call plus its one retry —
 * 180s + 180s for the writer — plus room for the deterministic work either side. Anything past that
 * is not a slow stage, it is a stage that will never end.
 */
export const STALE_AFTER_MS = 8 * 60_000;

/** A stalled run, described the way the diagnosis needs it. */
export function describeStall(p: ProgressRecord, nowMs: number): string {
  const quiet = Math.round((nowMs - Date.parse(p.lastProgressAt)) / 1000);
  const done = p.stages.filter((s) => s.ms !== undefined).map((s) => s.stage);
  return `${p.tier.toUpperCase()} → ${done.length ? `${done.join(' → ')} completed → ` : ''}`
    + `${p.stage} started ${p.stageStartedAt} → no progress for ${quiet}s`;
}

/**
 * May this execution still write to this row?
 *
 * Checked before every publishing step. A run that was reaped is no longer `processing`, and a run
 * that was superseded no longer owns the attempt — either way the answer is no, and the old
 * execution must return quietly rather than overwrite a finished or failed record.
 */
export function ownsRun(
  row: { status?: string; result_metadata?: { progress?: { attemptId?: string } } | null } | null,
  attemptId: string,
): { ok: boolean; why: string } {
  if (!row) return { ok: false, why: 'the generation row is gone' };
  if (row.status !== 'processing') {
    return { ok: false, why: `the row is already ${row.status} — this execution was superseded` };
  }
  const owner = row.result_metadata?.progress?.attemptId;
  if (owner && owner !== attemptId) {
    return { ok: false, why: `attempt ${attemptId.slice(0, 8)} lost the row to ${owner.slice(0, 8)}` };
  }
  return { ok: true, why: 'this execution still owns the run' };
}

/** What the agent is told when a run had to be abandoned. Never our internal vocabulary. */
export const STALLED_MESSAGE =
  "That one stopped responding partway through. Nothing was posted — please try it again.";

/** The internal code, for the record and the logs only. */
export const STALLED_CODE = 'STALLED_GENERATION';
