import { z } from "zod";
import { textWidth } from "./renderEditable";
import { renderTemplatePng } from "../src/lib/render";

// FREEFORM renderer (Smart v2, Christian 2026-07-14): the AI designs, the engine draws.
// Claude (vision) returns a DesignSpec — a blueprint of photo frames, panels, scrims and text blocks — and this
// renderer draws it deterministically: real photos cropped pixel-for-pixel into the frames, text drawn with the
// real font vault. The AI never touches pixels or types a digit, so photos stay photos and facts stay facts.
// (Born from the seedream test where 3 photos were BLENDED into one fake scene with two different prices.)

const Bbox = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const HEX = /^#[0-9a-fA-F]{6}$/;
const Colour = z.string().regex(HEX);

export const FreeformElement = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("photo"),
    photo: z.number().int().min(0).max(9), // index into the chosen photos
    bbox: Bbox,
    // optional manual framing (same semantics as the template editor's move/crop)
    zoom: z.number().min(1).max(6).optional(),
    x: z.number().min(0).max(1).optional(),
    y: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("rect"),
    bbox: Bbox,
    fill: Colour,
    radius: z.number().min(0).max(400).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("scrim"), // legibility gradient over a photo (transparent → colour)
    bbox: Bbox,
    colour: Colour,
    direction: z.enum(["up", "down"]).default("up"), // up = darkest at the bottom edge
  }),
  z.object({
    type: z.literal("text"),
    bbox: Bbox,
    // literal copy; fact elements may omit it entirely (the server substitutes the canonical string)
    content: z.string().max(300).default(""),
    fact: z.string().optional(),       // fact key — the SERVER substitutes the canonical string
    font: z.string(),
    size: z.number().min(14).max(400),
    colour: Colour,
    align: z.enum(["left", "center", "right"]).default("left"),
    weight: z.string().optional(),     // "500" | "600" | "700" | "bold"
    italic: z.boolean().optional(),
    tracking: z.number().min(0).max(40).optional(),
    uppercase: z.boolean().optional(),
    line_height: z.number().optional(),
    // vertical placement of the text block within its bbox (default top; buttons/labels want center)
    valign: z.enum(["top", "center", "bottom"]).optional(),
    // MEASURED button/badge: the renderer draws this pill sized to the text + padding and centers the text in
    // it perfectly — ONE element, so a "CTA cut off / not centered in its box" can never happen by coordinates.
    pill: z.object({
      fill: Colour,
      radius: z.number().min(0).max(200).optional(),
      pad_x: z.number().min(0).max(200).default(28),
      pad_y: z.number().min(0).max(120).default(16),
    }).optional(),
  }),
]);
export type FreeformElement = z.infer<typeof FreeformElement>;

export const DesignSpec = z.object({
  background: Colour,
  elements: z.array(FreeformElement).min(1).max(40),
});
export type DesignSpec = z.infer<typeof DesignSpec>;

// ── normaliser: be liberal in what we accept ──────────────────────────────────
// The first live Smart run failed on validation, not on design: the model omits `content` on fact elements
// (as the brief itself instructs), writes `colour` on rects, gives photo crop positions in pixels, emits null
// for optionals, 3-digit hex, numeric weights. All of that is unambiguous — normalise it BEFORE zod instead of
// failing a perfectly good design over syntax.
function normHex(v: unknown): unknown {
  if (typeof v !== "string") return v;
  let s = v.trim().toLowerCase();
  if (/^[0-9a-f]{6}$/.test(s)) s = "#" + s;
  if (/^#[0-9a-f]{3}$/.test(s)) s = "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  if (/^#[0-9a-f]{8}$/.test(s)) s = s.slice(0, 7); // strip alpha
  return s;
}
export function normaliseSpec(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const spec = { ...(raw as Record<string, unknown>) };
  spec.background = normHex(spec.background);
  if (!Array.isArray(spec.elements)) return spec;
  spec.elements = (spec.elements as unknown[])
    .map((e) => {
      if (!e || typeof e !== "object") return null;
      const el: Record<string, unknown> = { ...(e as Record<string, unknown>) };
      for (const k of Object.keys(el)) if (el[k] === null || el[k] === undefined) delete el[k];
      if (el.type === "rect") {
        if (el.fill === undefined && el.colour !== undefined) el.fill = el.colour;
        el.fill = normHex(el.fill);
        if (typeof el.fill !== "string") return null; // a rect with no colour at all is meaningless
      } else if (el.type === "scrim") {
        if (el.colour === undefined && el.fill !== undefined) el.colour = el.fill;
        el.colour = normHex(el.colour);
        if (typeof el.colour !== "string") return null;
      } else if (el.type === "photo") {
        if (typeof el.zoom === "number") el.zoom = Math.min(6, Math.max(1, el.zoom));
        // x/y are 0..1 crop positions; a value outside that range means the model meant pixels —
        // intent is unknowable, so drop the manual framing and let the automatic crop take over.
        if (typeof el.x !== "number" || el.x < 0 || el.x > 1) delete el.x;
        if (typeof el.y !== "number" || el.y < 0 || el.y > 1) delete el.y;
        // x:0,y:0 is the model saying "default position", not "anchor the crop to the top-left corner"
        // (the first live run cropped every photo to its corner this way) → treat as centre.
        if (el.x === 0 && el.y === 0) { el.x = 0.5; el.y = 0.5; }
        // zoom 1 with no meaningful offset = no manual framing at all → automatic subject-aware crop.
        if ((el.zoom === undefined || el.zoom === 1) && (el.x === undefined || el.x === 0.5) && (el.y === undefined || el.y === 0.5)) {
          delete el.zoom; delete el.x; delete el.y;
        }
      } else if (el.type === "text") {
        if (typeof el.content !== "string") delete el.content; // fact elements may omit it (zod defaults "")
        if (typeof el.weight === "number") el.weight = String(el.weight);
        el.colour = normHex(el.colour);
        const pill = el.pill as Record<string, unknown> | undefined;
        if (pill && typeof pill === "object") {
          if (pill.fill === undefined && pill.colour !== undefined) pill.fill = pill.colour;
          pill.fill = normHex(pill.fill);
          if (typeof pill.fill !== "string") delete el.pill;
        }
      }
      return el;
    })
    .filter((e) => e !== null);
  return spec;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function clampBox(b: [number, number, number, number], W: number, H: number): [number, number, number, number] {
  const x0 = Math.max(0, Math.min(W, Math.min(b[0], b[2])));
  const y0 = Math.max(0, Math.min(H, Math.min(b[1], b[3])));
  const x1 = Math.max(0, Math.min(W, Math.max(b[0], b[2])));
  const y1 = Math.max(0, Math.min(H, Math.max(b[1], b[3])));
  return [x0, y0, x1, y1];
}
const boxW = (b: number[]) => b[2] - b[0];
const boxH = (b: number[]) => b[3] - b[1];
function overlap(a: number[], b: number[]): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Render an AI design spec to a PNG in TRUE painter's order — a rect placed before a photo renders UNDER it
 * (the first live run broke exactly here: a white card drawn after two photos in the spec was painted over
 * them, hiding both). SVG runs between photos are rasterised as interleaved layers.
 */
export async function renderFreeform(
  spec: DesignSpec,
  canvas: { width: number; height: number },
  photos: Buffer[],
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const W = Math.round(canvas.width), H = Math.round(canvas.height);

  const photoBoxes = spec.elements.filter((e) => e.type === "photo").map((e) => clampBox(e.bbox, W, H));
  // legibility coverage: does anything EARLIER in the order shade this text box?
  const coverage = (textBox: number[], idx: number): number => {
    let covered = 0;
    spec.elements.slice(0, idx).forEach((e) => {
      if (e.type === "rect" || e.type === "scrim") covered = Math.max(covered, overlap(clampBox(e.bbox, W, H), textBox));
    });
    return covered / Math.max(1, boxW(textBox) * boxH(textBox));
  };

  const layers: { input: Buffer; left: number; top: number }[] = [];
  let defs = "";
  let overlaySvg = "";
  let gradId = 0;
  const flushSvg = () => {
    if (!overlaySvg) return;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${overlaySvg}</svg>`;
    layers.push({ input: renderTemplatePng(svg, W), left: 0, top: 0 });
    defs = ""; overlaySvg = "";
  };
  const gradient = (colour: string, direction: "up" | "down", peak: number): string => {
    const id = `g${gradId++}`;
    const [o0, o1] = direction === "up" ? [0, peak] : [peak, 0];
    defs += `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${colour}" stop-opacity="${o0}"/>` +
      `<stop offset="1" stop-color="${colour}" stop-opacity="${o1}"/></linearGradient>`;
    return id;
  };

  for (let idx = 0; idx < spec.elements.length; idx++) {
    const el = spec.elements[idx];

    if (el.type === "photo") {
      flushSvg(); // everything drawn so far sits UNDER this photo — as designed
      const src = photos[el.photo];
      if (!src) throw new Error(`design references photo ${el.photo} but only ${photos.length} were loaded`);
      const b = clampBox(el.bbox, W, H);
      const fw = Math.round(boxW(b)), fh = Math.round(boxH(b));
      if (fw < 8 || fh < 8) continue;
      const meta = await sharp(src).metadata();
      const sw = meta.width ?? 0, sh = meta.height ?? 0;
      if (!sw || !sh) throw new Error(`photo ${el.photo} is unreadable`);
      let buf: Buffer;
      if (el.zoom !== undefined || el.x !== undefined || el.y !== undefined) {
        const zoom = Math.min(6, Math.max(1, el.zoom ?? 1));
        const ar = fw / fh;
        let cw = sw, ch = sw / ar;
        if (ch > sh) { ch = sh; cw = sh * ar; }
        cw = Math.max(16, Math.min(sw, cw / zoom));
        ch = Math.max(16, Math.min(sh, ch / zoom));
        const px = Math.min(1, Math.max(0, el.x ?? 0.5)), py = Math.min(1, Math.max(0, el.y ?? 0.5));
        buf = await sharp(src)
          .extract({
            left: Math.round(Math.min(Math.max(0, (sw - cw) * px), sw - cw)),
            top: Math.round(Math.min(Math.max(0, (sh - ch) * py), sh - ch)),
            width: Math.round(cw), height: Math.round(ch),
          })
          .resize({ width: fw, height: fh, fit: "fill" }).jpeg({ quality: 90 }).toBuffer();
      } else {
        buf = await sharp(src)
          .resize({ width: fw, height: fh, fit: "cover", position: sharp.strategy.attention })
          .jpeg({ quality: 90 }).toBuffer();
      }
      layers.push({ input: buf, left: Math.round(b[0]), top: Math.round(b[1]) });

    } else if (el.type === "rect") {
      const b = clampBox(el.bbox, W, H);
      overlaySvg += `<rect x="${b[0]}" y="${b[1]}" width="${boxW(b)}" height="${boxH(b)}"` +
        (el.radius ? ` rx="${el.radius}"` : "") + ` fill="${el.fill}"` +
        (el.opacity !== undefined ? ` fill-opacity="${el.opacity}"` : "") + `/>`;

    } else if (el.type === "scrim") {
      const b = clampBox(el.bbox, W, H);
      overlaySvg += `<rect x="${b[0]}" y="${b[1]}" width="${boxW(b)}" height="${boxH(b)}" fill="url(#${gradient(el.colour, el.direction, 0.92)})"/>`;

    } else if (el.type === "text") {
      const b = clampBox(el.bbox, W, H);
      const raw = (el.content ?? "").trim();
      if (!raw || boxW(b) < 8 || boxH(b) < 8) continue;
      const textStr = el.uppercase ? raw.toUpperCase() : raw;
      const lines = textStr.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) continue;

      // legibility floor — a SOFT gradient, never a box (the first run's grey plates looked like wireframes).
      const onPhoto = photoBoxes.some((pb) => overlap(pb, b) > 0.35 * boxW(b) * boxH(b));
      if (onPhoto && coverage(b, idx) < 0.5) {
        const padX = Math.round(el.size * 1.2), padY = Math.round(el.size * 1.1);
        const gb = clampBox([b[0] - padX, b[1] - padY, b[2] + padX, b[3] + padY * 0.6], W, H);
        overlaySvg += `<rect x="${gb[0]}" y="${gb[1]}" width="${boxW(gb)}" height="${boxH(gb)}" fill="url(#${gradient("#0B0F14", "up", 0.55)})"/>`;
      }

      // auto-fit: shrink so the widest line fits the box width (minus pill padding when present)
      let size = el.size;
      const availW = boxW(b) - (el.pill ? 2 * el.pill.pad_x : 0);
      const track = (l: string, s: number) => (el.tracking ? el.tracking * Math.max(0, l.length - 1) * (s / el.size) : 0);
      const widest = (s: number) => Math.max(...lines.map((l) => textWidth(el.font, l, s, el.weight, el.italic) + track(l, s)));
      if (widest(size) > availW && availW > 0) size = Math.max(12, size * (availW / widest(size)));
      let lineH = (el.line_height ?? el.size * 1.16) * (size / el.size);
      if (lines.length * lineH > boxH(b) && boxH(b) > 0) {
        const r = boxH(b) / (lines.length * lineH);
        size = Math.max(12, size * r); lineH = lineH * r;
      }

      // vertical placement: the text BLOCK sits top/center/bottom inside the bbox — a centered single-line
      // label keeps ascender + descender headroom, so nothing is ever clipped against its panel edge.
      const blockH = lines.length * lineH;
      const topPad = el.valign === "center" ? Math.max(0, (boxH(b) - blockH) / 2)
        : el.valign === "bottom" ? Math.max(0, boxH(b) - blockH) : 0;

      const anchor = el.align === "center" ? "middle" : el.align === "right" ? "end" : "start";
      // pill labels: inset the text by pad_x so the padding is symmetric (the pill's edge stays on the
      // bbox/grid). Without this, a left-aligned button renders its text flush against the pill's left edge.
      const inset = el.pill ? el.pill.pad_x : 0;
      const tx = el.align === "center" ? b[0] + boxW(b) / 2 : el.align === "right" ? b[2] - inset : b[0] + inset;
      const wNum = el.weight ? (/^\d+$/.test(el.weight) ? el.weight : "700") : "";
      const attrs = (wNum ? ` font-weight="${wNum}"` : "") + (el.italic ? ` font-style="italic"` : "") +
        (el.tracking ? ` letter-spacing="${(el.tracking * (size / el.size)).toFixed(2)}"` : "");

      // measured pill: sized to the text, centered on it — the button IS the text element
      if (el.pill) {
        const mw = widest(size);
        const pw = mw + 2 * el.pill.pad_x;
        const ph = blockH + 2 * el.pill.pad_y;
        const px = el.align === "center" ? b[0] + boxW(b) / 2 - pw / 2 : el.align === "right" ? b[2] - pw : b[0];
        const py = b[1] + topPad - el.pill.pad_y;
        const rx = el.pill.radius ?? Math.round(ph / 2);
        overlaySvg += `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" rx="${rx}" fill="${el.pill.fill}"/>`;
      }

      lines.forEach((ln, i) => {
        const by = b[1] + topPad + size * 0.82 + i * lineH;
        overlaySvg += `<text x="${tx.toFixed(1)}" y="${by.toFixed(1)}" text-anchor="${anchor}" font-family="${esc(el.font)}" font-size="${size.toFixed(1)}"${attrs} fill="${el.colour}">${esc(ln)}</text>`;
      });
    }
  }
  flushSvg();

  return await sharp({ create: { width: W, height: H, channels: 4, background: spec.background } })
    .composite(layers)
    .png()
    .toBuffer();
}
