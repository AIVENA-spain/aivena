/**
 * The one AI step: ask Claude Haiku 4.5 for the facts. Uses the SERVER's key through the same path as Amanda
 * (getLlmKey, passed in by the caller, so this module never touches the database). The key goes only into the request
 * header to Anthropic: it is never logged, returned or stored.
 */
import { invalidValues } from './evidence';
import { SYSTEM_PROMPT, buildUserContent, maxOutputTokens } from './prompt';
import type { Facts, ScoringInput } from './types';

export const SCORING_MODEL = 'claude-haiku-4-5-20251001';
/** Anthropic's list price for Claude Haiku 4.5, USD per million tokens (checked on Anthropic's pricing page, 2026-09-11). */
export const PRICE_IN_PER_MTOK = 1;
export const PRICE_OUT_PER_MTOK = 5;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export type ModelRequest = { system: string; user: string; maxTokens: number };
export type ModelResponse = {
  status: number;
  body: {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    stop_reason?: string | null;
    error?: { type?: string };
  };
};
export type ModelCall = (req: ModelRequest) => Promise<ModelResponse>;

export function anthropicCaller(getKey: () => Promise<string | null>, timeoutMs = 45_000): ModelCall {
  return async ({ system, user, maxTokens }) => {
    const key = await getKey();
    if (!key) return { status: 503, body: { error: { type: 'ai_key_unavailable' } } };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: SCORING_MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      });
      const body = (await resp.json().catch(() => ({}))) as ModelResponse['body'];
      return { status: resp.status, body };
    } catch {
      return { status: 599, body: { error: { type: controller.signal.aborted ? 'timeout' : 'network_error' } } };
    } finally {
      clearTimeout(timer);
    }
  };
}

export const costUsd = (inputTokens: number, outputTokens: number): number =>
  (inputTokens * PRICE_IN_PER_MTOK + outputTokens * PRICE_OUT_PER_MTOK) / 1e6;

/** Worst case for one call: a token per 2.5 characters (real text is nearer 3.5–4) plus the whole output budget. */
export function worstCaseCostUsd(input: ScoringInput): number {
  const chars = SYSTEM_PROMPT.length + buildUserContent(input).length;
  return costUsd(Math.ceil(chars / 2.5), maxOutputTokens(input));
}

/** One JSON object: code fences stripped, the outermost braces taken. Anything else is not an answer. */
export function parseAnswer(text: string): Facts | null {
  const t = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const v: unknown = JSON.parse(t.slice(a, b + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Facts) : null;
  } catch {
    return null;
  }
}

type Usage = { inputTokens: number; outputTokens: number; costUsd: number; stopReason: string | null };
export type Extracted = (Usage & { ok: true; facts: Facts }) | (Usage & { ok: false; error: string });

export async function extractFacts(input: ScoringInput, call: ModelCall): Promise<Extracted> {
  const res = await call({ system: SYSTEM_PROMPT, user: buildUserContent(input), maxTokens: maxOutputTokens(input) });
  const inputTokens = res.body.usage?.input_tokens ?? 0;
  const outputTokens = res.body.usage?.output_tokens ?? 0;
  const usage: Usage = { inputTokens, outputTokens, costUsd: costUsd(inputTokens, outputTokens), stopReason: res.body.stop_reason ?? null };
  if (res.status !== 200) {
    return { ok: false, error: `model call failed (${res.status}${res.body.error?.type ? `: ${res.body.error.type}` : ''})`, ...usage };
  }
  // A cut-off answer is never read (practice run 1: the long Norwegian conversation stopped mid-answer).
  if (res.body.stop_reason === 'max_tokens') return { ok: false, error: 'answer was cut off, so it was not read', ...usage };
  const facts = parseAnswer((res.body.content ?? []).map((c) => c.text ?? '').join('').trim());
  if (!facts) return { ok: false, error: 'answer was not valid JSON', ...usage };
  const bad = invalidValues(facts);
  if (bad.length) return { ok: false, error: `answer not used, invalid value(s): ${bad.join(', ')}`, ...usage };
  return { ok: true, facts, ...usage };
}
