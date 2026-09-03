/**
 * THE FACTUAL GATE THAT RUNS AFTER THE WRITER.
 *
 * Christian, 2026-09-03: "Connecting never_assume to the prompt is necessary, but it is NOT
 * sufficient. The writer can invent a new factual sentence that is not literally listed in a bank
 * guardrail. I want the FINAL generated text inspected for factual assertions before it can publish."
 *
 * He is right, and a live six-post run proved it: the writer published a legal claim its own bank
 * card forbids in as many words, and a claim about market commission that no source establishes.
 * Prompt-side guardrails cannot catch what they did not anticipate. Reading the finished draft can.
 *
 * THE ONE RULE THAT GOVERNS EVERYTHING HERE — also his: "Do NOT solve this by dumping citations or
 * caveats into the finished Instagram post. Research and validation stay invisible. If a claim
 * fails: remove it, rewrite it truthfully, or find a different truthful argument. The customer sees
 * confident marketing, not our compliance machinery." A gate that makes the copy timid has failed,
 * even when every sentence it leaves behind is true.
 *
 * And the second rule: this is NOT a puffery police. "Buyers scroll fast and judge in seconds" is
 * not a claim to be sourced. Only genuine external assertions are policed; persuasion is left alone.
 */
import { env } from '../../../../packages/config/env';

import {
  dropSentence, endsMidThought, gateField, planFields, readField, writeField,
  type GateHit, type PlanLike,
} from './studio-copy-gate';

/** Policed: an external assertion a reader could act on and find false. */
export const POLICED_TYPES = ['FACTUAL_MATERIAL', 'TIME_SENSITIVE_FACT', 'AGENCY_FACT',
  'LOCAL_FACT', 'CAUSAL_INFERENCE', 'QUANTIFIED_CLAIM', 'LEGAL_CONSEQUENCE'] as const;
/** Left alone: this is where the post earns its living. */
export const ALLOWED_TYPES = ['MARKETING_PUFFERY', 'OPINION_POSITIONING', 'CREATIVE_HOOK',
  'HYPOTHETICAL'] as const;

export type ClaimType = (typeof POLICED_TYPES)[number] | (typeof ALLOWED_TYPES)[number];
export type Verdict = 'SUPPORTED' | 'SUPPORTED_WITH_NUANCE' | 'UNSUPPORTED'
  | 'CONTRADICTS_GUARDRAIL' | 'REQUIRES_FRESH_RESEARCH' | 'REQUIRES_AGENCY_EVIDENCE';

const PUBLISHABLE = new Set<Verdict>(['SUPPORTED', 'SUPPORTED_WITH_NUANCE']);

export interface ExtractedClaim { field: string; text: string; type: ClaimType }
export interface ClaimVerdict extends ExtractedClaim {
  verdict: Verdict;
  /** what is wrong, phrased so a repair can act on it. Internal — never printed. */
  problem?: string;
  /** for SUPPORTED_WITH_NUANCE: the true, still-confident wording */
  rewrite?: string;
}

export interface GateContext {
  language: string;
  topic: string;
  /** what THIS generation's research established; empty means research failed or never ran */
  research: string;
  /** the matched bank card's rules, already rendered; empty when no card governs the topic */
  cardRules: string;
  /** the facts the agency itself supplied */
  agencyEvidence: string;
}

export interface GateReport {
  claims: number;
  policed: number;
  verdicts: Record<string, number>;
  /** every claim that could not publish, with what happened to it */
  blocked: Array<{ field: string; text: string; verdict: string; problem: string; outcome: string }>;
  deterministic: Array<{ field: string; rule: string; severity: string; sentence: string }>;
  repairs: number;
  dropped: number;
  /** set when a step failed and the gate ran degraded rather than blocking the post */
  degraded: string | null;
}

// A gate step that fails silently is the bug this whole layer exists to fix. Every failure path
// says which one it was, so a degraded run is never mistaken for a clean one.
async function callTool(
  label: string, system: string, user: string, tool: Record<string, unknown>,
  ms: number, maxTokens = 8000,
): Promise<Record<string, unknown> | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  const why = (reason: string) => {
    console.warn(`[studio/gate] ${label} unavailable — ${reason}`);
    return null;
  };
  try {
    let last = 'no attempt completed';
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: ctl.signal,
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-5', max_tokens: maxTokens, system,
          tools: [tool], tool_choice: { type: 'tool', name: tool.name },
          messages: [{ role: 'user', content: user }],
        }),
      });
      if (!res.ok) {
        last = `http_${res.status}: ${(await res.text()).slice(0, 200)}`;
        if (res.status >= 500 || res.status === 429) continue;
        return why(last);
      }
      const data = await res.json() as {
        stop_reason?: string; content?: { type: string; input?: unknown }[];
      };
      const found = data.content?.find((c) => c.type === 'tool_use')?.input;
      if (found && typeof found === 'object') return found as Record<string, unknown>;
      last = `no tool_use in response (stop_reason=${data.stop_reason ?? 'unknown'})`;
      // A truncated tool call means the output did not fit. Retrying identically cannot help.
      if (data.stop_reason === 'max_tokens') return why(`${last} — raise max_tokens`);
    }
    return why(last);
  } catch (err) {
    const aborted = (err as { name?: string })?.name === 'AbortError';
    return why(aborted ? `timed out after ${ms}ms` : `network error: ${(err as Error)?.message}`);
  } finally { clearTimeout(timer); }
}


/**
 * Read a list out of a tool result, tolerating the model's favourite quirk.
 *
 * It frequently returns the array as a JSON STRING — sometimes wrapping the whole payload again, so
 * `claims` arrives as "{\"claims\": [...]}". Every extraction call in the first live run came back
 * this way, which made `Array.isArray` false and the whole gate report "unavailable" on six posts
 * out of six. The planner in studio-carousel-plan.ts already self-heals shape quirks rather than
 * burning a generation on them; this does the same.
 */
function coerceList(raw: unknown, key: string): Record<string, unknown>[] | null {
  let v: unknown = raw;
  for (let i = 0; i < 4; i++) {
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch { return null; }
      continue;
    }
    if (v && typeof v === 'object' && !Array.isArray(v) && key in (v as Record<string, unknown>)) {
      v = (v as Record<string, unknown>)[key];
      continue;
    }
    break;
  }
  return Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    : null;
}

/* ── 1. EXTRACT ──────────────────────────────────────────────────────────────────────────── */

const EXTRACT_TOOL = {
  name: 'submit_claims',
  description: 'Return every sentence of the draft, classified.',
  input_schema: {
    type: 'object',
    required: ['claims'],
    properties: {
      claims: {
        type: 'array',
        items: {
          type: 'object',
          required: ['field', 'text', 'type'],
          properties: {
            field: { type: 'string', description: 'the exact field address given to you, verbatim' },
            text: { type: 'string', description: 'the sentence, verbatim from the draft' },
            type: { type: 'string', enum: [...POLICED_TYPES, ...ALLOWED_TYPES] },
          },
        },
      },
    },
  },
};

const EXTRACT_SYSTEM = `You sort the sentences of a finished social post into two piles: assertions
about the outside world, and everything else.

THE SEVEN TYPES YOU POLICE — an external assertion a reader could act on and discover was false:
· FACTUAL_MATERIAL — how something works, what a process involves, what a document does.
· TIME_SENSITIVE_FACT — anything that was true on a date and may not be now: rates, prices,
  transaction counts, "since 2025", "right now", forecasts.
· AGENCY_FACT — a claim about THIS agency: what it charges, how fast it sells, what it specialises
  in, how many it has sold, which languages its staff speak.
· LOCAL_FACT — a concrete claim about a real place: whether daily life there needs a car, what is in
  the town centre, whether it is busy or quiet, who lives there, what is walkable.
· CAUSAL_INFERENCE — says one thing happened BECAUSE of another, or rules a cause out.
· QUANTIFIED_CLAIM — any number, percentage, duration, threshold or ranking.
· LEGAL_CONSEQUENCE — what the law requires, permits, forbids, or what happens if you do not comply.

THE FOUR YOU LEAVE ALONE — this is where the post earns its living, and classifying it as fact is
the mistake that ruins the writing:
· MARKETING_PUFFERY — "buyers scroll fast and judge in seconds", "generic words make a generic home".
  Rhetoric about how selling works. Not sourced, not sourceable, not a problem.
· OPINION_POSITIONING — what this agency believes or prefers, stated as a view. "We would rather have
  one accountable agent." A commercial position is allowed to be a position.
· CREATIVE_HOOK — a line whose job is to stop the scroll. Questions, provocations, imagery.
· HYPOTHETICAL — an explicit "if", "suppose", "imagine".

HOW TO DECIDE, WHEN IT IS CLOSE: ask whether a careful reader could check it and find it wrong. "Most
listings are forgettable" cannot be checked and nobody is misled — PUFFERY. "Jávea generally requires
a car" can be checked and someone might buy a house on it — LOCAL_FACT. "Five agents means five
prices" is an argument — OPINION_POSITIONING. "Only the agent who lands the buyer gets paid" states
how a contract works — FACTUAL_MATERIAL.

Advice framed as instruction ("lead with the detail that makes this home different") is PUFFERY, not
a factual claim — it asserts nothing about the world.

Split multi-sentence bodies into one entry per sentence. Copy each sentence VERBATIM and repeat the
field address you were given exactly. Do not invent, merge or tidy sentences.`;

export async function extractClaims(plan: PlanLike, language: string): Promise<ExtractedClaim[] | null> {
  const fields = planFields(plan);
  if (!fields.length) return [];
  const body = fields.map((f) => `[${f.field}] ${f.text}`).join('\n');
  const out = await callTool('claim extraction', EXTRACT_SYSTEM,
    `The post is written in ${language}. Classify every sentence.\n\n${body}`, EXTRACT_TOOL, 120_000);
  const list = out && coerceList(out.claims, 'claims');
  if (!list) {
    if (out) console.warn('[studio/gate] claim extraction returned an unreadable shape');
    return null;
  }
  const known = new Set(fields.map((f) => f.field));
  const types = new Set<string>([...POLICED_TYPES, ...ALLOWED_TYPES]);
  return list
    .filter((c) => typeof c?.text === 'string' && typeof c?.field === 'string'
      && known.has(c.field as string) && types.has(String(c.type)))
    .map((c) => ({ field: String(c.field), text: String(c.text), type: String(c.type) as ClaimType }));
}

/* ── 2. VALIDATE ─────────────────────────────────────────────────────────────────────────── */

const VALIDATE_TOOL = {
  name: 'submit_verdicts',
  description: 'One verdict per claim, in the order given.',
  input_schema: {
    type: 'object',
    required: ['verdicts'],
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          required: ['index', 'verdict'],
          properties: {
            index: { type: 'integer', description: 'the claim number you were given' },
            verdict: {
              type: 'string',
              enum: ['SUPPORTED', 'SUPPORTED_WITH_NUANCE', 'UNSUPPORTED', 'CONTRADICTS_GUARDRAIL',
                'REQUIRES_FRESH_RESEARCH', 'REQUIRES_AGENCY_EVIDENCE'],
            },
            problem: { type: 'string', description: 'what is wrong, in one sentence a rewriter can act on. Empty when SUPPORTED.' },
            rewrite: { type: 'string', description: 'SUPPORTED_WITH_NUANCE only: the true version, same length, same confidence, no hedging words added.' },
          },
        },
      },
    },
  },
};

const VALIDATE_SYSTEM = `You check whether each claim in a finished post is actually supported by the
evidence gathered for it. You are not an editor and you are not a censor: you decide one thing per
claim, and you say it plainly.

THE VERDICTS
· SUPPORTED — the research, the guardrails or the agency's own evidence establish it as written.
· SUPPORTED_WITH_NUANCE — true in a weaker or more qualified form. Give the corrected wording in
  "rewrite". THE REWRITE MUST BE AS CONFIDENT AND AS SHORT AS THE ORIGINAL. You are correcting a
  fact, not adding a disclaimer. Never introduce "may", "can sometimes", "in certain cases",
  "generally" as a way of avoiding the correction — find the wording that is simply true.
    "the energy certificate you need to sell at all" -> "the energy certificate the seller has to
    provide" (the source establishes a duty and a sanction, not a blocked sale)
    "Residents owe tax on the gain later" -> "Spanish tax residents may owe tax on a taxable gain
    under the resident rules" (not every sale produces a gain, so the qualifier is the correction —
    it is not a hedge bolted on to avoid one)
· UNSUPPORTED — nothing in front of you establishes it, and no further research would, because it is
  the kind of pattern nobody publishes. An invented market regularity belongs here.
· CONTRADICTS_GUARDRAIL — a verified guardrail says this is false. This outranks the research and it
  outranks anything the claim's own sources appear to say.
· REQUIRES_FRESH_RESEARCH — checkable, but this generation's research did not check it. A concrete
  claim about a real place with no research behind it belongs here.
· REQUIRES_AGENCY_EVIDENCE — true only of a particular agency, and this agency did not tell us. Its
  commission, its timescales, its results, its contract terms.

CAUSAL_INFERENCE HAS ITS OWN TEST. Two observations do not license a cause. "Transactions fell" plus
"supply is tight" does not permit "fewer sales, not less demand — that's tight supply, not cooling
interest". Unless the research establishes the MECHANISM — not just both facts — the verdict is
UNSUPPORTED, and the rewrite states what was observed without attributing it.

A DEBUNK IS NOT A VIOLATION. "There is no 48-hour rule", "no number of days gives them a right", "the
15-day deadline people fear is not real" are TRUE statements that happen to name a myth. If a
guardrail says never to assert X, a claim that denies X is SUPPORTED, not CONTRADICTS_GUARDRAIL.
Read the polarity before you judge.

BE PROPORTIONATE. General mechanics that any Spanish conveyancer would state without looking up are
SUPPORTED even if the brief did not spell them out. What must never pass is an invented SPECIFIC — a
threshold, a deadline, a percentage, a duration, a named requirement, a market regularity. This is
content, not a legal opinion; refusing everything is a failure, not a safe outcome.`;

export async function validateClaims(
  claims: ExtractedClaim[], ctx: GateContext,
): Promise<ClaimVerdict[] | null> {
  if (!claims.length) return [];
  const numbered = claims.map((c, i) => `${i}. [${c.type}] ${c.text}`).join('\n');
  const user = [
    `TOPIC: ${ctx.topic}`,
    '',
    ctx.cardRules || 'No verified guardrails exist for this topic.',
    '',
    ctx.research
      ? `WHAT THE RESEARCH ESTABLISHED FOR THIS POST:\n${ctx.research}`
      : 'NO RESEARCH WAS RETURNED FOR THIS POST. Nothing here has been checked, so any claim that '
        + 'depends on a checkable specific — a place, a number, a rule, a date — is at best '
        + 'REQUIRES_FRESH_RESEARCH.',
    '',
    ctx.agencyEvidence || 'The agency has supplied no facts about itself. Any claim about this '
      + 'agency is REQUIRES_AGENCY_EVIDENCE.',
    '',
    `THE CLAIMS (${claims.length}):`,
    numbered,
  ].join('\n');
  const out = await callTool('claim validation', VALIDATE_SYSTEM, user, VALIDATE_TOOL, 150_000);
  const list = out && coerceList(out.verdicts, 'verdicts');
  if (!list) {
    if (out) console.warn('[studio/gate] claim validation returned an unreadable shape');
    return null;
  }
  const byIndex = new Map<number, Record<string, unknown>>();
  for (const v of list) {
    if (typeof v?.index === 'number') byIndex.set(v.index, v);
  }
  return claims.map((c, i) => {
    const v = byIndex.get(i);
    return {
      ...c,
      // A claim the validator forgot is not a claim that passed.
      verdict: (v?.verdict as Verdict) ?? 'REQUIRES_FRESH_RESEARCH',
      problem: typeof v?.problem === 'string' ? v.problem : undefined,
      rewrite: typeof v?.rewrite === 'string' && v.rewrite.trim() ? v.rewrite.trim() : undefined,
    };
  });
}

/* ── 3. REPAIR ───────────────────────────────────────────────────────────────────────────── */

const REPAIR_TOOL = {
  name: 'submit_repairs',
  description: 'The rewritten fields.',
  input_schema: {
    type: 'object',
    required: ['fields'],
    properties: {
      fields: {
        type: 'array',
        items: {
          type: 'object',
          required: ['field', 'text'],
          properties: {
            field: { type: 'string' },
            text: { type: 'string', description: 'the whole field, rewritten' },
          },
        },
      },
    },
  },
};

const REPAIR_SYSTEM = `You repair specific lines of a social post that asserted something we cannot
stand behind. You are the same writer who wrote it, not a compliance officer.

THREE MOVES, IN THIS ORDER OF PREFERENCE:
1. Make the same point with a DIFFERENT TRUE ARGUMENT. This is almost always available and it is
   almost always the best post. If you cannot say that exclusive mandates are cheaper, say that one
   agency means one point of contact, one coordinated strategy, consistent presentation, clear
   accountability and fewer conflicting messages to a buyer. The commercial position survives; only
   the unsupportable sentence goes.
2. State the true, narrower version — at the same length and with the same confidence.
3. Cut the claim and let the line do less.

WHAT YOU MUST NOT DO, AND THIS MATTERS MORE THAN THE REPAIR:
· Never add a hedge. No "generally", "in many cases", "it depends", "may vary", "typically" bolted on
  to rescue a sentence. A hedged sentence is a worse failure than the one you are fixing.
· Never mention research, sources, evidence, verification, the law being unclear, or anything that
  reveals that a check happened. The reader must never feel they are reading the output of a
  fact-checking system.
· Never turn a bold line into a cautious one. If the repaired copy is more timid than what you
  received, you have failed even if every word is true.
· Keep the length, the rhythm and the voice. These are slides — a body is one idea, 15-40 words.

Return the FULL rewritten text of each field you were asked to fix, and nothing else.`;

async function repairFields(
  plan: PlanLike, failures: ClaimVerdict[], ctx: GateContext,
): Promise<PlanLike> {
  const byField = new Map<string, ClaimVerdict[]>();
  for (const f of failures) {
    if (!byField.has(f.field)) byField.set(f.field, []);
    byField.get(f.field)!.push(f);
  }
  const asks = [...byField.entries()].map(([field, fs]) => {
    const current = readField(plan, field);
    const problems = fs.map((f) => `  — "${f.text}" → ${f.verdict}: ${f.problem ?? 'not supported'}`
      + (f.rewrite ? `\n     A true version: "${f.rewrite}"` : '')).join('\n');
    return `[${field}] currently reads:\n"${current}"\nProblems:\n${problems}`;
  }).join('\n\n');
  const out = await callTool('claim repair', REPAIR_SYSTEM,
    [`The post is in ${ctx.language}. Topic: ${ctx.topic}`,
      ctx.research ? `\nWhat the research established (use it — do not quote it):\n${ctx.research}` : '',
      ctx.agencyEvidence ? `\n${ctx.agencyEvidence}` : '',
      `\nRewrite these fields:\n\n${asks}`].join('\n'),
    REPAIR_TOOL, 150_000);
  const list = out && coerceList(out.fields, 'fields');
  if (!list) return plan;
  let next = plan;
  for (const f of list) {
    if (typeof f?.field === 'string' && typeof f?.text === 'string' && f.text.trim()) {
      next = writeField(next, f.field, f.text.trim());
    }
  }
  return next;
}

/* ── 4. THE GATE ─────────────────────────────────────────────────────────────────────────── */

const HEDGE = /\b(?:generally speaking|in many cases|it depends|may vary|can vary|as a rule|broadly speaking|in some cases|not always|roughly speaking)\b/i;

/** Did the repair leave the copy more timid than it found it? A repair that hedges has failed. */
export function repairWentTimid(before: string, after: string): boolean {
  if (!after.trim()) return false;
  const gained = HEDGE.test(after) && !HEDGE.test(before);
  return gained || after.length < before.length * 0.45;
}

/**
 * Extract, validate, repair. Returns the plan that may publish and a report of what happened.
 *
 * Never throws and never blocks a post on its own failure: if the model steps are unavailable the
 * deterministic table still runs, the report says the gate ran degraded, and the post goes out with
 * the claims that table could reach. A gate that takes the product down when it has a bad minute is
 * not a safety feature.
 */
export async function gatePlan<T extends PlanLike>(
  plan: T, ctx: GateContext, maxRepairs = 2,
): Promise<{ plan: T; report: GateReport }> {
  const report: GateReport = {
    claims: 0, policed: 0, verdicts: {}, blocked: [], deterministic: [],
    repairs: 0, dropped: 0, degraded: null,
  };
  let current = plan;

  for (let round = 0; round <= maxRepairs; round++) {
    // The deterministic table first — it is free, it cannot have an off day, and its 'block' rules
    // outrank anything a model concludes.
    const hits: GateHit[] = planFields(current)
      .flatMap((f) => gateField(f.field, f.text, ctx.research));
    const claims = await extractClaims(current, ctx.language);
    if (claims === null) {
      report.degraded = 'claim extraction unavailable — only the deterministic table ran';
    }
    const policed = (claims ?? []).filter((c) =>
      (POLICED_TYPES as readonly string[]).includes(c.type));
    const verdicts = claims === null ? [] : await validateClaims(policed, ctx);
    if (claims !== null && verdicts === null) {
      report.degraded = 'claim validation unavailable — only the deterministic table ran';
    }

    if (round === 0) {
      // What the writer originally produced, kept so the agent can see what the gate found.
      report.deterministic = hits.map((h) => ({
        field: h.field, rule: h.rule.id, severity: h.rule.severity, sentence: h.sentence,
      }));
    }
    // The tally describes the FIRST draft — what the writer actually produced and what the gate
    // found in it. Accumulating across rounds produced "16 policed claims, 45 verdicts", which
    // cannot be true; reporting only the last round produced "0 sentences, 0 policed" on a post
    // that had been repaired twice, which hid the entire point. What happened next is in
    // repairs / dropped / blocked.
    if (round === 0) {
      report.claims = claims?.length ?? 0;
      report.policed = policed.length;
      for (const v of verdicts ?? []) report.verdicts[v.verdict] = (report.verdicts[v.verdict] ?? 0) + 1;
    }

    // Merge: a deterministic hit becomes a failure in its own right, so a model that shrugs at the
    // 15-day myth cannot wave it through.
    const failures: ClaimVerdict[] = [
      ...(verdicts ?? []).filter((v) => !PUBLISHABLE.has(v.verdict)),
      ...hits.map((h) => ({
        field: h.field, text: h.sentence, type: 'FACTUAL_MATERIAL' as ClaimType,
        verdict: (h.rule.severity === 'block' ? 'CONTRADICTS_GUARDRAIL' : 'UNSUPPORTED') as Verdict,
        problem: h.rule.problem,
      })),
    ];
    // SUPPORTED_WITH_NUANCE is not a failure — the corrected wording is simply applied.
    for (const v of verdicts ?? []) {
      if (v.verdict === 'SUPPORTED_WITH_NUANCE' && v.rewrite) {
        const before = readField(current, v.field);
        if (before.includes(v.text)) current = writeField(current, v.field, before.replace(v.text, v.rewrite));
      }
    }

    if (!failures.length) break;

    if (round === maxRepairs) {
      // Out of repair attempts. Delete the offending sentences rather than publish them or lose the
      // whole post; a shorter true card beats a complete false one.
      for (const f of failures) {
        const before = readField(current, f.field);
        const after = dropSentence(before, f.text);
        if (after !== before) { current = writeField(current, f.field, after); report.dropped++; }
        report.blocked.push({
          field: f.field, text: f.text, verdict: f.verdict, problem: f.problem ?? '',
          outcome: after !== before ? 'sentence removed' : 'left — could not be isolated',
        });
      }
      break;
    }

    const before = planFields(current).map((f) => f.text).join(' ');
    const repaired = await repairFields(current, failures, ctx);
    const after = planFields(repaired).map((f) => f.text).join(' ');
    if (repairWentTimid(before, after)) {
      report.degraded = 'a repair made the copy timid and was rejected';
      // Keep the original and fall through to sentence removal on the next round rather than ship
      // hedged copy. Hedging is the failure mode the owner explicitly forbade.
      continue;
    }
    current = repaired as T;
    report.repairs++;
  }

  // A tip whose body was emptied by sentence removal cannot ship: PlanSchema requires a non-empty
  // body, and /carousel/update re-parses the stored plan on every later edit, so an empty one would
  // break the deck long after this ran. Drop the slide instead — a shorter true deck beats a
  // complete false one, and beats a deck that cannot be reopened.
  const tips = current.tips ?? [];
  if (tips.length) {
    const kept = tips.filter((t) => (t?.body ?? '').trim().length >= 20);
    if (kept.length !== tips.length && kept.length >= 1) {
      report.dropped += tips.length - kept.length;
      current = { ...current, tips: kept };
    }
  }

  // Defence in depth behind trimWords: nothing leaves cut mid-thought.
  for (const f of planFields(current)) {
    if (endsMidThought(f.text)) {
      current = writeField(current, f.field, f.text.replace(/\s+\S+$/, '').replace(/[\s,;:—–-]+$/, ''));
    }
  }
  return { plan: current, report };
}
