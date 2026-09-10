/**
 * What automation is ACTUALLY running — and therefore what the UI is allowed to claim.
 *
 * WHY THIS FILE EXISTS
 * Every lead rendered "Follow-up active" with a green dot, directly above the line
 * "No follow-up scheduled". The dot was driven by `followup_paused === false`, which is the
 * column default, so it said "active" for every lead ever created while nothing followed up.
 *
 * Investigated 2026-09-10: the legacy n8n chain 1A Lead Intake -> 2A Lead Scoring ->
 * 3A Follow-Up Engine is wired correctly inside n8n, but nothing calls 1A's webhook — the live
 * path (Twilio -> twilio-whatsapp-inbound -> leads/conversations -> amanda-engine) bypasses it.
 * Evidence: 0 executions for 1A/2A/3A against a store holding 1,469; no caller found in the repo,
 * pg_cron, Edge Functions, Supabase or dashboard actions; last lead scored 2026-06-19; zero leads
 * with a follow-up scheduled.
 *
 * So: leads still carry June scores, and nothing schedules follow-ups. The data is real but the
 * ENGINE is not running, and the UI must not present stale output as live intelligence.
 *
 * WHEN AUTOMATION IS TURNED ON, CHANGE IT HERE. This is deliberately one declaration rather than
 * a flag per component, so the UI can never drift out of step with reality in one place while
 * telling the truth in another.
 */

export type EngineStatus = "running" | "not_running";

export const AUTOMATION: {
  /** 2A Lead Scoring + Enrichment v2 — writes leads.score / leads.temperature. */
  leadScoring: EngineStatus;
  /** 3A Follow-Up Engine v2 — schedules and enqueues automatic follow-ups. */
  automaticFollowUps: EngineStatus;
} = {
  leadScoring: "not_running",
  automaticFollowUps: "not_running",
};

/* ── follow-up ─────────────────────────────────────────────────────────────── */

export type FollowUpState =
  | "paused"      // a human explicitly paused it — honest either way
  | "scheduled"   // a real future follow-up exists, whatever put it there
  | "not_active"; // nothing scheduled AND no engine running to schedule one

/**
 * A follow-up may only be shown as active when something concrete is scheduled.
 *
 * `followup_paused === false` is NOT evidence of anything — it is the column default. The only
 * positive evidence available to the dashboard is a real `next_followup_at` in the future.
 * (A row already queued in send_queue would also count, but the lead payload does not carry
 * that; if it is added later, admit it here rather than in a component.)
 */
export function followUpState(input: {
  nextFollowUpAt?: string | null;
  paused?: boolean | null;
  now?: Date;
}): FollowUpState {
  if (input.paused === true) return "paused";
  const raw = input.nextFollowUpAt;
  if (raw) {
    const at = new Date(raw).getTime();
    const now = (input.now ?? new Date()).getTime();
    if (Number.isFinite(at) && at > now) return "scheduled";
  }
  return "not_active";
}

/* ── scoring ───────────────────────────────────────────────────────────────── */

export type ScoreState =
  | "live"        // scoring engine running and this lead has a score
  | "legacy"      // a score exists, but no engine is running to produce or refresh it
  | "unavailable"; // no score, and nothing running to produce one

/**
 * A number on screen implies something computed it recently. While the scoring engine is not
 * running, any score is a historical artefact and must be labelled as one — never shown as
 * fresh intelligence, and never shown as a bare number beside live fields.
 */
export function scoreState(input: {
  score?: number | null;
  temperature?: string | null;
}): ScoreState {
  const hasValue = input.score != null || (input.temperature ?? "") !== "";
  if (AUTOMATION.leadScoring === "running") return hasValue ? "live" : "unavailable";
  return hasValue ? "legacy" : "unavailable";
}

/** True when the UI may present scoring output as current, live intelligence. */
export function scoringIsLive(): boolean {
  return AUTOMATION.leadScoring === "running";
}

/** True when the UI may present automatic follow-ups as a working feature. */
export function followUpsAreLive(): boolean {
  return AUTOMATION.automaticFollowUps === "running";
}
