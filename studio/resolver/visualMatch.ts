import { CandidateScore, VisualLabel } from "./types";

// Bars from the v1 calibration (NOT re-tuned). USABLE is the "clearly close" bar, not a lenient floor.
export const HIGH_BAR = 0.85;
export const USABLE_BAR = 0.72;

// Visual-match score from the EXISTING ensemble signals (shape + contrast + stem + spacing). No re-tuning of
// the matcher; this is a read-only blend over the per-candidate signals resolveLayer already produced.
export function visualScore(c: CandidateScore): number {
  return Math.round((0.35 * c.shape + 0.3 * c.metric_fit + 0.2 * c.stem + 0.15 * c.spacing) * 1000) / 1000;
}

export interface VisualMatchResult {
  scored: CandidateScore[];
  best: CandidateScore;
  separation: number;
  label: VisualLabel;
  gate_pass: boolean;
  notes: string[];
}

export function classifyTitle(ranked: CandidateScore[], metadata: { metadata_font?: string; metadata_reliable?: boolean; in_library?: boolean }): VisualMatchResult {
  const scored = ranked.map((c) => ({ ...c, visual_match_score: visualScore(c) })).sort((a, b) => (b.visual_match_score! - a.visual_match_score!));
  const best = scored[0];
  const separation = scored[1] ? Math.round((best.visual_match_score! - scored[1].visual_match_score!) * 1000) / 1000 : best.visual_match_score!;
  const s = best.visual_match_score!;
  const notes: string[] = [];
  const metaExact = !!metadata.metadata_reliable && !!metadata.in_library;

  let label: VisualLabel;
  if (metaExact && s >= USABLE_BAR) { label = "exact_metadata_match"; }
  else if (s >= HIGH_BAR) { label = "verified_visual_match"; notes.push("tight visual match by pixels, not by a reliable name"); }
  else if (s >= USABLE_BAR) { label = "visual_substitute"; notes.push("usable but moderate — NOT exact, NOT source-faithful; verify the contact-sheet looks clearly close"); }
  else { label = "needs_seed"; notes.push(`best local visual score ${s} < USABLE ${USABLE_BAR} — nothing clearly close; recommend seeding a licensed metric-equivalent`); }

  if (metadata.metadata_reliable === false) notes.push(`metadata font "${metadata.metadata_font}" is UNRELIABLE (label/pixels disagree); never an exact_metadata_match`);
  // A passing substitute must NEVER be recorded as exact/source-faithful (enforced by the label set).
  const gate_pass = label === "verified_visual_match" || label === "visual_substitute";
  return { scored, best, separation, label, gate_pass, notes };
}
