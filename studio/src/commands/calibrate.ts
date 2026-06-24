import fs from "node:fs";
import path from "node:path";
import { abs } from "../lib/paths";
import { loadManifest, saveManifest, layerById, loadValues } from "../lib/manifest";
import { measureSourceLayer, lumaThreshold } from "../lib/measure_core";
import { renderTemplateRGBA, renderNaturalRGBA } from "../lib/render";
import { titleProbeSVG, glyphProbeSVG } from "../lib/svg";
import { regionFromArray, inkBox, measureTitleWord } from "../lib/ink";
import { openFont, touchingWidth } from "../lib/fonts";
import { applyValue } from "../lib/text";

const r2 = (n: number) => Math.round(n * 100) / 100;
const MAX_ITERS = 16;

async function capRatio(manifest: any, layer: any, glyph: string): Promise<number> {
  const refSize = 200;
  const { svg } = glyphProbeSVG(manifest, layer.font, glyph, refSize);
  const img = await renderNaturalRGBA(svg, true);
  const box = inkBox(img, { x0: 0, y0: 0, x1: img.width - 1, y1: img.height - 1 }, lumaThreshold(manifest));
  if (!box) throw new Error(`cap-ratio probe produced zero ink for glyph '${glyph}'`);
  return box.height / refSize;
}

async function measureProbe(manifest: any, layer: any, text: string, render: any) {
  const svg = titleProbeSVG(manifest, layer, text, render);
  const img = await renderTemplateRGBA(svg, manifest.canvas.output[0], true);
  const m = measureTitleWord(img, regionFromArray(layer.measure_region), lumaThreshold(manifest));
  if (!m) throw new Error(`calibrate probe produced zero ink for '${layer.id}'`);
  return m;
}

export async function calibrateCmd(args: any): Promise<any> {
  const template = args.template || "04";
  const element = args.element;
  if (!element) throw new Error("calibrate requires --element <id>");
  const manifest = loadManifest(template);
  const layer = layerById(manifest, element);
  if (layer.type !== "editable_text" || layer.cap_mode !== "first_glyph") {
    throw new Error(`calibrate supports title (first_glyph) layers only; '${element}' is not one`);
  }
  const values = loadValues(args.values || "values/04_good.json");
  const text = applyValue(values[layer.value_from], layer);
  const tol = layer.tol_px ?? 2;
  const font = openFont(manifest, layer.font);

  const target = await measureSourceLayer(manifest, layer); // source target {ink_left,width,cap_height,baseline}
  const before = JSON.parse(JSON.stringify(layer.render));

  const cr = await capRatio(manifest, layer, text[0]);
  let size = target.cap_height / cr;
  let tracking = 0;
  let tx = target.ink_left;
  let baseline = target.baseline;
  const n = Math.max(1, text.length - 1);

  const history: any[] = [];
  let converged = false;
  let last: any = {};
  for (let iter = 1; iter <= MAX_ITERS; iter++) {
    const tw = touchingWidth(font, text, size);
    const scaleX = target.width < tw ? target.width / tw : 1;
    const render = { size, scaleX, tracking_px: tracking, translate_x: tx, baseline };
    const m = await measureProbe(manifest, layer, text, render);
    const dCap = target.cap_height - m.cap_height;
    const dW = target.width - m.width;
    const dL = target.ink_left - m.ink_left;
    const dB = target.baseline - m.baseline;
    last = {
      iter, dCap: r2(dCap), dW: r2(dW), dL: r2(dL), dB: r2(dB),
      params: { size: r2(size), scaleX: r2(scaleX), tracking_px: r2(tracking), translate_x: r2(tx), baseline: r2(baseline) },
      measured: { cap_height: r2(m.cap_height), width: r2(m.width), ink_left: r2(m.ink_left), baseline: r2(m.baseline) },
    };
    history.push(last);
    if (Math.abs(dCap) <= tol && Math.abs(dW) <= tol && Math.abs(dL) <= tol && Math.abs(dB) <= tol) {
      layer.render = render;
      converged = true;
      break;
    }
    if (Math.abs(dCap) > tol) { size *= target.cap_height / m.cap_height; continue; } // settle cap (to tol) first
    tracking += dW / n / (scaleX || 1);
    tx += dL;
    baseline += dB;
  }

  if (!converged) {
    console.error(`CALIBRATE FAILED to converge for '${element}' after ${MAX_ITERS} iterations. Last: ${JSON.stringify(last)}`);
    throw new Error(`calibrate did not converge for '${element}'`);
  }

  for (const k of Object.keys(layer.render)) layer.render[k] = r2(layer.render[k]);
  layer.calibrated = {
    converged_at_iter: last.iter,
    final_deltas: { cap_height: last.dCap, width: last.dW, ink_left: last.dL, baseline: last.dB },
    source_target: { ink_left: r2(target.ink_left), width: r2(target.width), cap_height: r2(target.cap_height), baseline: r2(target.baseline) },
  };
  delete layer.render_params_stale;
  saveManifest(template, manifest);

  const outDir = abs(`out/${template}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `calibrate_${element}.json`),
    JSON.stringify({ element, source_target: target, before, after: layer.render, converged: true, iterations: history }, null, 2) + "\n");

  console.log(`CALIBRATE OK '${element}': converged at iter ${last.iter}`);
  console.log(`  source target: ink_left=${r2(target.ink_left)} width=${r2(target.width)} cap=${r2(target.cap_height)} baseline=${r2(target.baseline)}`);
  console.log(`  before (stale): ${JSON.stringify(before)}`);
  console.log(`  after  (calib): ${JSON.stringify(layer.render)}`);
  console.log(`  final deltas: cap=${last.dCap} width=${last.dW} ink_left=${last.dL} baseline=${last.dB} (tol ${tol}px)`);
  return { element, target, before, after: layer.render, history, converged: true };
}
