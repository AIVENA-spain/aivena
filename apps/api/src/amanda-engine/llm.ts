// Amanda engine — production model callers. The agentic caller feeds
// agent-loop.ts (client tools passthrough, prompt caching on the system block);
// the verifier is the independent Haiku fact-checker over the tool data the
// model actually fetched this turn (design §2 gate 3). Key = the same
// vault-first resolution as web-Amanda.

import { getLlmKey } from '../routes/amanda-llm';
import { extractJsonObject } from '../routes/amanda-llm-lib';
import type { ModelCall, ModelResponse } from './agent-loop';
import type { Verifier } from './gates';
import type { ToolEvent } from './tools';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ENGINE_MODEL = () => process.env.AMANDA_ENGINE_MODEL?.trim() || 'claude-sonnet-5';
export const ENGINE_VERIFIER_MODEL = () => process.env.AMANDA_ENGINE_VERIFIER_MODEL?.trim() || 'claude-haiku-4-5-20251001';
const CALL_TIMEOUT_MS = 45_000;
const VERIFIER_TIMEOUT_MS = 8_000;

async function anthropicCall(body: Record<string, unknown>, timeoutMs: number): Promise<ModelResponse> {
  const key = await getLlmKey();
  if (!key) throw new Error('amanda_llm_key_unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`anthropic_${resp.status}:${detail.slice(0, 160)}`);
    }
    return (await resp.json()) as ModelResponse;
  } finally {
    clearTimeout(timer);
  }
}

/** The production agentic caller. System block is cache-marked (§7 prompt
 *  caching); NO temperature (Sonnet 5 rejects non-default sampling params). */
export const productionModelCall: ModelCall = async ({ system, messages, tools }) => {
  return anthropicCall({
    model: ENGINE_MODEL(),
    max_tokens: 1200,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
    ...(tools.length ? { tools } : {}),
  }, CALL_TIMEOUT_MS);
};

/** Independent verifier: given the draft + everything fetched this turn, does
 *  the draft assert a property-specific fact the data doesn't support? Area/
 *  lifestyle talk and scheduling chatter are allowed. Unparseable → false
 *  (the gate layer treats false/throw as BLOCK — fail closed). */
export const productionVerifier: Verifier = async (draft: string, toolEvents: ToolEvent[]) => {
  const corpus = toolEvents
    .filter((ev) => !ev.result.refused && ev.result.data != null)
    .map((ev) => `${ev.tool}: ${JSON.stringify(ev.result.data).slice(0, 4000)}`)
    .join('\n');
  const system = [
    'You are a strict fact-checker for a real-estate assistant chatting on WhatsApp.',
    'You get DATA (tool results the assistant fetched) and its proposed ANSWER to the buyer.',
    'Your ONLY question: does ANSWER state a SPECIFIC PROPERTY FACT (price, size, rooms, features, availability, rules of a specific unit) that is NOT supported by DATA?',
    'Allowed without support: pleasantries; viewing invitations; scheduling chatter and times; general area/lifestyle statements; saying it will check with the office.',
    'Output ONLY JSON: {"supported": boolean}',
  ].join('\n');
  const resp = await anthropicCall({
    model: ENGINE_VERIFIER_MODEL(),
    max_tokens: 128,
    system,
    messages: [{ role: 'user', content: `<data>\n${corpus || '(no tool data fetched)'}\n</data>\n<answer>\n${draft.replace(/[<>]/g, ' ')}\n</answer>` }],
  }, VERIFIER_TIMEOUT_MS);
  const text = resp.content.find((b) => b.type === 'text')?.text ?? '';
  const obj = extractJsonObject(text);
  if (!obj) return false;
  try {
    return (JSON.parse(obj) as { supported?: unknown }).supported === true;
  } catch {
    return false;
  }
};
