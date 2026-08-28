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
    const r = await runAgentLoop(scripted([withTool, emptyFinal]), 'full', new FakeBackends(), 's', 'u');
    expect(r.text).toBeNull();   // the orchestrator escalates rather than sending a stale pre-tool line
  });
});
