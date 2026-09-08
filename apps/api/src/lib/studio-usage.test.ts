import { describe, expect, it } from 'vitest';
import { PRICES, TIER_BUDGETS, budgetFor, cacheStateOf, costOf, formatSummary, summarise, uncachedCostOf, type UsageEntry } from './studio-usage';

/**
 * Studio wrote no token usage at all, so a month of spend could only be guessed at from character
 * counts — and the guess was wrong about which stage was expensive. These numbers now drive real
 * decisions, so the arithmetic behind them is worth holding still.
 */
const entry = (o: Partial<UsageEntry> & { stage: string }): UsageEntry => ({
  model: 'claude-sonnet-5', inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0,
  cacheReadTokens: 0, ms: 0, costUsd: 0, ...o,
});

describe('what a call costs', () => {
  it('prices plain input and output at the model rate', () => {
    // 1M input + 1M output on Sonnet 5 = $2 + $10
    expect(costOf('claude-sonnet-5', { input_tokens: 1e6, output_tokens: 1e6 })).toBeCloseTo(12, 6);
  });

  /**
   * THE NUMBER EVERYTHING ELSE IS DECIDED FROM. The first table carried Sonnet 4.6's $3/$15 under
   * the Sonnet 5 key, which overstated the first measured generation by exactly 1.5x — and that
   * figure was about to become the baseline for a cost-reduction programme. Pinned against
   * Anthropic's published list pricing so a stale rate cannot pass silently again.
   */
  it('carries the published list price for every model the engine can call', () => {
    expect(PRICES['claude-sonnet-5']).toEqual({ input: 2, output: 10 });
    expect(PRICES['claude-opus-5']).toEqual({ input: 5, output: 25 });
    expect(PRICES['claude-haiku-4-5']).toEqual({ input: 1, output: 5 });
    // Sonnet 4.6 is a different model at a different price — keeping both stops the mix-up.
    expect(PRICES['claude-sonnet-4-6']).toEqual({ input: 3, output: 15 });
  });

  it('charges a cache write above the input rate and a cache read far below it', () => {
    const write = costOf('claude-sonnet-5', { cache_creation_input_tokens: 1e6 });
    const read = costOf('claude-sonnet-5', { cache_read_input_tokens: 1e6 });
    const plain = costOf('claude-sonnet-5', { input_tokens: 1e6 });
    expect(write).toBeGreaterThan(plain);       // 1.25x — caching costs more the first time
    expect(read).toBeLessThan(plain / 5);       // 0.1x — and far less every time after
    expect(read / plain).toBeCloseTo(0.1, 6);
  });

  // THE WHOLE POINT OF CACHING: reuse has to beat paying full price.
  it('makes a prefix cheaper from the second use onward', () => {
    const uncached = 5 * costOf('claude-sonnet-5', { input_tokens: 10_000 });
    const cached = costOf('claude-sonnet-5', { cache_creation_input_tokens: 10_000 })
      + 4 * costOf('claude-sonnet-5', { cache_read_input_tokens: 10_000 });
    expect(cached).toBeLessThan(uncached / 2);
  });

  it('does not silently count an unpriced model as free', () => {
    expect(costOf('some-future-model', { input_tokens: 1e6 })).toBeGreaterThan(0);
  });

  it('prices Haiku below Sonnet, which is why the swap is worth testing', () => {
    expect(PRICES['claude-haiku-4-5'].input).toBeLessThan(PRICES['claude-sonnet-5'].input);
    expect(PRICES['claude-haiku-4-5'].output).toBeLessThan(PRICES['claude-sonnet-5'].output);
  });
});

describe('what a generation cost', () => {
  const entries: UsageEntry[] = [
    entry({ stage: 'source facts S1', inputTokens: 5000, outputTokens: 800, costUsd: 0.027 }),
    entry({ stage: 'source facts S2', inputTokens: 5000, outputTokens: 800, costUsd: 0.027 }),
    entry({ stage: 'writer', inputTokens: 14_000, outputTokens: 2500, costUsd: 0.0795 }),
    entry({ stage: 'claim support', inputTokens: 6000, outputTokens: 900, cacheReadTokens: 1300, costUsd: 0.0316 }),
  ];

  it('adds up every column', () => {
    const s = summarise(entries, 'gen-1');
    expect(s.calls).toBe(4);
    expect(s.inputTokens).toBe(30_000);
    expect(s.outputTokens).toBe(5000);
    expect(s.cacheReadTokens).toBe(1300);
    expect(s.generationId).toBe('gen-1');
  });

  it('ranks stages by cost, so the expensive one is the first thing you see', () => {
    const s = summarise(entries);
    expect(s.byStage[0].stage).toBe('writer');
    expect(s.byStage.map((x) => x.costUsd)).toEqual([...s.byStage.map((x) => x.costUsd)].sort((a, b) => b - a));
  });

  it('groups by model, so a Haiku swap is visible in the record', () => {
    const mixed = [...entries, entry({ stage: 'source facts S3', model: 'claude-haiku-4-5', costUsd: 0.002 })];
    const s = summarise(mixed);
    expect(s.byModel.map((m) => m.model)).toContain('claude-haiku-4-5');
  });

  it('flags a generation over the warning line without touching the post', () => {
    const over = summarise(entries, 'gen-1', 0.1);
    expect(over.overThreshold).toBe(true);
    const under = summarise(entries, 'gen-1', 10);
    expect(under.overThreshold).toBe(false);
  });

  it('says nothing about a threshold that was never set', () => {
    expect(summarise(entries).overThreshold).toBeUndefined();
  });

  it('handles a generation that recorded nothing rather than dividing by zero', () => {
    const s = summarise([], 'gen-empty');
    expect(s.calls).toBe(0);
    expect(s.totalCostUsd).toBe(0);
    expect(s.byStage).toEqual([]);
  });

  it('reads as one glanceable block', () => {
    const out = formatSummary(summarise(entries, 'gen-1'));
    expect(out).toMatch(/\[studio\/cost\] \$\d+\.\d{4} · 4 calls/);
    expect(out).toContain('writer');
  });
});

/**
 * Provisional warning lines, deliberately. Christian, 2026-09-08: "do not treat $0.15/$0.30/$0.60
 * as fixed targets or interrupt generations. We'll recalibrate them from real usage."
 */
describe('the cost warning line', () => {
  it('expects a lifestyle post to cost less than a researched one', () => {
    expect(TIER_BUDGETS.low).toBeLessThan(TIER_BUDGETS.medium);
    expect(TIER_BUDGETS.medium).toBeLessThan(TIER_BUDGETS.high);
  });

  it('reads the line for a route', () => {
    expect(budgetFor('low', {})).toBe(0.15);
    expect(budgetFor('medium', {})).toBe(0.30);
  });

  it('can be recalibrated per environment while the numbers are still guesses', () => {
    expect(budgetFor('low', { STUDIO_COST_WARN_LOW: '0.22' })).toBe(0.22);
    expect(budgetFor('low', { STUDIO_COST_WARN_LOW: 'nonsense' })).toBe(0.15);
    expect(budgetFor('low', { STUDIO_COST_WARN_LOW: '0' })).toBe(0.15);
  });

  it('has no line for a route it does not know, rather than inventing one', () => {
    expect(budgetFor('something-else', {})).toBeUndefined();
    expect(budgetFor(undefined, {})).toBeUndefined();
  });

  // The whole point: it annotates, it never stops anything.
  it('only ever flags — the summary carries a threshold, not a decision', () => {
    const over = summarise([entry({ stage: 'writer', costUsd: 0.9 })], 'g', 0.15);
    expect(over.overThreshold).toBe(true);
    expect(Object.keys(over)).not.toContain('cancelled');
  });
});

/**
 * Anthropic bills input as `cache_read + cache_creation + uncached input`, and a cache write costs
 * 1.25x while a read costs 0.1x. A prefix that is written and never read is a LOSS — and it looks
 * exactly like a win unless the categories are priced apart.
 */
describe('what caching actually cost', () => {
  it('prices the three input categories separately', () => {
    const s = summarise([entry({
      stage: 'writer', inputTokens: 1000, cacheCreationTokens: 2000, cacheReadTokens: 4000,
      outputTokens: 500,
    })]);
    expect(s.costSplit.uncachedInput).toBeCloseTo(1000 / 1e6 * 2, 8);
    expect(s.costSplit.cacheWrite).toBeCloseTo(2000 / 1e6 * 2 * 1.25, 8);
    expect(s.costSplit.cacheRead).toBeCloseTo(4000 / 1e6 * 2 * 0.1, 8);
    expect(s.costSplit.output).toBeCloseTo(500 / 1e6 * 10, 8);
  });

  it('shows a write-only generation as a hit rate of zero', () => {
    const s = summarise([entry({ stage: 'writer', cacheCreationTokens: 1400 })]);
    expect(s.cacheHitRate).toBe(0);
    expect(s.costSplit.cacheWrite).toBeGreaterThan(0);
    expect(s.costSplit.cacheRead).toBe(0);
  });

  it('shows a well-reused prefix as a high hit rate', () => {
    const s = summarise([
      entry({ stage: 'a', cacheCreationTokens: 1400 }),
      entry({ stage: 'b', cacheReadTokens: 1400 }),
      entry({ stage: 'c', cacheReadTokens: 1400 }),
    ]);
    expect(s.cacheHitRate).toBeCloseTo(2 / 3, 3);
  });

  it('reports no hit rate at all when nothing went through a cache', () => {
    expect(summarise([entry({ stage: 'writer', inputTokens: 5000 })]).cacheHitRate).toBe(0);
  });

  it('puts the split on the one glanceable line', () => {
    const out = formatSummary(summarise([entry({
      stage: 'writer', inputTokens: 1000, cacheReadTokens: 4000, costUsd: 0.01,
    })]));
    expect(out).toContain('uncached input');
    // the log reports the benefit against no caching; the hit rate stays in the record, because a
    // percentage of a prefix read is not the same question as whether the run was better off
    expect(out).toContain('vs no caching at all');
  });
});

/**
 * Christian, 2026-09-08: "Don't treat the saving as guaranteed per generation. An isolated
 * generation will pay the cache-write premium and get no read benefit."
 *
 * So the record must not report a hit rate and call it a benefit. A cold run is a real loss and has
 * to read as one; only the difference against what the same tokens would have cost uncached tells
 * the two apart.
 */
describe('did caching actually help this run', () => {
  const cat = 5412;   // the bank catalogue, the only block cached today

  it('shows an isolated generation as a LOSS, not as a 0% hit rate', () => {
    const cold = summarise([entry({
      stage: 'bank_card', inputTokens: 190, cacheCreationTokens: cat, outputTokens: 4,
      costUsd: costOf('claude-sonnet-5', {
        input_tokens: 190, cache_creation_input_tokens: cat, output_tokens: 4,
      }),
    })]);
    expect(cold.cacheCalls.cold).toBe(1);
    expect(cold.cacheSavingUsd).toBeLessThan(0);              // it cost us money
    expect(cold.uncachedEquivalentUsd).toBeLessThan(cold.totalCostUsd);
  });

  it('shows a second generation inside the window as a real saving', () => {
    const warm = summarise([entry({
      stage: 'bank_card', inputTokens: 190, cacheReadTokens: cat, outputTokens: 4,
      costUsd: costOf('claude-sonnet-5', {
        input_tokens: 190, cache_read_input_tokens: cat, output_tokens: 4,
      }),
    })]);
    expect(warm.cacheCalls.warm).toBe(1);
    expect(warm.cacheSavingUsd).toBeGreaterThan(0.009);       // ~a cent, as audited
  });

  it('prices the uncached baseline off ALL the input, not just the uncached part', () => {
    // input_tokens counts only what follows the breakpoint — the trap in Anthropic's own docs.
    expect(uncachedCostOf('claude-sonnet-5', {
      input_tokens: 190, cache_read_input_tokens: cat,
    })).toBeCloseTo((190 + cat) / 1e6 * 2, 8);
  });

  it('names what happened at the cache for each call', () => {
    expect(cacheStateOf({ cacheCreationTokens: 100, cacheReadTokens: 0 })).toBe('cold');
    expect(cacheStateOf({ cacheCreationTokens: 0, cacheReadTokens: 100 })).toBe('warm');
    expect(cacheStateOf({ cacheCreationTokens: 100, cacheReadTokens: 100 })).toBe('mixed');
    expect(cacheStateOf({ cacheCreationTokens: 0, cacheReadTokens: 0 })).toBe('none');
  });

  it('says SAVED or COST in words, so the log cannot be misread', () => {
    const cold = formatSummary(summarise([entry({
      stage: 'bank_card', cacheCreationTokens: cat,
      costUsd: costOf('claude-sonnet-5', { cache_creation_input_tokens: cat }),
    })]));
    expect(cold).toContain('caching COST');
    expect(cold).toContain('1 cold');
  });
});
