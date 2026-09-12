/**
 * The internal scoring check (Stage 1, approved by Christian 2026-09-11; fact-by-fact comparison added in Stage 3a,
 * 2026-09-12). Runs the 11 fixture conversations through the real scorer and judges them against his acceptance
 * standard. It has NO database access: it reads no leads and writes nothing. The model call is passed in: the admin
 * route passes the server's own key path.
 */
import { SCORING_MODEL, worstCaseCostUsd, type ModelCall } from './extract';
import { SCORING_FIXTURES, type ScoringFixture } from './fixtures';
import { NO_SCORE_BANDS, RUBRIC_VERSION } from './rubric';
import { scoreConversation } from './score-conversation';
import type { Band, Fact, Facts, Temperature } from './types';

export const CHECK_CAP_USD = 0.05;

export type CheckCase = {
  id: number;
  title: string;
  minor: boolean;
  expected: ScoringFixture['expected'];
  actual: { score: number | null; band: Band; temperature: Temperature } | null;
  ok: boolean;
  explanation: string | null;
  discarded: string[];
  guards: string[];
  /** Facts that came out differently from what a perfect reader should have found. */
  factDiffs: string[];
  /** What code made of the dates (Stage 3a): a viewing date that has passed, a horizon read from a real date. */
  timeNotes: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error: string | null;
};

export type Verdict = 'GREEN' | 'ACCEPTABLE' | 'NOT ACCEPTABLE';

export type CheckReport = {
  verdict: Verdict;
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
  cases: CheckCase[];
};

export function matchesExpected(exp: ScoringFixture['expected'], actual: CheckCase['actual']): boolean {
  if (!actual || actual.band !== exp.band) return false;
  if (NO_SCORE_BANDS.includes(exp.band)) return actual.score == null;
  if (actual.score == null) return false;
  if (exp.range) return actual.score >= exp.range[0] && actual.score <= exp.range[1];
  return exp.score != null && Math.abs(actual.score - exp.score) <= 3;
}

const isFact = (v: unknown): v is Fact => typeof v === 'object' && v !== null && !Array.isArray(v);
const yesNo = (v: unknown): string => (v === true ? 'yes' : v === false ? 'no' : 'not said');

/**
 * Fact by fact, not only the final band (Christian, 2026-09-12). Only the facts the case names are compared: where a
 * reading is genuinely arguable the case leaves it out. A difference never changes the score by itself — it is
 * reported, and it is what stops GREEN meaning "the band happened to land right".
 */
export function factDiffs(expected: Facts, actual: Facts | null): string[] {
  if (!actual) return [];
  const out: string[] = [];
  for (const key of Object.keys(expected) as Array<keyof Facts>) {
    if (key === 'reason') continue;
    const e = expected[key];
    const a = actual[key];
    if (!isFact(e)) {
      if (e !== undefined && e !== a) out.push(`${key}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a ?? null)}`);
      continue;
    }
    const got = isFact(a) ? a : undefined;
    if (e.state !== undefined && e.state !== (got?.state ?? 'none')) {
      out.push(`${key}: expected ${e.state}, got ${got?.state ?? 'none'}`);
    }
    if (e.present !== undefined && e.present !== (got?.present ?? false)) {
      out.push(`${key}: expected ${yesNo(e.present)}, got ${yesNo(got?.present ?? false)}`);
    }
    if (e.within_7_days !== undefined && e.within_7_days !== (got?.within_7_days ?? null)) {
      out.push(`${key} within 7 days: expected ${yesNo(e.within_7_days)}, got ${yesNo(got?.within_7_days ?? null)}`);
    }
  }
  return out;
}

// Christian's named requirements (2026-09-11). Each applies only when its case was part of the run.
const NAMED: Array<{ id: number; label: string; test: (c: CheckCase) => boolean }> = [
  { id: 8, label: 'The Norwegian viewing case lands super-hot', test: (c) => c.actual?.band === 'super_hot' },
  { id: 3, label: '"Is this available?" alone is not hot', test: (c) => !!c.actual && !['hot', 'super_hot', 'ready_to_act'].includes(c.actual.band) },
  { id: 10, label: 'Bought elsewhere is lost: no score, no temperature', test: (c) => c.actual?.band === 'lost' && c.actual.score == null && c.actual.temperature == null },
  { id: 6, label: 'Clear budget + area + need is not scored too low', test: (c) => !!c.actual && ['hot', 'super_hot', 'ready_to_act'].includes(c.actual.band) },
  { id: 6, label: '"Next spring" is not read as within 30 days', test: (c) => !c.factDiffs.some((d) => d.startsWith('timing:')) },
  { id: 9, label: 'An offer is read as an offer', test: (c) => !c.factDiffs.some((d) => d.startsWith('decision:')) },
];

/**
 * NOT ACCEPTABLE: a failed, cut-off, invalid or unrun answer; a wrong band on a serious case; a named requirement
 * missed. ACCEPTABLE: only same-band score differences, a band slip on a case marked minor, facts that differ from
 * what a perfect reader should have found, or quotes the verifier caught and discarded (they can never raise a score
 * or appear in the explanation, and are reported here). GREEN: every band right, every named fact right, nothing
 * discarded.
 */
export function computeVerdict(cases: CheckCase[]): Pick<CheckReport, 'verdict' | 'reasons' | 'namedChecks'> {
  const reasons: string[] = [];
  const failed = cases.filter((c) => c.error);
  const bandWrong = cases.filter((c) => c.actual && c.actual.band !== c.expected.band);
  const seriousWrong = bandWrong.filter((c) => !c.minor);
  const scoreOff = cases.filter((c) => c.actual && !c.ok && c.actual.band === c.expected.band);
  const withDiscards = cases.filter((c) => c.discarded.length > 0);
  const factsOff = cases.filter((c) => c.factDiffs.length > 0);
  const namedChecks = NAMED.filter((n) => cases.some((c) => c.id === n.id)).map(({ id, label, test }) => {
    const c = cases.find((x) => x.id === id);
    return { label, pass: !!c && test(c) };
  });
  const ids = (xs: CheckCase[]) => xs.map((c) => `#${c.id}`).join(', ');
  if (failed.length) reasons.push(`failed or not run: ${ids(failed)}`);
  if (seriousWrong.length) reasons.push(`wrong band: ${ids(seriousWrong)}`);
  for (const n of namedChecks) if (!n.pass) reasons.push(`missed: ${n.label}`);
  if (reasons.length) return { verdict: 'NOT ACCEPTABLE', reasons, namedChecks };
  if (bandWrong.length) reasons.push(`band slip on a minor case: ${ids(bandWrong)}`);
  if (factsOff.length) reasons.push(`facts differ: ${factsOff.map((c) => `#${c.id} (${c.factDiffs.join('; ')})`).join(' · ')}`);
  if (scoreOff.length) reasons.push(`same-band score difference: ${ids(scoreOff)}`);
  if (withDiscards.length) reasons.push(`quotes caught and discarded (never scored, never shown): ${ids(withDiscards)}`);
  return { verdict: reasons.length ? 'ACCEPTABLE' : 'GREEN', reasons, namedChecks };
}

export async function runScoringCheck(
  call: ModelCall,
  opts: { capUsd?: number; fixtures?: ScoringFixture[]; onProgress?: (done: number, total: number) => void } = {},
): Promise<CheckReport> {
  const fixtures = opts.fixtures ?? SCORING_FIXTURES;
  const capUsd = opts.capUsd ?? CHECK_CAP_USD;
  const startedAt = new Date().toISOString();
  const cases: CheckCase[] = [];
  let spent = 0;
  for (const fx of fixtures) {
    const base = { id: fx.id, title: fx.title, minor: fx.minor === true, expected: fx.expected };
    // Checked before every call: a call runs only if even its worst case cannot take the run past the cap.
    if (spent + worstCaseCostUsd(fx.input) > capUsd) {
      cases.push({ ...base, actual: null, ok: false, explanation: null, discarded: [], guards: [], factDiffs: [], timeNotes: [], inputTokens: 0, outputTokens: 0, costUsd: 0, error: 'not run: it could have passed the cost cap' });
      opts.onProgress?.(cases.length, fixtures.length);
      continue;
    }
    const r = await scoreConversation(fx.input, call);
    spent += r.costUsd;
    const actual = r.ok && r.band ? { score: r.score, band: r.band, temperature: r.temperature } : null;
    cases.push({
      ...base,
      actual,
      ok: matchesExpected(fx.expected, actual),
      explanation: r.explanation,
      discarded: r.discarded,
      guards: r.guards,
      factDiffs: factDiffs(fx.expectedFacts, r.facts),
      timeNotes: r.timeNotes,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: Number(r.costUsd.toFixed(5)),
      error: r.error,
    });
    opts.onProgress?.(cases.length, fixtures.length);
  }
  return {
    ...computeVerdict(cases),
    model: SCORING_MODEL,
    rubricVersion: RUBRIC_VERSION,
    capUsd,
    totalCostUsd: Number(spent.toFixed(5)),
    inputTokens: cases.reduce((a, c) => a + c.inputTokens, 0),
    outputTokens: cases.reduce((a, c) => a + c.outputTokens, 0),
    startedAt,
    finishedAt: new Date().toISOString(),
    cases,
  };
}
