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
