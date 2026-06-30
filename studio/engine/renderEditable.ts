import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { abs } from "../src/lib/paths";
import { renderTemplatePng, pngToRGBA, RGBA } from "../src/lib/render";

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
});
export const EditableManifest = z.object({
  template_id: z.string(),
  canvas: z.object({ width: z.number(), height: z.number() }),
  source_svg: z.string(),
  photo_token: z.string(),
  colour_tokens: z.record(z.string(), z.object({ default: z.string(), locked: z.boolean() })),
  text_slots: z.array(EditableSlot),
});
export type EditableManifest = z.infer<typeof EditableManifest>;
export type Palette = Record<string, string>;

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

export async function renderEditable(m: EditableManifest, palette: Palette = {}, photoUri = GREY): Promise<{ svg: string; png: Buffer; editableTextCount: number }> {
  const [W, H] = [m.canvas.width, m.canvas.height];
  const src = fs.readFileSync(abs(m.source_svg), "utf8");
  // background raster = source SVG with the photo token filled
  const filled = src.split(m.photo_token).join(photoUri).replace(/@@PHOTO\d+@@/g, GREY);
  const bgPng = renderTemplatePng(filled, W);
  const bgUri = "data:image/png;base64," + bgPng.toString("base64");
  const bgRGBA = await pngToRGBA(bgPng, false);

  let overlay = "";
  let editableTextCount = 0;
  for (const s of m.text_slots) {
    const [x0, y0, x1, y1] = s.bbox;
    const lines = s.text.split("\n");
    const bw = x1 - x0, bh = y1 - y0;
    const fontSize = Math.max(8, (bh / lines.length) * 0.78);
    const lineH = bh / lines.length;
    const fill = roleHex(m, palette, s.role);
    const anchor = s.align === "center" ? "middle" : s.align === "right" ? "end" : "start";
    const tx = s.align === "center" ? x0 + bw / 2 : s.align === "right" ? x1 : x0;
    const knockHex = localBg(bgRGBA, [x0, y0, x1, y1]);
    // knockout the baked (outlined) source text in this region, then draw editable <text> on top
    overlay += `<rect x="${x0}" y="${y0}" width="${bw}" height="${bh}" fill="${knockHex}"/>`;
    lines.forEach((ln, i) => {
      const by = y0 + (i + 1) * lineH - lineH * 0.22;
      overlay += `<text data-slot-id="${s.id}" data-editable="true" data-role="${s.role}" x="${tx}" y="${by.toFixed(1)}" text-anchor="${anchor}" font-family="${s.font}" font-size="${fontSize.toFixed(1)}" fill="${fill}">${esc(ln)}</text>`;
      editableTextCount++;
    });
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><image x="0" y="0" width="${W}" height="${H}" xlink:href="${bgUri}"/>${overlay}</svg>`;
  const png = renderTemplatePng(svg, W);
  return { svg, png, editableTextCount };
}

export function loadEditableManifest(p: string): EditableManifest {
  return EditableManifest.parse(JSON.parse(fs.readFileSync(abs(p), "utf8")));
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
