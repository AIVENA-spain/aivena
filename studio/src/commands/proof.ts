import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { abs } from "../lib/paths";
import { loadManifest, loadValues } from "../lib/manifest";
import { assembleRebuildSVG } from "../lib/svg";
import { renderTemplatePng, saveRGBA } from "../lib/render";
import { renderSource, lumaThreshold } from "../lib/measure_core";
import { lumaAt } from "../lib/ink";
import { runDiff, gateTable } from "./diff";

function layer(manifest: any, id: string): any { return manifest.layers.find((l: any) => l.id === id); }
function unionRegion(regions: number[][]): number[] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of regions) { x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]); x1 = Math.max(x1, r[2]); y1 = Math.max(y1, r[3]); }
  return [x0, y0, x1, y1];
}

async function sideCrop(srcRefPath: string, rebuildBuf: Buffer, reg: number[], outPath: string, W: number, H: number) {
  const x0 = Math.max(0, Math.round(reg[0])), y0 = Math.max(0, Math.round(reg[1]));
  const w = Math.min(W - x0, Math.round(reg[2] - reg[0])), h = Math.min(H - y0, Math.round(reg[3] - reg[1]));
  const ext = { left: x0, top: y0, width: Math.max(1, w), height: Math.max(1, h) };
  const a = await sharp(srcRefPath).extract(ext).png().toBuffer();
  const b = await sharp(rebuildBuf).extract(ext).png().toBuffer();
  const gap = 12;
  await sharp({ create: { width: w * 2 + gap, height: h, channels: 4, background: { r: 25, g: 25, b: 25, alpha: 1 } } })
    .composite([{ input: a, left: 0, top: 0 }, { input: b, left: w + gap, top: 0 }]).png().toFile(outPath);
}

export async function proofCmd(args: any): Promise<any> {
  const template = args.template || "04";
  const manifest = loadManifest(template);
  const values = loadValues(args.values || "values/04_good.json");
  const [W, H] = manifest.canvas.output;
  const outDir = abs(`out/${template}`);
  fs.mkdirSync(outDir, { recursive: true });

  const rebuildPhotoPng = renderTemplatePng(assembleRebuildSVG(manifest, values, { noPhoto: false }), W);
  fs.writeFileSync(path.join(outDir, "rebuild_photo.png"), rebuildPhotoPng);
  const srcRefPath = abs(manifest.source.ref_png);
  if (!fs.existsSync(srcRefPath)) throw new Error(`source ref_png missing: ${srcRefPath}`);

  // 1. side by side (source_ref left, rebuild WITH photo right)
  const half = 540;
  const left = await sharp(srcRefPath).resize(half).png().toBuffer();
  const right = await sharp(rebuildPhotoPng).resize(half).png().toBuffer();
  const lh = (await sharp(left).metadata()).height || Math.round((half * H) / W);
  await sharp({ create: { width: half * 2, height: lh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite([{ input: left, left: 0, top: 0 }, { input: right, left: half, top: 0 }]).png().toFile(path.join(outDir, "proof_side_by_side.png"));

  // diff (also gives rebuildNoPhoto)
  const { gates, pass, source, rebuildNoPhoto } = await runDiff(manifest, values);
  const T = lumaThreshold(manifest);
  void source; // renderSource is cached; use the diff's photo-suppressed renders for the overlay
  const src = await renderSource(manifest);

  // 2. overlay: rebuild ink in red over a dimmed source (photo-suppressed)
  const ov = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const idx = i * 4;
    const base = Math.min(255, lumaAt(src.data, idx)) * 0.5;
    ov[idx] = base; ov[idx + 1] = base; ov[idx + 2] = base; ov[idx + 3] = 255;
    if (rebuildNoPhoto.data[idx + 3] > 0 && lumaAt(rebuildNoPhoto.data, idx) > T) { ov[idx] = 255; ov[idx + 1] = 40; ov[idx + 2] = 40; }
  }
  await saveRGBA({ data: ov, width: W, height: H }, path.join(outDir, "proof_overlay.png"));

  // 3. crop comparisons (source-left / rebuild-right, with photo)
  const crops: Record<string, number[]> = {
    crop_title: unionRegion([layer(manifest, "title_line1").measure_region, layer(manifest, "title_line2").measure_region]),
    crop_statrow: [0, 95, 1080, 205],
    crop_body: layer(manifest, "body").measure_region,
  };
  // crop_footer only if a footer layer exists (none for #4)
  if (layer(manifest, "footer")) crops["crop_footer"] = layer(manifest, "footer").measure_region;
  for (const [name, reg] of Object.entries(crops)) await sideCrop(srcRefPath, rebuildPhotoPng, reg, path.join(outDir, name + ".png"), W, H);

  // 4. deviation report
  const devs = gates.filter((g) => !g.pass);
  let md = `# Deviation report — template ${template}\n\n`;
  md += `**VISUAL TEMPLATE PROOF: ${pass ? "PASS" : "FAIL"}** — Canva match on numbers only. This is NOT engine proof and NOT a production-readiness claim.\n\n`;
  md += gateTable(gates);
  md += `\n## Deviations over tolerance\n\n` + (devs.length ? devs.map((g) => `- ${g.gate} [${g.scope}]: ${JSON.stringify(g.value)} (thr ${g.threshold})`).join("\n") : "(none — all gates within tolerance)") + "\n";
  fs.writeFileSync(path.join(outDir, "deviation_report.md"), md);

  // 5. manifest used
  fs.writeFileSync(path.join(outDir, "manifest_used.json"), JSON.stringify(manifest, null, 2) + "\n");

  console.log(`PROOF written to out/${template}/  (proof_side_by_side.png, proof_overlay.png, crop_title.png, crop_statrow.png, crop_body.png, deviation_report.md, manifest_used.json)`);
  console.log(`  VISUAL TEMPLATE PROOF = ${pass ? "PASS" : "FAIL"}  (engine proof NOT run / NOT claimed)`);
  return { pass, gates };
}
