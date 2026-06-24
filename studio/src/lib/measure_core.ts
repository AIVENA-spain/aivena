import fs from "node:fs";
import { abs } from "./paths";
import { renderTemplateRGBA, RGBA } from "./render";
import { regionFromArray, inkBox, measureTitleWord, colourOpacity } from "./ink";

const sourceCache = new Map<string, RGBA>();

export function lumaThreshold(manifest: any): number {
  return manifest?.diff_config?.luma_threshold ?? 60;
}

// Render the photo-suppressed source typography image (source_nophoto.svg) on opaque black.
export async function renderSource(manifest: any): Promise<RGBA> {
  const svgPath = abs(manifest.source.nophoto_svg);
  if (!fs.existsSync(svgPath)) throw new Error(`Source nophoto SVG missing: ${svgPath}`);
  if (!sourceCache.has(svgPath)) {
    const svg = fs.readFileSync(svgPath, "utf8");
    sourceCache.set(svgPath, await renderTemplateRGBA(svg, manifest.canvas.output[0], true));
  }
  return sourceCache.get(svgPath)!;
}

export interface LayerMetrics {
  ink_left: number; width: number; cap_height: number; baseline: number;
  top: number; bottom: number; left: number; right: number;
  color?: { r: number; g: number; b: number }; opacity?: number;
}

// Measure one text/fixed_art layer in its region. Title (first_glyph) isolates the cap so a neighbour's
// descender cannot contaminate cap/baseline/width.
export function measureLayerOnImage(img: RGBA, layer: any, T: number): LayerMetrics {
  if (!layer.measure_region) throw new Error(`Layer '${layer.id}' has no measure_region`);
  const reg = regionFromArray(layer.measure_region);
  let m: LayerMetrics;
  if (layer.type === "editable_text" && layer.cap_mode === "first_glyph") {
    const t = measureTitleWord(img, reg, T);
    if (!t) throw new Error(`ZERO INK measuring '${layer.id}' in region [${layer.measure_region}]`);
    m = { ink_left: t.ink_left, width: t.width, cap_height: t.cap_height, baseline: t.baseline, top: t.cap_top, bottom: t.baseline, left: t.ink_left, right: t.right };
  } else {
    const b = inkBox(img, reg, T);
    if (!b) throw new Error(`ZERO INK measuring '${layer.id}' in region [${layer.measure_region}]`);
    m = { ink_left: b.left, width: b.width, cap_height: b.height, baseline: b.bottom, top: b.top, bottom: b.bottom, left: b.left, right: b.right };
  }
  const co = colourOpacity(img, reg, T);
  if (co) { m.color = { r: co.r, g: co.g, b: co.b }; m.opacity = co.opacity; }
  return m;
}

// Measure a layer directly off the source (used by calibrate to obtain the source target).
export async function measureSourceLayer(manifest: any, layer: any): Promise<LayerMetrics> {
  const img = await renderSource(manifest);
  return measureLayerOnImage(img, layer, lumaThreshold(manifest));
}
