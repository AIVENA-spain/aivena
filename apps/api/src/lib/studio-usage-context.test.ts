import { describe, expect, it } from 'vitest';
import { currentEntries, recordUsage, summarise, withUsage } from './studio-usage';

/**
 * The collector rides on AsyncLocalStorage so that thirty-eight call sites across two files can
 * record without anything being threaded through by hand. That only works if the context survives
 * the shapes the generation actually uses: deep awaits, Promise.all fan-out, a fire-and-forget
 * caller, and a call that throws. If it does not, the next real generation produces an empty record
 * and the baseline is wasted.
 */
const sonnet = 'claude-sonnet-5';
const call = async (stage: string, input: number) => {
  await new Promise((r) => setTimeout(r, 1));
  recordUsage(stage, sonnet, { input_tokens: input, output_tokens: 100 }, 5);
};

describe('the usage collector survives the shapes a generation actually uses', () => {
  it('records from a nested async call several levels down', async () => {
    const s = await withUsage('gen-1', async () => {
      const outer = async () => {
        const middle = async () => { await call('writer', 1000); };
        await middle();
      };
      await outer();
      return summarise(currentEntries(), 'gen-1');
    });
    expect(s.calls).toBe(1);
    expect(s.byStage[0].stage).toBe('writer');
  });

  // Fact extraction fans twelve pages out at once — the whole biggest-cost stage.
  it('records every branch of a Promise.all fan-out', async () => {
    const s = await withUsage('gen-2', async () => {
      await Promise.all(Array.from({ length: 12 }, (_, i) => call(`source facts S${i + 1}`, 5000)));
      return summarise(currentEntries(), 'gen-2');
    });
    expect(s.calls).toBe(12);
    expect(s.inputTokens).toBe(60_000);
  });

  it('keeps what was already spent when a later call throws', async () => {
    const s = await withUsage('gen-3', async () => {
      await call('writer', 1000);
      await expect((async () => {
        await call('editor', 500);
        throw new Error('editor blew up');
      })()).rejects.toThrow('editor blew up');
      return summarise(currentEntries(), 'gen-3');
    });
    expect(s.calls).toBe(2);
  });

  // The wizard starts the generation with `void withUsage(...)` and returns to the browser at once.
  it('records inside a fire-and-forget generation', async () => {
    let seen = 0;
    await new Promise<void>((resolve) => {
      void withUsage('gen-4', async () => {
        await call('research', 2000);
        seen = summarise(currentEntries(), 'gen-4').calls;
        resolve();
      });
    });
    expect(seen).toBe(1);
  });

  it('keeps two concurrent generations apart', async () => {
    const [a, b] = await Promise.all([
      withUsage('gen-a', async () => { await call('writer', 1000); return summarise(currentEntries(), 'gen-a'); }),
      withUsage('gen-b', async () => {
        await Promise.all([call('writer', 1000), call('editor', 1000)]);
        return summarise(currentEntries(), 'gen-b');
      }),
    ]);
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(2);
  });

  // A call site outside a generation must never throw — most of them do not know they are measured.
  it('does nothing at all outside a generation', () => {
    expect(() => recordUsage('stray', sonnet, { input_tokens: 10 }, 1)).not.toThrow();
    expect(currentEntries()).toEqual([]);
  });
});
