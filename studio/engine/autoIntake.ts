import fs from "node:fs";
import path from "node:path";
import { abs } from "../src/lib/paths";
import { renderTemplatePng, pngToRGBA, RGBA } from "../src/lib/render";
import { lumaAt } from "../src/lib/ink";

// Bulk per-template auto-intake (FIRST-PASS, draft). For each tokenized Canva SVG in studio/out/bucket/,
// emit a DRAFT intake skeleton: canvas, photo-slot boxes (precise, via a magenta marker render),
// ink/text-region candidates (polarity-aware projection), heuristic title/body/stat/badge labels, colour
// fills + first-pass colour-role candidates. Text stays the editable target — outlined source is NOT final.
// Drafts go to studio/intake/<n>/template.draft.json for human/next-step refinement (see #4 for the proven
// final shape). READ-ONLY on the bucket (uses already-downloaded SVGs); no writes/deploy/provider calls.

const TEMPLATES = ["1", "2", "3", "4", "5", "6", "6b", "7", "8", "10", "11", "14", "15"];
const BUCKET_DIR = "out/bucket"; // tokenized SVGs downloaded by bucketInventory.ts (gitignored)
// flexible role set (control-tower list); first-pass mapping only — extend as templates prove they need it.
const ROLE_SET = ["background", "overlay", "title", "subtitle/body", "accent", "badge.fill", "badge.text", "divider", "icon", "stat.label", "stat.value", "cta"];

const stripImages = (svg: string) => svg.replace(/<image\b[^>]*\/>/g, "").replace(/<image\b[^>]*>[\s\S]*?<\/image>/g, "");
let MARK_URI = ""; // a guaranteed-valid magenta marker PNG (generated via sharp at runtime)
async function ensureMark(): Promise<string> {
  if (!MARK_URI) { const sharp = (await import("sharp")).default; MARK_URI = "data:image/png;base64," + (await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 0, b: 255 } } }).png().toBuffer()).toString("base64"); }
  return MARK_URI;
}

interface Box { x0: number; y0: number; x1: number; y1: number; }
const W2 = (b: Box) => b.x1 - b.x0, H2 = (b: Box) => b.y1 - b.y0, AREA = (b: Box) => W2(b) * H2(b);

async function render(svg: string, outWidth: number, flatten: boolean): Promise<RGBA> {
  return pngToRGBA(renderTemplatePng(svg, outWidth, flatten ? "#000000" : undefined), flatten);
}

// ---- photo slots: render @@PHOTOn@@ as magenta, flood-fill magenta clusters -> precise boxes ----
// photo-slot mask = pixels where the magenta render differs from the all-stripped render (the photo area).
function photoDiffMask(mag: RGBA, base: RGBA): Uint8Array {
  const n = Math.min(mag.width * mag.height, base.width * base.height);
  const m = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const d = Math.abs(mag.data[i] - base.data[i]) + Math.abs(mag.data[i + 1] - base.data[i + 1]) + Math.abs(mag.data[i + 2] - base.data[i + 2]);
    if (d > 60) m[p] = 1;
  }
  return m;
}
// full bounding box of all set pixels (merges fragments of one photo slot split by overlaid text)
function fullBBox(mask: Uint8Array, w: number, h: number): Box | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let p = 0; p < mask.length; p++) if (mask[p]) { const x = p % w, y = (p / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

// ---- ink regions (polarity-aware): modal bg colour, ink = drawn pixels far from it ----
function inkMask(img: RGBA): { mask: Uint8Array; bgLuma: number } {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] > 128) hist[Math.round(lumaAt(img.data, i))]++;
  let bgLuma = 0, mx = -1; for (let l = 0; l < 256; l++) if (hist[l] > mx) { mx = hist[l]; bgLuma = l; }
  const T = 55;
  const mask = new Uint8Array(img.width * img.height);
  for (let i = 0, p = 0; i < img.data.length; i += 4, p++) if (img.data[i + 3] > 128 && Math.abs(lumaAt(img.data, i) - bgLuma) > T) mask[p] = 1;
  return { mask, bgLuma };
}
// horizontal bands (gap-merge), then per-band vertical blocks
function detectRegions(img: RGBA): Box[] {
  const { mask } = inkMask(img);
  const w = img.width, h = img.height;
  const rowInk = new Array(h).fill(0);
  for (let y = 0; y < h; y++) { let c = 0; const r = y * w; for (let x = 0; x < w; x++) if (mask[r + x]) c++; rowInk[y] = c; }
  const rThr = Math.max(3, w * 0.004);
  const gapMerge = Math.round(h * 0.018); // merge lines within a block; split distinct elements
  const bands: { y0: number; y1: number }[] = [];
  let by0 = -1, gap = 0;
  for (let y = 0; y < h; y++) {
    if (rowInk[y] >= rThr) { if (by0 < 0) by0 = y; gap = 0; }
    else if (by0 >= 0) { gap++; if (gap > gapMerge) { bands.push({ y0: by0, y1: y - gap }); by0 = -1; } }
  }
  if (by0 >= 0) bands.push({ y0: by0, y1: h - 1 });

  const regions: Box[] = [];
  for (const band of bands) {
    if (band.y1 - band.y0 < h * 0.006) continue; // noise
    const colInk = new Array(w).fill(0);
    for (let y = band.y0; y <= band.y1; y++) { const r = y * w; for (let x = 0; x < w; x++) if (mask[r + x]) colInk[x]++; }
    const cThr = 1, gapV = Math.round(w * 0.03);
    let bx0 = -1, g = 0;
    const flush = (bx1: number) => { if (bx0 < 0) return; // tighten the block's vertical extent to its actual ink
      let yy0 = band.y1, yy1 = band.y0;
      for (let y = band.y0; y <= band.y1; y++) { const r = y * w; for (let x = bx0; x <= bx1; x++) if (mask[r + x]) { if (y < yy0) yy0 = y; if (y > yy1) yy1 = y; break; } }
      const b = { x0: bx0, y0: yy0, x1: bx1, y1: yy1 };
      if (W2(b) > w * 0.02 && H2(b) > h * 0.006) regions.push(b); bx0 = -1; };
    for (let x = 0; x < w; x++) {
      if (colInk[x] >= cThr) { if (bx0 < 0) bx0 = x; g = 0; }
      else if (bx0 >= 0) { g++; if (g > gapV) flush(x - g); }
    }
    if (bx0 >= 0) flush(w - 1);
  }
  return regions;
}

// ---- heuristic first-pass classification ----
function classify(regions: Box[], W: number, H: number): { box: Box; type: string }[] {
  const out = regions.map((b) => ({ box: b, type: "label" }));
  if (!out.length) return out;
  // stat row: a horizontal band with 2-4 similar small blocks at similar y in the top third
  const byRow: Record<number, typeof out> = {};
  for (const r of out) { const key = Math.round((r.box.y0 / H) * 20); (byRow[key] ||= []).push(r); }
  for (const k of Object.keys(byRow)) { const grp = byRow[k as any]; if (grp.length >= 2 && grp.length <= 4 && grp.every((r) => H2(r.box) < H * 0.06) && grp[0].box.y0 < H * 0.45) grp.forEach((r) => (r.type = "stat")); }
  // title: tallest text block not already a stat
  const cand = out.filter((r) => r.type !== "stat");
  if (cand.length) { const title = cand.reduce((a, b) => (H2(b.box) > H2(a.box) ? b : a)); title.type = "title"; }
  // body: widest remaining multi-ish block below the title with smaller glyphs
  const titleY = out.find((r) => r.type === "title")?.box.y0 ?? H;
  const rest = out.filter((r) => r.type === "label" && r.box.y0 > titleY);
  if (rest.length) { const body = rest.reduce((a, b) => (W2(b.box) * H2(b.box) > W2(a.box) * H2(a.box) ? b : a)); body.type = "subtitle/body"; }
  // small top-corner blocks -> badge
  for (const r of out) if (r.type === "label" && r.box.y0 < H * 0.12 && W2(r.box) < W * 0.4) r.type = "badge";
  return out;
}

function colourFills(svg: string): string[] {
  const set = new Set<string>();
  for (const m of svg.match(/fill="(#[0-9a-fA-F]{3,8})"/g) || []) set.add(m.replace(/fill="|"/g, "").toLowerCase());
  for (const m of svg.match(/fill:(#[0-9a-fA-F]{3,8})/g) || []) set.add(m.replace(/fill:/g, "").toLowerCase());
  return [...set].sort();
}

async function buildIntake(t: string) {
  const svgPath = abs(`${BUCKET_DIR}/${t}.tokenized.svg`);
  if (!fs.existsSync(svgPath)) return { template: t, ok: false, error: "tokenized SVG not downloaded (run bucketInventory.ts)" };
  const svg = fs.readFileSync(svgPath, "utf8");
  const head = svg.slice(0, 4000);
  const wM = head.match(/\bwidth="([\d.]+)"/), hM = head.match(/\bheight="([\d.]+)"/);
  const W = wM ? Math.round(Number(wM[1])) : 1080, H = hM ? Math.round(Number(hM[1])) : 1350;

  // photo slots: diff two renders — (a) all images stripped vs (b) photos->magenta (film stripped). The
  // overlays/text are identical in both, so the diff isolates the photo-slot area (robust to dimming overlays).
  await ensureMark();
  const baseImg = await render(stripImages(svg), W, true);
  // one box per DISTINCT photo token: mark only that token, strip other images, take the full diff bbox.
  const tokens = [...new Set(svg.match(/@@PHOTO\d+@@/g) || [])].sort();
  const photoBoxes: { token: string; bbox: number[] }[] = [];
  for (const tok of tokens) {
    const keepOnly = (tg: string) => (tg.includes(tok) ? tg : "");
    let marked = svg.replace(/<image\b[^>]*\/>/g, keepOnly).replace(/<image\b[^>]*>[\s\S]*?<\/image>/g, keepOnly);
    marked = marked.split(tok).join(MARK_URI);
    const mImg = await render(marked, W, true);
    const bb = fullBBox(photoDiffMask(mImg, baseImg), W, mImg.height);
    if (bb && AREA(bb) > W * H * 0.003) photoBoxes.push({ token: tok, bbox: [bb.x0, bb.y0, bb.x1, bb.y1] });
  }
  const imageTags = (svg.match(/<image\b[^>]*>/g) || []).length;

  // ink/text regions (photos stripped)
  const inkImg = await render(stripImages(svg), W, false);
  const regions = detectRegions(inkImg);
  const classified = classify(regions, W, H);

  const fills = colourFills(svg);
  const roleCandidates = firstPassRoles(fills, classified);

  return {
    template: t, ok: true, canvas: { width: W, height: H }, aspect: +(W / H).toFixed(3),
    photo_slots: photoBoxes,
    image_slot_count: imageTags,
    text_regions: classified.map((r) => ({ candidate_type: r.type, bbox: [r.box.x0, r.box.y0, r.box.x1, r.box.y1], height: H2(r.box) })),
    colour_fills: fills, colour_role_candidates: roleCandidates,
  };
}
function firstPassRoles(fills: string[], regions: { type: string }[]): Record<string, string> {
  // crudely map the darkest fill -> background/overlay, lightest -> title/body ink, others -> accent.
  const sorted = [...fills].sort((a, b) => hexLuma(a) - hexLuma(b));
  const roles: Record<string, string> = {};
  if (sorted.length) { roles["background"] = sorted[0]; roles["title"] = sorted[sorted.length - 1]; roles["subtitle/body"] = sorted[sorted.length - 1]; }
  if (sorted.length > 2) roles["accent"] = sorted[Math.floor(sorted.length / 2)];
  return roles;
}
const hexLuma = (h: string) => { const x = h.replace("#", ""); if (x.length < 6) return 128; return 0.299 * parseInt(x.slice(0, 2), 16) + 0.587 * parseInt(x.slice(2, 4), 16) + 0.114 * parseInt(x.slice(4, 6), 16); };

// ---- validation vs the proven #4 intake (overlap-based; first-pass regions are coarse, so we check that a
// detected region OVERLAPS each known #4 content zone — the full title is 2 lines, packed against the body) ----
const KNOWN_04: Record<string, Box> = {
  stat_row: { x0: 120, y0: 200, x1: 960, y1: 270 }, title: { x0: 140, y0: 700, x1: 952, y1: 1095 }, body: { x0: 95, y0: 1095, x1: 985, y1: 1262 },
};
function overlap(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy; const uni = AREA(a) + AREA(b) - inter; return uni > 0 ? inter / uni : 0;
}
function validate04(intake: any): any {
  const dets: Box[] = intake.text_regions.map((r: any) => ({ x0: r.bbox[0], y0: r.bbox[1], x1: r.bbox[2], y1: r.bbox[3] }));
  const res: any = {};
  for (const [name, known] of Object.entries(KNOWN_04)) {
    let best: Box | null = null, bi = 0;
    for (const d of dets) { const io = overlap(known, d); if (io > bi) { bi = io; best = d; } }
    res[name] = { known: [known.x0, known.y0, known.x1, known.y1], best_overlap_detected: best ? [best.x0, best.y0, best.x1, best.y1] : null, iou: +bi.toFixed(2), covered: bi > 0.1 };
  }
  return res;
}

async function main() {
  const intakeRoot = abs("intake");
  const rows: any[] = [];
  for (const t of TEMPLATES) {
    const r = await buildIntake(t);
    rows.push(r);
    if (!r.ok) { console.log(`  ${t.padEnd(4)} FAIL ${r.error}`); continue; }
    const dir = path.join(intakeRoot, t); fs.mkdirSync(dir, { recursive: true });
    const draft = { ...r, draft: true, needs_human_measure_confirm: true, editable_text_target: true,
      _note: "FIRST-PASS auto-intake from the tokenized Canva SVG. text_regions/colour roles are candidates to confirm; outlined source text is NOT final — the editable manifest re-renders real text. See #4 for the proven final template.json.", role_set: ROLE_SET };
    fs.writeFileSync(path.join(dir, "template.draft.json"), JSON.stringify(draft, null, 2) + "\n");
    const types = r.text_regions.reduce((m: any, x: any) => { m[x.candidate_type] = (m[x.candidate_type] || 0) + 1; return m; }, {});
    console.log(`  ${t.padEnd(4)} ${r.canvas.width}x${r.canvas.height} photos=${r.photo_slots.length} imgtags=${r.image_slot_count} regions=${r.text_regions.length} types=${JSON.stringify(types)} colours=${r.colour_fills.length}`);
  }

  const v = validate04(rows.find((x) => x.template === "4"));
  const ok = rows.filter((x) => x.ok);
  const summary = { generated_by: "studio/engine/autoIntake.ts", templates: ok.length, validation_vs_04: v, rows };
  const catDir = abs("catalogue"); fs.mkdirSync(catDir, { recursive: true });
  fs.writeFileSync(path.join(catDir, "intake_draft_summary.json"), JSON.stringify(summary, null, 2) + "\n");

  console.log(`\n  #4 validation (a detected region must OVERLAP each known #4 content zone):`);
  for (const [k, vv] of Object.entries(v) as any) console.log(`    ${k.padEnd(8)} known=${JSON.stringify(vv.known)} best=${JSON.stringify(vv.best_overlap_detected)} iou=${vv.iou} covered=${vv.covered}`);
  const hits = Object.values(v).filter((x: any) => x.covered).length;
  console.log(`\n  drafts written to studio/intake/<n>/template.draft.json (${ok.length} templates); #4 zones covered: ${hits}/3`);
  if (ok.length !== TEMPLATES.length) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
