import fs from "node:fs";
import { abs } from "../src/lib/paths";
import { renderFreeform, normaliseSpec, DesignSpec } from "./renderFreeform";
import { ensureImages, PROPS } from "./finalRender";

// PROOF: re-render the EXACT design spec from Christian's failed live Smart run (2026-07-14, gen
// 854ca5ef) through the FIXED renderer — true painter's order (the white card no longer hides photos
// 2+3), gradient legibility (no grey boxes), centre-crop heuristic. Same AI design, fixed hands.
async function main() {
  const sharp = (await import("sharp")).default;
  const raw = JSON.parse(fs.readFileSync(process.argv[2] ?? "/private/tmp/claude-501/-Users-christianscholte-aivena/3638da7f-aabe-4cea-8da2-cc182d9bf454/scratchpad/failed_spec.json", "utf8"));
  const spec = DesignSpec.parse(normaliseSpec(raw));
  const p = PROPS[0];
  const imgs = (await ensureImages(p)).map((f) => fs.readFileSync(f));
  const png = await renderFreeform(spec, { width: 1080, height: 1080 }, imgs);
  await sharp(png).png().toFile(abs("out/failed_spec_fixed.png"));
  console.log("-> " + abs("out/failed_spec_fixed.png"));
}
main().catch((e) => { console.error("ERROR:", e.stack || e.message); process.exit(1); });
