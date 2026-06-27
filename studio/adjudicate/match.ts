import path from "node:path";
import fs from "node:fs";
import { RGBA } from "../src/lib/render";
import { LayerSpec, THRESHOLDS, CandidateScore } from "../resolver/types";
import { LibFont, LoadedLibrary } from "../resolver/fontLibrary";
import { resolveLayer, ResolveOpts } from "../resolver/resolveLayer";
import { classifyTitle, HIGH_BAR, USABLE_BAR } from "../resolver/visualMatch";
import { visualScore } from "../resolver/visualMatch";
import { IntakeLayer, LayerOutcome, LayerLabel, Shortlisted } from "./types";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function shortlistLib(shortlist: Shortlisted[], version: string): LoadedLibrary {
  return { library_version: version, fonts: shortlist.map((s) => s.lib), warnings: [], excluded: [] };
}

function labelFromScore(score: number, selected: boolean, metadataReliable: boolean, rank1IsNamed: boolean): LayerLabel {
  if (!selected) return "needs_seed";
  if (score >= HIGH_BAR) return metadataReliable && rank1IsNamed ? "exact_metadata_match" : "verified_visual_match";
  if (score >= USABLE_BAR) return "visual_substitute";
  return "needs_seed";
}

// Visual scoring over the pre-filtered shortlist. Wraps the frozen v1 resolveLayer (and classifyTitle for
// shape mode) — no re-tuning. Computes per-layer leave-one-out from the layer's known-true font.
export async function matchLayer(
  sourceImg: RGBA, v1layer: LayerSpec, intake: IntakeLayer, shortlist: Shortlisted[],
  outDir: string, id: string, version: string, opts: ResolveOpts, mode: "faithful" | "production" = "faithful",
): Promise<LayerOutcome> {
  const lib = shortlistLib(shortlist, version);
  const renders: { font: LibFont; img: RGBA }[] = [];
  const srcBoxOut: any = { box: null };
  // resolveLayer always writes its own overlay/contact; route those into a work subdir so the canonical
  // adjudicate proof dir holds only <layer>.overlay.png / <layer>.contact.png (written by perLayerProof).
  const work = path.join(outDir, "_work"); fs.mkdirSync(work, { recursive: true });
  const res = await resolveLayer(sourceImg, v1layer, lib, work, id, { ...opts, collectRenders: renders, srcBoxOut });

  // leave-one-out: remove the known-true font, re-resolve on the shortlist; clean iff it does NOT accept.
  let leave_one_out_ok = true;
  if (intake.known_true_font) {
    const gt = norm(intake.known_true_font);
    const reduced: LoadedLibrary = { ...lib, fonts: lib.fonts.filter((f) => norm(f.label || f.verified_family) !== gt) };
    if (reduced.fonts.length && reduced.fonts.length < lib.fonts.length) {
      const work = path.join(outDir, "_work"); fs.mkdirSync(work, { recursive: true });
      const looRes = await resolveLayer(sourceImg, v1layer, reduced, work, id + "_loo", { ...opts });
      leave_one_out_ok = looRes.decision !== "accept";
    }
  }

  const metaReliable = intake.metadata_reliable;
  let score: number, separation: number, rank1_font: string, candidates: { font: string; score: number; rank: number }[];

  if (v1layer.match_mode === "shape") {
    const vm = classifyTitle(res.top, { metadata_font: intake.metadata_font || undefined, metadata_reliable: metaReliable, in_library: false });
    score = vm.best.visual_match_score!;
    separation = vm.separation;
    rank1_font = vm.best.family;
    candidates = vm.scored.slice(0, 4).map((c, i) => ({ font: c.family, score: c.visual_match_score!, rank: i + 1 }));
  } else {
    score = res.confidence;
    separation = res.separation;
    rank1_font = res.best.family;
    candidates = res.top.slice(0, 4).map((c, i) => ({ font: c.family, score: c.composite, rank: i + 1 }));
  }

  const selected = score >= USABLE_BAR && separation >= THRESHOLDS.high_separation && leave_one_out_ok;
  const rank1IsNamed = !!intake.metadata_font && norm(rank1_font) === norm(intake.metadata_font);
  const faithful_label = labelFromScore(score, selected, metaReliable, rank1IsNamed);

  // production-mode improvement override: deliberately pick an active vault font for a recorded MEASURABLE
  // reason. Honest — labelled visual_substitute (never exact/verified); faithful_label preserves the truth.
  let label = faithful_label;
  let selected_font: string | null = selected ? rank1_font : null;
  let selected_id: string | null = selected ? res.best.font_id : null;
  let improvement_reason: string | null = null;
  let outScore = score, outRank1 = rank1_font, reason: string;

  if (mode === "production" && intake.production_override) {
    const ov = intake.production_override;
    const ovEntry = candidates.find((c) => norm(c.font) === norm(ov.font));
    const ovTop = res.top.find((c) => norm(c.family) === norm(ov.font));
    if (!ovEntry || !ovTop) throw new Error(`production_override font '${ov.font}' for layer '${intake.id}' is not among the active candidates`);
    label = "visual_substitute";
    selected_font = ov.font; selected_id = ovTop.font_id;
    improvement_reason = ov.reason; outScore = ovEntry.score; outRank1 = ov.font;
    reason = `production improvement: ${ov.font} chosen for a measurable reason (faithful = ${faithful_label}). ${ov.reason}`;
  } else if (faithful_label === "needs_seed") {
    const why = score < USABLE_BAR ? `best active candidate ${rank1_font} ${score} < USABLE ${USABLE_BAR}` :
      !leave_one_out_ok ? `selection blocked: leave-one-out not clean (a wrong font would falsely accept)` :
      `separation ${separation} < ${THRESHOLDS.high_separation} (ambiguous)`;
    reason = `${why}${intake.metadata_font ? `; metadata claims ${intake.metadata_font}${metaReliable ? "" : " (UNRELIABLE)"}` : ""}`;
  } else {
    reason = `${rank1_font} selected (score ${score} >= ${score >= HIGH_BAR ? "HIGH " + HIGH_BAR : "USABLE " + USABLE_BAR}, separation ${separation}, leave-one-out clean)`;
  }

  return {
    id: intake.id, type: intake.type, match_mode: intake.match_mode,
    selected_font, selected_id,
    known_true_font: intake.known_true_font ?? null, downgraded_by_guard: false,
    faithful_label, label, score: outScore, rank1_font: outRank1, separation, leave_one_out_ok, measurement_quality: res.measurement_quality,
    improvement_reason, reason,
    shortlist_ids: shortlist.map((s) => s.entry.id), bbox: v1layer.layer_bbox as [number, number, number, number], candidates,
    ranked: res.top, renders, srcBox: srcBoxOut.box, raw: res,
    metadata_font: intake.metadata_font, metadata_reliable: metaReliable,
  };
}
