/**
 * Every API route that shows a score gets it from here (Stage 3b, Christian 2026-09-13: "no fake or stale score can look
 * live again"). It reads the lead's own score columns — never a score a task saved earlier — keeps only what
 * live-score.ts allows, and adds the live urgency signal. It FAILS CLOSED: if the read fails, no score is shown for that
 * request, never an old one. Each read runs in a savepoint, so a failure here cannot break the rest of the route.
 */
import { sql } from 'drizzle-orm';
import type { Tx } from '../../../../packages/db/client';
import { LEAD_SCORING_LIVE } from '../lib/automation-status';
import { safeErr } from '../lib/safe-error';
import { liveScoreOf, type LeadScoreColumns, type LiveScore } from './live-score';
import { SERVICE_SOURCE } from './source';
import { urgencyOf, type UrgencySignal } from './urgency';

export type LeadScoreView = {
  score: number | null;
  temperature: string | null;
  /** The live score with its provenance, or null. */
  scoring: LiveScore | null;
  urgency: UrgencySignal[];
};

export const noScore = (): LeadScoreView => ({ score: null, temperature: null, scoring: null, urgency: [] });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: string | Date | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : Number.isNaN(Date.parse(String(v))) ? null : new Date(String(v)).toISOString();

type Row = LeadScoreColumns & { lead_id: string; last_inbound_at: string | Date | null; last_outbound_at: string | Date | null };

export async function leadScoreViews(
  tx: Tx,
  leadIds: ReadonlyArray<string | null | undefined>,
  now: Date = new Date(),
): Promise<Map<string, LeadScoreView>> {
  const out = new Map<string, LeadScoreView>();
  const ids = [...new Set(leadIds.filter((x): x is string => typeof x === 'string' && UUID.test(x)))];
  if (!LEAD_SCORING_LIVE || ids.length === 0) return out;
  try {
    const rows = (await tx.transaction(async (sp) =>
      sp.execute(sql`
        SELECT l.id::text AS lead_id, l.score, l.temperature, l.scored_at, l.score_source, l.score_rubric_version,
               l.score_model, l.score_band, l.score_message_count, l.score_cost_usd, l.score_viewing_date,
               l.reasoning_summary,
               (SELECT max(cm.created_at) FROM conversation_messages cm
                 WHERE cm.lead_id = l.id AND cm.direction = 'inbound') AS last_inbound_at,
               (SELECT max(cm.created_at) FROM conversation_messages cm
                 WHERE cm.lead_id = l.id AND cm.direction = 'outbound'
                   AND COALESCE(cm.status, '') NOT IN ('failed', 'undelivered', 'cancelled')) AS last_outbound_at
          FROM leads l
         WHERE l.agency_id = current_setting('app.current_agency_id', true)
           AND l.score_source = ${SERVICE_SOURCE}
           AND l.id = ANY (string_to_array(${ids.join(',')}, ',')::uuid[])`),
    )) as unknown as Row[];
    for (const r of rows) {
      const scoring = liveScoreOf(r);
      if (!scoring) continue;
      out.set(r.lead_id, {
        score: scoring.score,
        temperature: scoring.temperature,
        scoring,
        urgency: urgencyOf({
          lastInboundAt: iso(r.last_inbound_at),
          lastOutboundAt: iso(r.last_outbound_at),
          viewingDate: scoring.viewingDate,
          now: now.toISOString(),
        }),
      });
    }
  } catch (err) {
    console.error('[lead-scores] read failed, so no score is shown:', safeErr(err));
    return new Map();
  }
  return out;
}

export const viewFor = (views: ReadonlyMap<string, LeadScoreView>, leadId: string | null | undefined): LeadScoreView =>
  (leadId ? views.get(leadId) : undefined) ?? noScore();

/** Replaces any score/temperature on RPC rows (keyed by `idKey`) with the lead's live values, and adds provenance. */
export async function withLiveScores<T extends Record<string, unknown>>(tx: Tx, rows: T[], idKey: string): Promise<T[]> {
  const views = await leadScoreViews(tx, rows.map((r) => (typeof r[idKey] === 'string' ? (r[idKey] as string) : null)));
  return rows.map((r) => {
    const v = viewFor(views, typeof r[idKey] === 'string' ? (r[idKey] as string) : null);
    const next: Record<string, unknown> = { ...r, scoring: v.scoring, urgency: v.urgency };
    if ('score' in r) next.score = v.score;
    if ('temperature' in r) next.temperature = v.temperature;
    if ('lead_score' in r) next.lead_score = v.score;
    return next as T;
  });
}

/** Hot Leads: live scores only, hot AND super-hot. Null while scoring is not live. */
export async function countLiveHotLeads(tx: Tx): Promise<number | null> {
  if (!LEAD_SCORING_LIVE) return null;
  try {
    const r = (await tx.transaction(async (sp) =>
      sp.execute(sql`
        SELECT count(*)::int AS n FROM leads
         WHERE agency_id = current_setting('app.current_agency_id', true)
           AND score_source = ${SERVICE_SOURCE}
           AND temperature IN ('hot', 'super_hot')
           AND COALESCE(status, '') NOT IN ('closed', 'lost', 'do_not_contact', 'booked')`),
    )) as unknown as Array<{ n: number }>;
    return Number(r[0]?.n ?? 0);
  } catch (err) {
    console.error('[lead-scores] hot count failed:', safeErr(err));
    return null;
  }
}
