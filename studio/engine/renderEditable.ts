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
};
const _fk = new Map<string, any>();
function fkFont(key: string): any { const rel = FONT_FILES[key] || FONT_FILES.Poppins; if (!_fk.has(rel)) _fk.set(rel, (fontkit as any).openSync(abs(rel))); return _fk.get(rel); }
// advance width (px) of one line at a given size — used to shrink text so it never overruns its bbox/dividers.
export function textWidth(fontKey: string, text: string, size: number): number {
  try { const f = fkFont(fontKey); const run = f.layout(text); let u = 0; for (const g of run.glyphs) u += g.advanceWidth; return (u * size) / f.unitsPerEm; }
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
  weight: z.string().optional(),      // "bold"/"600"/"700" -> faux-bold (same-colour stroke; vault has no bold face yet)
  pad: z.number().optional(),         // inner horizontal padding px kept clear of the bbox edges (divider clearance)
  valign: z.enum(["top", "center", "bottom"]).optional(), // vertical placement of the text block in the bbox (default top)
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
  overlay: z.object({ role: z.string(), opacity: z.number() }).optional(), // legibility scrim over the photo
  knockout_regions: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])).optional(), // knock out stray baked source art (local-bg fill, no text)
  // ADAPTIVE PANEL: a baked panel (e.g. #7's feature panel) trimmed to its content — everything in `area` below
  // the last non-empty `fit_to` slot (+ pad) is filled with `fill_role` (the page bg), so a 2-row list doesn't
  // leave a tall empty panel. Fill is drawn LAST (over the baked panel bottom + any empty-row knockouts).
  adaptive_panel: z.object({ area: z.tuple([z.number(), z.number(), z.number(), z.number()]), fit_to: z.array(z.string()), pad: z.number(), fill_role: z.string() }).optional(),
  text_slots: z.array(EditableSlot),
});
export type EditableManifest = z.infer<typeof EditableManifest>;
export type Palette = Record<string, string>;
// per-slot rendered geometry (returned for the visual-QA pass): effective size + measured width + block extent.
export type SlotLayout = { id: string; bbox: number[]; size: number; pad: number; avail: number; maxLineWidth: number; blockTop: number; blockBottom: number };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function roleHex(m: EditableManifest, palette: Palette, role: string): string {
  return palette[role] || m.colour_tokens[role]?.default || "#000000";
}

// 1x1 mid-grey stand-in photo (no real property photo embedded in a proof; real renders pass a data URI).
const GREY = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwAEAQH/7yMK/AAAAABJRU5ErkJggg==";

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
  const src = fs.readFileSync(abs(m.source_svg), "utf8");
  // background raster = source SVG with EACH photo token filled (hero + thumbnails), then an optional
  // legibility scrim baked in, so the knockout samples the FINAL backdrop tone.
  const tokens = m.photo_slots?.map((p) => p.token) ?? (m.photo_token ? [m.photo_token] : []);
  let filled = src, photosFilled = 0;
  for (const tok of tokens) {
    const uri = typeof photos === "string" ? photos : (photos[tok] || GREY);
    if (filled.includes(tok)) photosFilled++;
    filled = filled.split(tok).join(uri);
  }
  filled = filled.replace(/@@PHOTO\d+@@/g, GREY); // any stray token -> neutral
  const photoUriPng = "data:image/png;base64," + renderTemplatePng(filled, W).toString("base64");
  const scrim = m.overlay ? `<rect x="0" y="0" width="${W}" height="${H}" fill="${roleHex(m, palette, m.overlay.role)}" fill-opacity="${m.overlay.opacity}"/>` : "";
  const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><image x="0" y="0" width="${W}" height="${H}" xlink:href="${photoUriPng}"/>${scrim}</svg>`;
  const bgPng = renderTemplatePng(bgSvg, W);
  const bgUri = "data:image/png;base64," + bgPng.toString("base64");
  const bgRGBA = await pngToRGBA(bgPng, false);

  let overlay = "";
  let editableTextCount = 0;
  const layout: SlotLayout[] = [];
  // knock out stray baked source artifacts (e.g. a leftover bracket glyph) before drawing text
  for (const kr of m.knockout_regions ?? []) {
    overlay += `<rect x="${kr[0]}" y="${kr[1]}" width="${kr[2] - kr[0]}" height="${kr[3] - kr[1]}" fill="${localBg(bgRGBA, kr)}"/>`;
  }
  for (const s of m.text_slots) {
    const [x0, y0, x1, y1] = s.bbox;
    // empty slot → knock out the baked source text but draw nothing, so a data-driven derivation can HIDE a row
    // (e.g. a property with fewer real features than the template has feature rows) without leaking baked copy.
    if (!s.text.trim()) { overlay += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="${localBg(bgRGBA, [x0, y0, x1, y1])}"/>`; continue; }
    const lines = s.text.split("\n");
    const bw = x1 - x0, bh = y1 - y0;
    const pad = s.pad ?? 0;
    let fontSize = s.size ?? Math.max(8, (bh / lines.length) * 0.78);
    let lineH = s.line_height ?? (bh / lines.length);
    // AUTO-FIT: shrink so the widest line fits the bbox width minus padding — keeps text off divider lines /
    // edges and prevents overrun when real property values are longer than the template's placeholder copy.
    const avail = bw - 2 * pad;
    const widest = Math.max(...lines.map((l) => textWidth(s.font, l, fontSize)));
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
    // faux-bold: the vault has no bold face, so a same-colour stroke thickens the regular glyph to match
    // a bold source title/label (flagged needs_seed — this is a visual approximation, not the real face).
    const bold = /bold|[6-9]00/.test(s.weight || "");
    const strokeAttr = bold ? ` stroke="${fill}" stroke-width="${(fontSize * 0.042).toFixed(2)}" paint-order="stroke"` : "";
    const maxLineWidth = Math.max(...lines.map((l) => textWidth(s.font, l, fontSize)));
    layout.push({ id: s.id, bbox: [x0, y0, x1, y1], size: +fontSize.toFixed(1), pad, avail: +(bw - 2 * pad).toFixed(1), maxLineWidth: +maxLineWidth.toFixed(1), blockTop: +(y0 + topPad).toFixed(1), blockBottom: +(y0 + topPad + lines.length * lineH).toFixed(1) });
    // knockout the baked (outlined) source text in this region, then draw editable <text> on top
    overlay += `<rect x="${x0}" y="${y0}" width="${bw}" height="${bh}" fill="${knockHex}"/>`;
    lines.forEach((ln, i) => {
      // when size/valign is explicit, place the first baseline from the ascent so type sits inside the bbox
      const by = (s.size || s.valign) ? (y0 + topPad + fontSize * 0.82 + i * lineH) : (y0 + (i + 1) * lineH - lineH * 0.22);
      overlay += `<text data-slot-id="${s.id}" data-editable="true" data-role="${s.role}" x="${tx}" y="${by.toFixed(1)}" text-anchor="${anchor}" font-family="${s.font}" font-size="${fontSize.toFixed(1)}"${strokeAttr} fill="${fill}">${esc(ln)}</text>`;
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
  const src = fs.readFileSync(abs(m.source_svg), "utf8");
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
