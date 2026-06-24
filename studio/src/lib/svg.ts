import fs from "node:fs";
import { abs } from "./paths";
import { fontFamily } from "./fonts";
import { applyValue, wrapBlock, escapeXml } from "./text";

function mimeFor(p: string): string {
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function dataUri(filePath: string): string {
  const p = abs(filePath);
  if (!fs.existsSync(p)) throw new Error(`Asset missing: ${p}`);
  return `data:${mimeFor(p)};base64,${fs.readFileSync(p).toString("base64")}`;
}

function rect(x: number, y: number, w: number, h: number, fill: string, op: number): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" fill-opacity="${op}"/>`;
}

function textLayerSvg(manifest: any, L: any, values: any): string {
  const fam = fontFamily(manifest, L.font);
  const raw = values[L.value_from];
  if (raw === undefined) throw new Error(`Missing value '${L.value_from}' for layer ${L.id}`);
  const text = escapeXml(applyValue(raw, L));
  const r = L.render;
  const op = L.opacity ?? 1;
  const tr = r.tracking_px || 0;
  if (L.align === "center" && r.anchor) {
    const [cx, cy] = r.anchor;
    return `<text x="${cx}" y="${cy}" text-anchor="middle" font-family="${fam}" font-size="${r.size}" letter-spacing="${tr}" fill="${L.color}" fill-opacity="${op}">${text}</text>`;
  }
  const sx = r.scaleX ?? 1;
  return `<g transform="translate(${r.translate_x},${r.baseline}) scale(${sx},1)"><text x="0" y="0" font-family="${fam}" font-size="${r.size}" letter-spacing="${tr}" fill="${L.color}" fill-opacity="${op}">${text}</text></g>`;
}

function blockLayerSvg(manifest: any, L: any, values: any): string {
  const fam = fontFamily(manifest, L.font);
  const raw = values[L.value_from];
  if (raw === undefined) throw new Error(`Missing value '${L.value_from}' for layer ${L.id}`);
  const wrapped = wrapBlock(manifest, L, String(raw));
  const r = L.render;
  const [bx, , bw] = r.box;
  const cx = bx + bw / 2;
  const op = L.opacity ?? 1;
  const tr = r.tracking_px || 0;
  const n = wrapped.lines.length;
  let out = "";
  for (let i = 0; i < n; i++) {
    const y = r.baseline_last - (n - 1 - i) * r.line_spacing;
    out += `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${fam}" font-size="${wrapped.size}" letter-spacing="${tr}" fill="${L.color}" fill-opacity="${op}">${escapeXml(wrapped.lines[i])}</text>`;
  }
  return out;
}

export interface AssembleOpts { noPhoto?: boolean; }

// Assemble the rebuild SVG from the manifest + flat values, in z-order. DEV renderer (no LLM, no DB).
export function assembleRebuildSVG(manifest: any, values: any, opts: AssembleOpts = {}): string {
  const [W, H] = manifest.canvas.output;
  const layers = [...manifest.layers].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  let defs = "", body = "", gradId = 0;
  for (const L of layers) {
    if (L.type === "photo_slot") {
      const [x, y, w, h] = L.box;
      if (opts.noPhoto) body += rect(x, y, w, h, "#000000", 1);
      else {
        const par = L.fit === "cover" ? "xMidYMid slice" : L.fit === "contain" ? "xMidYMid meet" : "none";
        body += `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="${par}" xlink:href="${dataUri(L.asset)}"/>`;
      }
    } else if (L.type === "overlay") {
      const [x, y, w, h] = L.box;
      if (L.kind === "solid") body += rect(x, y, w, h, L.color, L.opacity);
      else if (L.kind === "asset") {
        const par = L.fit === "stretch" ? "none" : "xMidYMid meet";
        body += `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="${par}" xlink:href="${dataUri(L.asset)}"/>`;
      } else if (L.kind === "gradient") {
        const id = "grad" + gradId++;
        const stops = L.stops.map((s: any) => `<stop offset="${s.offset}" stop-color="${s.color}" stop-opacity="${s.opacity}"/>`).join("");
        const dir = L.axis === "vertical" ? 'x1="0" y1="0" x2="0" y2="1"' : 'x1="0" y1="0" x2="1" y2="0"';
        defs += `<linearGradient id="${id}" ${dir}>${stops}</linearGradient>`;
        body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id})"/>`;
      }
    } else if (L.type === "fixed_art") {
      const [x, y, w, h] = L.box;
      body += `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none" xlink:href="${dataUri(L.asset)}"/>`;
    } else if (L.type === "editable_text") {
      body += textLayerSvg(manifest, L, values);
    } else if (L.type === "editable_text_block") {
      body += blockLayerSvg(manifest, L, values);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body}</svg>`;
}

// Single title word probe (black canvas) for calibrate iterations.
export function titleProbeSVG(manifest: any, layer: any, text: string, render: any): string {
  const [W, H] = manifest.canvas.output;
  const fam = fontFamily(manifest, layer.font);
  const sx = render.scaleX ?? 1;
  const tr = render.tracking_px || 0;
  const body = `<g transform="translate(${render.translate_x},${render.baseline}) scale(${sx},1)"><text x="0" y="0" font-family="${fam}" font-size="${render.size}" letter-spacing="${tr}" fill="#ffffff">${escapeXml(text)}</text></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#000"/>${body}</svg>`;
}

// Isolated reference render of one editable_text / editable_text_block layer on black,
// per the (active) manifest render block. Used for proof_compare:"manifest" gates.
export function elementProbeSVG(manifest: any, layer: any, values: any): string {
  const [W, H] = manifest.canvas.output;
  let frag = "";
  if (layer.type === "editable_text") frag = textLayerSvg(manifest, layer, values);
  else if (layer.type === "editable_text_block") frag = blockLayerSvg(manifest, layer, values);
  else throw new Error(`elementProbeSVG: unsupported layer type ${layer.type}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#000"/>${frag}</svg>`;
}

// Single glyph probe at a ref size (natural render) to measure cap-ratio.
export function glyphProbeSVG(manifest: any, fontKey: string, glyph: string, refSize: number): { svg: string; pad: number } {
  const fam = fontFamily(manifest, fontKey);
  const pad = Math.ceil(refSize * 1.5);
  const W = Math.ceil(refSize * 4), H = Math.ceil(refSize * 3);
  const body = `<text x="${pad}" y="${pad}" font-family="${fam}" font-size="${refSize}" fill="#ffffff">${escapeXml(glyph)}</text>`;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#000"/>${body}</svg>`, pad };
}
