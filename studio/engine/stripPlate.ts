import fs from "node:fs";
import path from "node:path";
import { abs } from "../src/lib/paths";
import { renderTemplatePng, pngToRGBA } from "../src/lib/render";

// STRIP PLATE builder — the faithful-replication mechanism.
// A Canva export bakes text as vector <path> glyphs over the photo. Knockout rectangles can NEVER hide them
// invisibly over a photo (they erase the photo texture -> visible boxes). The correct fix: REMOVE the dynamic
// text paths from the SVG itself, leaving the photo/art untouched, then draw editable text directly on the
// intact background.
// Because Canva's transform structure is unreliable to parse statically, path positions are measured
// EMPIRICALLY: each <path> element is rendered once painted magenta and its true canvas bbox recorded
// (cached to intake/<id>/path_map.json). Paths whose rendered bbox center falls inside a strip zone
// (intake/<id>/strip_zones.json, canvas px) are deleted -> assets/<id>/source.stripped.svg.
//
// Usage: npx tsx engine/stripPlate.ts <templateId> [--remap]

const GREY = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwAEAQH/7yMK/AAAAABJRU5ErkJggg==";
const PROBE_W = Number(process.env.PROBE_W || 1080); // probe width; lower = faster (tiny glyphs still register via n>=1)

type Box = [number, number, number, number] | null;

function pathElements(svg: string): { el: string; idx: number }[] {
  return [...svg.matchAll(/<path\b[^>]*?\/>/g)].map((m) => ({ el: m[0], idx: m.index! }));
}

function magentaVariant(svg: string, p: { el: string; idx: number }): string {
  let el = p.el
    .replace(/fill="[^"]*"/g, 'fill="#ff00ff"')
    .replace(/stroke="[^"]*"/g, 'stroke="#ff00ff"')
    .replace(/fill-opacity="[^"]*"/g, 'fill-opacity="1"')
    .replace(/stroke-opacity="[^"]*"/g, 'stroke-opacity="1"');
  if (!/fill="/.test(el)) el = el.replace("<path", '<path fill="#ff00ff"');
  return svg.slice(0, p.idx) + el + svg.slice(p.idx + p.el.length);
}

async function magentaBox(png: Buffer, scale: number): Promise<Box> {
  const img = await pngToRGBA(png, false);
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * 4;
    if (img.data[i] > 180 && img.data[i + 1] < 90 && img.data[i + 2] > 180) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return n >= 1 ? [x0 * scale, y0 * scale, (x1 + 1) * scale, (y1 + 1) * scale] : null;
}

export async function buildPathMap(id: string, force = false): Promise<Box[]> {
  const mapFile = abs(`intake/${id}/path_map.json`);
  const src = fs.readFileSync(abs(`assets/${id}/source.tokenized.svg`), "utf8").replace(/@@PHOTO\d+@@/g, GREY);
  const paths = pathElements(src);
  if (!force && fs.existsSync(mapFile)) {
    const cached = JSON.parse(fs.readFileSync(mapFile, "utf8"));
    if (cached.count === paths.length) return cached.boxes;
  }
  const scale = 1080 / PROBE_W;
  const boxes: Box[] = [];
  for (let i = 0; i < paths.length; i++) {
    const png = renderTemplatePng(magentaVariant(src, paths[i]), PROBE_W);
    boxes.push(await magentaBox(png, scale));
    if ((i + 1) % 40 === 0) console.log(`  probed ${i + 1}/${paths.length}`);
  }
  fs.mkdirSync(path.dirname(mapFile), { recursive: true });
  fs.writeFileSync(mapFile, JSON.stringify({ count: paths.length, boxes }));
  return boxes;
}

export async function buildStrippedSource(id: string, remap = false): Promise<{ removed: number; kept: number }> {
  const zones: [number, number, number, number][] = JSON.parse(fs.readFileSync(abs(`intake/${id}/strip_zones.json`), "utf8"));
  const boxes = await buildPathMap(id, remap);
  const raw = fs.readFileSync(abs(`assets/${id}/source.tokenized.svg`), "utf8");
  const paths = pathElements(raw);
  const drop = new Set<number>();
  paths.forEach((p, i) => {
    const b = boxes[i]; if (!b) return;
    // guard: never strip full-bleed art (photo scrims / background rects) — their center can fall inside a
    // text zone but they are structural, not dynamic text.
    const pathArea = (b[2] - b[0]) * (b[3] - b[1]);
    if (pathArea >= 0.8 * 1080 * 1350) return;
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    // a path much LARGER than the zone that owns its center is structural art behind the text (e.g. the brand
    // band) — keep it. A path comparable to / smaller than the zone (glyphs, a panel fully inside its zone) strips.
    const z = zones.find((z) => cx >= z[0] && cx <= z[2] && cy >= z[1] && cy <= z[3]);
    if (z && pathArea <= 1.5 * (z[2] - z[0]) * (z[3] - z[1])) drop.add(i);
  });
  let out = "";
  let pos = 0;
  paths.forEach((p, i) => { if (drop.has(i)) { out += raw.slice(pos, p.idx); pos = p.idx + p.el.length; } });
  out += raw.slice(pos);
  // optional POSTPROCESS (intake/<id>/postprocess.json): structural surgery the zone mechanism can't express.
  // delete_group_clips: remove whole <g clip-path="url(#id)">...</g> subtrees (e.g. #14's mirrored feather-band
  // apparatus that ate ~2/3 of the photo window — Christian 2026-07-06: more image, hard-ish edges).
  const ppFile = abs(`intake/${id}/postprocess.json`);
  if (fs.existsSync(ppFile)) {
    const pp = JSON.parse(fs.readFileSync(ppFile, "utf8"));
    // literal string replaces (e.g. nudging a baked block's translate) — each find must be UNIQUE in the source
    for (const r of pp.replace || []) {
      const n = out.split(r.find).length - 1;
      if (n !== 1) { console.warn(`postprocess replace: "${r.find.slice(0, 60)}..." matched ${n}x (want 1) — skipped`); continue; }
      out = out.replace(r.find, r.replace);
    }
    for (const cid of pp.delete_group_clips || []) {
      const m = new RegExp(`<g clip-path="url\\(#${cid}\\)">`).exec(out);
      if (!m) continue;
      let depth = 0, end = -1;
      const it = out.slice(m.index).matchAll(/<g\b[^>]*>|<\/g>/g);
      for (const t of it) { depth += t[0].startsWith("<g") ? 1 : -1; if (depth === 0) { end = m.index + t.index! + t[0].length; break; } }
      if (end > 0) out = out.slice(0, m.index) + out.slice(end);
    }
  }
  fs.writeFileSync(abs(`assets/${id}/source.stripped.svg`), out);
  return { removed: drop.size, kept: paths.length - drop.size };
}

if (require.main === module) {
  (async () => {
    const id = process.argv[2] || "3";
    const remap = process.argv.includes("--remap");
    const r = await buildStrippedSource(id, remap);
    console.log(`stripped #${id}: removed ${r.removed} paths, kept ${r.kept} -> assets/${id}/source.stripped.svg`);
    // proof render with grey photo
    const svg = fs.readFileSync(abs(`assets/${id}/source.stripped.svg`), "utf8").replace(/@@PHOTO\d+@@/g, GREY);
    fs.writeFileSync(abs(`out/bucket/${id}.stripped.png`), renderTemplatePng(svg, 1080));
    console.log(`proof -> out/bucket/${id}.stripped.png`);
  })().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}
