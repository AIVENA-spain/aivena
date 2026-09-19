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

/**
 * The last word when the loop ends WITHOUT a reply (live 2026-09-19: six
 * read-only lookups, the cap was reached, no text — the buyer got silence and
 * the turn escalated as "empty_draft"). One more call, with NO tools and NO tool
 * blocks (the API rejects tool_use/tool_result blocks when no tools are
 * defined): the facts gathered this turn are handed over as text and the model
 * answers now. It is still judged by every gate in the orchestrator, against the
 * same tool events, so nothing ungrounded gets through that way.
 */
export const ANSWER_NOW_INSTRUCTION =
  'You have used all your lookups for this message. Reply to the buyer NOW, in their language, using ONLY the facts above. ' +
  'If viewing times were proposed, list every one with its day. Never make up a fact, price, date or time. ' +
  'Do not call tools. Do not promise to check, confirm or come back later. ' +
  'If these facts do not let you answer safely, output nothing at all — a colleague will be asked instead.';

async function answerNow(
  callModel: ModelCall,
  system: string,
  userContext: string,
  toolEvents: ToolEvent[],
): Promise<ModelResponse> {
  let budget = 8000;
  const facts: string[] = [];
  for (const ev of toolEvents) {
    if (!ev.result.ok || ev.result.refused) continue;
    const line = `${ev.tool}: ${JSON.stringify(ev.result.data ?? null)}`.slice(0, 2000);
    if (line.length > budget) break;
    budget -= line.length;
    facts.push(line);
  }
  return callModel({
    system,
    messages: [{
      role: 'user',
      content: `${userContext}\n\n[Facts from your lookups for this message]\n${facts.join('\n') || '(none)'}\n\n${ANSWER_NOW_INSTRUCTION}`,
    }],
    tools: [],
  });
}

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
  const joinText = (r: ModelResponse): string | null =>
    r.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => (b.text ?? '').trim())
      .filter((t) => t.length > 0)
      .join('\n\n') || null;

  const addUsage = (r: ModelResponse) => {
    usage.inputTokens += r.usage?.input_tokens ?? 0;
    usage.outputTokens += r.usage?.output_tokens ?? 0;
    usage.cacheReadTokens += r.usage?.cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens += r.usage?.cache_creation_input_tokens ?? 0;
  };

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    const resp = await callModel({ system, messages, tools });
    addUsage(resp);

    // The reply is EVERY text block of the turn, joined — not just the last
    // one. A model that writes "here are two homes: 1)… 2)…" and then a
    // closing line emits TWO text blocks; keeping only the last shipped the
    // closing line alone and the buyer got "both homes are right by the
    // school" with no homes (live demo 2026-08-28). Blocks are joined in
    // order; blank ones dropped.
    const turnText = joinText(resp);

    const toolUses = resp.content.filter((b) => b.type === 'tool_use' && b.name && b.id);
    if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) {
      // Final turn: the reply is THIS turn's text. Never fall back to text the
      // model wrote before its tools ran — that text predates the facts.
      if (turnText || toolEvents.length === 0) {
        return { text: turnText, toolEvents, cannotAnswer, handedOff, usage, iterations: i };
      }
      // It stopped after doing real work but wrote nothing: ask for the answer.
      const last = await answerNow(callModel, system, userContext, toolEvents);
      addUsage(last);
      return { text: joinText(last), toolEvents, cannotAnswer, handedOff, usage, iterations: i + 1 };
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
  // Loop cap reached with tools still pending: one tools-free call for the
  // answer (see answerNow). If even that yields nothing, the orchestrator
  // escalates as empty_draft and sends the holding line (fail closed, never
  // silent). NEVER fall back to text written in an earlier round: it was
  // written BEFORE the lookups that followed it, and it can stop mid-sentence
  // where the model broke off to call a tool (live 2026-09-19 12:45, sent to
  // the buyer: "…til riktig villa – kan du si").
  const last = await answerNow(callModel, system, userContext, toolEvents);
  addUsage(last);
  return { text: joinText(last), toolEvents, cannotAnswer, handedOff, usage, iterations: MAX_ITERATIONS + 1 };
}
