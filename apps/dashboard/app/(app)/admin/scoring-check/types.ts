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
