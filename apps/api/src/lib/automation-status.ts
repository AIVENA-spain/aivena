/**
 * What automation is actually running, as far as the API is concerned.
 *
 * MUST agree with apps/dashboard/lib/automation-status.ts. tools/feature-truth-lint.mjs fails if the
 * two disagree. Two declarations exist only because the dashboard and the API deploy separately;
 * the lint is what stops them drifting apart.
 *
 * LEAD_SCORING_LIVE: the legacy n8n 2A pipeline wrote leads.score and leads.temperature, last on
 * 2026-06-19, and nothing in the live path calls it. While this is false, nothing the API derives
 * from those columns may present them as current intelligence. On 2026-09-11 the AIVENA Brief was
 * found stating "Marte is a warm lead (score 75)" from that stale June data.
 */
export const LEAD_SCORING_LIVE = false;

/**
 * LEAD_SCORING_AGENCIES — which agencies the real-lead scorer (lead-scoring/worker.ts) may run for.
 * Stage 2 (approved by Christian 2026-09-12): the demo agency ONLY, in shadow mode. The scorer writes one internal
 * record per run and never touches the lead, and every other agency is refused before any database call. Changing this
 * list takes a reviewed commit, and tools/feature-truth-lint.mjs fails unless the register's automatic-lead-scoring
 * row names exactly the same agencies (scoring_enabled_for).
 */
export const LEAD_SCORING_AGENCIES: readonly string[] = ['demo-costa-homes-pilot01'];

/**
 * LEAD_SCORING_MODE — 'shadow' writes only an internal audit record (ai_classifications), never the lead. 'write'
 * (Stage 3) does not exist yet, and the lint refuses it while LEAD_SCORING_LIVE is false.
 */
export const LEAD_SCORING_MODE: 'shadow' | 'write' = 'shadow';

/**
 * The stop-only brake (Christian, 2026-09-12). With LEAD_SCORING_PAUSED=true on the server, every run stops before any
 * database call. It can only stop scoring: no setting can start it, because the agency list above lives in code and
 * the truth register must name exactly the same agencies.
 */
export const scoringPaused = (): boolean => String(process.env.LEAD_SCORING_PAUSED ?? '').trim().toLowerCase() === 'true';
