import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db, withAgency } from '../../../../../packages/db/client';
import { LEAD_SCORING_LIVE, LEAD_SCORING_MODE } from '../../lib/automation-status';
import { safeErr } from '../../lib/safe-error';
import { getLlmKey } from '../amanda-llm';
import { anthropicCaller, type ModelCall } from '../../lead-scoring/extract';
import { scoreConversation } from '../../lead-scoring/score-conversation';
import { SERVICE_SOURCE } from '../../lead-scoring/source';
import { planLead, rescoreAllowed, type RescoreAction, type RescoreLeadRow } from '../../lead-scoring/rescore-plan';
import { buildScoringInput, readLeadConversation, writeLeadScore, writeShadowRecord } from '../../lead-scoring/worker';

/**
 * Admin → Scoring check → Re-score (internal, staff only; built in Stage 3b, run in Stage 3c on Christian's go).
 *
 *   GET  /dry-run   Lead by lead, across every active agency, exactly what go-live would do. Reads only.
 *   POST /execute   Does it. REFUSES unless scoring is declared live AND in write mode (Stage 3c), and needs
 *                   { confirm: "RESCORE" }.
 *
 * What go-live does to a lead (Christian 2026-09-13): June's legacy scoring output — score, temperature, scored_at,
 * intent, urgency and the reasoning sentence — is first archived in an internal record, then cleared, so nothing from June
 * can appear live. A lead the scorer can read is then scored for real, with provenance. A lead it cannot read stays
 * cleared ("not scored yet"). A live score is never cleared.
 */
const route = new Hono();

const MAX_LEADS_PER_EXECUTE = 50;

async function activeAgencies(): Promise<string[]> {
  const r = (await db.execute(sql`SELECT public.lead_scoring_active_agencies() AS id`)) as unknown as Array<{ id: string }>;
  return r.map((x) => String(x.id));
}

async function leadsOf(agencyId: string): Promise<RescoreLeadRow[]> {
  return withAgency(agencyId, async (tx) =>
    (await tx.execute(sql`
      SELECT l.id::text AS lead_id, l.full_name, l.status, l.opt_in_status, l.score, l.temperature, l.scored_at,
             l.intent, l.urgency, (l.reasoning_summary IS NOT NULL) AS has_reasoning, l.score_source,
             (SELECT count(*)::int FROM conversation_messages cm
               WHERE cm.lead_id = l.id AND cm.direction = 'inbound') AS inbound_messages
        FROM leads l
       WHERE l.agency_id = current_setting('app.current_agency_id', true)
       ORDER BY l.full_name NULLS LAST, l.id`)) as unknown as RescoreLeadRow[],
  );
}

route.get('/dry-run', async (c) => {
  try {
    const agencies = [];
    for (const agencyId of await activeAgencies()) {
      const plans = (await leadsOf(agencyId)).map(planLead);
      agencies.push({ agencyId, leads: plans });
    }
    const all = agencies.flatMap((a) => a.leads);
    const count = (a: RescoreAction) => all.filter((p) => p.action === a).length;
    const toScore = count('rescore') + count('rescore_and_clear_legacy');
    return c.json({
      ok: true,
      live: LEAD_SCORING_LIVE,
      mode: LEAD_SCORING_MODE,
      canExecute: rescoreAllowed(),
      agencies,
      totals: {
        leads: all.length,
        rescoreAndClearLegacy: count('rescore_and_clear_legacy'),
        clearLegacy: count('clear_legacy'),
        rescore: count('rescore'),
        nothing: count('nothing'),
        estimatedCostUsd: Number((toScore * 0.008).toFixed(3)),
        maxCostUsd: Number((toScore * 0.02).toFixed(3)),
      },
    });
  } catch (err) {
    console.error('[scoring-rescore] dry run failed:', safeErr(err));
    return c.json({ ok: false, error: 'Could not prepare the re-score dry run.' }, 500);
  }
});

/** Archives June's legacy scoring output for one lead, then clears it. Never touches a live score. */
async function archiveAndClear(agencyId: string, leadId: string): Promise<void> {
  await withAgency(agencyId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO ai_classifications
        (agency_id, lead_id, service_source, classification_type, output, classification, requires_human_review,
         model_used, tokens_used, cost_usd, classified_at)
      SELECT l.agency_id, l.id, ${SERVICE_SOURCE}, 'legacy_score_archived',
             jsonb_build_object('score', l.score, 'temperature', l.temperature, 'scored_at', l.scored_at,
                                'intent', l.intent, 'urgency', l.urgency, 'reasoning_summary', l.reasoning_summary,
                                'archived_because', 'Stage 3c: legacy scoring output must never appear live'),
             'legacy_archived', false, 'none', 0, 0, now()
        FROM leads l
       WHERE l.id = ${leadId}::uuid
         AND l.agency_id = current_setting('app.current_agency_id', true)
         AND l.score_source IS DISTINCT FROM ${SERVICE_SOURCE}`);
    await tx.execute(sql`
      UPDATE leads
         SET score = NULL, temperature = NULL, scored_at = NULL, intent = NULL, urgency = NULL, reasoning_summary = NULL
       WHERE id = ${leadId}::uuid
         AND agency_id = current_setting('app.current_agency_id', true)
         AND score_source IS DISTINCT FROM ${SERVICE_SOURCE}`);
  });
}

/** Scores one lead now, exactly as the worker would, and writes the score with its provenance. */
async function scoreNow(agencyId: string, leadId: string, call: ModelCall): Promise<{ ok: boolean; score: number | null; band: string | null; error: string | null }> {
  return withAgency(agencyId, async (tx) => {
    const { conversation, earlier } = await readLeadConversation(tx, leadId);
    const built = buildScoringInput(new Date().toISOString(), conversation, earlier);
    const scored = await scoreConversation(built.input, call);
    const runId = await writeShadowRecord(tx, agencyId, leadId, scored, [agencyId], built, 'write');
    await writeLeadScore(tx, agencyId, leadId, scored, runId, built, [agencyId]);
    return { ok: scored.ok, score: scored.score, band: scored.band, error: scored.error };
  });
}

route.post('/execute', async (c) => {
  if (!rescoreAllowed()) {
    return c.json({ ok: false, error: 'Scoring is not live yet. Re-scoring runs only at go-live (Stage 3c).' }, 409);
  }
  const body = (await c.req.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm !== 'RESCORE') return c.json({ ok: false, error: 'Confirm the re-score first.' }, 400);
  const call = anthropicCaller(getLlmKey);
  const results = [];
  let done = 0;
  try {
    for (const agencyId of await activeAgencies()) {
      for (const plan of (await leadsOf(agencyId)).map(planLead)) {
        if (plan.action === 'nothing') continue;
        if (done >= MAX_LEADS_PER_EXECUTE) break;
        done += 1;
        if (plan.action === 'clear_legacy' || plan.action === 'rescore_and_clear_legacy') await archiveAndClear(agencyId, plan.leadId);
        const outcome = plan.action === 'clear_legacy' ? null : await scoreNow(agencyId, plan.leadId, call);
        results.push({ agencyId, leadId: plan.leadId, action: plan.action, outcome });
      }
    }
    console.info(`[scoring-rescore] executed for ${results.length} lead(s)`);
    return c.json({ ok: true, results });
  } catch (err) {
    console.error('[scoring-rescore] execute failed:', safeErr(err));
    return c.json({ ok: false, error: 'The re-score stopped part-way. Run the dry run again to see where it stands.', results }, 500);
  }
});

export default route;
