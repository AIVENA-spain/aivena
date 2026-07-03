import fs from "node:fs";
import path from "node:path";
import { abs } from "../src/lib/paths";
import { loadEditableManifest } from "./renderEditable";
import { checkEligibility } from "./eligibility";
import { PROPS, ensureImages, renderEditableFor } from "./finalRender";

// Batch-2 Studio templates on REAL properties across types (same general engine + deriveSlots as the approved
// set). Renders #5/#14/#3/#6, demonstrates the production ELIGIBILITY GUARD (#14 Just Sold), and builds review
// sheets. NEW = the templates built to standard this batch.
const NEW = ["5", "14", "3", "6"];
const NAME: Record<string, string> = { "5": "#5 Listing", "14": "#14 Just Sold", "3": "#3 Luxury (Canva p3)", "6": "#6 Property Gallery (Canva p6)" };

async function main() {
  const sharp = (await import("sharp")).default;
  const imgs: Record<string, string[]> = {};
  for (const p of PROPS) imgs[p.id] = await ensureImages(p);

  // ---- ELIGIBILITY GUARD demonstration (#14 Just Sold) ----
  const m14 = loadEditableManifest("manifest/templates/14.editable.json");
  const blocked = checkEligibility(m14, { status: PROPS[0].status });                 // active listing, no demo
  const allowed = checkEligibility(m14, { status: PROPS[0].status, demo: true });      // explicit demo/test render
  console.log("== eligibility guard (#14 Just Sold) ==");
  console.log(`  active listing, no demo -> ok=${blocked.ok}  ${blocked.reason}`);
  console.log(`  explicit demo/test      -> ok=${allowed.ok} (demo=${allowed.demo})  ${allowed.reason}`);

  const grid: Record<string, Record<string, Buffer>> = {};
  let allQA = true;
  console.log("\n== batch-2 renders across property types ==");
  for (const id of NEW) {
    grid[id] = {};
    const m = loadEditableManifest(`manifest/templates/${id}.editable.json`);
    for (const p of PROPS) {
      // status-gated templates render only when eligible OR as an explicit demo/test (this proof = demo)
      const elig = checkEligibility(m, { status: p.status, demo: true });
      const { png, qa } = await renderEditableFor(p, id, imgs[p.id]);
      grid[id][p.id] = png;
      fs.writeFileSync(abs(`out/realprop/${p.id}/final_${id}.png`), png);
      console.log(`  ${p.id} (${p.type}) #${id}: QA ${qa.ok ? "PASS" : "FAIL " + qa.checks.filter((c) => !c.ok).map((c) => `${c.slot || ""}:${c.name}`).join(";")}${elig.demo ? "  [demo render — not a real claim]" : ""}`);
      if (!qa.ok) allQA = false;
    }
  }

  const OUT = abs("out/realprop/review"); fs.mkdirSync(OUT, { recursive: true });
  const DESK = path.join(process.env.HOME!, "Desktop/AIVENA-studio-review"); fs.mkdirSync(DESK, { recursive: true });
  const bar = (w: number, t: string, h: number, fsz: number, bg = "#111") => Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="${bg}"/><text x="12" y="${h / 2 + fsz / 3}" font-family="sans-serif" font-size="${fsz}" fill="#fff">${t}</text></svg>`);
  const cw = 300, gap = 14;
  const cells: Record<string, Buffer> = {};
  for (const id of NEW) for (const p of PROPS) cells[`${id}_${p.id}`] = await sharp(grid[id][p.id]).resize({ width: cw }).png().toBuffer();
  const ch = (await sharp(cells[`${NEW[0]}_${PROPS[0].id}`]).metadata()).height || 375;
  const cols = PROPS.length;
  const W = cols * cw + (cols + 1) * gap, H = 46 + NEW.length * (ch + 28 + gap) + gap + 36;
  const comps: any[] = [{ input: bar(W, "STUDIO BATCH 2 (replicated to Canva) — #5 Listing · #14 Just Sold · #3 Luxury (Canva p3) · #6 Property Gallery (Canva p6) — across property types", 46, 14), left: 0, top: 0 }];
  for (let ri = 0; ri < NEW.length; ri++) for (let ci = 0; ci < cols; ci++) {
    const p = PROPS[ci]; const x = gap + ci * (cw + gap), y = 46 + gap + ri * (ch + 28 + gap);
    const demo = NEW[ri] === "14" ? "  (DEMO — not a real sold claim)" : "";
    comps.push({ input: bar(cw, `${NAME[NEW[ri]]} · ${p.type}, ${p.city}${demo}`, 28, 12, "#2a2a2a"), left: x, top: y }, { input: cells[`${NEW[ri]}_${p.id}`], left: x, top: y + 28 });
  }
  comps.push({ input: bar(W, "Note: source photos are watermarked scraped imagery (data-source limitation) — NOT client-ready photos. #14 shown as an explicit DEMO render only (properties are active, not sold).", 36, 12, "#3a2a10"), left: 0, top: H - 36 });
  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 24, g: 24, b: 24, alpha: 1 } } }).composite(comps).png().toFile(path.join(OUT, "batch2_new_templates.png"));
  fs.copyFileSync(path.join(OUT, "batch2_new_templates.png"), path.join(DESK, "batch2_new_templates.png"));
  console.log(`\n  QA all pass: ${allQA}\n  -> out/realprop/review/batch2_new_templates.png (+ Desktop)`);
  if (!allQA) process.exit(1);
}
main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
