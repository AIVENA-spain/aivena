// Amanda engine — the agentic tool loop (design §1: "agentic tool loop per
// turn, not single-shot drafting"). The model caller is INJECTED so the whole
// loop runs scripted in tests and golden scenarios; the production caller
// (llm.ts) wires it to the Anthropic API with the vault-first key.

import { executeToolCall, TOOL_SPECS, type ToolBackends, type ToolEvent } from './tools';
import type { AmandaMode } from './modes';

export interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface ModelResponse {
  content: ContentBlock[];
  stop_reason: string | null;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

export type ModelCall = (req: {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>;
  tools: Array<Record<string, unknown>>;
}) => Promise<ModelResponse>;

export interface LoopResult {
  text: string | null;                 // the drafted reply (ALL text blocks of the final turn, joined)
  toolEvents: ToolEvent[];
  cannotAnswer: string | null;         // reason, when the model declared abstention
  handedOff: boolean;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  iterations: number;
}

const MAX_ITERATIONS = 6;

export async function runAgentLoop(
  callModel: ModelCall,
  mode: AmandaMode,
  backends: ToolBackends,
  system: string,
  userContext: string,
): Promise<LoopResult> {
  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
    { role: 'user', content: userContext },
  ];
  const tools = TOOL_SPECS.map((t) => t.schema);
  const toolEvents: ToolEvent[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let cannotAnswer: string | null = null;
  let handedOff = false;
  let lastText: string | null = null;
  const joinText = (r: ModelResponse): string | null =>
    r.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => (b.text ?? '').trim())
      .filter((t) => t.length > 0)
      .join('\n\n') || null;

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    const resp = await callModel({ system, messages, tools });
    usage.inputTokens += resp.usage?.input_tokens ?? 0;
    usage.outputTokens += resp.usage?.output_tokens ?? 0;
    usage.cacheReadTokens += resp.usage?.cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens += resp.usage?.cache_creation_input_tokens ?? 0;

    // The reply is EVERY text block of the turn, joined — not just the last
    // one. A model that writes "here are two homes: 1)… 2)…" and then a
    // closing line emits TWO text blocks; keeping only the last shipped the
    // closing line alone and the buyer got "both homes are right by the
    // school" with no homes (live demo 2026-08-28). Blocks are joined in
    // order; blank ones dropped.
    const turnText = joinText(resp);
    if (turnText) lastText = turnText;

    const toolUses = resp.content.filter((b) => b.type === 'tool_use' && b.name && b.id);
    if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) {
      // Final turn: the reply is THIS turn's text. Never fall back to text the
      // model wrote before its tools ran — that text predates the facts.
      return { text: turnText, toolEvents, cannotAnswer, handedOff, usage, iterations: i };
    }

    const resultBlocks: Array<Record<string, unknown>> = [];
    for (const tu of toolUses) {
      const ev = await executeToolCall(mode, backends, tu.name as string, (tu.input ?? {}) as Record<string, unknown>);
      toolEvents.push(ev);
      if (tu.name === 'cannot_answer') cannotAnswer = String((tu.input as Record<string, unknown>)?.reason ?? 'unspecified');
      if (tu.name === 'handoff_to_human' && ev.result.ok && !ev.result.simulated) handedOff = true;
      resultBlocks.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(ev.result.refused ? { error: ev.result.refused } : ev.result.data ?? null).slice(0, 6000),
        is_error: Boolean(ev.result.refused),
      });
    }
    messages.push({ role: 'assistant', content: resp.content });
    messages.push({ role: 'user', content: resultBlocks });
  }
  // Loop cap reached with tools still pending — return what we have; the
  // orchestrator treats a missing final text as a gate failure (fail closed).
  return { text: lastText, toolEvents, cannotAnswer, handedOff, usage, iterations: MAX_ITERATIONS };
}
