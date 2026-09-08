/**
 * WHAT A CAROUSEL COSTS — recorded, not estimated.
 *
 * Studio wrote no token usage anywhere, so a month of spend could only be guessed at from character
 * counts and call sites. A generation makes 38 model calls across two files and half a dozen
 * stages; anything that has to be threaded through every one of those by hand will be wrong within
 * a week, so the collector rides on AsyncLocalStorage instead: the wizard opens one per generation
 * and every call site inside records into it, whether or not it knows the collector exists.
 *
 * Pure of the environment on purpose — the pricing arithmetic and the aggregation are testable
 * without any variables set.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** What one Anthropic call cost, and what it was for. */
export interface UsageEntry {
  stage: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  ms: number;
  costUsd: number;
}

/**
 * What the three input categories cost, kept apart.
 *
 * Anthropic bills input as `cache_read + cache_creation + uncached input`, and the `input_tokens`
 * field is only the tokens AFTER the last breakpoint — not the total. Rolling them into one number
 * would hide both whether caching hit and whether it paid: a write costs 1.25x and a read 0.1x, so
 * a prefix that is written and never read is a loss, and it looks identical to a win unless these
 * are separated.
 */
export interface CostSplit {
  uncachedInput: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

export interface UsageSummary {
  generationId: string | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalCostUsd: number;
  /** what each stage cost, most expensive first */
  byStage: Array<{ stage: string; calls: number; costUsd: number; inputTokens: number;
    outputTokens: number; cacheState: CacheState; cacheSavingUsd: number }>;
  byModel: Array<{ model: string; calls: number; costUsd: number }>;
  /** what each input category cost, and what the output cost */
  costSplit: CostSplit;
  /** share of cacheable input actually served from cache, 0 when nothing was cached */
  cacheHitRate: number;
  /** what this generation would have cost with caching switched off entirely */
  uncachedEquivalentUsd: number;
  /** uncached minus actual. NEGATIVE means caching cost us money on this run. */
  cacheSavingUsd: number;
  /** how many calls wrote a prefix, read one, or did neither */
  cacheCalls: { cold: number; warm: number; mixed: number; none: number };
  /** true when this generation passed the warning threshold */
  overThreshold?: boolean;
  thresholdUsd?: number;
}

/**
 * List prices per MILLION tokens, used for estimation only.
 *
 * One place to correct, because a wrong price here silently misinforms every decision made from
 * these numbers. Cache writes bill at 1.25× the input rate and cache reads at 0.1×, which is the
 * whole reason caching is worth doing at all.
 */
export const PRICES: Readonly<Record<string, { input: number; output: number }>> = {
  // Verified against Anthropic's published list pricing, 2026-09-08. The first version of this
  // table carried Sonnet 4.6's $3/$15 under the Sonnet 5 key and Opus 4.x's $15/$75 under Opus 5,
  // which overstated the first measured generation by exactly 1.5x. A wrong number here is worse
  // than no number, because it is the one everything else is decided from.
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;
/**
 * Anything unpriced is charged at a deliberately HIGH rate rather than silently counted as free —
 * an unknown model should overstate the bill, never hide it.
 */
const FALLBACK = { input: 5, output: 25 };

export interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * What these same tokens WOULD have cost with no caching at all.
 *
 * The number caching has to beat. A hit rate says how much of the cacheable prefix was read; it
 * does not say whether the run was better off. An isolated generation writes the prefix at 1.25x
 * and never reads it, which is a real loss with a hit rate of 0% — and a busy hour is a real
 * saving. Only the difference against this baseline distinguishes them.
 */
export function uncachedCostOf(model: string, u: RawUsage): number {
  const p = PRICES[model] ?? FALLBACK;
  const allInput = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
    + (u.cache_creation_input_tokens ?? 0);
  return allInput / 1e6 * p.input + (u.output_tokens ?? 0) / 1e6 * p.output;
}

/** What happened at the cache for one call. */
export type CacheState = 'cold' | 'warm' | 'mixed' | 'none';

export function cacheStateOf(u: { cacheCreationTokens: number; cacheReadTokens: number }): CacheState {
  if (u.cacheReadTokens && u.cacheCreationTokens) return 'mixed';
  if (u.cacheReadTokens) return 'warm';
  if (u.cacheCreationTokens) return 'cold';
  return 'none';
}

/** What one call cost, in dollars. */
export function costOf(model: string, u: RawUsage): number {
  const p = PRICES[model] ?? FALLBACK;
  const input = (u.input_tokens ?? 0) / 1e6 * p.input;
  const output = (u.output_tokens ?? 0) / 1e6 * p.output;
  const write = (u.cache_creation_input_tokens ?? 0) / 1e6 * p.input * CACHE_WRITE_MULTIPLIER;
  const read = (u.cache_read_input_tokens ?? 0) / 1e6 * p.input * CACHE_READ_MULTIPLIER;
  return input + output + write + read;
}

class Collector {
  readonly entries: UsageEntry[] = [];
  constructor(readonly generationId: string | null) {}
}

const store = new AsyncLocalStorage<Collector>();

/** Run one generation with a usage collector attached to its async context. */
export function withUsage<T>(generationId: string | null, fn: () => Promise<T>): Promise<T> {
  return store.run(new Collector(generationId), fn);
}

/**
 * Record one Anthropic call. Safe to call from anywhere — outside a generation it does nothing,
 * so a call site never has to know whether it is being measured.
 */
export function recordUsage(stage: string, model: string, u: RawUsage | undefined, ms: number): void {
  const c = store.getStore();
  if (!c || !u) return;
  c.entries.push({
    stage,
    model,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    ms,
    costUsd: costOf(model, u),
  });
}

/** Every call recorded so far in this generation. Empty outside one. */
export function currentEntries(): readonly UsageEntry[] {
  return store.getStore()?.entries ?? [];
}

const round = (n: number, dp = 6) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Roll the entries up into the per-generation picture. */
export function summarise(
  entries: readonly UsageEntry[], generationId: string | null = null, thresholdUsd?: number,
): UsageSummary {
  const byStage = new Map<string, { calls: number; costUsd: number; inputTokens: number;
    outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; uncachedUsd: number }>();
  const byModel = new Map<string, { calls: number; costUsd: number }>();
  let inputTokens = 0; let outputTokens = 0; let cacheCreationTokens = 0;
  let cacheReadTokens = 0; let totalCostUsd = 0;

  for (const e of entries) {
    inputTokens += e.inputTokens;
    outputTokens += e.outputTokens;
    cacheCreationTokens += e.cacheCreationTokens;
    cacheReadTokens += e.cacheReadTokens;
    totalCostUsd += e.costUsd;
    const s = byStage.get(e.stage) ?? { calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0,
      cacheCreationTokens: 0, cacheReadTokens: 0, uncachedUsd: 0 };
    s.calls++; s.costUsd += e.costUsd; s.inputTokens += e.inputTokens; s.outputTokens += e.outputTokens;
    s.cacheCreationTokens += e.cacheCreationTokens; s.cacheReadTokens += e.cacheReadTokens;
    s.uncachedUsd += uncachedCostOf(e.model, {
      input_tokens: e.inputTokens, output_tokens: e.outputTokens,
      cache_creation_input_tokens: e.cacheCreationTokens, cache_read_input_tokens: e.cacheReadTokens,
    });
    byStage.set(e.stage, s);
    const m = byModel.get(e.model) ?? { calls: 0, costUsd: 0 };
    m.calls++; m.costUsd += e.costUsd;
    byModel.set(e.model, m);
  }

  // Priced per category rather than in total, so "did caching help?" is answerable from the record.
  const costSplit: CostSplit = { uncachedInput: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  for (const e of entries) {
    const p = PRICES[e.model] ?? FALLBACK;
    costSplit.uncachedInput += e.inputTokens / 1e6 * p.input;
    costSplit.cacheWrite += e.cacheCreationTokens / 1e6 * p.input * CACHE_WRITE_MULTIPLIER;
    costSplit.cacheRead += e.cacheReadTokens / 1e6 * p.input * CACHE_READ_MULTIPLIER;
    costSplit.output += e.outputTokens / 1e6 * p.output;
  }
  for (const k of Object.keys(costSplit) as Array<keyof CostSplit>) costSplit[k] = round(costSplit[k]);
  // Of everything that passed through a cache breakpoint, how much was read rather than written.
  const cacheable = cacheReadTokens + cacheCreationTokens;
  const cacheHitRate = cacheable ? round(cacheReadTokens / cacheable, 4) : 0;
  // The number that actually answers "did caching help THIS run?"
  const uncachedEquivalentUsd = round([...byStage.values()].reduce((a, v) => a + v.uncachedUsd, 0));
  const cacheSavingUsd = round(uncachedEquivalentUsd - totalCostUsd);
  const cacheCalls = { cold: 0, warm: 0, mixed: 0, none: 0 };
  for (const e of entries) cacheCalls[cacheStateOf(e)]++;

  return {
    generationId,
    calls: entries.length,
    inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens,
    totalCostUsd: round(totalCostUsd),
    costSplit, cacheHitRate, uncachedEquivalentUsd, cacheSavingUsd, cacheCalls,
    byStage: [...byStage.entries()]
      .map(([stage, v]) => ({
        stage, calls: v.calls, costUsd: round(v.costUsd),
        inputTokens: v.inputTokens, outputTokens: v.outputTokens,
        cacheState: cacheStateOf(v),
        cacheSavingUsd: round(v.uncachedUsd - v.costUsd),
      }))
      .sort((a, b) => b.costUsd - a.costUsd),
    byModel: [...byModel.entries()]
      .map(([model, v]) => ({ model, ...v, costUsd: round(v.costUsd) }))
      .sort((a, b) => b.costUsd - a.costUsd),
    ...(thresholdUsd ? { thresholdUsd, overThreshold: totalCostUsd > thresholdUsd } : {}),
  };
}

/**
 * WHAT A GENERATION OF THIS DEPTH SHOULD COST — provisional, and warning-only.
 *
 * Christian, 2026-09-08: "Add the infrastructure now... but do not treat $0.15/$0.30/$0.60 as
 * sacred limits. No cancellation. No weakening evidence. Just flag it." These are first guesses
 * from a single measured generation; after twenty or fifty real posts they become distributions
 * and get recalibrated. Nothing here ever stops a post.
 */
export const TIER_BUDGETS: Readonly<Record<string, number>> = {
  low: 0.15,
  medium: 0.30,
  high: 0.60,
};

/** The warning line for a route, overridable per environment while the numbers are still guesses. */
export function budgetFor(
  route: string | undefined, env: Record<string, string | undefined> = process.env,
): number | undefined {
  const key = (route ?? '').toLowerCase();
  const override = Number(env[`STUDIO_COST_WARN_${key.toUpperCase()}`]);
  if (Number.isFinite(override) && override > 0) return override;
  return TIER_BUDGETS[key];
}

/** One line per stage, cheap enough to log on every generation. */
export function formatSummary(s: UsageSummary): string {
  const money = (n: number) => `$${n.toFixed(4)}`;
  const lines = s.byStage.map((x) =>
    `    ${x.stage.padEnd(28)} ${money(x.costUsd).padStart(9)}  ${String(x.calls).padStart(2)} calls`
    + `  in ${x.inputTokens.toLocaleString()}  out ${x.outputTokens.toLocaleString()}`
    + (x.cacheState === 'none' ? ''
      : `  cache ${x.cacheState.toUpperCase()} ${x.cacheSavingUsd >= 0 ? 'saved' : 'cost'} `
        + money(Math.abs(x.cacheSavingUsd))));
  const c = s.costSplit;
  return [
    `[studio/cost] ${money(s.totalCostUsd)} · ${s.calls} calls`
    + ` · in ${s.inputTokens.toLocaleString()} · out ${s.outputTokens.toLocaleString()}`
    + ` · cache read ${s.cacheReadTokens.toLocaleString()} · cache written ${s.cacheCreationTokens.toLocaleString()}`,
    `    ${'uncached input'.padEnd(28)} ${money(c.uncachedInput).padStart(9)}`
    + `   cache write ${money(c.cacheWrite)}   cache read ${money(c.cacheRead)}`
    + `   output ${money(c.output)}`,
    `    ${'vs no caching at all'.padEnd(28)} ${money(s.uncachedEquivalentUsd).padStart(9)}`
    + `   → caching ${s.cacheSavingUsd >= 0 ? 'SAVED' : 'COST'} ${money(Math.abs(s.cacheSavingUsd))}`
    + `   (${s.cacheCalls.cold} cold, ${s.cacheCalls.warm} warm, ${s.cacheCalls.mixed} mixed)`,
    ...lines,
  ].join('\n');
}
