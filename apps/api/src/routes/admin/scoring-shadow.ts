import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { withAgency } from '../../../../../packages/db/client';
import { LEAD_SCORING_AGENCIES, LEAD_SCORING_MODE, scoringPaused } from '../../lib/automation-status';
import { SERVICE_SOURCE } from '../../lead-scoring/worker';
import { safeErr } from '../../lib/safe-error';

/**
 * Admin → Scoring check → Shadow results (internal, staff only; Stage 2, approved by Christian 2026-09-12).
 *
 * READ ONLY. It reads the scorer's own internal records for the agencies scoring is switched on for, with each lead's
 * stored score beside them for comparison, and it changes nothing at all. Agencies cannot reach it: the whole
 * /api/v1/admin surface answers every non-staff caller with 404.
 */
const route = new Hono();
const LIMIT = 50;

type Row = {
  id: string;
  lead_id: string | null;
  lead_name: string | null;
  classified_at: string | Date;
  classification: string | null;
  output: Record<string, unknown> | null;
  tokens_used: number | null;
  cost_usd: string | number | null;
  stored_score: number | null;
  stored_temperature: string | null;
  stored_scored_at: string | Date | null;
};

const iso = (v: string | Date | null): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

route.get('/', async (c) => {
  try {
    const runs = [];
    for (const agencyId of LEAD_SCORING_AGENCIES) {
      const rows = (await withAgency(agencyId, async (tx) =>
        tx.execute(sql`
          SELECT ac.id::text AS id,
                 ac.lead_id::text AS lead_id,
                 COALESCE(to_jsonb(l)->>'name', to_jsonb(l)->>'full_name', to_jsonb(l)->>'first_name') AS lead_name,
                 ac.classified_at,
                 ac.classification,
                 ac.output,
                 ac.tokens_used,
                 ac.cost_usd,
                 l.score AS stored_score,
                 l.temperature AS stored_temperature,
                 l.scored_at AS stored_scored_at
            FROM ai_classifications ac
            LEFT JOIN leads l ON l.id = ac.lead_id
           WHERE ac.agency_id = current_setting('app.current_agency_id', true)
             AND ac.service_source = ${SERVICE_SOURCE}
           ORDER BY ac.classified_at DESC
           LIMIT ${LIMIT}`),
      )) as unknown as Row[];

      for (const r of rows) {
        const out = (r.output ?? {}) as {
          ok?: boolean;
          error?: string | null;
          score?: number | null;
          band?: string | null;
          temperature?: string | null;
          explanation?: string | null;
          discarded?: unknown;
          guards?: unknown;
          rubric_version?: string | null;
          input?: { messages?: number; earlier_lead_messages?: number; trimmed?: string | null } | null;
        };
        runs.push({
          id: r.id,
          agencyId,
          leadId: r.lead_id,
          leadName: r.lead_name,
          classifiedAt: iso(r.classified_at) ?? '',
          ok: out.ok !== false,
          error: out.error ?? null,
          score: out.score ?? null,
          band: out.band ?? r.classification ?? null,
          temperature: out.temperature ?? null,
          explanation: out.explanation ?? null,
          discarded: strings(out.discarded),
          guards: strings(out.guards),
          rubricVersion: out.rubric_version ?? null,
          messagesSeen: out.input?.messages ?? null,
          earlierMessagesSeen: out.input?.earlier_lead_messages ?? null,
          trimmed: out.input?.trimmed ?? null,
          tokens: r.tokens_used ?? null,
          costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
          storedScore: r.stored_score ?? null,
          storedTemperature: r.stored_temperature ?? null,
          storedScoredAt: iso(r.stored_scored_at),
        });
      }
    }
    runs.sort((a, b) => (a.classifiedAt < b.classifiedAt ? 1 : -1));
    return c.json({
      ok: true,
      agencies: [...LEAD_SCORING_AGENCIES],
      mode: LEAD_SCORING_MODE,
      paused: scoringPaused(),
      runs: runs.slice(0, LIMIT),
    });
  } catch (err) {
    console.error('[scoring-shadow] failed:', safeErr(err));
    return c.json({ ok: false, error: 'Could not load the shadow results.' }, 500);
  }
});

export default route;
