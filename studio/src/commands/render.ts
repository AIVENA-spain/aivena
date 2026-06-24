import fs from "node:fs";
import path from "node:path";
import { abs } from "../lib/paths";
import { loadManifest, loadValues } from "../lib/manifest";
import { assembleRebuildSVG } from "../lib/svg";
import { renderTemplatePng } from "../lib/render";
import { wrapBlock } from "../lib/text";

export async function renderCmd(args: any): Promise<string> {
  const template = args.template || "04";
  const manifest = loadManifest(template);
  const values = loadValues(args.values || "values/04_good.json");
  const noPhoto = !!args["no-photo"];

  // Dev renderer fails closed on body overflow (gate G): do not silently overflow.
  for (const L of manifest.layers) {
    if (L.type === "editable_text_block") {
      const w = wrapBlock(manifest, L, String(values[L.value_from]));
      if (w.overflow) throw new Error(`OVERFLOW: body '${L.id}' cannot fit at autosize_min=${L.render.autosize_min} (gate G)`);
    }
  }

  const svg = assembleRebuildSVG(manifest, values, { noPhoto });
  const png = renderTemplatePng(svg, manifest.canvas.output[0], noPhoto ? "#000000" : undefined);
  const out = args.out ? abs(args.out) : abs(`out/${template}/rebuild${noPhoto ? "_nophoto" : ""}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, png);
  console.log(`[DEV RENDERER for diffing — NOT the production engine; no engine-proof / production claim] wrote ${out}`);
  return out;
}
