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
  adjudicate, capFor, coverageGaps, dropSentence, endsMidThought, gateField, incompleteBody,
  fieldIncomplete, planFields, readField, shortenToBoundary, writeField,
  RESOLVED_HARD_FAIL, RESOLVED_OK,
  type CoverageStatus, type GateHit, type PlanLike, type Requirement, type RequirementCoverage,
  type Resolution,
} from './studio-copy-gate';
import { getCard, retrieveBankFacts } from './studio-bank-match';
import {
  riskOf, verifySupport,
  type ClaimSupport, type ProposedSupport, type ResearchSource, type SupportContext,
} from './studio-evidence';

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
  /** requirements the card set that this generation's research did not answer */
  uncovered?: string[];
  /** the facts the agency itself supplied */
  agencyEvidence: string;
  /** every page the research touched, with the text of the ones that were opened */
  sources?: ResearchSource[];
  /** requirement id → status, so a claim can be refused for resting on an unestablished one */
  coverage?: RequirementCoverage[];
  /** id → exact text of the verified bank facts and guardrails relevant to this post. Left unset,
   *  the gate retrieves them itself from what the finished post actually claims. */
  bankFacts?: ReadonlyMap<string, string>;
  /** the matched card, whose own requirements and guardrails always apply */
  cardId?: string;
  /** which bank to retrieve across when no card matched */
  bank?: 'seller' | 'buyer';
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
  /** every flagged claim and how it was resolved — no residual is left unexplained */
  adjudications: Array<{ field: string; text: string; verdict: string; resolution: Resolution }>;
  /** flags the second-opinion validator raised, before adjudication */
  rawFlags: number;
  /** flags that survived adjudication as genuine failures */
  materialFailures: number;
  /** what every material claim in the FIRST draft was found to rest on */
  supports: ClaimSupport[];
  /** finished sentences that contradict a verified bank fact or guardrail — a hard block */
  bankContradictions: BankContradiction[];
  /** material claims that could not point at evidence, before any repair */
  unsupportedMaterial: number;
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
/**
 * Recover a JSON payload the model ran out of tokens mid-way through.
 *
 * The verdict list arrives as a JSON STRING, so a truncated response is not a truncated tool call —
 * it is a string that will not parse, and losing it threw away every verdict for the post. Two of
 * six posts in an acceptance run degraded to the deterministic table alone because of this. Cutting
 * back to the last complete object and closing the brackets keeps the verdicts the model did finish.
 */
function salvage(text: string): unknown {
  const start = text.indexOf('[');
  const lastObj = text.lastIndexOf('}');
  if (start < 0 || lastObj < start) return null;
  // Rebuild just the array, cut back to the last object that finished.
  try { return JSON.parse(`${text.slice(start, lastObj + 1)}]`); } catch { /* fall through */ }
  // That last object may itself be the truncated one; drop it and try again.
  const prev = text.lastIndexOf('},', lastObj);
  if (prev > start) {
    try { return JSON.parse(`${text.slice(start, prev + 1)}]`); } catch { /* give up */ }
  }
  return null;
}

function coerceList(raw: unknown, key: string): Record<string, unknown>[] | null {
  let v: unknown = raw;
  for (let i = 0; i < 4; i++) {
    if (typeof v === 'string') {
      const str: string = v;
      try { v = JSON.parse(str); } catch { v = salvage(str); if (v === null) return null; }
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

/* ── 0. REQUIREMENT COVERAGE ────────────────────────────────────────────────────────────── */

const COVERAGE_TOOL = {
  name: 'submit_coverage',
  description: 'One status per requirement id, in the order given.',
  input_schema: {
    type: 'object',
    required: ['coverage'],
    properties: {
      coverage: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'status'],
          properties: {
            id: { type: 'string', description: 'the requirement id exactly as given' },
            status: { type: 'string', enum: ['established', 'partial', 'not_established'] },
            evidence: { type: 'string', description: 'the sentence of the briefing that establishes it; omit when nothing does' },
            source_ids: { type: 'array', items: { type: 'string' },
              description: 'ids of the listed sources that back it, e.g. ["S2","S5"]. Required for established or partial.' },
          },
        },
      },
    },
  },
};

const COVERAGE_SYSTEM = `You decide, for each numbered requirement, whether a research briefing
actually establishes it.

"established" means the briefing states the thing the requirement asks for, specifically enough to
write from. Quote the sentence in "evidence".
"partial" means the briefing touches the subject but leaves the specific point open — a figure named
without its period, a rule described without its condition, one half of a comparison.
"not_established" means the briefing does not answer it. A briefing that discusses the general area
without answering the question is NOT established.

Be strict. The purpose of these requirements is to stop a writer asserting something plausible that
nobody checked, so "the briefing probably implies it" is not established. Judge each requirement on
its own; do not let a rich briefing carry a requirement it never addressed.

EVIDENCE IS NOT SIMILAR WORDING. For anything you mark established or partial you must quote the
sentence of the briefing that carries it AND name the source ids that back it, from the list given.
A requirement whose support you cannot point at is not_established, however plausible it sounds.`;

/**
 * Which of the card's requirements this generation's research actually established.
 *
 * FAILS CLOSED. If the assessment cannot run, every requirement is reported unestablished, because
 * the alternative is letting a writer assert whatever sounds right about points nobody verified —
 * which is the exact failure this step exists to prevent.
 */
export async function assessCoverage(
  requirements: readonly Requirement[], brief: string,
  sources: readonly { id: string; url: string; title: string }[] = [],
): Promise<{ coverage: RequirementCoverage[]; degraded: string | null }> {
  const allUnestablished = (why: string) => ({
    coverage: requirements.map((r) => ({
      id: r.id, status: 'not_established' as CoverageStatus, evidence: '', sourceIds: [] })),
    degraded: why,
  });
  if (!requirements.length) return { coverage: [], degraded: null };
  if (!brief.trim()) return allUnestablished('no research brief');

  const out = await callTool('requirement coverage', COVERAGE_SYSTEM,
    `THE BRIEFING:\n${brief}\n\nTHE SOURCES THE RESEARCH OPENED:\n`
    + (sources.length ? sources.map((s) => `${s.id}: ${s.title || s.url} — ${s.url}`).join('\n')
                      : '(none recorded)')
    + `\n\nTHE REQUIREMENTS:\n`
    + requirements.map((r) => `${r.id}: ${r.text}`).join('\n'),
    COVERAGE_TOOL, 120_000, 8000);
  const list = out && coerceList(out.coverage, 'coverage');
  if (!list) return allUnestablished('coverage assessment unavailable');

  const known = new Set(sources.map((s) => s.id));
  const byId = new Map<string, RequirementCoverage>();
  for (const c of list) {
    const id = String(c?.id ?? '').trim();
    const status = String(c?.status ?? '');
    if (!id || !['established', 'partial', 'not_established'].includes(status)) continue;
    const evidence = String(c?.evidence ?? '').trim();
    const sourceIds = (Array.isArray(c?.source_ids) ? c.source_ids : [])
      .map((x) => String(x).trim()).filter((x) => known.has(x));
    // A requirement is established because something backs it, not because the briefing used
    // similar words. No quoted evidence, or no source that was actually opened, means not
    // established — however plausible the wording.
    const grounded = evidence.length > 0 && (sourceIds.length > 0 || known.size === 0);
    byId.set(id, {
      id,
      status: (status !== 'not_established' && !grounded ? 'not_established' : status) as CoverageStatus,
      evidence, sourceIds,
    });
  }
  return {
    coverage: requirements.map((r) => byId.get(r.id)
      ?? { id: r.id, status: 'not_established' as CoverageStatus, evidence: '', sourceIds: [] }),
    degraded: null,
  };
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
  // The model sometimes echoes the address with the brackets it was shown it in.
  const address = (v: unknown) => String(v ?? '').trim().replace(/^\[|\]$/g, '').trim();
  const kept = list
    .filter((c) => typeof c?.text === 'string' && known.has(address(c.field)) && types.has(String(c.type)))
    .map((c) => ({ field: address(c.field), text: String(c.text), type: String(c.type) as ClaimType }));
  // A silent zero reads exactly like a clean post, which is the trap this whole layer exists to
  // close. Say which of the two happened.
  if (!kept.length) {
    console.warn(list.length
      ? `[studio/gate] claim extraction returned ${list.length} rows and none survived filtering — `
        + `first row: ${JSON.stringify(list[0]).slice(0, 200)}`
      : '[studio/gate] claim extraction found no sentences at all in a plan of '
        + `${fields.length} fields — treating as a failure, not a clean post`);
    return null;
  }
  return kept;
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
            problem: { type: 'string', description: 'OMIT ENTIRELY when the verdict is SUPPORTED. Otherwise one sentence a rewriter can act on.' },
            rewrite: { type: 'string', description: 'SUPPORTED_WITH_NUANCE only, omit otherwise: the true version, same length, same confidence, no hedging words added.' },
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

A SERVICE PROMISE IS NOT A PERFORMANCE CLAIM, AND THIS DISTINCTION MATTERS IN BOTH DIRECTIONS.
"We give every home its own angles, its own wording, its own story" and "Comment COAST and we'll
send you the breakdown" are things the agency is offering to DO. If the agency could plausibly do
it, that is positioning and it is SUPPORTED — do not demand evidence for an offer.
But the category is not a hiding place. These are performance claims and they need the agency's own
evidence: what it has ACHIEVED ("we've seen how this plays out", "our sellers get", "we sold 40 last
year"), its client history, anything measured, any award or accreditation, and any service it does
not actually offer. "We've seen how the accountable-team approach plays out on this coast" is client
history wearing a positioning coat: REQUIRES_AGENCY_EVIDENCE.

CAUSAL_INFERENCE HAS ITS OWN TEST. Two observations do not license a cause. "Transactions fell" plus
"supply is tight" does not permit "fewer sales, not less demand — that's tight supply, not cooling
interest". Unless the research establishes the MECHANISM — not just both facts — the verdict is
UNSUPPORTED, and the rewrite states what was observed without attributing it.

A DEBUNK IS NOT A VIOLATION. "There is no 48-hour rule", "no number of days gives them a right", "the
15-day deadline people fear is not real" are TRUE statements that happen to name a myth. If a
guardrail says never to assert X, a claim that denies X is SUPPORTED, not CONTRADICTS_GUARDRAIL.
Read the polarity before you judge.

KEEP IT SHORT. Give "problem" ONLY when the claim did not pass, and "rewrite" ONLY for
SUPPORTED_WITH_NUANCE. A verdict on its own is the whole answer for anything that is fine.

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
    ctx.uncovered?.length
      ? `\nTHE BANK REQUIRED THESE AND THE RESEARCH DID NOT ESTABLISH THEM. Any claim that depends `
        + `on one of them is REQUIRES_FRESH_RESEARCH, however mild it sounds and however obvious it `
        + `seems — "known to be", "generally", "both towns" do not make an unchecked claim checked:\n`
        + ctx.uncovered.map((m) => `· ${m}`).join('\n')
      : '',
    '',
    `THE CLAIMS (${claims.length}):`,
    numbered,
  ].join('\n');
  // A verdict list is short; the prose around it is not. Leaving out problem/rewrite for everything
  // that passed is what keeps the payload inside the budget on a 20-claim post.
  const out = await callTool('claim validation', VALIDATE_SYSTEM, user, VALIDATE_TOOL, 150_000, 16_000);
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

/* ── 2b. SUPPORT — what each material claim actually rests on ────────────────────────────── */

const SUPPORT_TOOL = {
  name: 'submit_support',
  description: 'For each claim, the evidence it rests on.',
  input_schema: {
    type: 'object',
    required: ['supports'],
    properties: {
      supports: {
        type: 'array',
        items: {
          type: 'object',
          required: ['claim_id', 'support_type'],
          properties: {
            claim_id: { type: 'string' },
            support_type: { type: 'string', enum: ['research_evidence', 'agency_profile', 'bank_fact', 'none'] },
            source_ids: { type: 'array', items: { type: 'string' },
              description: 'the S-ids tagged on the briefing lines that carry this, e.g. ["S4"]' },
            evidence_excerpt: { type: 'string',
              description: 'the words themselves, copied EXACTLY from the briefing line, source or profile — never your own paraphrase' },
            bank_fact_ids: { type: 'array', items: { type: 'string' } },
            requirement_ids: { type: 'array', items: { type: 'string' },
              description: 'any listed requirement this claim depends on, established or not' },
          },
        },
      },
    },
  },
};

const SUPPORT_SYSTEM = `You attach evidence to claims. For each claim you are given, say what it
actually rests on and quote the words that carry it.

THIS IS NOT A JUDGEMENT TASK. You are not deciding whether the claim sounds right. You are finding
the sentence that establishes it and copying that sentence out. If you cannot find one, say so with
support_type "none" — that is a correct and useful answer, and inventing a quotation to fill the box
is the one thing you must never do.

WHERE EVIDENCE COMES FROM
· research_evidence — a line of the briefing. Give the S-ids tagged on that line and copy the
  quoted words EXACTLY as the briefing has them, including any Spanish. The excerpt is checked
  character by character against the page that was actually opened, so a paraphrase, a translation
  or a tidied-up version will fail. Copy, do not rewrite.
· agency_profile — a fact the agency itself supplied. Copy the words from the profile.
· bank_fact — a verified bank fact or guardrail you were given by id. Copy its words.
· none — nothing in front of you establishes this claim.

REQUIREMENTS: if a numbered requirement is listed and the claim depends on it, name it in
requirement_ids whether or not it was established. Being honest about the dependency is the point;
whether it may publish is decided elsewhere.

EXCERPT LENGTH: enough to identify the passage, roughly one sentence. Not three words, not a page.`;

/**
 * What every material claim rests on — proposed by a model, decided offline.
 *
 * The acceptance run of 5dfb1c3 published fifteen material defects while reporting two, because
 * "supported" meant a second model had used the word. A claim about the world now has to point at
 * a page that was opened and quote it, and the quotation is checked against the page. Anything that
 * cannot is unsupported, and unsupported copy does not publish.
 */
export async function supportClaims(
  claims: readonly { field: string; text: string; type: string }[], ctx: GateContext,
): Promise<{ supports: ClaimSupport[]; degraded: string | null }> {
  if (!claims.length) return { supports: [], degraded: null };
  const sources = ctx.sources ?? [];
  const coverage = ctx.coverage ?? [];
  const bankFacts = ctx.bankFacts ?? new Map<string, string>();
  // ONLY not_established bars a claim. A partial requirement is not permission to assert the whole
  // paragraph, but nor is it a bar: the claim still has to produce direct evidence for the specific
  // proposition it uses, and that is what the support record is. Treating partial as a block took
  // eight true, sourced sentences out of a smoke-test deck.
  const unestablished = new Set(coverage.filter((c) => c.status === 'not_established').map((c) => c.id));

  const supportCtx: SupportContext = {
    sources, agencyEvidence: ctx.agencyEvidence, bankText: bankFacts, unestablished,
  };
  const unsupportedAll = (why: string) => ({
    supports: claims.map((c, i) => verifySupport({
      claimId: `C${i + 1}`, field: c.field, claim: c.text, claimType: c.type, supportType: 'none',
    }, supportCtx)),
    degraded: why,
  });

  const numbered = claims.map((c, i) => `C${i + 1} @ ${c.field} [${c.type}]: ${c.text}`).join('\n');
  const reqLines = coverage.length
    ? `\n\nREQUIREMENTS FOR THIS TOPIC (status in brackets):\n`
      + coverage.map((c) => `${c.id} [${c.status}]`).join('\n')
    : '';
  const bankLines = bankFacts.size
    ? `\n\nVERIFIED BANK FACTS AND GUARDRAILS:\n`
      + [...bankFacts].map(([id, t]) => `${id}: ${t}`).join('\n')
    : '';
  const out = await callTool('claim support', SUPPORT_SYSTEM,
    `THE BRIEFING THE POST WAS WRITTEN FROM (each factual line tagged with the source it came off):\n`
    + `${ctx.research || '(no research was done for this post)'}\n\n`
    + `WHAT THE AGENCY ITSELF TOLD US:\n${ctx.agencyEvidence}`
    + `${bankLines}${reqLines}\n\nTHE CLAIMS:\n${numbered}`,
    SUPPORT_TOOL, 120_000, 8000);
  const list = out && coerceList(out.supports, 'supports');
  if (!list) return unsupportedAll('claim support unavailable');

  const byId = new Map<string, Record<string, unknown>>();
  for (const r of list) {
    const id = String(r?.claim_id ?? '').trim().toUpperCase();
    if (id) byId.set(id, r);
  }
  const supports = claims.map((c, i) => {
    const id = `C${i + 1}`;
    const r = byId.get(id);
    const proposed: ProposedSupport = {
      claimId: id, field: c.field, claim: c.text, claimType: c.type,
      supportType: (['research_evidence', 'agency_profile', 'bank_fact'] as const)
        .find((t) => t === String(r?.support_type ?? '')) ?? 'none',
      sourceIds: Array.isArray(r?.source_ids) ? (r!.source_ids as unknown[]).map(String) : [],
      evidenceExcerpt: String(r?.evidence_excerpt ?? ''),
      bankFactIds: Array.isArray(r?.bank_fact_ids) ? (r!.bank_fact_ids as unknown[]).map(String) : [],
      requirementIds: Array.isArray(r?.requirement_ids) ? (r!.requirement_ids as unknown[]).map(String) : [],
    };
    return verifySupport(proposed, supportCtx);
  });
  return { supports, degraded: null };
}

/* ── 2c. THE VERIFIED BANK, CONSULTED AFTER WRITING ──────────────────────────────────────── */

const CONTRADICTION_TOOL = {
  name: 'submit_contradictions',
  description: 'Which claims contradict a verified fact or guardrail.',
  input_schema: {
    type: 'object',
    required: ['findings'],
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          required: ['claim_id', 'contradicts', 'bank_fact_id'],
          properties: {
            claim_id: { type: 'string' },
            contradicts: { type: 'boolean' },
            bank_fact_id: { type: 'string' },
            why: { type: 'string', description: 'what the bank says and what the claim says instead' },
          },
        },
      },
    },
  },
};

const CONTRADICTION_SYSTEM = `You hold a small set of statements that have already been verified
against primary law, tax and official statistics. They are the ground truth. You are given the
sentences of a finished post. Say which of those sentences contradict one of the verified
statements, or do the thing a guardrail expressly forbids.

A CONTRADICTION IS: the claim says the opposite of a verified fact; the claim asserts something a
guardrail says must never be asserted; the claim moves a figure to a geography, a period or a
population the verified statement says it does not cover.

IT IS NOT: the claim being about something the statements do not mention; the claim being vaguer
than the statement; the claim being marketing language; the claim being one you personally doubt.
Silence in the bank is not permission and it is not contradiction — report only real conflicts.

This exists because a post matched a card whose guardrail read "do not generalise a national ranking
to Alicante province", and then published a province ranking taken from the national one. The
guardrail was in front of the writer the whole time. Nobody checked the finished sentence against it.`;

export interface BankContradiction { field: string; text: string; bankFactId: string; why: string }

/**
 * Check the FINISHED copy against the verified bank.
 *
 * Handing guardrails to the writer is necessary and demonstrably not sufficient. Retrieval is over
 * the whole relevant bank rather than the one card matched before research, because the two posts
 * that made the worst legal and tax claims in the last run matched no card at all.
 */
export async function checkBankContradictions(
  claims: readonly { field: string; text: string }[], facts: ReadonlyMap<string, string>,
): Promise<{ contradictions: BankContradiction[]; degraded: string | null }> {
  if (!claims.length || !facts.size) return { contradictions: [], degraded: null };
  const numbered = claims.map((c, i) => `C${i + 1} @ ${c.field}: ${c.text}`).join('\n');
  const bank = [...facts].map(([id, t]) => `${id}: ${t}`).join('\n');
  const out = await callTool('bank contradiction', CONTRADICTION_SYSTEM,
    `VERIFIED STATEMENTS:\n${bank}\n\nTHE POST'S CLAIMS:\n${numbered}`,
    CONTRADICTION_TOOL, 120_000, 6000);
  const list = out && coerceList(out.findings, 'findings');
  // FAILS CLOSED IN THE OTHER DIRECTION on purpose: if this check cannot run we do not invent
  // contradictions, we record that it did not run. Blocking every claim because a model timed out
  // would empty the deck; the support pass is what holds the line on evidence.
  if (!list) return { contradictions: [], degraded: 'bank contradiction check unavailable' };
  const found: BankContradiction[] = [];
  for (const r of list) {
    if (r?.contradicts !== true) continue;
    const idx = Number(String(r?.claim_id ?? '').replace(/[^0-9]/g, '')) - 1;
    const claim = claims[idx];
    const factId = String(r?.bank_fact_id ?? '').trim();
    if (!claim || !facts.has(factId)) continue;   // an id the bank does not contain is not evidence
    found.push({ field: claim.field, text: claim.text, bankFactId: factId, why: String(r?.why ?? '') });
  }
  return { contradictions: found, degraded: null };
}

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
      // A repair writes whatever the model returned; the caps were applied once, when the plan was
      // first parsed. A repaired title shipped at 161 characters against a 62-character cap.
      const cap = capFor(f.field);
      const text = cap ? (shortenToBoundary(f.text.trim(), cap) ?? f.text.trim()) : f.text.trim();
      next = writeField(next, f.field, text);
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
    repairs: 0, dropped: 0, degraded: null, adjudications: [], rawFlags: 0, materialFailures: 0,
    supports: [], bankContradictions: [], unsupportedMaterial: 0,
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

    // A prose card cut at the character limit goes back to be rewritten short and whole. Christian's
    // rule: prefer the last complete sentence; if none is viable, shorten the card by rewriting it —
    // never ship prose that stops mid-sentence, and never butcher good prose to avoid it.
    const cutShort = planFields(current)
      .filter((f) => fieldIncomplete(f.field, f.text))
      .map((f) => ({
        field: f.field, text: f.text, type: 'FACTUAL_MATERIAL' as ClaimType,
        verdict: 'UNSUPPORTED' as Verdict,
        problem: 'This card was cut at the character limit and stops mid-sentence. Rewrite it so it '
          + 'says the same thing in fewer words and ends as a complete sentence. Do not simply drop '
          + 'the last clause — make the whole point fit.',
      }));

    // RETRIEVAL HAPPENS HERE, on what the post ended up claiming — not on the topic it started
    // from. H1 and H2 matched no card and made the run's worst legal and tax claims; the bank
    // covers both subjects. Retrieval is restricted to material claims so marketing stays fast.
    const bankFacts = new Map<string, string>(ctx.bankFacts ?? []);
    if (!ctx.bankFacts && policed.length) {
      for (const f of retrieveBankFacts(policed.map((c) => c.text), ctx.bank)) bankFacts.set(f.id, f.text);
      const card = ctx.cardId ? getCard(ctx.cardId) : undefined;
      if (card) {
        // The matched card is authoritative for this topic whatever retrieval scored.
        card.must.forEach((t, i) => bankFacts.set(`${card.id}#${i + 1}`, t));
        card.never.forEach((t, i) => bankFacts.set(`${card.id}#never${i + 1}`, t));
      }
    }
    // SUPPORT. Every material claim, not only the flagged ones, has to say what it rests on, and
    // the record is checked offline against the pages the research actually opened. This is the
    // step whose absence let fifteen defects publish under a report of two: a claim used to need
    // only a second model's approval, and approval is not evidence.
    const { supports, degraded: supportDegraded } = await supportClaims(policed, { ...ctx, bankFacts });
    if (supportDegraded) report.degraded = supportDegraded;
    const supportOf = new Map<string, ClaimSupport>();
    supports.forEach((sup, i) => supportOf.set(`${policed[i].field}::${policed[i].text}`, sup));
    const isSupported = (f: string, t: string) => supportOf.get(`${f}::${t}`)?.verdict === 'supported';

    // THE VERIFIED BANK, ON THE FINISHED DRAFT. Retrieval is over the whole relevant bank, because
    // the posts that made the worst claims last time matched no card at all.
    const { contradictions, degraded: bankDegraded } = await checkBankContradictions(policed, bankFacts);
    if (bankDegraded) report.degraded = report.degraded ?? bankDegraded;
    if (round === 0) {
      report.supports = supports;
      report.bankContradictions = contradictions;
      report.unsupportedMaterial = supports.filter((x) => x.verdict === 'unsupported').length;
    }

    // ADJUDICATION. The validator's opinion is evidence, not a verdict: a flagged claim is resolved
    // against the support record, the agency's own evidence and its own claim type before anything
    // is repaired. It can no longer rescue a claim by resemblance — only a verified support record
    // produces SUPPORTED_BY_RESEARCH.
    const hitFields = new Set(hits.map((h) => `${h.field}::${h.sentence}`));
    const flagged = (verdicts ?? []).filter((v) => !PUBLISHABLE.has(v.verdict));
    for (const v of flagged) {
      const resolution = adjudicate({
        text: v.text, type: v.type, research: ctx.research,
        agencyEvidence: ctx.agencyEvidence, uncovered: ctx.uncovered ?? [],
        deterministic: hitFields.has(`${v.field}::${v.text}`),
        supported: isSupported(v.field, v.text),
      });
      if (round === 0) {
        report.rawFlags++;
        report.adjudications.push({ field: v.field, text: v.text, verdict: v.verdict, resolution });
      }
    }

    // A material claim that cannot point at evidence is a failure whether or not the validator
    // liked it. This replaces "the second model said SUPPORTED" as the publication test.
    const unsupported: ClaimVerdict[] = policed
      .map((c, i) => ({ c, sup: supports[i] }))
      .filter(({ sup }) => sup && sup.verdict === 'unsupported')
      .map(({ c, sup }) => {
        const flaggedProblem = (verdicts ?? []).find((v) => v.field === c.field && v.text === c.text)?.problem;
        return {
          field: c.field, text: c.text, type: c.type as ClaimType,
          verdict: 'UNSUPPORTED' as Verdict,
          problem: `Nothing establishes this: ${sup.reason}.`
            + (flaggedProblem ? ` The check also said: ${flaggedProblem}` : '')
            + ` Rewrite the line so it says something the briefing DOES establish, or make the same`
            + ` argument without this claim. Do not hedge it — replace it.`,
        };
      });

    const failures: ClaimVerdict[] = [
      ...unsupported,
      // A guardrail that was verified against primary sources outranks the draft, always.
      ...contradictions.map((c) => ({
        field: c.field, text: c.text, type: 'FACTUAL_MATERIAL' as ClaimType,
        verdict: 'CONTRADICTS_GUARDRAIL' as Verdict,
        problem: `This contradicts a verified fact (${c.bankFactId}). ${c.why} `
          + `Write what the verified fact actually says, or drop the point.`,
      })),
      // A deterministic hit is a failure in its own right, so a model that shrugs at the 15-day
      // myth cannot wave it through.
      ...hits.map((h) => ({
        field: h.field, text: h.sentence, type: 'FACTUAL_MATERIAL' as ClaimType,
        verdict: (h.rule.severity === 'block' ? 'CONTRADICTS_GUARDRAIL' : 'UNSUPPORTED') as Verdict,
        problem: h.rule.problem,
      })),
      ...cutShort,
    ];
    if (round === 0) report.materialFailures = failures.length;
    // SUPPORTED_WITH_NUANCE is not a failure — the corrected wording is simply applied.
    for (const v of verdicts ?? []) {
      if (v.verdict === 'SUPPORTED_WITH_NUANCE' && v.rewrite) {
        const before = readField(current, v.field);
        if (before.includes(v.text)) current = writeField(current, v.field, before.replace(v.text, v.rewrite));
      }
    }

    if (!failures.length) break;

    if (round === maxRepairs) {
      // Out of repair attempts. Delete the offending sentence rather than publish it — but ONLY
      // from prose. A title is one phrase: deleting its sentence empties it, and a live run shipped
      // a card reading "2. (blank)" over an orphan body. A headline that cannot be supported takes
      // its whole slide with it; it never becomes a hole in the deck.
      for (const f of failures) {
        const before = readField(current, f.field);
        const isProse = /(?:\.body|slide2_body|caption)$/.test(f.field);
        const after = isProse ? dropSentence(before, f.text) : before;
        const tip = /^tips\[(\d+)\]\./.exec(f.field);
        if (isProse && after !== before) {
          current = writeField(current, f.field, after);
          report.dropped++;
          report.blocked.push({ field: f.field, text: f.text, verdict: f.verdict,
            problem: f.problem ?? '', outcome: 'sentence removed' });
        } else if (tip) {
          // Not prose, or not isolable: mark the whole slide for removal below.
          const tips = [...(current.tips ?? [])];
          if (tips[Number(tip[1])]) {
            tips[Number(tip[1])] = { ...tips[Number(tip[1])], body: '' };
            current = { ...current, tips };
          }
          report.blocked.push({ field: f.field, text: f.text, verdict: f.verdict,
            problem: f.problem ?? '', outcome: 'slide removed — the claim was its headline' });
        } else {
          report.blocked.push({ field: f.field, text: f.text, verdict: f.verdict,
            problem: f.problem ?? '', outcome: 'left — not isolable and not a slide' });
        }
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
    // A slide needs BOTH halves, and the body has to carry its headline. A live card shipped a
    // 49-character body under a title promising more — the sentence removal had taken the half that
    // made the point. Twenty characters was never enough to be a card.
    const kept = tips.filter((t) => (t?.body ?? '').trim().length >= 60 && (t?.title ?? '').trim().length >= 3);
    if (kept.length !== tips.length && kept.length >= 1) {
      report.dropped += tips.length - kept.length;
      current = { ...current, tips: kept };
    }
  }

  return { plan: finishCopy(current, report), report };
}

/**
 * The very last thing that touches the copy — caps, complete sentences, no dangling word.
 *
 * This used to live at the end of gatePlan, which meant the editor (and the final deterministic
 * pass) ran AFTER it and could reintroduce exactly what it had cleaned. A live post shipped a card
 * titled "Borrowing is getting more expensive, not" for precisely that reason: the check that
 * catches it had already run. Exported so the orchestrator can call it after everything else.
 */
export function finishCopy<T extends PlanLike>(plan: T, report?: GateReport): T {
  let current = plan;
  for (const f of planFields(current)) {
    const cap = capFor(f.field);
    if (cap && f.text.length > cap) {
      const whole = shortenToBoundary(f.text, cap);
      if (whole !== null) current = writeField(current, f.field, whole);
      else if (/^tips\[\d+\]\./.test(f.field)) {
        // No boundary to cut at. A slide is droppable; a fragment is not shippable.
        const idx = Number(/^tips\[(\d+)\]/.exec(f.field)?.[1] ?? -1);
        const tips = [...(current.tips ?? [])];
        if (tips[idx]) { tips[idx] = { ...tips[idx], body: '' }; current = { ...current, tips } as T; }
        report?.blocked.push({ field: f.field, text: f.text, verdict: 'OVER_CAP',
          problem: `${f.text.length} characters against a cap of ${cap}, with no sentence or clause `
            + `boundary inside it`, outcome: 'slide removed — cutting it would have shipped a fragment' });
      } else {
        // Left long and reported. A field that renders slightly over is a layout problem; a field
        // cut mid-phrase is a lie about what the writer said.
        report?.blocked.push({ field: f.field, text: f.text, verdict: 'OVER_CAP',
          problem: `${f.text.length} characters against a cap of ${cap}, with no boundary to shorten at`,
          outcome: 'left whole — never cut mid-phrase' });
      }
    }
  }
  // A prose card still stopping mid-sentence is cut back to its last complete sentence. Losing a
  // clause beats publishing a fragment; this only runs when a rewrite could not fit the point.
  for (const f of planFields(current)) {
    if (incompleteBody(f.field, f.text)) {
      const whole = f.text.replace(/\s*[^.!?…]*$/, '').trim();
      if (whole.length >= 40) {
        current = writeField(current, f.field, whole);
        if (report) report.dropped++;
      }
    }
  }
  for (const f of planFields(current)) {
    if (endsMidThought(f.text)) {
      current = writeField(current, f.field,
        f.text.replace(/\s+\S+$/, '').replace(/[\s,;:—–-]+$/, ''));
    }
  }
  return current;
}
