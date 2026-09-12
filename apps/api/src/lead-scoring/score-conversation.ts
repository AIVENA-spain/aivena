/**
 * Facts → evidence checks → dates → score → explanation, in one place. Used by the internal scoring check now and by
 * the real-lead scorer (worker.ts). The model call is passed in, so tests run without any AI or key.
 */
import { applyDates } from './dates';
import { checkEvidence, norm } from './evidence';
import { explain } from './explain';
import { extractFacts, type ModelCall } from './extract';
import { leadMessagesOf } from './lead-messages';
import { computeScore, temperatureOf } from './rubric';
import type { Band, Facts, ScoringInput, Temperature } from './types';

export type ScoredConversation = {
  ok: boolean;
  error: string | null;
  score: number | null;
  band: Band | null;
  temperature: Temperature;
  /** Built from verified facts only. */
  explanation: string | null;
  /** The facts that counted, after the evidence check, the guards and the dates. */
  facts: Facts | null;
  discarded: string[];
  guards: string[];
  /** What code made of the dates: a passed viewing, a horizon read from a real date. */
  timeNotes: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  stopReason: string | null;
};

export async function scoreConversation(input: ScoringInput, call: ModelCall): Promise<ScoredConversation> {
  const x = await extractFacts(input, call);
  const usage = { inputTokens: x.inputTokens, outputTokens: x.outputTokens, costUsd: x.costUsd, stopReason: x.stopReason };
  if (!x.ok) {
    return {
      ok: false, error: x.error, score: null, band: null, temperature: null, explanation: null, facts: null,
      discarded: [], guards: [], timeNotes: [], ...usage,
    };
  }
  const raw = leadMessagesOf(input);
  const ev = checkEvidence(x.facts, raw.map(norm), raw);
  const dated = applyDates(ev.facts, input.now);
  const r = computeScore(dated.facts, raw.length);
  return {
    ok: true,
    error: null,
    score: r.score,
    band: r.band,
    temperature: temperatureOf(r.score),
    explanation: explain(r, dated.facts),
    facts: dated.facts,
    discarded: ev.discarded,
    guards: ev.guards,
    timeNotes: dated.notes,
    ...usage,
  };
}
