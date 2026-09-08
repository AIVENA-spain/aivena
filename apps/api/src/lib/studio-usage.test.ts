import { describe, expect, it } from 'vitest';
import { PRICES, costOf, formatSummary, summarise, type UsageEntry } from './studio-usage';

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
