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
 * EMPTY = OFF (Stage 1, approved by Christian 2026-09-11): the worker is never started, and the scorer refuses every
 * agency before any database call. Changing it takes a reviewed commit, and tools/feature-truth-lint.mjs fails unless
 * the register's automatic-lead-scoring row names exactly the same agencies (scoring_enabled_for).
 */
export const LEAD_SCORING_AGENCIES: readonly string[] = [];

/**
 * LEAD_SCORING_MODE — 'shadow' writes only an internal audit record (ai_classifications), never the lead. 'write'
 * (Stage 3) does not exist yet, and the lint refuses it while LEAD_SCORING_LIVE is false.
 */
export const LEAD_SCORING_MODE: 'shadow' | 'write' = 'shadow';
