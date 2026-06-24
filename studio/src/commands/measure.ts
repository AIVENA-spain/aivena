import fs from "node:fs";
import path from "node:path";
import { abs } from "../lib/paths";
import { loadManifest, isTextLayer } from "../lib/manifest";
import { renderSource, measureLayerOnImage, lumaThreshold } from "../lib/measure_core";

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function measureCmd(args: any): Promise<any> {
  const template = args.template || "04";
  const manifest = loadManifest(template);
  const T = lumaThreshold(manifest);
  const img = await renderSource(manifest);

  const rows: any[] = [];
  const check: any[] = [];
  for (const L of manifest.layers) {
    if (!(isTextLayer(L) || L.type === "fixed_art")) continue;
    if (!L.measure_region) continue;
    const m = measureLayerOnImage(img, L, T); // throws (fail-closed) on zero ink
    rows.push({
      id: L.id, type: L.type, proof_compare: L.proof_compare,
      ink_left: r2(m.ink_left), width: r2(m.width), cap_height: r2(m.cap_height), baseline: r2(m.baseline),
      top: r2(m.top), bottom: r2(m.bottom),
      color: m.color, opacity: m.opacity != null ? r2(m.opacity) : undefined,
    });
    if (L.target) {
      for (const k of Object.keys(L.target)) {
        const measured = (m as any)[k];
        if (typeof measured === "number") {
          check.push({ id: L.id, field: k, manifest_target: L.target[k], measured: r2(measured), delta: r2(measured - L.target[k]) });
        }
      }
    }
  }

  const outDir = abs(`out/${template}`);
  fs.mkdirSync(outDir, { recursive: true });
  const json = { template, luma_threshold: T, source: manifest.source.nophoto_svg, layers: rows, manifest_check: check };
  fs.writeFileSync(path.join(outDir, "measure_source.json"), JSON.stringify(json, null, 2) + "\n");

  let md = `# Source measurement — template ${template}\n\nThreshold luma > ${T}. Measured off \`${manifest.source.nophoto_svg}\` (photo-suppressed, on black).\n\n`;
  md += `| layer | type | ink_left | width | cap_height | baseline | top | bottom | opacity |\n|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of rows) md += `| ${r.id} | ${r.type} | ${r.ink_left} | ${r.width} | ${r.cap_height} | ${r.baseline} | ${r.top} | ${r.bottom} | ${r.opacity ?? ""} |\n`;
  md += `\n## manifest_check (measured vs first-pass manifest target)\n\n| layer | field | manifest_target | measured | delta |\n|---|---|---|---|---|\n`;
  for (const c of check) md += `| ${c.id} | ${c.field} | ${c.manifest_target} | ${c.measured} | ${c.delta} |\n`;
  fs.writeFileSync(path.join(outDir, "measure_source.md"), md);

  console.log(`MEASURE OK -> out/${template}/measure_source.json (+ .md). ${rows.length} layers measured.`);
  for (const c of check) {
    const flag = Math.abs(c.delta) > 2 ? "  <-- >2px (measurement is source of truth)" : "";
    console.log(`  ${c.id}.${c.field}: measured ${c.measured} vs manifest ${c.manifest_target} (Δ ${c.delta})${flag}`);
  }
  return json;
}
