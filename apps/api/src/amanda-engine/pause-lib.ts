// Amanda engine — pure "is Amanda paused for this conversation?" rule (house
// pattern: importable without a database so tests need no env).
//
// FOUR stops, not three. Escalation (escalateToHuman) flags the lead
// needs_human_since, and the dashboard's "Needs a human" card then says "the
// assistant is paused for these clients — a person must reply". The engine only
// read the two conversation flags and the lead's claim, so that promise was
// false: on 2026-09-18 Amanda auto-replied twice to a lead flagged needs-human
// since 2026-08-31 (D-56). needs_human_since is also what the canonical
// ai_autoreply_blocked() predicate reads. Any of the four pauses her; only an
// explicit hand-back clears them.
export type PauseFlags = {
  convMutedAt: unknown;
  convClaimedAt: unknown;
  leadClaimedAt: unknown;
  leadNeedsHumanSince: unknown;
};

export type PauseReason = 'lead_needs_human' | 'ai_muted_or_human_claimed';

export function pauseReason(f: PauseFlags): PauseReason | null {
  if (f.leadNeedsHumanSince) return 'lead_needs_human';
  if (f.convMutedAt || f.convClaimedAt || f.leadClaimedAt) return 'ai_muted_or_human_claimed';
  return null;
}
