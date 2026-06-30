import fs from "node:fs";
import { abs } from "../resolver/fontLibrary";
import { renderSourcePng } from "../resolver/glyphMetrics";
import { SHAPE_FLOOR } from "../resolver/score";
import { LayerSpec } from "../resolver/types";
import { ResolveOpts } from "../resolver/resolveLayer";
import { loadVault } from "../vault/buildVault";
import { prefilter, requiredCharsFor } from "../adjudicate/prefilter";
import { matchLayer } from "../adjudicate/match";
import { IntakeLayer } from "../adjudicate/types";

// Per-template title font adjudication, SHAPE mode — renders the known title line in each active vault font
// and aligns the glyph outlines to the source (the reliable title signal; content-independent features alone
// cannot tell a serif title from a sans one). Reuses the frozen v1 adjudicator (matchLayer + classifyTitle);
// no per-template tuning. Honest labels: needs_seed when no vault font is a clearly-close visual match — never
// forces a wrong font.
const SS = 3, K = 0.5;

export async function adjudicateTitle(templateId: string, svgPath: string, bbox: [number, number, number, number], lineText: string, canvasWidth = 1080) {
  const vault = loadVault();
  const active = vault.fonts.filter((f) => f.status === "active");
  const img = await renderSourcePng(abs(svgPath), canvasWidth * SS, true);
  const v1layer: LayerSpec = { layer_id: "title", text: lineText, layer_bbox: bbox, metric: "cap", match_mode: "shape" } as LayerSpec;
  const intake: IntakeLayer = { id: "title", type: "headline", editable: true, text: lineText, layer_bbox: bbox, metric: "cap", match_mode: "shape", categories: "any", opacity: 1, color: "#ffffff", metadata_font: null, metadata_reliable: false };
  const required = requiredCharsFor(lineText, null);
  const pf = prefilter(img, v1layer, "any", required, active, SS, K, { bandFactor: 6 });
  const outDir = abs(`out/engine/font_adjudication/${templateId}`); fs.mkdirSync(outDir, { recursive: true });
  const opts: ResolveOpts = { ss: SS, k: K, shapeFloor: SHAPE_FLOOR, measureLog: [] };
  const oc = await matchLayer(img, v1layer, intake, pf.shortlist, outDir, "title", vault.vault_version, opts, "faithful");
  return { templateId, label: oc.label, score: oc.score, separation: oc.separation, best: oc.rank1_font, candidates: oc.candidates, measurement_quality: oc.measurement_quality };
}

const TARGETS: { id: string; svg: string; bbox: [number, number, number, number]; text: string; current: string }[] = [
  { id: "4", svg: "assets/04/source_nophoto.svg", bbox: [250, 700, 822, 896], text: "Luxury", current: "LibreCaslonDisplay (Q9 production improvement; faithful=needs_seed)" },
  { id: "11", svg: "assets/11/source.tokenized.svg", bbox: [100, 263, 945, 360], text: "STEP INTO YOUR", current: "Poppins (default)" },
  { id: "1", svg: "assets/1/source.tokenized.svg", bbox: [133, 440, 947, 670], text: "OPEN", current: "LibreCaslonDisplay (default)" },
];

if (require.main === module) {
  (async () => {
    const results: any[] = [];
    for (const t of TARGETS) {
      const r = await adjudicateTitle(t.id, t.svg, t.bbox, t.text);
      results.push({ ...r, line: t.text, current_manifest_font: t.current });
      console.log(`== #${t.id} title "${t.text}" ==  label=${r.label}  best=${r.best} (visual ${r.score}, sep ${r.separation})  measurement=${r.measurement_quality}`);
      for (const c of r.candidates) console.log(`   ${c.font.padEnd(22)} visual=${c.score}`);
      console.log(`   current manifest font: ${t.current}`);
    }
    fs.writeFileSync(abs("catalogue/font_adjudication.json"), JSON.stringify({ generated_by: "studio/engine/adjudicateFont.ts (shape mode)", labels: "verified_visual_match=tight; visual_substitute=usable/close; needs_seed=no clearly-close vault font (honest — do not force)", results }, null, 2) + "\n");
    console.log("\nwrote studio/catalogue/font_adjudication.json");
  })().catch((e) => { console.error("ERROR:", e.stack || e.message); process.exit(1); });
}
