import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import fontkit from "fontkit";
import { abs } from "../src/lib/paths";
import { renderTemplatePng, pngToRGBA, RGBA } from "../src/lib/render";

// font-key -> file, for width measurement (auto-fit). Same faces resvg loads from fonts/.
const FONT_FILES: Record<string, string> = {
  Poppins: "fonts/Poppins-Regular.ttf", LibreCaslonDisplay: "fonts/LibreCaslonDisplay-Regular.ttf",
  LibreCaslonText: "fonts/LibreCaslonText-Regular.ttf", Prata: "fonts/Prata-Regular.ttf", Tinos: "fonts/Tinos-Regular.ttf",
  GreatVibes: "fonts/GreatVibes-Regular.ttf", "Great Vibes": "fonts/GreatVibes-Regular.ttf",
  Italiana: "fonts/Italiana-Regular.ttf",
};
// real weight files (identified via engine/fontMatch.ts — no faux-bold strokes)
const WEIGHT_FILES: Record<string, Record<string, string>> = {
  Poppins: { "500": "fonts/Poppins-Medium.ttf", "600": "fonts/Poppins-SemiBold.ttf", "700": "fonts/Poppins-Bold.ttf", bold: "fonts/Poppins-Bold.ttf" },
};
// SELF-REGISTERING vault: every fonts/*.ttf is scanned once (typographic family + usWeightClass + italic flag)
// so a newly seeded face is addressable by family name immediately — mirrors how resvg's fontDir registers the
// same files. Static maps above stay as overrides/aliases (e.g. "GreatVibes" without the space).
type VaultFace = { file: string; weight: number; italic: boolean };
let _vault: Map<string, VaultFace[]> | null = null;
function vault(): Map<string, VaultFace[]> {
  if (_vault) return _vault;
  _vault = new Map();
  for (const f of fs.readdirSync(abs("fonts"))) {
    if (!f.endsWith(".ttf") || f.startsWith("__cand_")) continue;
    try {
      const fk = (fontkit as any).openSync(abs(path.join("fonts", f)));
      const fam = fk.name?.records?.preferredFamily?.en || fk.familyName;
      const face: VaultFace = {
        file: path.join("fonts", f),
        weight: fk["OS/2"]?.usWeightClass || 400,
        italic: (fk.italicAngle || 0) !== 0 || ((fk["OS/2"]?.fsSelection || 0) & 1) !== 0,
      };
      if (fam) { if (!_vault.has(fam)) _vault.set(fam, []); _vault.get(fam)!.push(face); }
    } catch { /* unreadable face — skip */ }
  }
  return _vault;
}
const _fk = new Map<string, any>();
function fkFile(key: string, weight?: string, italic?: boolean): string {
  if (!italic && weight && WEIGHT_FILES[key]?.[weight]) return WEIGHT_FILES[key][weight];
  const faces = vault().get(key);
  if (faces?.length) {
    const want = weight && /^\d+$/.test(weight) ? +weight : weight ? 700 : 400;
    // prefer the requested italic style; within it, the nearest registered weight
    const pool = faces.filter((c) => c.italic === !!italic);
    const pick = (pool.length ? pool : faces).reduce((a, b) => (Math.abs(b.weight - want) < Math.abs(a.weight - want) ? b : a));
    return pick.file;
  }
  return FONT_FILES[key] || FONT_FILES.Poppins;
}
function fkFont(key: string, weight?: string, italic?: boolean): any { const rel = fkFile(key, weight, italic); if (!_fk.has(rel)) _fk.set(rel, (fontkit as any).openSync(abs(rel))); return _fk.get(rel); }
// advance width (px) of one line at a given size — measured with the ACTUAL face file (bold/italic differ).
export function textWidth(fontKey: string, text: string, size: number, weight?: string, italic?: boolean): number {
  try { const f = fkFont(fontKey, weight, italic); const run = f.layout(text); let u = 0; for (const g of run.glyphs) u += g.advanceWidth; return (u * size) / f.unitsPerEm; }
  catch { return text.length * size * 0.55; }
}

// Generic editable-template renderer (multi-template; simpler than the #4-bespoke composeOne). Renders the
// tokenized Canva SVG as a background raster (photo filled), then knocks out each text region and draws REAL
// editable <text> in its role-token colour. Output SVG keeps <text data-editable> (text stays editable) and
// resolves colours from a palette (role -> hex) so roles recolour independently. First-proof grade — geometry
// from the auto-intake draft; the knockout is the background-role colour. NOT the production compositor.

export const EditableSlot = z.object({
  id: z.string(),
  role: z.string(),               // colour token / role (resolved via the palette)
  source: z.enum(["template_copy", "property_fact"]), // never invent property facts
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  font: z.string(),               // vault font key the renderer loads (resvg fontDir)
  align: z.enum(["left", "center", "right"]).default("left"),
  text: z.string(),               // may contain \n for multiple lines
  size: z.number().optional(),        // explicit font-size px (overrides the bbox heuristic; enables tight display type)
  line_height: z.number().optional(), // explicit line pitch px (for tight multi-line titles)
  weight: z.string().optional(),      // real weight ("500"/"600"/"700"/"800"/"900") -> seeded weight face via the vault
  italic: z.boolean().optional(),     // real italic face via the vault (emits font-style="italic"; measured with the italic file)
  pad: z.number().optional(),         // inner horizontal padding px kept clear of the bbox edges (divider clearance)
  valign: z.enum(["top", "center", "bottom"]).optional(), // vertical placement of the text block in the bbox (default top)
  tracking: z.number().optional(),    // letter-spacing px (premium uppercase eyebrows / labels)
  word_spacing: z.number().optional(),// extra px between words (replicates sources set tighter/looser than the face's space glyph)
  // REPLICATED stroke effect: the SOURCE design bakes a same-colour stroke on the text (constant px stems across
  // different sizes = stroke, not a bolder face). This is replication of baked art — NOT the banned faux-bold
  // used to fake a missing weight file.
  stroke_px: z.number().optional(),
  scale_x: z.number().optional(),     // horizontal condensing (0-1) — matches condensed display faces the vault lacks
  no_knockout: z.boolean().optional(),// per-slot: baked text for THIS slot was stripped from the source -> draw only
  // ADAPTIVE PILL: draw a rounded pill behind the text, sized to the MEASURED text width (+pad) — replaces a
  // baked pill that would otherwise sit half-empty behind shorter real values (e.g. #11's address pill).
  pill: z.object({ role: z.string(), pad_x: z.number(), pad_y: z.number() }).optional(),
  // FLOW: position this slot's y directly after another slot's rendered text block (title -> body stacking,
  // so a 2-line real title keeps the body tight underneath like the Canva original).
  follow: z.object({ slot: z.string(), gap: z.number() }).optional(),
  // the source design's line count: when real text has FEWER lines, size/line-height scale UP so the text
  // still fills the design zone naturally (width auto-fit then caps it) — no empty holes from short titles.
  design_lines: z.number().optional(),
  // BAKED art that belongs to this slot's fact (its icon, its divider): when the fact is missing (empty text),
  // each region is covered with fill_role (else the sampled local background) so no orphaned icon/divider floats
  // beside a hidden value. When the text renders, nothing is drawn — the original baked art shows untouched.
  companion_art: z.array(z.object({ bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]), fill_role: z.string().optional() })).optional(),
});
export const EditableManifest = z.object({
  template_id: z.string(),
  canvas: z.object({ width: z.number(), height: z.number() }),
  source_svg: z.string(),
  photo_token: z.string().optional(),                                   // single-photo templates
  photo_slots: z.array(z.object({ token: z.string() })).optional(),     // multi-photo templates (hero + thumbnails)
  colour_tokens: z.record(z.string(), z.object({ default: z.string(), locked: z.boolean() })),
  // PRODUCTION ELIGIBILITY GUARD: a post whose truth depends on property STATUS (e.g. "Just Sold") must only
  // render for a matching status or an explicit demo/test render — the engine must never auto-generate it for an
  // active listing. Enforced by engine/eligibility.ts.
  eligibility: z.object({ post_type: z.string(), requires_status: z.array(z.string()), note: z.string().optional() }).optional(),
  // photo aspect mode for the WHOLE template (see forceAspectOnPhotoSlots): "slice" crop-to-fill dead-center
  // (default — the accepted #1/#7/#11 renders, matches the live renderer) | "attention" crop-to-fill with
  // attention framing (Christian 2026-07-06, Canva-original truth: photos FILL their frames edge to edge and
  // cropping is expected; each photo is pre-cropped to its frame's aspect around the most interesting region
  // via fitPhotosToFrames, so a landscape shot in a tall frame frames the subject instead of a dead-center
  // zoom) | "meet" fit-whole-photo (kept for completeness; no current template).
  photo_fit: z.enum(["slice", "attention", "meet"]).optional(),
  // colour-locked template (e.g. #10): the design's own palette IS the identity — the agency colour wheel must
  // NOT recolour it. Renderers pass an empty palette so every role keeps its colour_tokens default.
  palette_locked: z.boolean().optional(),
  overlay: z.object({ role: z.string(), opacity: z.number() }).optional(), // flat legibility scrim over the photo
  // vertical GRADIENT scrim (premium): dark where text sits (e.g. top), clear over the photo. Baked into the bg
  // so knockouts blend. stops = [{offset 0..1, opacity 0..1}] in the role colour.
  // under_art: inject the gradient INTO the source SVG right after the photo element — it darkens the photo at
  // the photo's own position in the stacking order, so baked art painted later (pill outlines, icons, dividers)
  // stays on top. Without it the scrim composites over the finished plate and would bury that art.
  scrim: z.object({ role: z.string(), stops: z.array(z.object({ offset: z.number(), opacity: z.number() })), under_art: z.boolean().optional() }).optional(),
  // STATIC plate rectangles drawn over the photo raster before any text: rebuild source margins that the
  // ONE-ASPECT force-slice floods (e.g. a crop window whose cream border existed only via the original photo's
  // aspect). First-class — never abuse panels/scrims with dummy slot names to fake static rects.
  plate_rects: z.array(z.object({ bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]), fill_role: z.string() })).optional(),
  knockout_regions: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])).optional(), // knock out stray baked source art (local-bg fill, no text)
  // STRIP-PLATE mode: the source_svg already had its dynamic text paths REMOVED (engine/stripPlate.ts), so the
  // photo/art background is intact — editable text draws directly on it with NO knockout rectangles (knockouts
  // over a photo always show as boxes; this mode is what makes photo-background templates replicate exactly).
  no_knockouts: z.boolean().optional(),
  // ADAPTIVE PANEL: a baked panel (e.g. #7's feature panel) trimmed to its content — everything in `area` below
  // the last non-empty `fit_to` slot (+ pad) is filled with `fill_role` (the page bg), so a 2-row list doesn't
  // leave a tall empty panel. Fill is drawn LAST (over the baked panel bottom + any empty-row knockouts).
  adaptive_panel: z.object({ area: z.tuple([z.number(), z.number(), z.number(), z.number()]), fit_to: z.array(z.string()), pad: z.number(), fill_role: z.string() }).optional(),
  // DYNAMIC PANEL (Christian 2026-07-04, tuned to his Canva 3-feature example): the baked panel was STRIPPED
  // from the source; the engine DRAWS it and positions header+rows inside. Height fits the row count; the panel
  // TOP starts at top_base (full row count) and moves DOWN by shift_per_missing for each missing row, so a
  // shorter panel sits with the title/details instead of leaving dead space.
  dynamic_panel: z.object({
    x0: z.number(), x1: z.number(), top_base: z.number(), shift_per_missing: z.number(), max_rows: z.number(),
    fill_role: z.string(), header_slot: z.string(), row_slots: z.array(z.string()),
    pad_top: z.number(), header_h: z.number(), row_pitch: z.number(), row_h: z.number(), pad_bottom: z.number(),
    // row icons: baked icon art extracted from the source (engine/stripPlate probe + extractor). Keyword-matched
    // per row text; unmatched rows get a neutral check icon in the same style.
    icons: z.object({ file: z.string(), x: z.number(), dy: z.number() }).optional(),
  }).optional(),
  text_slots: z.array(EditableSlot),
});
export type EditableManifest = z.infer<typeof EditableManifest>;
export type Palette = Record<string, string>;
// per-slot rendered geometry (returned for the visual-QA pass): effective size + measured width + block extent.
export type SlotLayout = { id: string; bbox: number[]; size: number; pad: number; avail: number; maxLineWidth: number; blockTop: number; blockBottom: number };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ONE ASPECT RULE per template (Christian 2026-07-06, supersedes always-slice): a template's photos are either
// 'slice' (crop-to-fill — full-bleed photo BACKGROUNDS, and the default: matches the accepted #1/#7/#11 renders
// and the LIVE renderer apps/api/src/routes/studio-render.ts) or 'meet' (fit-whole-photo — framed GALLERY
// designs, like Canva fits a placed photo; the mismatch space stays design background). manifest.photo_fit
// picks ONE mode for the whole template — never mixed ad-hoc. Applied on the SHORT tokens before substitution;
// baked art (no token) untouched.
export function forceAspectOnPhotoSlots(svg: string, mode: "slice" | "attention" | "meet" = "slice"): string {
  const par = mode === "meet" ? "meet" : "slice"; // "attention" = slice geometry over pre-cropped bitmaps
  return svg.replace(/<image\b[^>]*>/g, (tag) => {
    if (!/@@PHOTO\d+@@/.test(tag)) return tag;
    return tag.replace(/\s+preserveAspectRatio\s*=\s*"[^"]*"/g, "").replace(/^<image\b/, `<image preserveAspectRatio="xMidYMid ${par}"`);
  });
}
export const forceSliceOnPhotoSlots = (svg: string) => forceAspectOnPhotoSlots(svg, "slice");

// ATTENTION FIT (photo_fit "attention"): pre-crop each property photo to its frame's exact aspect around the
// most interesting region (sharp attention strategy) so the slice fill shows a sensibly framed crop instead of
// a dead-center zoom. Frame aspects come from the source's <image> width/height attrs — Canva exports bake the
// demo bitmap at frame size, so the attrs ARE the frame shape. Photos keep the existing index->token order
// (PHOTO0 = the design's hero frame).
export async function fitPhotosToFrames(m: z.infer<typeof EditableManifest>, imgPaths: string[]): Promise<Record<string, string>> {
  const sharp = (await import("sharp")).default;
  const src = fs.readFileSync(abs(m.source_svg), "utf8");
  const tokens = m.photo_slots?.map((p) => p.token) ?? (m.photo_token ? [m.photo_token] : []);
  const out: Record<string, string> = {};
  for (let i = 0; i < tokens.length; i++) {
    const tag = src.match(new RegExp(`<image\\b[^>]*${tokens[i].replace(/@/g, "\\@")}[^>]*>`))?.[0] || "";
    const fw = Number(/\bwidth="([\d.]+)"/.exec(tag)?.[1] || 0), fh = Number(/\bheight="([\d.]+)"/.exec(tag)?.[1] || 0);
    const img = imgPaths[i % imgPaths.length];
    if (!fw || !fh) { out[tokens[i]] = "data:image/jpeg;base64," + fs.readFileSync(img).toString("base64"); continue; }
    // render at up to ~1400px on the long side — plenty for a 1080-canvas frame
    const s = Math.min(1, 1400 / Math.max(fw, fh));
    const buf = await sharp(img)
      .resize({ width: Math.round(fw * s), height: Math.round(fh * s), fit: "cover", position: sharp.strategy.attention })
      .jpeg({ quality: 88 })
      .toBuffer();
    out[tokens[i]] = "data:image/jpeg;base64," + buf.toString("base64");
  }
  return out;
}
function roleHex(m: EditableManifest, palette: Palette, role: string): string {
  return palette[role] || m.colour_tokens[role]?.default || "#000000";
}

// 1x1 mid-grey stand-in photo (no real property photo embedded in a proof; real renders pass a data URI).
const GREY = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwAEAQH/7yMK/AAAAABJRU5ErkJggg==";
const TRANSPARENT = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==";

// median colour of a thin ring just outside the bbox = the local background to knock out with (blends the
// knockout into the surrounding design instead of a flat white box).
function localBg(img: RGBA, b: number[], margin = 10): string {
  const samples: [number, number, number][] = [];
  const push = (x: number, y: number) => { if (x < 0 || y < 0 || x >= img.width || y >= img.height) return; const i = (y * img.width + x) * 4; if (img.data[i + 3] > 128) samples.push([img.data[i], img.data[i + 1], img.data[i + 2]]); };
  for (let x = b[0] - margin; x <= b[2] + margin; x += 4) { push(x, b[1] - margin); push(x, b[3] + margin); }
  for (let y = b[1] - margin; y <= b[3] + margin; y += 4) { push(b[0] - margin, y); push(b[2] + margin, y); }
  if (!samples.length) return "#ffffff";
  const med = (k: number) => { const a = samples.map((s) => s[k]).sort((p, q) => p - q); return a[a.length >> 1]; };
  return "#" + [med(0), med(1), med(2)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export async function renderEditable(m: EditableManifest, palette: Palette = {}, photos: string | Record<string, string> = GREY): Promise<{ svg: string; png: Buffer; editableTextCount: number; photosFilled: number }> {
  const [W, H] = [m.canvas.width, m.canvas.height];
  const src = forceAspectOnPhotoSlots(fs.readFileSync(abs(m.source_svg), "utf8"), m.photo_fit ?? "slice");
  // background raster = source SVG with EACH photo token filled (hero + thumbnails), then an optional
  // legibility scrim baked in, so the knockout samples the FINAL backdrop tone.
  const tokens = m.photo_slots?.map((p) => p.token) ?? (m.photo_token ? [m.photo_token] : []);
  let filled = src, photosFilled = 0;
  // under_art scrim: the scrim rect stays in exact canvas space (over the photo raster), and the baked art that
  // the source paints AFTER the photo (its own gradient, pill outlines, icons, dividers) is re-composited on top
  // via a second art-only render: photo tokens -> transparent, pre-photo background paths dropped by paint order.
  let artOverUri = "";
  if (m.scrim?.under_art && tokens.length) {
    const imgPos = src.search(new RegExp(`<image\\b[^>]*${tokens[0].replace(/@/g, "\\@")}[^>]*/>`));
    let art = src;
    if (imgPos >= 0) {
      // paths inside <defs> are clip/mask DEFINITIONS, not painted art — deleting them breaks url(#) references
      const defs: [number, number][] = [];
      for (const d of art.matchAll(/<defs>[\s\S]*?<\/defs>/g)) defs.push([d.index!, d.index! + d[0].length]);
      const inDefs = (i: number) => defs.some(([a, b]) => i >= a && i < b);
      const pre = [...art.matchAll(/<path\b[^>]*?\/>/g)].filter((p) => p.index! < imgPos && !inDefs(p.index!));
      for (let i = pre.length - 1; i >= 0; i--) art = art.slice(0, pre[i].index!) + art.slice(pre[i].index! + pre[i][0].length);
    }
    art = art.replace(/@@PHOTO\d+@@/g, TRANSPARENT);
    artOverUri = "data:image/png;base64," + renderTemplatePng(art, W).toString("base64");
  }
  for (const tok of tokens) {
    const uri = typeof photos === "string" ? photos : (photos[tok] || GREY);
    if (filled.includes(tok)) photosFilled++;
    filled = filled.split(tok).join(uri);
  }
  filled = filled.replace(/@@PHOTO\d+@@/g, GREY); // any stray token -> neutral
  const photoUriPng = "data:image/png;base64," + renderTemplatePng(filled, W).toString("base64");
  let scrim = m.overlay ? `<rect x="0" y="0" width="${W}" height="${H}" fill="${roleHex(m, palette, m.overlay.role)}" fill-opacity="${m.overlay.opacity}"/>` : "";
  let scrimDefs = "";
  if (m.scrim) {
    const stops = m.scrim.stops.map((s) => `<stop offset="${s.offset}" stop-color="${roleHex(m, palette, m.scrim!.role)}" stop-opacity="${s.opacity}"/>`).join("");
    scrimDefs = `<defs><linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>`;
    scrim += `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#scrim)"/>`;
  }
  const artOver = artOverUri ? `<image x="0" y="0" width="${W}" height="${H}" xlink:href="${artOverUri}"/>` : "";
  const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${scrimDefs}<image x="0" y="0" width="${W}" height="${H}" xlink:href="${photoUriPng}"/>${scrim}${artOver}</svg>`;
  const bgPng = renderTemplatePng(bgSvg, W);
  const bgUri = "data:image/png;base64," + bgPng.toString("base64");
  const bgRGBA = await pngToRGBA(bgPng, false);

  let overlay = "";
  // static plate rectangles first — they are part of the plate, everything else draws on top
  for (const pr of m.plate_rects || []) {
    const [rx0, ry0, rx1, ry1] = pr.bbox;
    overlay += `<rect x="${rx0}" y="${ry0}" width="${rx1 - rx0}" height="${ry1 - ry0}" fill="${roleHex(m, palette, pr.fill_role)}"/>`;
  }
  let editableTextCount = 0;
  const layout: SlotLayout[] = [];
  // dynamic panel: compute geometry from the number of NON-EMPTY rows, draw the panel, and override the
  // header/row slot y-positions so they sit inside the drawn panel (x-coords stay from the manifest).
  const yOverride = new Map<string, [number, number]>();
  const blockBottoms = new Map<string, number>();
  if (m.dynamic_panel) {
    const dp = m.dynamic_panel;
    const rows = dp.row_slots.filter((id) => m.text_slots.find((s) => s.id === id)?.text.trim());
    const n = rows.length;
    const rowsBlock = n > 0 ? (n - 1) * dp.row_pitch + dp.row_h : 0;
    const panelH = dp.pad_top + dp.header_h + rowsBlock + dp.pad_bottom;
    // top-anchored with shift-down: full row count sits at top_base (the Canva original position); each missing
    // row moves the whole box DOWN so it stays visually attached to the title/details block (Christian's example).
    const top = dp.top_base + dp.shift_per_missing * Math.max(0, dp.max_rows - n);
    overlay += `<rect x="${dp.x0}" y="${top.toFixed(1)}" width="${dp.x1 - dp.x0}" height="${panelH.toFixed(1)}" fill="${roleHex(m, palette, dp.fill_role)}"/>`;
    yOverride.set(dp.header_slot, [top + dp.pad_top, top + dp.pad_top + dp.header_h]);
    rows.forEach((id, i) => { const y0 = top + dp.pad_top + dp.header_h + i * dp.row_pitch; yOverride.set(id, [y0, y0 + dp.row_h]); });
    // baked row icons (extracted from the source): keyword-match each row's text; neutral check when unmatched
    if (dp.icons) {
      const lib = JSON.parse(fs.readFileSync(abs(dp.icons.file), "utf8"));
      const kw: Record<string, string[]> = lib._keywords || {};
      rows.forEach((id, i) => {
        const txt = (m.text_slots.find((s) => s.id === id)?.text || "").toLowerCase();
        const name = Object.keys(kw).find((k) => kw[k].some((w) => txt.includes(w)));
        const y0 = top + dp.pad_top + dp.header_h + i * dp.row_pitch + dp.icons!.dy;
        if (name && lib[name]) {
          const ic = lib[name];
          overlay += `<g transform="translate(${(dp.icons!.x - ic.bbox[0]).toFixed(1)},${(y0 - ic.bbox[1]).toFixed(1)})">${ic.svg}</g>`;
        } else {
          overlay += `<g transform="translate(${dp.icons!.x},${y0.toFixed(1)})"><rect x="0" y="0" width="49" height="49" rx="8" fill="#1a1a1a"/><path d="M13 26 L22 34 L36 16" stroke="#ffffff" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`;
        }
      });
    }
  }
  // knock out stray baked source artifacts (e.g. a leftover bracket glyph) before drawing text
  for (const kr of m.knockout_regions ?? []) {
    overlay += `<rect x="${kr[0]}" y="${kr[1]}" width="${kr[2] - kr[0]}" height="${kr[3] - kr[1]}" fill="${localBg(bgRGBA, kr)}"/>`;
  }
  for (const s of m.text_slots) {
    if (s.follow && blockBottoms.has(s.follow.slot)) {
      const fy = blockBottoms.get(s.follow.slot)! + s.follow.gap;
      yOverride.set(s.id, [fy, fy + (s.bbox[3] - s.bbox[1])]);
    }
    const ov = yOverride.get(s.id);
    const [x0, y0, x1, y1] = ov ? [s.bbox[0], ov[0], s.bbox[2], ov[1]] : s.bbox;
    // empty slot → knock out the baked source text but draw nothing, so a data-driven derivation can HIDE a row
    // (e.g. a property with fewer real features than the template has feature rows) without leaking baked copy.
    if (!s.text.trim()) {
      if (!m.no_knockouts && !s.no_knockout) overlay += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="${localBg(bgRGBA, [x0, y0, x1, y1])}"/>`;
      // the fact is missing → also cover the slot's baked companion art (icon/divider) so nothing floats orphaned
      for (const ca of s.companion_art || []) {
        const [ax0, ay0, ax1, ay1] = ca.bbox;
        const fill = ca.fill_role ? roleHex(m, palette, ca.fill_role) : localBg(bgRGBA, [ax0, ay0, ax1, ay1]);
        overlay += `<rect x="${ax0}" y="${ay0}" width="${ax1 - ax0}" height="${ay1 - ay0}" fill="${fill}"/>`;
      }
      continue;
    }
    const lines = s.text.split("\n");
    const bw = x1 - x0, bh = y1 - y0;
    const pad = s.pad ?? 0;
    let fontSize = s.size ?? Math.max(8, (bh / lines.length) * 0.78);
    let lineH = s.line_height ?? (bh / lines.length);
    if (s.design_lines && lines.length < s.design_lines) { const g = s.design_lines / lines.length; fontSize *= g; lineH *= g; }
    // AUTO-FIT: shrink so the widest line fits the bbox width minus padding — keeps text off divider lines /
    // edges and prevents overrun when real property values are longer than the template's placeholder copy.
    const avail = bw - 2 * pad;
    const sx = s.scale_x ?? 1;
    // word_spacing is defined at the slot's DESIGN size and scales with auto-fit (a fixed -25px gap that
    // replicates the source at 154px would fuse words once a long real title shrinks the type) — so the
    // rendered gap stays proportional. designSize captures the pre-fit size for that ratio.
    const designSize = fontSize;
    const wsAt = (fs: number) => (s.word_spacing ? s.word_spacing * (fs / designSize) : 0);
    const wsExtra = (l: string, fs: number) => (l.split(" ").length - 1) * wsAt(fs);
    const widest = Math.max(...lines.map((l) => textWidth(s.font, l, fontSize, s.weight, s.italic) + wsExtra(l, fontSize))) * sx;
    if (widest > avail && avail > 0) { const r = avail / widest; fontSize = Math.max(8, fontSize * r); lineH = lineH * r; }
    // vertical auto-fit: if the block is taller than the bbox (e.g. a 3-line title), shrink size + line pitch
    if (lines.length * lineH > bh && bh > 0) { const rv = bh / (lines.length * lineH); fontSize = Math.max(8, fontSize * rv); lineH = lineH * rv; }
    // vertical placement of the text block within the bbox (top default; center/bottom balance short blocks)
    const blockH = lines.length * lineH;
    const topPad = s.valign === "center" ? Math.max(0, (bh - blockH) / 2) : s.valign === "bottom" ? Math.max(0, bh - blockH) : 0;
    const fill = roleHex(m, palette, s.role);
    const anchor = s.align === "center" ? "middle" : s.align === "right" ? "end" : "start";
    const tx = s.align === "center" ? x0 + bw / 2 : s.align === "right" ? x1 - pad : x0 + pad;
    const knockHex = localBg(bgRGBA, [x0, y0, x1, y1]);
    // REAL weights: emit font-weight and let fontdb select the seeded weight file (Poppins Medium/SemiBold/
    // Bold are in fonts/). No faux-bold strokes.
    const wNum = s.weight ? (/^\d+$/.test(s.weight) ? s.weight : "700") : "";
    const strokeAttr = (wNum ? ` font-weight="${wNum}"` : "") + (s.italic ? ` font-style="italic"` : "")
      + (s.stroke_px ? ` stroke="${fill}" stroke-width="${s.stroke_px}"` : "") + (s.word_spacing ? ` word-spacing="${wsAt(fontSize).toFixed(1)}"` : "");
    const maxLineWidth = Math.max(...lines.map((l) => textWidth(s.font, l, fontSize, s.weight, s.italic) + wsExtra(l, fontSize))) * sx;
    blockBottoms.set(s.id, y0 + topPad + (lines.length - 1) * lineH + fontSize * 0.95); // ink bottom (baseline+descender)
    layout.push({ id: s.id, bbox: [x0, y0, x1, y1], size: +fontSize.toFixed(1), pad, avail: +(bw - 2 * pad).toFixed(1), maxLineWidth: +maxLineWidth.toFixed(1), blockTop: +(y0 + topPad).toFixed(1), blockBottom: +(y0 + topPad + lines.length * lineH).toFixed(1) });
    // knockout the baked (outlined) source text in this region, then draw editable <text> on top.
    // strip-plate mode (template-wide or per-slot): baked text already REMOVED -> draw directly, no knockout box.
    if (!m.no_knockouts && !s.no_knockout) overlay += `<rect x="${x0}" y="${y0}" width="${bw}" height="${bh}" fill="${knockHex}"/>`;
    // adaptive pill sized to the measured text (+padding) — replaces a baked pill that sat half-empty behind
    // shorter real values. Drawn before the text.
    if (s.pill) {
      const pw = maxLineWidth + 2 * s.pill.pad_x, ph = lines.length * lineH + 2 * s.pill.pad_y;
      const px = s.align === "center" ? x0 + bw / 2 - pw / 2 : s.align === "right" ? x1 - pad - maxLineWidth - s.pill.pad_x : x0 + pad - s.pill.pad_x;
      const py = y0 + topPad - s.pill.pad_y;
      overlay += `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" rx="${(ph / 2).toFixed(1)}" fill="${roleHex(m, palette, s.pill.role)}"/>`;
    }
    lines.forEach((ln, i) => {
      // when size/valign is explicit, place the first baseline from the ascent so type sits inside the bbox
      const by = (s.size || s.valign) ? (y0 + topPad + fontSize * 0.82 + i * lineH) : (y0 + (i + 1) * lineH - lineH * 0.22);
      const trackAttr = s.tracking ? ` letter-spacing="${s.tracking}"` : "";
      const posAttr = sx !== 1
        ? ` transform="translate(${tx},${by.toFixed(1)}) scale(${sx},1)" x="0" y="0"`
        : ` x="${tx}" y="${by.toFixed(1)}"`;
      overlay += `<text data-slot-id="${s.id}" data-editable="true" data-role="${s.role}"${posAttr} text-anchor="${anchor}" font-family="${s.font}" font-size="${fontSize.toFixed(1)}"${trackAttr}${strokeAttr} fill="${fill}">${esc(ln)}</text>`;
      editableTextCount++;
    });
  }
  // adaptive panel: trim the baked panel to its rendered content (fill everything below the last non-empty
  // fit_to slot with the page bg). Drawn LAST so it covers the baked panel's bottom + any empty-row knockouts.
  if (m.adaptive_panel) {
    const ap = m.adaptive_panel;
    const lastY = m.text_slots.filter((s) => ap.fit_to.includes(s.id) && s.text.trim()).reduce((mx, s) => Math.max(mx, s.bbox[3]), ap.area[1]);
    const cutY = Math.round(lastY + ap.pad);
    if (cutY < ap.area[3]) overlay += `<rect x="${ap.area[0]}" y="${cutY}" width="${ap.area[2] - ap.area[0]}" height="${ap.area[3] - cutY}" fill="${roleHex(m, palette, ap.fill_role)}"/>`;
  }
  // Render the overlay ALONE (transparent) then composite onto the bg raster with sharp. Putting the text in
  // the SAME svg as a large embedded data-URI <image> trips a resvg coordinate quirk (text after the image
  // mis-scales/relocates); the overlay renders correctly on its own, so composite it separately.
  const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${overlay}</svg>`;
  const overlayPng = renderTemplatePng(overlaySvg, W);
  const png = await (await import("sharp")).default(bgPng).composite([{ input: overlayPng, top: 0, left: 0 }]).png().toBuffer();
  // svg kept for record + the editability/photo-fill checks (grep for <text data-editable> + the embedded image)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><image x="0" y="0" width="${W}" height="${H}" xlink:href="${bgUri}"/>${overlay}</svg>`;
  return { svg, png, editableTextCount, photosFilled, layout };
}

export function loadEditableManifest(p: string): EditableManifest {
  return EditableManifest.parse(JSON.parse(fs.readFileSync(abs(p), "utf8")));
}

// the ORIGINAL template look: source SVG with every photo token filled, NO editable overlay. Used as the
// reference side of the side-by-side visual comparison.
export function renderFilledSource(m: EditableManifest, photos: string | Record<string, string> = GREY): Buffer {
  const src = forceAspectOnPhotoSlots(fs.readFileSync(abs(m.source_svg), "utf8"), m.photo_fit ?? "slice");
  const tokens = m.photo_slots?.map((p) => p.token) ?? (m.photo_token ? [m.photo_token] : []);
  let filled = src;
  for (const tok of tokens) filled = filled.split(tok).join(typeof photos === "string" ? photos : (photos[tok] || GREY));
  filled = filled.replace(/@@PHOTO\d+@@/g, GREY);
  return renderTemplatePng(filled, m.canvas.width);
}

if (require.main === module) {
  (async () => {
    const mp = process.argv[2] || "manifest/templates/11.editable.json";
    const m = loadEditableManifest(mp);
    const outDir = abs(`out/engine/${m.template_id}`); fs.mkdirSync(outDir, { recursive: true });
    const r = await renderEditable(m);
    fs.writeFileSync(path.join(outDir, `editable_default.svg`), r.svg);
    fs.writeFileSync(path.join(outDir, `editable_default.png`), r.png);
    console.log(`rendered ${m.template_id}: ${r.editableTextCount} editable <text> elements -> out/engine/${m.template_id}/editable_default.{svg,png}`);
  })().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
