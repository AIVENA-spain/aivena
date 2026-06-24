import fs from "node:fs";
import path from "node:path";
import { abs } from "../lib/paths";
import { loadManifest, loadValues, isTextLayer } from "../lib/manifest";
import { renderSource, measureLayerOnImage, lumaThreshold } from "../lib/measure_core";
import { assembleRebuildSVG, elementProbeSVG } from "../lib/svg";
import { renderTemplateRGBA, RGBA } from "../lib/render";
import { regionFromArray, inkBox, colourOpacity, medianRunLength, fullImageDiffPct, cropMismatchPct, Region } from "../lib/ink";
import { wrapBlock } from "../lib/text";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface Gate { gate: string; scope: string; metric: string; value: any; threshold: any; pass: boolean; }
export interface DiffResult { gates: Gate[]; pass: boolean; rebuildNoPhoto: RGBA; source: RGBA; }

function unionRegion(regions: number[][]): number[] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of regions) { x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]); x1 = Math.max(x1, r[2]); y1 = Math.max(y1, r[3]); }
  return [x0, y0, x1, y1];
}

function cropGate(gate: string, scope: string, refImg: RGBA, rebImg: RGBA, regionArr: number[], T: number, thrPct: number): Gate {
  const reg: Region = regionFromArray(regionArr);
  const sBox = inkBox(refImg, reg, T);
  const rBox = inkBox(rebImg, reg, T);
  if (!sBox || !rBox) return { gate, scope, metric: "crop XOR/union %", value: "no ink (fail-closed)", threshold: thrPct, pass: false };
  const pct = cropMismatchPct(refImg, rebImg, sBox, rBox, T);
  return { gate, scope, metric: "crop XOR/union %", value: r2(pct), threshold: `<=${thrPct}`, pass: pct <= thrPct };
}

export async function runDiff(manifest: any, values: any): Promise<DiffResult> {
  const T = lumaThreshold(manifest);
  const cfg = manifest.diff_config || {};
  const W = manifest.canvas.output[0];
  const gates: Gate[] = [];

  const source = await renderSource(manifest);
  const rebuildNoPhoto = await renderTemplateRGBA(assembleRebuildSVG(manifest, values, { noPhoto: true }), W, true);

  async function refFor(L: any): Promise<{ img: RGBA; box: any }> {
    if (L.proof_compare === "source") return { img: source, box: measureLayerOnImage(source, L, T) };
    const img = await renderTemplateRGBA(elementProbeSVG(manifest, L, values), W, true);
    return { img, box: measureLayerOnImage(img, L, T) };
  }

  // GATE A (bbox-delta) + GATE D (colour/opacity)
  for (const L of manifest.layers) {
    if (!(isTextLayer(L) || L.type === "fixed_art")) continue;
    if (!L.measure_region || !L.proof_compare) continue;
    const tol = L.tol_px ?? cfg?.default ?? 2;
    const ref = await refFor(L);
    const reb = measureLayerOnImage(rebuildNoPhoto, L, T);
    const dLeft = reb.left - ref.box.left;
    const dTop = reb.top - ref.box.top;
    const dBottom = reb.bottom - ref.box.bottom;
    const dWidth = reb.width - ref.box.width;
    const passA = Math.abs(dLeft) <= tol && Math.abs(dTop) <= tol && Math.abs(dBottom) <= tol && Math.abs(dWidth) <= tol;
    gates.push({ gate: "A_bbox", scope: L.id, metric: `Δleft/top/bottom/width vs ${L.proof_compare}`, value: { dLeft: r2(dLeft), dTop: r2(dTop), dBottom: r2(dBottom), dWidth: r2(dWidth) }, threshold: `<=${tol}px`, pass: passA });

    if (isTextLayer(L)) {
      const reg = regionFromArray(L.measure_region);
      const cReb = colourOpacity(rebuildNoPhoto, reg, T);
      const cRef = colourOpacity(ref.img, reg, T);
      if (cReb && cRef) {
        const dRGB = Math.max(Math.abs(cReb.r - cRef.r), Math.abs(cReb.g - cRef.g), Math.abs(cReb.b - cRef.b));
        const dOp = Math.abs(cReb.opacity - cRef.opacity);
        const passD = dRGB <= (cfg.colour_channel_delta ?? 6) && dOp <= (cfg.opacity_delta ?? 0.05);
        gates.push({ gate: "D_colour", scope: L.id, metric: "max|ΔRGB| / Δopacity", value: { dRGB: r2(dRGB), dOpacity: r2(dOp) }, threshold: `RGB<=${cfg.colour_channel_delta ?? 6}, op<=${cfg.opacity_delta ?? 0.05}`, pass: passD });
      } else {
        gates.push({ gate: "D_colour", scope: L.id, metric: "colour", value: "no ink (fail-closed)", threshold: "-", pass: false });
      }
    }
  }

  // GATE B (pixel crop mismatch)
  const cropPct = cfg.crop_pixel_pct || {};
  const titleLayers = manifest.layers.filter((l: any) => l.id === "title_line1" || l.id === "title_line2");
  if (titleLayers.length) gates.push(cropGate("B_crop", "title", source, rebuildNoPhoto, unionRegion(titleLayers.map((l: any) => l.measure_region)), T, cropPct.title ?? 6));
  gates.push(cropGate("B_crop", "statrow", source, rebuildNoPhoto, [0, 95, 1080, 205], T, cropPct.statrow ?? 6));
  const iconL = manifest.layers.find((l: any) => l.id === "stat_icons");
  if (iconL) gates.push(cropGate("B_crop", "icons", source, rebuildNoPhoto, iconL.measure_region, T, cropPct.icons ?? 5));
  const bodyL = manifest.layers.find((l: any) => l.id === "body");
  if (bodyL) {
    const bodyRef = await renderTemplateRGBA(elementProbeSVG(manifest, bodyL, values), W, true);
    gates.push(cropGate("B_crop", "body", bodyRef, rebuildNoPhoto, bodyL.measure_region, T, cropPct.body ?? 8));
  }

  // GATE C (weight) — body stroke-thickness rebuild vs source
  if (bodyL) {
    const reg = regionFromArray(bodyL.measure_region);
    const rl0 = medianRunLength(source, reg, T);
    const rl1 = medianRunLength(rebuildNoPhoto, reg, T);
    if (rl0 && rl1) {
      const ratio = rl1 / rl0;
      const band = (cfg.weight_band_pct ?? 15) / 100;
      gates.push({ gate: "C_weight", scope: "body", metric: "median ink-run length rebuild/source", value: { source: rl0, rebuild: rl1, ratio: r2(ratio) }, threshold: `1 ± ${cfg.weight_band_pct ?? 15}%`, pass: Math.abs(ratio - 1) <= band });
    } else {
      gates.push({ gate: "C_weight", scope: "body", metric: "run length", value: "no ink (fail-closed)", threshold: "-", pass: false });
    }
  }

  // GATE E (full-image, photo-suppressed)
  const ePct = fullImageDiffPct(source, rebuildNoPhoto, cfg.full_image_luma_delta ?? 30);
  gates.push({ gate: "E_full", scope: "canvas", metric: "% pixels |Δluma|>thr (nophoto)", value: r2(ePct), threshold: `<=${cfg.full_image_pct ?? 6}`, pass: ePct <= (cfg.full_image_pct ?? 6) });

  // GATE F (placeholder scan, hard fail)
  if (bodyL) {
    const bodyText = String(values[bodyL.value_from] ?? "").toLowerCase();
    const hits = (manifest.placeholder_denylist || []).filter((s: string) => bodyText.includes(String(s).toLowerCase()));
    gates.push({ gate: "F_placeholder", scope: "body", metric: "denylist substring hits", value: hits, threshold: "0 hits", pass: hits.length === 0 });
  }

  // GATE G (overflow, hard fail)
  if (bodyL) {
    const w = wrapBlock(manifest, bodyL, String(values[bodyL.value_from]));
    const bbox = inkBox(rebuildNoPhoto, regionFromArray(bodyL.measure_region), T);
    const [bx, by, bw, bh] = bodyL.render.box;
    const within = bbox ? bbox.left >= bx - 3 && bbox.right <= bx + bw + 3 && bbox.top >= by - 8 && bbox.bottom <= by + bh + 8 : false;
    gates.push({ gate: "G_overflow", scope: "body", metric: "fits at autosize_min & ink within box", value: { overflow: w.overflow, within }, threshold: "no overflow", pass: !w.overflow && within });
  }

  return { gates, pass: gates.every((g) => g.pass), rebuildNoPhoto, source };
}

export function gateTable(gates: Gate[]): string {
  let md = `| gate | scope | metric | value | threshold | result |\n|---|---|---|---|---|---|\n`;
  for (const g of gates) md += `| ${g.gate} | ${g.scope} | ${g.metric} | ${JSON.stringify(g.value)} | ${g.threshold} | ${g.pass ? "PASS" : "FAIL"} |\n`;
  return md;
}

export async function diffCmd(args: any): Promise<DiffResult> {
  const template = args.template || "04";
  const manifest = loadManifest(template);
  const values = loadValues(args.values || "values/04_good.json");
  const res = await runDiff(manifest, values);
  const outDir = abs(`out/${template}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "diff.json"), JSON.stringify({ template, pass: res.pass, gates: res.gates }, null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "diff.md"), `# studio_diff — template ${template}\n\nOVERALL: ${res.pass ? "PASS" : "FAIL"}\n\n${gateTable(res.gates)}`);
  console.log(`DIFF ${res.pass ? "PASS" : "FAIL"} -> out/${template}/diff.json (+ .md)`);
  for (const g of res.gates) if (!g.pass) console.log(`  FAIL ${g.gate} [${g.scope}] ${g.metric} = ${JSON.stringify(g.value)} (thr ${g.threshold})`);
  if (!res.pass) throw new Error("studio_diff: one or more gates FAILED");
  return res;
}
