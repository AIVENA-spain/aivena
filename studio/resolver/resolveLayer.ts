import path from "node:path";
import { RGBA } from "../src/lib/render";
import { LayerSpec, LayerResult, CandidateScore } from "./types";
import { LibFont, LoadedLibrary, abs } from "./fontLibrary";
import { metricHeight, regionOf, inkBox, renderStringRGBA, detectLine, measureFeatures, relThreshold, Features } from "./glyphMetrics";
import { toMask, scaleMask, iouShift } from "./align";
import { scoreCandidate, confidenceOf, decide, SourceProfile, SHAPE_FLOOR } from "./score";
import { makeOverlay, makeContactSheet } from "./proof";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export interface ResolveOpts { ss: number; k: number; shapeFloor: number; measureLog: string[]; collectRenders?: { font: LibFont; img: RGBA }[]; srcBoxOut?: { box: any }; }

// §3.4 measurement self-check: flag unreliable rather than emit a confident wrong number.
function selfCheck(feat: Features): { unreliable: boolean; reason: string } {
  if (feat.peak < 70) return { unreliable: true, reason: `peak_luma ${Math.round(feat.peak)} < 70 (layer too dim/close to cut)` };
  if (feat.metricH < 6) return { unreliable: true, reason: `metric height ${feat.metricH}px too small to measure` };
  if (feat.ink_high < 25) return { unreliable: true, reason: `too little ink above 0.7*peak (${feat.ink_high})` };
  return { unreliable: false, reason: "ok" };
}

export async function resolveLayer(sourceImg: RGBA, layer: LayerSpec, lib: LoadedLibrary, outDir: string, templateId: string, opts: ResolveOpts): Promise<LayerResult> {
  const { ss, k } = opts;
  const b0 = layer.ref_glyph_bbox || layer.layer_bbox;
  const fullRegion = regionOf([b0[0] * ss, b0[1] * ss, b0[2] * ss, b0[3] * ss]);
  const srcT0 = relThreshold(sourceImg, fullRegion, k);
  const region = layer.match_mode === "metric" ? (detectLine(sourceImg, fullRegion, srcT0) || fullRegion) : fullRegion;
  const feat = measureFeatures(sourceImg, region, k);
  const notes: string[] = [];
  notes.push(`match_mode=${layer.match_mode} (${layer.match_mode === "shape" ? "render-align on known text '" + layer.text + "' + features" : "content-independent features; source text NOT used"})`);
  if (!feat) return failResult(layer, "zero/low ink in region (fail-closed)", "measurement_failed");
  const q = selfCheck(feat);
  opts.measureLog.push(`[${templateId}.${layer.layer_id}] ss=${ss}x peak=${Math.round(feat.peak)} thr=${Math.round(feat.threshold)} metricH=${feat.metricH} stem=${feat.stem} contrast=${feat.contrast.toFixed(2)} stemRatio=${feat.stemRatio.toFixed(3)} ink_low/high=${feat.ink_low}/${feat.ink_high} self_check=${q.unreliable ? "UNRELIABLE:" + q.reason : "ok"} opacity_source=overlay-dimmed(SVG fill-opacity=1; adaptive threshold)`);
  const srcT = feat.threshold;
  const mh = metricHeight(sourceImg, region, srcT)!;
  const srcInkBox = { left: mh.left, top: mh.top, width: mh.right - mh.left + 1, height: mh.baseline - mh.top + 1, right: mh.right, bottom: mh.baseline, count: 0 };
  const src: SourceProfile = { metric_h: feat.metricH, stem: feat.stem, contrast: feat.contrast, stemRatio: feat.stemRatio, xRatio: null, ink_left: mh.left, baseline: mh.baseline, width: srcInkBox.width, inferred_category: feat.contrast < 1.35 ? "sans" : "serif" };
  notes.push(`src: metricH=${feat.metricH} contrast=${feat.contrast.toFixed(2)} stemRatio=${feat.stemRatio.toFixed(3)} inferred=${src.inferred_category} measurement=${q.unreliable ? "UNRELIABLE" : "ok"}`);

  let cands = lib.fonts.filter((f) => !layer.categories || layer.categories.includes(f.category as any));
  if (!cands.length) cands = lib.fonts;
  const renders: { font: LibFont; img: RGBA }[] = [];
  const scores: CandidateScore[] = [];
  for (const f of cands) {
    const size = feat.metricH / f.metrics.capRatio; // match source metric height (already at ss scale)
    const renderText = layer.match_mode === "shape" ? layer.text : "Hamburgevons";
    let img = await renderStringRGBA(f.verified_family, renderText, size, 1);
    const full = regionOf([0, 0, img.width - 1, img.height - 1]);
    const cf = measureFeatures(img, full, k);
    const rendered_ok = !!cf;
    const cm = cf ? { stemRatio: cf.stemRatio, contrast: cf.contrast, xRatio: f.metrics.xRatio } : { stemRatio: 0, contrast: 1, xRatio: f.metrics.xRatio };
    let shapeSig: any = null;
    if (layer.match_mode === "shape" && rendered_ok) {
      const cbb = inkBox(img, full, relThreshold(img, full, k))!;
      const scaleX = clampN(src.width / cbb.width, 0.5, 1.6);
      img = await renderStringRGBA(f.verified_family, renderText, size, scaleX);
      const cT = relThreshold(img, regionOf([0, 0, img.width - 1, img.height - 1]), k);
      const cm2 = metricHeight(img, regionOf([0, 0, img.width - 1, img.height - 1]), cT)!;
      const candCB = { left: cm2.left, top: cm2.top, width: cm2.right - cm2.left + 1, height: cm2.baseline - cm2.top + 1, right: cm2.right, bottom: cm2.baseline, count: 0 };
      const candMask = scaleMask(toMask(img, candCB, cT), srcInkBox.width, srcInkBox.height);
      const srcMask = toMask(sourceImg, srcInkBox, srcT);
      const fit = iouShift(srcMask, candMask, 10);
      shapeSig = { shape: fit.iou, scaleX, pixel: 1 - fit.xorUnion };
    }
    renders.push({ font: f, img });
    scores.push(scoreCandidate(f, cm, src, layer.match_mode, shapeSig, rendered_ok));
  }

  if (opts.collectRenders) opts.collectRenders.push(...renders);
  if (opts.srcBoxOut) opts.srcBoxOut.box = srcInkBox;
  const ranked = [...scores].sort((a, b) => b.composite - a.composite);
  const best = ranked[0], runner_up = ranked[1] || null;
  const separation = runner_up ? r3(best.composite - runner_up.composite) : best.composite;
  let confidence = confidenceOf(best.composite, separation);
  const shapeGate = layer.match_mode === "shape" ? clampN(best.shape / opts.shapeFloor, 0, 1) : 1;
  confidence = r3(confidence * shapeGate);
  let decision = decide(confidence, separation, best.rendered_ok, best.composite);
  if (q.unreliable) { decision = decision === "accept" ? "review" : decision; notes.push("measurement_failed -> capped at review (never a confident number on unreliable measurement)"); }
  const bestFont = lib.fonts.find((f) => f.id === best.font_id)!;

  let ground_truth_check: any = undefined;
  if (layer.ground_truth) {
    const gt = norm(layer.ground_truth.family);
    const idx = ranked.findIndex((c) => norm(c.family) === gt);
    ground_truth_check = { matched: norm(best.family) === gt, true_font_rank: idx >= 0 ? idx + 1 : null, true_font_composite: idx >= 0 ? ranked[idx].composite : null };
  }

  const bestRender = renders.find((r) => r.font.id === best.font_id)!;
  const overlay = path.join(outDir, `${templateId}.${layer.layer_id}.overlay.png`);
  const contact = path.join(outDir, `${templateId}.${layer.layer_id}.contact.png`);
  await makeOverlay(sourceImg, srcInkBox, bestRender.img, overlay);
  const top5 = ranked.slice(0, 5).map((s) => ({ label: `${s.family}  comp=${s.composite} contr=${s.metric_fit} stem=${s.stem}`, img: renders.find((r) => r.font.id === s.font_id)!.img }));
  await makeContactSheet(sourceImg, srcInkBox, top5, contact);

  if (decision !== "accept") notes.push("manifest_mapping withheld (decision != accept)");
  if (decision === "fail") notes.push("needs library seed (no confident match)");

  return {
    layer_id: layer.layer_id, decision, confidence, best, runner_up, separation, top: ranked.slice(0, 5), match_mode: layer.match_mode,
    measurement_quality: q.unreliable ? "unreliable" : "ok",
    manifest_mapping: decision === "accept" ? { family: bestFont.verified_family, file: bestFont.file, weight: bestFont.weight, style: bestFont.style } : null,
    ground_truth_check, proof: { overlay: path.relative(abs("."), overlay), contact_sheet: path.relative(abs("."), contact) }, notes,
  } as LayerResult;
}

function failResult(layer: LayerSpec, reason: string, quality: string): LayerResult {
  return { layer_id: layer.layer_id, decision: "fail", confidence: 0, best: { font_id: "-", family: "-", weight: 0, style: "normal", composite: 0, shape: 0, stem: 0, spacing: 0, pixel: 0, metric_fit: 0, rendered_ok: false }, runner_up: null, separation: 0, top: [], match_mode: layer.match_mode, measurement_quality: quality, manifest_mapping: null, proof: { overlay: "", contact_sheet: "" }, notes: [reason] } as LayerResult;
}
