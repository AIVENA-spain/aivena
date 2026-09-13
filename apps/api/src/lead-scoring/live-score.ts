/**
 * The one rule for showing a score (Stage 3b, Christian 2026-09-13): "no fake or stale score can look live again".
 *
 * A score, temperature or scoring reason leaves the API only when BOTH hold:
 *   1. scoring is declared live (LEAD_SCORING_LIVE), and
 *   2. the lead's score carries the new scorer's provenance (score_source = SERVICE_SOURCE, with scored_at).
 * Anything else — the June scores from the legacy n8n pipeline, a score a task saved earlier, a score some other
 * writer might put on a lead tomorrow — is never displayed. No database access here: routes read the columns and pass
 * them in, so this rule is testable on its own.
 */
import { LEAD_SCORING_LIVE } from '../lib/automation-status';
import { SERVICE_SOURCE } from './source';

/** The lead columns the guard reads. */
export type LeadScoreColumns = {
  score?: number | string | null;
  temperature?: string | null;
  scored_at?: string | Date | null;
  score_source?: string | null;
  score_rubric_version?: string | null;
  score_model?: string | null;
  score_band?: string | null;
  score_message_count?: number | string | null;
  score_cost_usd?: number | string | null;
  score_viewing_date?: string | Date | null;
  reasoning_summary?: string | null;
};

/** A score that may be shown, with where it came from. */
export type LiveScore = {
  score: number | null;
  temperature: string | null;
  band: string | null;
  /** When the score was calculated (ISO). */
  scoredAt: string;
  rubricVersion: string | null;
  model: string | null;
  messageCount: number | null;
  costUsd: number | null;
  /** The viewing date the scorer resolved (YYYY-MM-DD), for the urgency layer only. */
  viewingDate: string | null;
  /** The reason built from verified quotes only. */
  reason: string | null;
};

const iso = (v: string | Date | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : Number.isNaN(Date.parse(String(v))) ? null : new Date(String(v)).toISOString();
const num = (v: number | string | null | undefined): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const day = (v: string | Date | null | undefined): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m ? m[1]! : null;
};

export function liveScoreOf(row: LeadScoreColumns | null | undefined, live: boolean = LEAD_SCORING_LIVE): LiveScore | null {
  if (!live || !row || row.score_source !== SERVICE_SOURCE) return null;
  const scoredAt = iso(row.scored_at);
  if (!scoredAt) return null;
  return {
    score: num(row.score),
    temperature: row.temperature ?? null,
    band: row.score_band ?? null,
    scoredAt,
    rubricVersion: row.score_rubric_version ?? null,
    model: row.score_model ?? null,
    messageCount: num(row.score_message_count),
    costUsd: num(row.score_cost_usd),
    viewingDate: day(row.score_viewing_date),
    reason: row.reasoning_summary ?? null,
  };
}
