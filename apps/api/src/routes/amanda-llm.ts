import { sql } from 'drizzle-orm';
import { db } from '../../../../packages/db/client';
import {
  buildGroundedPrompt, parseLlmAnswer, passesGroundingGuard,
  ANTHROPIC_URL, DEFAULT_MODEL, TIMEOUT_MS,
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

/** Grounded answer about ONE listing. Any problem → {ok:false} (caller falls back
 *  to the deterministic reply — the visitor never sees an error). */
export async function groundedListingAnswer(args: {
  agencyName: string;
  listing: ListingForLlm;
  question: string;
  lang: string | undefined;
}): Promise<LlmAnswer> {
  const key = await getLlmKey();
  if (!key) return { ok: false };
  const { system, user } = buildGroundedPrompt(args);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.AMANDA_LLM_MODEL?.trim() || DEFAULT_MODEL,
        max_tokens: 300,
        temperature: 0.2,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!resp.ok) {
      console.error('[amanda-llm] api error:', resp.status);
      return { ok: false };
    }
    const data = (await resp.json()) as { content?: Array<{ type: string; text?: string }>; usage?: unknown };
    const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
    const parsed = parseLlmAnswer(text);
    if (!parsed || !parsed.grounded || parsed.needsTeam || !parsed.answer) return { ok: false };
    if (!passesGroundingGuard(parsed.answer, args.listing)) {
      console.error('[amanda-llm] grounding guard rejected an answer');
      return { ok: false };
    }
    return { ok: true, answer: parsed.answer };
  } catch (err) {
    console.error('[amanda-llm] call failed:', err instanceof Error ? err.message : String(err));
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}
