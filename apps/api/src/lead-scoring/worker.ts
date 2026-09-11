/**
 * The real-lead scorer. Stage 1 (Christian, 2026-09-11): BUILT BUT OFF.
 *
 * - It starts only when LEAD_SCORING_AGENCIES (lib/automation-status.ts) names an agency. The list is empty, so
 *   index.ts never starts it, and runScoringTick() returns before any database call.
 * - Even if called, it refuses every agency not on that list, before writing anything.
 * - Shadow mode only: each run writes ONE internal audit row (ai_classifications, service_source 'aivena_scoring_v1').
 *   It never writes the lead (score, temperature, summary, status), the send queue, tasks, events or messages. Nothing
 *   in the product reads ai_classifications; only gdpr_export_lead and gdpr_erase_lead do.
 *
 * Cadence (Christian, 2026-09-11): after a meaningful inbound message and 30 minutes of quiet, one conversation = one
 * run; at most 2 automatic runs per lead per day (the next morning catches up); an agency cap as cost safety only.
 */
import { sql } from 'drizzle-orm';
import type { Tx } from '../../../../packages/db/client';
import { LEAD_SCORING_AGENCIES, LEAD_SCORING_MODE } from '../lib/automation-status';
import { SCORING_MODEL, type ModelCall } from './extract';
import { RUBRIC_VERSION } from './rubric';
import { scoreConversation, type ScoredConversation } from './score-conversation';
import type { ConversationMessage } from './types';

export const SERVICE_SOURCE = 'aivena_scoring_v1';
export const QUIET_MINUTES = 30;
export const MAX_RUNS_PER_LEAD_PER_DAY = 2;
export const AGENCY_DAILY_CAP = 200;
export const LEADS_PER_TICK = 5;
export const MESSAGES_PER_RUN = 30;
export const TICK_MS = 60_000;

export const shouldStartScoringWorker = (allowed: readonly string[] = LEAD_SCORING_AGENCIES): boolean => allowed.length > 0;
export const scoringAllowedFor = (agencyId: string, allowed: readonly string[] = LEAD_SCORING_AGENCIES): boolean =>
  allowed.includes(agencyId);

// Greetings, thanks and acknowledgements in the 13 dashboard languages. Anything else counts as meaningful.
const TRIVIAL = new Set([
  'ok', 'okay', 'okey', 'okei', 'oke', 'k', 'yes', 'no', 'ja', 'nei', 'nee', 'si', 'sí', 'oui', 'non', 'tak',
  'thanks', 'thank you', 'thx', 'ty', 'takk', 'tusen takk', 'tack', 'tak skal du have', 'gracias', 'merci', 'danke',
  'dank je', 'dank u', 'bedankt', 'kiitos', 'dziękuję', 'dzięki', 'obrigado', 'obrigada', 'grazie', 'спасибо',
  'hi', 'hello', 'hey', 'hei', 'hej', 'hola', 'hallo', 'moi', 'cześć', 'olá', 'ola', 'ciao', 'привет', 'bonjour',
  'good', 'great', 'perfect', 'fine', 'bra', 'perfecto', 'genial', 'super',
]);

export function isTrivialMessage(text: string): boolean {
  const t = String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t === '' || TRIVIAL.has(t);
}

/**
 * A burst counts when any new lead message is more than a greeting or thanks, or when a short reply answers a question
 * the agency asked in the hour before it ("ok" to "Shall I book Thursday at 17:00?").
 */
export function burstIsMeaningful(conversation: ConversationMessage[], sinceMs: number): boolean {
  for (let i = 0; i < conversation.length; i++) {
    const m = conversation[i]!;
    if (m.from !== 'lead' || Date.parse(m.at) <= sinceMs) continue;
    if (!isTrivialMessage(m.text)) return true;
    const prev = conversation.slice(0, i).reverse().find((x) => x.from === 'agency');
    if (prev && prev.text.trim().endsWith('?') && Date.parse(m.at) - Date.parse(prev.at) <= 60 * 60_000) return true;
  }
  return false;
}

export type DueRow = { lead_id: string; last_inbound_at: string | Date | null; last_run_at: string | Date | null; runs_today: number };
const toMs = (v: string | Date | null): number => (v == null ? NaN : v instanceof Date ? v.getTime() : Date.parse(String(v)));

/** Leads whose newest inbound message is newer than their last run, quiet for 30 minutes, under the daily per-lead cap. */
export function pickDueLeads(rows: DueRow[], nowMs: number, limit = LEADS_PER_TICK): DueRow[] {
  return rows
    .filter((r) => {
      const inbound = toMs(r.last_inbound_at);
      if (Number.isNaN(inbound)) return false;
      const lastRun = toMs(r.last_run_at);
      if (!Number.isNaN(lastRun) && inbound <= lastRun) return false;
      if (nowMs - inbound < QUIET_MINUTES * 60_000) return false;
      return Number(r.runs_today) < MAX_RUNS_PER_LEAD_PER_DAY;
    })
    .slice(0, limit);
}

/** Leads whose only new messages were trivial are not re-examined until a newer inbound arrives (per process). */
const trivialUntil = new Map<string, number>();

export type WorkerDeps = {
  allowed?: readonly string[];
  mode?: 'shadow' | 'write';
  withAgency: <T>(agencyId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;
  call: ModelCall;
  nowMs?: () => number;
};
export type TickResult = { agencies: number; scored: number; failed: number; skippedTrivial: number };

const rows = <T>(r: unknown): T[] => r as unknown as T[];
const toIso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
// Today in Madrid, as a timestamp: the per-lead and per-agency caps reset at local midnight.
const MADRID_TODAY = sql`(date_trunc('day', now() AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid')`;

export async function runScoringTick(deps: WorkerDeps): Promise<TickResult> {
  const allowed = deps.allowed ?? LEAD_SCORING_AGENCIES;
  const mode = deps.mode ?? LEAD_SCORING_MODE;
  const result: TickResult = { agencies: 0, scored: 0, failed: 0, skippedTrivial: 0 };
  if (!shouldStartScoringWorker(allowed)) return result; // OFF: returns before any database call
  if (mode !== 'shadow') throw new Error('lead scoring: only shadow mode exists in Stage 1');
  const now = deps.nowMs ?? Date.now;

  for (const agencyId of allowed) {
    if (!scoringAllowedFor(agencyId, allowed)) continue;
    result.agencies += 1;
    await deps.withAgency(agencyId, async (tx) => {
      const used = rows<{ n: number }>(
        await tx.execute(sql`
          SELECT count(*)::int AS n FROM ai_classifications
           WHERE agency_id = current_setting('app.current_agency_id', true)
             AND service_source = ${SERVICE_SOURCE} AND classified_at >= ${MADRID_TODAY}`),
      );
      let budget = AGENCY_DAILY_CAP - Number(used[0]?.n ?? 0);
      if (budget <= 0) return;

      const due = pickDueLeads(
        rows<DueRow>(
          await tx.execute(sql`
            SELECT l.id::text AS lead_id,
                   (SELECT max(cm.created_at) FROM conversation_messages cm
                     WHERE cm.lead_id = l.id AND cm.direction = 'inbound') AS last_inbound_at,
                   (SELECT max(ac.classified_at) FROM ai_classifications ac
                     WHERE ac.lead_id = l.id AND ac.service_source = ${SERVICE_SOURCE}) AS last_run_at,
                   (SELECT count(*)::int FROM ai_classifications ac
                     WHERE ac.lead_id = l.id AND ac.service_source = ${SERVICE_SOURCE}
                       AND ac.classified_at >= ${MADRID_TODAY}) AS runs_today
              FROM leads l
             WHERE l.agency_id = current_setting('app.current_agency_id', true)
               AND COALESCE(l.status, '') NOT IN ('closed', 'lost', 'booked', 'do_not_contact')
               AND COALESCE(l.opt_in_status, '') <> 'opted_out'`),
        ),
        now(),
      );

      for (const d of due) {
        if (budget <= 0) break;
        const inboundMs = toMs(d.last_inbound_at);
        if (trivialUntil.get(d.lead_id) === inboundMs) continue;
        const messages = rows<{ direction: string; content: string | null; created_at: string | Date }>(
          await tx.execute(sql`
            SELECT direction, content, created_at FROM conversation_messages
             WHERE agency_id = current_setting('app.current_agency_id', true) AND lead_id = ${d.lead_id}::uuid
             ORDER BY created_at DESC LIMIT ${MESSAGES_PER_RUN}`),
        ).reverse();
        const conversation: ConversationMessage[] = messages.map((m) => ({
          at: toIso(m.created_at),
          from: m.direction === 'inbound' ? 'lead' : 'agency',
          text: m.content ?? '',
        }));
        const lastRunMs = toMs(d.last_run_at);
        if (!burstIsMeaningful(conversation, Number.isNaN(lastRunMs) ? 0 : lastRunMs)) {
          trivialUntil.set(d.lead_id, inboundMs);
          result.skippedTrivial += 1;
          continue;
        }
        const scored = await scoreConversation({ now: new Date(now()).toISOString(), conversation }, deps.call);
        await writeShadowRecord(tx, agencyId, d.lead_id, scored, allowed);
        budget -= 1;
        if (scored.ok) result.scored += 1;
        else result.failed += 1;
      }
    });
  }
  return result;
}

/** The ONLY write the scorer can make in Stage 1: one internal audit row. Refuses any agency not allowed in code. */
export async function writeShadowRecord(
  tx: Tx,
  agencyId: string,
  leadId: string,
  s: ScoredConversation,
  allowed: readonly string[] = LEAD_SCORING_AGENCIES,
): Promise<void> {
  if (!scoringAllowedFor(agencyId, allowed)) throw new Error('lead scoring: agency not allowed');
  const output = {
    mode: 'shadow',
    rubric_version: RUBRIC_VERSION,
    ok: s.ok,
    error: s.error,
    score: s.score,
    band: s.band,
    temperature: s.temperature,
    explanation: s.explanation,
    facts: s.facts,
    discarded: s.discarded,
    guards: s.guards,
  };
  await tx.execute(sql`
    INSERT INTO ai_classifications
      (agency_id, lead_id, service_source, classification_type, output, classification, requires_human_review,
       model_used, tokens_used, cost_usd, classified_at)
    VALUES
      (current_setting('app.current_agency_id', true), ${leadId}::uuid, ${SERVICE_SOURCE}, 'lead_scoring',
       ${JSON.stringify(output)}::jsonb, ${s.ok && s.band ? s.band : 'failed'}, false,
       ${SCORING_MODEL}, ${s.inputTokens + s.outputTokens}, ${s.costUsd}, now())`);
}
