import { THRESHOLDS, CandidateScore } from "./types";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const close = (a: number, b: number, ref: number) => clamp01(1 - Math.abs(a - b) / (ref || 1));

// GLOBAL feature weights (v1). contrast + stem carry it: contrast separates sans/serif AND Text/Display;
// stem separates weight; category guards; x-height when measurable. Tuned on #4 (see recalibration.md).
export const FEATURE_WEIGHTS = { contrast: 0.42, stem: 0.33, x: 0.1, cat: 0.15 };
export const SHAPE_FLOOR = 0.5; // shape-mode confidence gate (a wrong-shaped font cannot pass)

export interface SourceProfile {
  metric_h: number; stem: number; contrast: number; stemRatio: number; xRatio: number | null;
  ink_left: number; baseline: number; width: number; inferred_category: "sans" | "serif";
}
export interface ShapeSignals { shape: number; scaleX: number; pixel: number; }
export interface CandMeasured { stemRatio: number; contrast: number; xRatio: number; }

export function scoreCandidate(
  cand: { id: string; verified_family: string; label?: string; weight: number; style: string; category: string },
  cm: CandMeasured,
  src: SourceProfile,
  mode: "shape" | "metric",
  shapeSig: ShapeSignals | null,
  rendered_ok: boolean,
): CandidateScore {
  const stem = close(cm.stemRatio, src.stemRatio, src.stemRatio);
  const contrastFit = close(cm.contrast, src.contrast, src.contrast);
  const xFit = src.xRatio != null ? close(cm.xRatio, src.xRatio, src.xRatio) : 1; // neutral when source x-height not measurable
  const catScore = cand.category === src.inferred_category ? 1 : (cand.category === "display" && src.inferred_category === "serif" ? 0.85 : 0.4);
  const W = FEATURE_WEIGHTS;
  let composite = W.contrast * contrastFit + W.stem * stem + W.x * xFit + W.cat * catScore;
  if (!rendered_ok) composite = 0;
  const shape = shapeSig ? shapeSig.shape : 0;
  const pixel = shapeSig ? shapeSig.pixel : 0;
  const spacing = shapeSig ? clamp01(1 - Math.abs(Math.log(shapeSig.scaleX || 1)) / 0.3) : 0;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return { font_id: cand.id, family: cand.label || cand.verified_family, weight: cand.weight, style: cand.style, composite: r3(composite), shape: r3(shape), stem: r3(stem), spacing: r3(spacing), pixel: r3(pixel), metric_fit: r3(contrastFit), rendered_ok };
}

export function confidenceOf(best: number, separation: number): number {
  return Math.round(best * Math.max(0.5, Math.min(1, 0.5 + separation / 0.12)) * 1000) / 1000;
}

export function decide(confidence: number, separation: number, rendered_ok: boolean, bestComposite: number): "accept" | "review" | "fail" {
  if (!rendered_ok) return "fail";
  if (confidence >= THRESHOLDS.high && separation >= THRESHOLDS.high_separation) return "accept";
  if (confidence >= THRESHOLDS.medium) return "review";
  if (bestComposite >= 0.78 && separation < THRESHOLDS.high_separation) return "review"; // ambiguous (near-identical) -> review
  return "fail";
}
