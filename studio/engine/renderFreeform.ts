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
    // photo treatments (carousel styles 2026-07-16): wash = low-opacity colour grade that unifies
    // mixed portal photos into one "shoot"; duotone = greyscale mapped into the tint (poster register).
    // Saturation is NEVER raised — over-HDR is the #1 cheap-listing tell.
    tint: Colour.optional(),
    tint_mode: z.enum(["wash", "duotone"]).optional(),
    tint_opacity: z.number().min(0).max(0.4).optional(),   // wash strength (default 0.12)
    rotate: z.number().min(-45).max(45).optional(),        // tilt (scrapbook photo cards)
  }),
  z.object({
    // DOODLE (carousel styles inspired by the template catalogue's line-work): hand-authored editorial
    // marks — concentric rings, waves, sparkles, the signature cat — scaled into the bbox.
    type: z.literal("doodle"),
    bbox: Bbox,
    kind: z.enum(["rings", "wave", "plus", "sparkle", "dots_row", "arc", "cat", "birds", "pot_plant"]),
    colour: Colour,
    accent: Colour.optional(),           // second colour (rings' dot, pot's plant)
    stroke_width: z.number().min(0.5).max(12).optional(),
    rotate: z.number().min(-90).max(90).optional(),
  }),
  z.object({
    // PUNCH (carousel styles): covers its bbox with the ground colour EXCEPT a shape-shaped hole,
    // so the photo underneath shows through an arch / circle. Optional hairline echo ring outside
    // the crop — the offset-outline device from the Mediterranean identity research.
    type: z.literal("punch"),
    bbox: Bbox,
    fill: Colour,
    shape: z.enum(["arch", "circle"]),
    outline: z.object({
      colour: Colour,
      width: z.number().min(0.5).max(8).default(1.5),
      offset: z.number().min(2).max(40).default(10),
    }).optional(),
  }),
  z.object({
    type: z.literal("rect"),
    bbox: Bbox,
    fill: Colour,
    radius: z.number().min(0).max(400).optional(),
    opacity: z.number().min(0).max(1).optional(),
    rotate: z.number().min(-90).max(90).optional(),   // degrees around the rect's centre (tape strips, diagonal bands)
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
    size: z.number().min(14).max(1000),   // up to oversized display numerals (Cartel/Plano styles)
    colour: Colour,
    align: z.enum(["left", "center", "right"]).default("left"),
    weight: z.string().optional(),     // "500" | "600" | "700" | "bold"
    italic: z.boolean().optional(),
    tracking: z.number().min(0).max(40).optional(),
    uppercase: z.boolean().optional(),
    line_height: z.number().optional(),
    // vertical placement of the text block within its bbox (default top; buttons/labels want center)
    valign: z.enum(["top", "center", "bottom"]).optional(),
    // display-type devices (carousel styles 2026-07-16): rotate the block around its centre;
    // hollow = outline-only type (stroke in the text colour, no fill) — the editorial poster look
    rotate: z.number().min(-90).max(90).optional(),
    hollow: z.boolean().optional(),
    stroke_width: z.number().min(0.5).max(12).optional(),
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
  elements: z.array(FreeformElement).min(1).max(80),   // authored carousel styles use tick/annotation kits
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
      if (el.tint) {
        const rgb = [1, 3, 5].map((i) => parseInt(el.tint!.slice(i, i + 2), 16));
        if (el.tint_mode === "duotone") {
          // greyscale mapped into the tint colour — shadows take the tint, highlights stay light
          buf = await sharp(buf).greyscale().tint({ r: rgb[0], g: rgb[1], b: rgb[2] }).jpeg({ quality: 90 }).toBuffer();
        } else {
          // wash: one low-opacity grade pass — unifies mixed photos, never raises saturation
          const a = el.tint_opacity ?? 0.12;
          const washSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${fw}" height="${fh}"><rect width="${fw}" height="${fh}" fill="${el.tint}" fill-opacity="${a}"/></svg>`;
          buf = await sharp(buf).composite([{ input: Buffer.from(washSvg) }]).jpeg({ quality: 90 }).toBuffer();
        }
      }
      if (el.rotate) {
        // tilt the placed photo around its centre; the rotated canvas grows, so re-anchor by the growth
        const rad = Math.abs(el.rotate) * Math.PI / 180;
        const rw = Math.round(fw * Math.cos(rad) + fh * Math.sin(rad));
        const rh = Math.round(fh * Math.cos(rad) + fw * Math.sin(rad));
        buf = await sharp(buf).rotate(el.rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        layers.push({ input: buf, left: Math.round(b[0] - (rw - fw) / 2), top: Math.round(b[1] - (rh - fh) / 2) });
      } else {
        layers.push({ input: buf, left: Math.round(b[0]), top: Math.round(b[1]) });
      }

    } else if (el.type === "rect") {
      const b = clampBox(el.bbox, W, H);
      const rectSvg = `<rect x="${b[0]}" y="${b[1]}" width="${boxW(b)}" height="${boxH(b)}"` +
        (el.radius ? ` rx="${el.radius}"` : "") + ` fill="${el.fill}"` +
        (el.opacity !== undefined ? ` fill-opacity="${el.opacity}"` : "") + `/>`;
      overlaySvg += el.rotate
        ? `<g transform="rotate(${el.rotate} ${(b[0] + boxW(b) / 2).toFixed(1)} ${(b[1] + boxH(b) / 2).toFixed(1)})">${rectSvg}</g>`
        : rectSvg;

    } else if (el.type === "doodle") {
      // drawn in a 100×100 design space, scaled into the bbox (cat/pot keep aspect via uniform scale)
      const b = clampBox(el.bbox, W, H);
      const sw = el.stroke_width ?? 2.5;
      const st = `fill="none" stroke="${el.colour}" stroke-width="${sw}" stroke-linecap="round"`;
      const acc = el.accent ?? el.colour;
      let art = "";
      if (el.kind === "rings") {
        for (let r = 12; r <= 48; r += 9) art += `<circle cx="50" cy="50" r="${r}" ${st}/>`;
        art += `<circle cx="66" cy="38" r="6" fill="${acc}"/>`;
      } else if (el.kind === "wave") {
        for (let k = 0; k < 3; k++) {
          const y = 30 + k * 18;
          art += `<path d="M 0 ${y} C 12 ${y - 10}, 24 ${y + 10}, 36 ${y} S 60 ${y - 10}, 72 ${y} S 96 ${y + 10}, 100 ${y}" ${k === 1 ? `fill="none" stroke="${acc}" stroke-width="${sw}" stroke-linecap="round"` : st}/>`;
        }
      } else if (el.kind === "plus") {
        art += `<path d="M 50 20 V 80 M 20 50 H 80" ${st}/>`;
      } else if (el.kind === "sparkle") {
        art += `<path d="M 50 8 V 92 M 8 50 H 92 M 24 24 L 76 76 M 76 24 L 24 76" ${st}/>`;
      } else if (el.kind === "dots_row") {
        for (let i = 0; i < 6; i++) art += `<circle cx="${8 + i * 17}" cy="50" r="4.5" fill="${el.colour}"/>`;
      } else if (el.kind === "arc") {
        art += `<path d="M 0 100 Q 0 30 70 20" ${st}/><path d="M 0 100 Q 10 55 55 45" fill="none" stroke="${acc}" stroke-width="${sw}" stroke-linecap="round"/>`;
      } else if (el.kind === "cat") {
        // the catalogue's signature: a sitting cat, tail curled — filled silhouette
        art += `<path fill="${el.colour}" d="M 30 92 C 18 92 12 80 14 66 C 16 52 26 44 28 36 L 24 18 L 34 28 C 37 26 43 26 46 28 L 56 18 L 52 36 C 60 46 66 58 64 72 C 63 82 56 92 44 92 Z"/>` +
          `<path fill="none" stroke="${el.colour}" stroke-width="7" stroke-linecap="round" d="M 62 86 C 78 88 84 76 76 66"/>`;
      } else if (el.kind === "birds") {
        art += `<path d="M 10 40 Q 22 28 34 40 Q 46 28 58 40" ${st}/><path d="M 48 66 Q 58 56 68 66 Q 78 56 88 66" ${st}/>`;
      } else if (el.kind === "pot_plant") {
        art += `<path fill="${acc}" d="M 50 18 C 66 18 76 30 74 44 C 72 54 62 60 50 60 C 38 60 28 54 26 44 C 24 30 34 18 50 18 Z"/>` +
          `<rect x="44" y="58" width="12" height="10" fill="${el.colour}"/>` +
          `<path fill="${el.colour}" d="M 34 68 H 66 L 61 94 H 39 Z"/>`;
      }
      const isUniform = el.kind === "cat" || el.kind === "pot_plant";
      const sx = boxW(b) / 100, sy = boxH(b) / 100;
      const s2 = isUniform ? Math.min(sx, sy) : sy;
      const s1 = isUniform ? Math.min(sx, sy) : sx;
      const ox = b[0] + (boxW(b) - 100 * s1) / 2, oy = b[1] + (boxH(b) - 100 * s2) / 2;
      let g = `<g transform="translate(${ox.toFixed(1)} ${oy.toFixed(1)}) scale(${s1.toFixed(3)} ${s2.toFixed(3)})">${art}</g>`;
      if (el.rotate) {
        const cx = b[0] + boxW(b) / 2, cy = b[1] + boxH(b) / 2;
        g = `<g transform="rotate(${el.rotate} ${cx.toFixed(1)} ${cy.toFixed(1)})">${g}</g>`;
      }
      overlaySvg += g;

    } else if (el.type === "punch") {
      // ground colour over the bbox with a shape-shaped hole (evenodd) — the photo below shows through
      const b = clampBox(el.bbox, W, H);
      const [x0, y0, x1, y1] = b, w = boxW(b), h = boxH(b);
      const shapePath = (inset: number): string => {
        const sx0 = x0 + inset, sy0 = y0 + inset, sx1 = x1 - inset, sy1 = y1 - inset;
        if (el.shape === "circle") {
          const cx = (sx0 + sx1) / 2, cy = (sy0 + sy1) / 2, rx = (sx1 - sx0) / 2, ry = (sy1 - sy0) / 2;
          return `M ${cx - rx},${cy} A ${rx} ${ry} 0 1 0 ${cx + rx},${cy} A ${rx} ${ry} 0 1 0 ${cx - rx},${cy} Z`;
        }
        const r = (sx1 - sx0) / 2; // arch: semicircular top on straight sides
        return `M ${sx0},${sy1} L ${sx0},${Math.min(sy1, sy0 + r)} A ${r} ${r} 0 0 1 ${sx1},${Math.min(sy1, sy0 + r)} L ${sx1},${sy1} Z`;
      };
      // cover slightly beyond the bbox so no photo sliver leaks at the crop edge
      const pad = 2;
      overlaySvg += `<path fill-rule="evenodd" fill="${el.fill}" d="M ${x0 - pad},${y0 - pad} L ${x1 + pad},${y0 - pad} L ${x1 + pad},${y1 + pad} L ${x0 - pad},${y1 + pad} Z ${shapePath(0)}"/>`;
      if (el.outline) {
        overlaySvg += `<path fill="none" stroke="${el.outline.colour}" stroke-width="${el.outline.width}" d="${shapePath(-el.outline.offset)}"/>`;
      }

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
      // hollow = outline-only display type: stroke in the text colour, no fill
      const paint = el.hollow
        ? ` fill="none" stroke="${el.colour}" stroke-width="${(el.stroke_width ?? Math.max(1.5, size / 40)).toFixed(1)}"`
        : ` fill="${el.colour}"`;
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

      // rotated blocks pivot around the text block's centre — for vertical folios, tilted stamps, angled kickers
      let block = "";
      lines.forEach((ln, i) => {
        const by = b[1] + topPad + size * 0.82 + i * lineH;
        block += `<text x="${tx.toFixed(1)}" y="${by.toFixed(1)}" text-anchor="${anchor}" font-family="${esc(el.font)}" font-size="${size.toFixed(1)}"${attrs}${paint}>${esc(ln)}</text>`;
      });
      if (el.rotate) {
        const cx = b[0] + boxW(b) / 2, cy = b[1] + topPad + blockH / 2;
        block = `<g transform="rotate(${el.rotate} ${cx.toFixed(1)} ${cy.toFixed(1)})">${block}</g>`;
      }
      overlaySvg += block;
    }
  }
  flushSvg();

  return await sharp({ create: { width: W, height: H, channels: 4, background: spec.background } })
    .composite(layers)
    .png()
    .toBuffer();
}
