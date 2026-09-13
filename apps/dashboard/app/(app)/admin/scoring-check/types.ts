/** The report the API's internal scoring check returns (apps/api/src/lead-scoring/check.ts). */

export type ScoringCheckVerdict = "GREEN" | "ACCEPTABLE" | "NOT ACCEPTABLE";

export type ScoringCheckCase = {
  id: number;
  title: string;
  minor: boolean;
  expected: { score: number | null; band: string; range?: [number, number]; why: string };
  actual: { score: number | null; band: string; temperature: string | null } | null;
  ok: boolean;
  explanation: string | null;
  discarded: string[];
  guards: string[];
  tolerated: string[];
  factDiffs: string[];
  timeNotes: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error: string | null;
};

export type ScoringCheckReport = {
  verdict: ScoringCheckVerdict;
  reasons: string[];
  namedChecks: Array<{ label: string; pass: boolean }>;
  model: string;
  rubricVersion: string;
  capUsd: number;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  startedAt: string;
  finishedAt: string;
  cases: ScoringCheckCase[];
};

export type ScoringCheckRun = {
  id: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  done: number;
  total: number;
  report: ScoringCheckReport | null;
  error: string | null;
};

/** One shadow run: what the scorer made of a real conversation, written only to the internal record. */
export type ShadowRun = {
  id: string;
  agencyId: string;
  leadId: string | null;
  leadName: string | null;
  classifiedAt: string;
  ok: boolean;
  error: string | null;
  score: number | null;
  band: string | null;
  temperature: string | null;
  explanation: string | null;
  discarded: string[];
  guards: string[];
  tolerated: string[];
  timeNotes: string[];
  rubricVersion: string | null;
  messagesSeen: number | null;
  earlierMessagesSeen: number | null;
  trimmed: string | null;
  tokens: number | null;
  costUsd: number | null;
  storedScore: number | null;
  storedTemperature: string | null;
  storedScoredAt: string | null;
};

export type ShadowStatus = {
  agencies: string[];
  mode: string;
  paused: boolean;
  runs: ShadowRun[];
};

/** Go-live re-score dry run (Stage 3b built; Stage 3c executes). */
export type RescoreAction = "rescore_and_clear_legacy" | "clear_legacy" | "rescore" | "nothing";

export type RescorePlan = {
  leadId: string;
  name: string | null;
  action: RescoreAction;
  reason: string;
  legacyFields: string[];
};

export type RescoreDryRun = {
  live: boolean;
  mode: string;
  canExecute: boolean;
  agencies: Array<{ agencyId: string; leads: RescorePlan[] }>;
  totals: {
    leads: number;
    rescoreAndClearLegacy: number;
    clearLegacy: number;
    rescore: number;
    nothing: number;
    estimatedCostUsd: number;
    maxCostUsd: number;
  };
};

/** What the go-live re-score did, lead by lead (Stage 3c). */
export type RescoreExecuteResult = {
  results: Array<{
    agencyId: string;
    leadId: string;
    action: RescoreAction;
    outcome: { ok: boolean; score: number | null; band: string | null; error: string | null } | null;
  }>;
};
