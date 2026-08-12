import { sql } from 'drizzle-orm';
import { db } from '../../../../packages/db/client';
import {
  buildGroundedPrompt, buildVerifierPrompt, parseLlmAnswer, parseVerdict, passesGroundingGuard,
  ANTHROPIC_URL, DEFAULT_MODEL, VERIFIER_MODEL, ANSWER_TIMEOUT_MS, VERIFIER_TIMEOUT_MS,
  type ListingForLlm, type LlmAnswer,
} from './amanda-llm-lib';

/** Amanda Phase D — the network/key side (see amanda-llm-lib.ts for the rules). */
export type { ListingForLlm, LlmAnswer } from './amanda-llm-lib';

// ── Key resolution — VAULT-FIRST, cached with periodic re-check ──────────────
// The deliberate Amanda key lives in the Supabase Vault (ANTHROPIC_API_KEY secret,
// read via the single-purpose _get_amanda_llm_key()). We do NOT read the generic
// process.env.ANTHROPIC_API_KEY — Railway already carries a platform-wide one (for
// Studio) that collided with Amanda and shadowed the vault key. An Amanda-specific
// env var can still override for local/testing without colliding.
let cachedKey: string | null | undefined;
let cachedAt = 0;
async function getLlmKey(): Promise<string | null> {
  if (process.env.AMANDA_LLM_DISABLED === 'true') return null;
  const override = process.env.AMANDA_ANTHROPIC_API_KEY?.trim();
  if (override) return override;
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

/** One Anthropic call with its own timeout. Returns the first text block, or null.
 *  NO `temperature` — Claude Sonnet 5 / Opus 5 reject any non-default sampling
 *  param with a 400. `disableThinking` keeps the whole max_tokens budget for the
 *  answer (adaptive thinking would otherwise eat it) — accepted on Sonnet 5; the
 *  verifier (Haiku) omits it, since Haiku doesn't think by default. */
async function callClaude(
  key: string,
  model: string,
  system: string,
  user: string,
  timeoutMs: number,
  disableThinking: boolean,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body: Record<string, unknown> = {
      model,
      max_tokens: 512,
      system,
      messages: [{ role: 'user', content: user }],
    };
    if (disableThinking) body.thinking = { type: 'disabled' };
    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      console.error('[amanda-llm] api error:', resp.status, detail.slice(0, 200));
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
 * The ANSWER call — Sonnet 5 with the server-side web_search tool so Amanda can
 * research the AREA before answering. Adaptive thinking is left ON (omitted): with
 * thinking disabled, Sonnet 5 can emit a tool call as plain text and the search
 * never runs. Handles pause_turn (server hit the tool-loop cap) by resuming, and
 * returns the FINAL text block (after any search results). Its own long timeout.
 */
async function callClaudeAnswer(key: string, model: string, system: string, user: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANSWER_TIMEOUT_MS);
  try {
    let messages: Array<{ role: string; content: unknown }> = [{ role: 'user', content: user }];
    for (let i = 0; i < 3; i++) {
      const resp = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system,
          messages,
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
        }),
      });
      if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        console.error('[amanda-llm] answer api error:', resp.status, detail.slice(0, 200));
        return null;
      }
      const data = (await resp.json()) as { stop_reason?: string; content?: Array<{ type: string; text?: string }> };
      if (data.stop_reason === 'pause_turn' && data.content) {
        // Server paused mid-tool-loop — resume by echoing the assistant turn back.
        messages = [{ role: 'user', content: user }, { role: 'assistant', content: data.content }];
        continue;
      }
      const texts = (data.content ?? []).filter((c) => c.type === 'text' && typeof c.text === 'string');
      return texts.length ? (texts[texts.length - 1].text as string) : null;   // the final answer, after any search
    }
    return null;
  } catch (err) {
    console.error('[amanda-llm] answer call failed:', err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Warm agent answer about ONE listing (property facts grounded in DATA; area/
 * lifestyle from general local knowledge, web-researched when helpful). Two safety
 * gates protect against invented PROPERTY facts before the text is shown:
 *   (1) deterministic guard — output safety + property-fact numeric grounding;
 *   (2) independent verifier — no invented property-specific claim (area talk OK).
 * Any failure / missing key → {ok:false} and the caller uses the deterministic reply.
 */
export async function groundedListingAnswer(args: {
  agencyName: string;
  listing: ListingForLlm;
  question: string;
  lang: string | undefined;
}): Promise<LlmAnswer> {
  const key = await getLlmKey();
  if (!key) return { ok: false };

  const { system, user } = buildGroundedPrompt(args);
  const answerModel = process.env.AMANDA_LLM_MODEL?.trim() || DEFAULT_MODEL;
  const rawAnswer = await callClaudeAnswer(key, answerModel, system, user);
  if (rawAnswer === null) return { ok: false };
  const parsed = parseLlmAnswer(rawAnswer);
  if (!parsed) return { ok: false };

  // Gate 1 — deterministic: no unsafe output, no invented property-fact numbers.
  if (!passesGroundingGuard(parsed.answer, args.listing)) {
    console.error('[amanda-llm] deterministic guard rejected an answer');
    return { ok: false };
  }

  // Gate 2 — independent verifier: no invented PROPERTY-specific fact (area OK).
  const verifierModel = process.env.AMANDA_VERIFIER_MODEL?.trim() || VERIFIER_MODEL;
  const vp = buildVerifierPrompt({ listing: args.listing, answer: parsed.answer });
  const rawVerdict = await callClaude(key, verifierModel, vp.system, vp.user, VERIFIER_TIMEOUT_MS, false);
  if (rawVerdict === null || !parseVerdict(rawVerdict)) {
    console.error('[amanda-llm] verifier rejected or was unavailable');
    return { ok: false };
  }

  return { ok: true, answer: parsed.answer, needsTeam: parsed.needsTeam };
}
