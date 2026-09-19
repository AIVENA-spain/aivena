import { describe, it, expect } from 'vitest';
import { runAgentLoop, type ModelResponse } from './agent-loop';
import { FakeBackends } from './golden/harness';

const say = (...texts: string[]): ModelResponse => ({
  content: texts.map((t) => ({ type: 'text' as const, text: t })),
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 10 },
});

function scripted(responses: ModelResponse[]) {
  const q = [...responses];
  return async () => {
    const next = q.shift();
    if (!next) throw new Error('scripted model exhausted');
    return next;
  };
}

describe('agent loop — the whole reply reaches the buyer (live demo 2026-08-28)', () => {
  it('joins EVERY text block of the final turn (the truncation that dropped two homes)', async () => {
    const r = await runAgentLoop(
      scripted([say(
        'Her er to boliger i Ciudad Quesada:\n1. Villa til 390.000 €\n2. Villa til 399.900 €',
        'Bare si ifra hva du tenker — begge ligger nær skolen.',
      )]),
      'full',
      new FakeBackends(),
      'system',
      'user',
    );
    expect(r.text).toContain('390.000');
    expect(r.text).toContain('399.900');
    expect(r.text).toContain('Bare si ifra');
  });

  it('a single text block is unchanged', async () => {
    const r = await runAgentLoop(scripted([say('Hei Marte!')]), 'full', new FakeBackends(), 's', 'u');
    expect(r.text).toBe('Hei Marte!');
  });

  it('a final turn with NO text returns null — never resurrects text written before the tools ran', async () => {
    const withTool: ModelResponse = {
      content: [
        { type: 'text', text: 'Let me look that up…' },
        { type: 'tool_use', id: 't1', name: 'get_area_info', input: { area: 'Quesada' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 10 },
    };
    const emptyFinal: ModelResponse = { content: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
    // The answer-now call (2026-09-19) also comes back empty.
    const r = await runAgentLoop(scripted([withTool, emptyFinal, emptyFinal]), 'full', new FakeBackends(), 's', 'u');
    expect(r.text).toBeNull();   // the orchestrator escalates rather than sending a stale pre-tool line
  });
});

describe('agent loop — never ends a worked turn without asking for the answer (live 2026-09-19)', () => {
  const lookup = (n: number): ModelResponse => ({
    content: [{ type: 'tool_use', id: `t${n}`, name: 'get_area_info', input: { area: `Quesada ${n}` } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 10 },
  });

  it('six lookups hit the cap: one tools-free call gets the answer from the gathered facts', async () => {
    const requests: Array<{ messages: unknown[]; tools: unknown[] }> = [];
    const q: ModelResponse[] = [lookup(1), lookup(2), lookup(3), lookup(4), lookup(5), lookup(6), say('Quesada has a lovely park.')];
    const call = async (req: { system: string; messages: unknown[]; tools: unknown[] }) => {
      requests.push({ messages: req.messages, tools: req.tools });
      const next = q.shift();
      if (!next) throw new Error('scripted model exhausted');
      return next;
    };
    const r = await runAgentLoop(call, 'full', new FakeBackends(), 's', 'u');
    expect(r.text).toBe('Quesada has a lovely park.');
    expect(r.toolEvents).toHaveLength(6);
    expect(r.iterations).toBe(7);
    const final = requests[6];
    expect(final.tools).toEqual([]);                                    // no tools offered
    const body = JSON.stringify(final.messages);
    expect(body).not.toMatch(/tool_use|tool_result/);                   // no tool blocks: the API would reject them
    expect(body).toContain('get_area_info');                            // the facts ride along as text
    expect(body).toContain('Do not promise to check');
  });

  it('a worked turn that ends with no text also gets one answer-now call', async () => {
    const r = await runAgentLoop(
      scripted([lookup(1), { content: [], stop_reason: 'end_turn', usage: {} }, say('Here is what I found.')]),
      'full', new FakeBackends(), 's', 'u',
    );
    expect(r.text).toBe('Here is what I found.');
  });

  it('at the cap, an empty answer-now returns null — never the half-sentence written before a lookup (live 12:45)', async () => {
    const fragmentThenLookup: ModelResponse = {
      content: [
        { type: 'text', text: 'Beklager, jeg vil bare være sikker på at jeg booker visning til riktig villa – kan du si' },
        { type: 'tool_use', id: 't0', name: 'search_properties', input: { cities: ['Ciudad Quesada'] } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 10 },
    };
    const empty: ModelResponse = { content: [], stop_reason: 'end_turn', usage: {} };
    const r = await runAgentLoop(
      scripted([fragmentThenLookup, lookup(2), lookup(3), lookup(4), lookup(5), lookup(6), empty]),
      'full', new FakeBackends(), 's', 'u',
    );
    expect(r.iterations).toBe(7);
    expect(r.text).toBeNull();
  });

  it('a turn with no lookups that ends silent is NOT given a second call', async () => {
    const r = await runAgentLoop(scripted([{ content: [], stop_reason: 'end_turn', usage: {} }]), 'full', new FakeBackends(), 's', 'u');
    expect(r.text).toBeNull();
    expect(r.iterations).toBe(1);
  });
});
