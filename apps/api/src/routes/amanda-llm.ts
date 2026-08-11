import { sql } from 'drizzle-orm';
import { db } from '../../../../packages/db/client';
import {
  buildGroundedPrompt, buildVerifierPrompt, parseLlmAnswer, parseVerdict, passesGroundingGuard,
  ANTHROPIC_URL, DEFAULT_MODEL, VERIFIER_MODEL, TIMEOUT_MS, VERIFIER_TIMEOUT_MS,
  type ListingForLlm, type LlmAnswer,
} from './amanda-llm-lib';

/** Amanda Phase D — the network/key side (see amanda-llm-lib.ts for the rules). */
export type { ListingForLlm, LlmAnswer } from './amanda-llm-lib';

// ── Key resolution (env → vault RPC), cached with periodic re-check ──────────
let cachedKey: string | null | undefined;
let cachedAt = 0;
async function getLlmKey(): Promise<string | null> {
  if (process.env.AMANDA_LLM_DISABLED === 'true') return null;
  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (envKey) return envKey;
  const now = Date.now();
  if (cachedKey !== undefined && now - cachedAt < 5 * 60_000) return cachedKey;
  try {
    const res = await db.execute(sql`SELECT public._get_amanda_llm_key() AS k`);
    const k = (res as unknown as Array<{ k: string | null }>)[0]?.k ?? null;
    cachedKey = k && k.trim() ? k.trim() : null;
  } catch {
    cachedKey = null;
  }
  cachedAt = now;
  return cachedKey;
}

/** One Anthropic call with its own timeout. Returns the first text block, or null. */
async function callClaude(
  key: string,
  model: string,
  system: string,
  user: string,
  timeoutMs: number,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 300, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!resp.ok) {
      console.error('[amanda-llm] api error:', resp.status);
      return null;
    }
    const data = (await resp.json()) as { content?: Array<{ type: string; text?: string }> };
    return data.content?.find((c) => c.type === 'text')?.text ?? null;
  } catch (err) {
    console.error('[amanda-llm] call failed:', err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Grounded answer about ONE listing. Passes THREE gates before returning text:
 *   (1) model self-report grounded/non-team/non-empty, (2) deterministic guard
 *   (output safety + numeric grounding), (3) independent verifier fact-check.
 * Any miss → {ok:false} and the caller uses the deterministic honest reply.
 */
export async function groundedListingAnswer(args: {
  agencyName: string;
  listing: ListingForLlm;
  question: string;
  lang: string | undefined;
}): Promise<LlmAnswer> {
  const key = await getLlmKey();
  if (!key) return { ok: false };

  // Gate 1 — answer + structured self-report.
  const { system, user } = buildGroundedPrompt(args);
  const answerModel = process.env.AMANDA_LLM_MODEL?.trim() || DEFAULT_MODEL;
  const rawAnswer = await callClaude(key, answerModel, system, user, TIMEOUT_MS);
  if (rawAnswer === null) return { ok: false };
  const parsed = parseLlmAnswer(rawAnswer);
  if (!parsed || !parsed.grounded || parsed.needsTeam || !parsed.answer) return { ok: false };

  // Gate 2 — deterministic: no unsafe output, no ungrounded numbers.
  if (!passesGroundingGuard(parsed.answer, args.listing)) {
    console.error('[amanda-llm] deterministic guard rejected an answer');
    return { ok: false };
  }

  // Gate 3 — independent verifier: is EVERY property claim supported by the data?
  const verifierModel = process.env.AMANDA_VERIFIER_MODEL?.trim() || VERIFIER_MODEL;
  const vp = buildVerifierPrompt({ listing: args.listing, answer: parsed.answer });
  const rawVerdict = await callClaude(key, verifierModel, vp.system, vp.user, VERIFIER_TIMEOUT_MS);
  if (rawVerdict === null || !parseVerdict(rawVerdict)) {
    console.error('[amanda-llm] verifier rejected or was unavailable');
    return { ok: false };
  }

  return { ok: true, answer: parsed.answer };
}
