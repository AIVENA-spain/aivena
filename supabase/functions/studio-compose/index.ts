// studio-compose — deterministic creative renderer v3.6.3 (AIVENA Studio).
// v3.5.5 (2026-06-17): collage rebuilt — clean cream editorial DUO.
// v3.5.6 (2026-06-17): collage branches by photo count.
// v3.6.0 (2026-06-17): Canva-template clones — showcase, feature, new_listing.
// v3.6.1 (2026-06-17): Anton condensed display font; new_listing reworked; showcase regrouped; feature icons.
// v3.6.2 (2026-06-18): showcase right column unified to single left-aligned tight stack (brand+kicker+price+specs+headline+cta share one left edge, no zigzag, no internal gap); new_listing description bottom-aligned to LISTING baseline.
// v3.6.3 (2026-06-19): feature rebuilt to Rimberio template (hero+cream fade, brand top-right, headline/tagline left, tan features box overlapping hero on right with icon tiles, low photo strip, full dark footer w/ contact+phone+location); Montserrat added (non-fatal fetch); per-element colour palette; new_listing badge language-aware via copy.badge_text.

import { createClient } from "npm:@supabase/supabase-js@2";
import { Resvg, initWasm } from "npm:@resvg/resvg-wasm@2.6.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "generated-images";
const SIGNED_TTL = 60 * 60 * 24 * 365;
const WASM_URL = "https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm";

const FONT_SOURCES = [
  "https://fonts.googleapis.com/css2?family=Inter:wght@400",
  "https://fonts.googleapis.com/css2?family=Inter:wght@600",
  "https://fonts.googleapis.com/css2?family=Inter:wght@700",
  "https://fonts.googleapis.com/css2?family=Instrument+Serif",
  "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@1",
  "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500",
  "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@700",
  "https://fonts.googleapis.com/css2?family=Anton",
  "https://fonts.googleapis.com/css2?family=Montserrat:wght@400",
  "https://fonts.googleapis.com/css2?family=Montserrat:wght@700",
];

let wasmReady: Promise<void> | null = null;
let fontsReady: Promise<Uint8Array[]> | null = null;
async function fetchTtf(cssUrl: string): Promise<Uint8Array> {
  const css = await (await fetch(cssUrl, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1)" } })).text();
  const m = css.match(/src:\s*url\(([^)]+)\)/);
  if (!m) throw new Error("font_css_parse_failed");
  return new Uint8Array(await (await fetch(m[1])).arrayBuffer());
}
function ensureAssets() {
  if (!wasmReady) wasmReady = (async () => { await initWasm(await fetch(WASM_URL)); })();
  if (!fontsReady) fontsReady = Promise.all(FONT_SOURCES.map((u) => fetchTtf(u).catch(() => null))).then((a) => a.filter((x): x is Uint8Array => !!x));
}

function j(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function esc(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const CREAM = "#FAF8F3";
const INK = "#0A0A0A";
const F_INTER = "Inter";
const F_SERIF = "Instrument Serif";
const F_MONO = "JetBrains Mono";
const F_DISPLAY = "Anton";
const F_MONTS = "Montserrat";

interface FontPlan { headline: string; headlineWeight: number; headlineItalic: boolean; kicker: string; kickerWeight: number; }
function fontPlan(set: string): FontPlan {
  if (set === "sans")  return { headline: F_INTER, headlineWeight: 700, headlineItalic: false, kicker: F_MONO, kickerWeight: 700 };
  if (set === "mixed") return { headline: F_SERIF, headlineWeight: 400, headlineItalic: true,  kicker: F_MONO, kickerWeight: 700 };
  return { headline: F_SERIF, headlineWeight: 400, headlineItalic: false, kicker: F_MONO, kickerWeight: 700 };
}

function wAdvance(s: string, size: number, family: string, weight: number): number {
  const per = family === F_MONO ? 0.6 : family === F_SERIF ? 0.48 : family === F_DISPLAY ? 0.42 : 0.55;
  return (s ?? "").length * size * per;
}
function wrap(text: string, size: number, maxW: number, family: string, weight: number, maxLines = 3): string[] {
  const words = (text ?? "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? cur + " " + w : w;
    if (wAdvance(cand, size, family, weight) <= maxW || !cur) cur = cand;
    else { lines.push(cur); cur = w; if (lines.length === maxLines - 1) break; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  const consumed = lines.join(" ").length;
  const full = (text ?? "").replace(/\s+/g, " ").trim();
  if (consumed < full.length && lines.length > 0) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/\s*\S*$/, "") + "…";
  }
  return lines;
}
function wrapFit(text: string, startSize: number, maxW: number, family: string, weight: number, maxLines: number, minSize: number): { lines: string[]; size: number } {
  let size = startSize;
  let lines = wrap(text, size, maxW, family, weight, 99);
  while (lines.length > maxLines && size > minSize) {
    size -= 2;
    lines = wrap(text, size, maxW, family, weight, 99);
  }
  if (lines.length > maxLines) lines = wrap(text, size, maxW, family, weight, maxLines);
  return { lines, size };
}

function textEl(x: number, yTop: number, size: number, family: string, weight: number, fill: string, content: string, opts: { tracking?: number; anchor?: string; italic?: boolean } = {}): string {
  const baseline = yTop + size * 0.78;
  const ls = opts.tracking ? ` letter-spacing="${opts.tracking}"` : "";
  const an = opts.anchor ? ` text-anchor="${opts.anchor}"` : "";
  const fs = opts.italic ? ` font-style="italic"` : "";
  return `<text x="${x}" y="${baseline}" font-family="${family}" font-size="${size}" font-weight="${weight}"${fs} fill="${fill}"${ls}${an}>${esc(content)}</text>`;
}

function pill(x: number, yTop: number, text: string, size: number, opts: { bg?: string; color: string; border?: string; tracking?: number; font?: string; weight?: number; dot?: string }): { svg: string; w: number; h: number } {
  const t = (text ?? "").toUpperCase();
  const tracking = opts.tracking ?? 2;
  const font = opts.font ?? F_MONO;
  const padX = Math.round(size * 1.05);
  const padY = Math.round(size * 0.55);
  const dotR = opts.dot ? Math.round(size * 0.3) : 0;
  const dotSpace = opts.dot ? dotR * 2 + Math.round(size * 0.5) : 0;
  const tw = wAdvance(t, size, font, opts.weight ?? 700) + (t.length - 1) * tracking;
  const w = Math.round(tw + padX * 2 + dotSpace);
  const h = Math.round(size + padY * 2);
  let svg = "";
  if (opts.bg) svg += `<rect x="${x}" y="${yTop}" width="${w}" height="${h}" rx="${h / 2}" fill="${opts.bg}"/>`;
  if (opts.border) svg += `<rect x="${x}" y="${yTop}" width="${w}" height="${h}" rx="${h / 2}" fill="none" stroke="${opts.border}" stroke-width="2.5"/>`;
  if (opts.dot) svg += `<circle cx="${x + padX + dotR}" cy="${yTop + h / 2}" r="${dotR}" fill="${opts.dot}"/>`;
  svg += textEl(x + padX + dotSpace, yTop + padY - size * 0.06, size, font, opts.weight ?? 700, opts.color, t, { tracking });
  return { svg, w, h };
}

function photoEl(href: string, x: number, y: number, w: number, h: number, clip?: string): string {
  const c = clip ? ` clip-path="url(#${clip})"` : "";
  return `<image href="${href}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"${c}/>`;
}

const ICON_PATHS: Record<string, string> = {
  bed: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
  bath: '<path d="M4 12V6a2 2 0 0 1 4 0"/><path d="M2 12h20v3a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z"/><path d="M7 19v2"/><path d="M17 19v2"/>',
  pin: '<path d="M12 22s8-6 8-12a8 8 0 1 0-16 0c0 6 8 12 8 12Z"/><circle cx="12" cy="10" r="3"/>',
  kitchen: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 11h18"/><circle cx="8" cy="7" r="1.4"/><circle cx="14" cy="7" r="1.4"/>',
  sofa: '<path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><path d="M2 12h20v5a1 1 0 0 1-1 1h-1v-2H4v2H3a1 1 0 0 1-1-1z"/>',
  view: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  phone: '<path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
};
function icon(name: string, cx: number, cy: number, size: number, color: string, strokePx = 2.2): string {
  const p = ICON_PATHS[name]; if (!p) return "";
  const sc = size / 24;
  return `<g transform="translate(${cx - size / 2},${cy - size / 2}) scale(${sc})" fill="none" stroke="${color}" stroke-width="${strokePx / sc}" stroke-linecap="round" stroke-linejoin="round">${p}</g>`;
}

interface Copy {
  kicker?: string; headline?: string; price_text?: string; specs_text?: string;
  badge_text?: string; cta_text?: string; tagline?: string; bullets?: string[];
  stats?: { label: string; value: string }[]; location_text?: string; label_text?: string | null;
  features_title?: string; contact_label?: string; phone_text?: string;
}
interface Brand { name: string; logo_url?: string | null; primary_color?: string | null; accent_color?: string | null; }

function aiLabel(W: number, label?: string | null): string {
  if (!label) return "";
  const size = 16;
  const p = pill(0, 0, label, size, { bg: "rgba(250,248,243,0.9)", color: "rgba(10,10,10,0.6)", tracking: 2 });
  return `<g transform="translate(${W - 26 - p.w}, 26)">${p.svg}</g>`;
}

const DEFS =
  `<defs>` +
  `<filter id="cardShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="16" stdDeviation="22" flood-color="#0A0A0A" flood-opacity="0.28"/></filter>` +
  `<linearGradient id="fadeB" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#0A0A0A" stop-opacity="0"/><stop offset="46%" stop-color="#0A0A0A" stop-opacity="0.05"/><stop offset="74%" stop-color="#0A0A0A" stop-opacity="0.45"/><stop offset="100%" stop-color="#0A0A0A" stop-opacity="0.86"/></linearGradient>` +
  `<linearGradient id="fadeT" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#0A0A0A" stop-opacity="0.5"/><stop offset="100%" stop-color="#0A0A0A" stop-opacity="0"/></linearGradient>` +
  `</defs>`;

interface Block { h: number; isHeadline?: boolean; isTagline?: boolean; draw: (x: number, y: number, w: number) => string; }
interface BlockCtx {
  copy: Copy; brand: Brand; fp: FontPlan; primary: string; accent: string;
  onDark: boolean; colorTreatment: string; align: "left" | "center"; scale: number;
}
function inkPrimary(ctx: BlockCtx) { return ctx.onDark ? CREAM : INK; }
function inkSoft(ctx: BlockCtx)    { return ctx.onDark ? "rgba(250,248,243,0.82)" : "rgba(10,10,10,0.62)"; }
function hairline(ctx: BlockCtx)   { return ctx.onDark ? "rgba(250,248,243,0.32)" : "rgba(10,10,10,0.14)"; }
function anchorFor(align: string, x: number, w: number) { return align === "center" ? { ax: x + w / 2, anchor: "middle" } : { ax: x, anchor: undefined as string | undefined }; }

function buildBlocks(ctx: BlockCtx, contentType: string): Block[] {
  const { copy, brand, fp, primary, accent, colorTreatment, align, scale } = ctx;
  const blocks: Block[] = [];
  const S = scale;
  const accentColor = ctx.onDark ? accent : primary;

  const kicker = copy.kicker || copy.location_text || "";
  const badge = copy.badge_text || "";
  const kickerLine = [badge, kicker].filter(Boolean).join("  ·  ");
  if (kickerLine && contentType !== "sold") {
    blocks.push({ h: 40 * S, draw: (x, y, w) => {
      const a = anchorFor(align, x, w);
      return textEl(a.ax, y, 24 * S, fp.kicker, fp.kickerWeight, accentColor, kickerLine.toUpperCase(), { tracking: 3.5, anchor: a.anchor });
    }});
  }

  if (copy.headline) {
    const hSize = (contentType === "brand" || contentType === "educational" ? 76 : 84) * S;
    blocks.push({ h: 0, isHeadline: true, draw: (x, y, w) => {
      const lines = wrap(copy.headline!, hSize, w, fp.headline, fp.headlineWeight, 4);
      const lh = Math.round(hSize * 1.06);
      const a = anchorFor(align, x, w);
      return lines.map((ln, i) => textEl(a.ax, y + i * lh, hSize, fp.headline, fp.headlineWeight, inkPrimary(ctx), ln, { italic: fp.headlineItalic, anchor: a.anchor })).join("");
    } });
  }

  if (copy.tagline) {
    const tagSize = 30 * S;
    blocks.push({ h: 0, isTagline: true, draw: (x, y, w) => {
      const a = anchorFor(align, x, w);
      const lines = wrap(copy.tagline!, tagSize, w, F_INTER, 400, 2);
      const lh = Math.round(tagSize * 1.25);
      return lines.map((ln, i) => textEl(a.ax, y + i * lh, tagSize, F_INTER, 400, inkSoft(ctx), ln, { anchor: a.anchor })).join("");
    }});
  }

  if (copy.bullets && copy.bullets.length) {
    for (const b of copy.bullets.slice(0, 4)) {
      blocks.push({ h: 46 * S, draw: (x, y, w) => {
        const dot = `<circle cx="${align === "center" ? x + w / 2 - wAdvance(b, 26 * S, F_INTER, 600) / 2 - 18 : x + 7}" cy="${y + 16 * S}" r="5" fill="${accentColor}"/>`;
        const a = anchorFor(align, x, w);
        const tx = align === "center" ? a.ax : x + 26;
        return dot + textEl(tx, y, 26 * S, F_INTER, 600, inkPrimary(ctx), b, { anchor: a.anchor });
      }});
    }
  }

  if (copy.price_text || copy.specs_text) {
    const priceSize = 54 * S;
    const priceW = copy.price_text ? wAdvance(copy.price_text, priceSize, F_INTER, 700) : 0;
    const specSize = 22 * S;
    const specPW = copy.specs_text
      ? wAdvance(copy.specs_text.toUpperCase(), specSize, F_MONO, 700) + (copy.specs_text.length - 1) * 2 + specSize * 1.05 * 2
      : 0;
    blocks.push({ h: 84 * S, isTagline: false, draw: (x, y, w) => {
      const sideBySide = !!(copy.price_text && copy.specs_text && (priceW + 40 * S + specPW <= w) && colorTreatment !== "color_block");
      let s = "";
      if (copy.price_text) {
        if (colorTreatment === "color_block") {
          s += pill(x, y, copy.price_text, 34 * S, { bg: accent, color: INK, tracking: 1, font: F_INTER, weight: 700 }).svg;
        } else {
          s += textEl(x, y + 14 * S, priceSize, F_INTER, 700, inkPrimary(ctx), copy.price_text);
        }
      }
      if (copy.specs_text) {
        const t = copy.specs_text.toUpperCase();
        if (sideBySide) {
          s += pill(x + w - specPW, y + 18 * S, t, specSize, { color: inkPrimary(ctx), border: hairline(ctx), tracking: 2 }).svg;
        } else if (colorTreatment === "color_block") {
          const pricePillW = wAdvance(copy.price_text || "", 34 * S, F_INTER, 700) + 34 * S * 1.05 * 2;
          s += pill(x + pricePillW + 20 * S, y + 6 * S, t, specSize, { color: inkPrimary(ctx), border: hairline(ctx), tracking: 2 }).svg;
        } else {
          s += pill(x, y + 78 * S, t, specSize, { color: inkPrimary(ctx), border: hairline(ctx), tracking: 2 }).svg;
        }
      }
      return s;
    }});
    if (copy.price_text && copy.specs_text && (priceW + 40 * S + specPW > (1080 - 128)) && colorTreatment !== "color_block") {
      blocks[blocks.length - 1].h = 150 * S;
    }
  }

  if (copy.stats && copy.stats.length) {
    blocks.push({ h: 96 * S, draw: (x, y, w) => {
      const n = Math.min(copy.stats!.length, 3);
      const colW = w / n;
      let s = "";
      copy.stats!.slice(0, n).forEach((st, i) => {
        const cx = x + colW * i + colW / 2;
        if (i > 0) s += `<rect x="${x + colW * i}" y="${y + 6 * S}" width="1.5" height="${72 * S}" fill="${hairline(ctx)}"/>`;
        s += textEl(cx, y, 19 * S, F_MONO, 500, inkSoft(ctx), st.label.toUpperCase(), { tracking: 2, anchor: "middle" });
        s += textEl(cx, y + 34 * S, 40 * S, fp.headline, fp.headlineWeight, inkPrimary(ctx), st.value, { anchor: "middle", italic: fp.headlineItalic });
      });
      return s;
    }});
  }

  if (contentType !== "educational") {
    blocks.push({ h: 28 * S, draw: (x, y, w) => `<rect x="${align === "center" ? x + w * 0.18 : x}" y="${y + 20 * S}" width="${align === "center" ? w * 0.64 : w}" height="1.5" fill="${hairline(ctx)}"/>` });
  }

  const brandUpper = (brand.name || "").toUpperCase();
  const ctaUpper = copy.cta_text ? copy.cta_text.toUpperCase() + "  →" : "";
  const footSize = 22 * S;
  const brandW = wAdvance(brandUpper, footSize, F_MONO, 700) + (brandUpper.length - 1) * 3;
  const ctaW = ctaUpper ? wAdvance(ctaUpper, footSize, F_MONO, 700) + (ctaUpper.length - 1) * 2 : 0;

  if (align === "center") {
    blocks.push({ h: 46 * S, draw: (x, y, w) => textEl(x + w / 2, y + 12 * S, footSize, F_MONO, 700, inkSoft(ctx), brandUpper, { tracking: 3, anchor: "middle" }) });
    if (copy.cta_text) {
      blocks.push({ h: 44 * S, draw: (x, y, w) => {
        const pw = wAdvance(ctaUpper, footSize, F_MONO, 700) + footSize * 1.05 * 2;
        return pill(x + w / 2 - pw / 2, y, copy.cta_text!.toUpperCase() + "  →", footSize, { color: accentColor, border: hairline(ctx), tracking: 2 }).svg;
      }});
    }
  } else {
    const reserved = copy.cta_text ? 84 * S : 46 * S;
    blocks.push({ h: reserved, draw: (x, y, w) => {
      const inline = !copy.cta_text || (brandW + 40 * S + ctaW) <= w;
      let s = textEl(x, y + 12 * S, footSize, F_MONO, 700, inkSoft(ctx), brandUpper, { tracking: 3 });
      if (copy.cta_text && inline) {
        s += textEl(x + w, y + 12 * S, footSize, F_MONO, 700, accentColor, ctaUpper, { tracking: 2, anchor: "end" });
      } else if (copy.cta_text) {
        s += textEl(x, y + 50 * S, footSize, F_MONO, 700, accentColor, ctaUpper, { tracking: 2 });
      }
      return s;
    }});
  }

  return blocks;
}

function measureBlocks(blocks: Block[], w: number, ctx: BlockCtx, contentType: string): { total: number; hHeights: number[] } {
  const hHeights: number[] = [];
  let total = 0;
  for (const b of blocks) {
    let h = b.h;
    if (b.isHeadline && ctx.copy.headline) {
      const hSize = (contentType === "brand" || contentType === "educational" ? 76 : 84) * ctx.scale;
      const lines = wrap(ctx.copy.headline, hSize, w, ctx.fp.headline, ctx.fp.headlineWeight, 4);
      h = lines.length * Math.round(hSize * 1.06) + 14 * ctx.scale;
    }
    if (b.isTagline && ctx.copy.tagline) {
      const tagSize = 30 * ctx.scale;
      const lines = wrap(ctx.copy.tagline, tagSize, w, F_INTER, 400, 2);
      h = lines.length * Math.round(tagSize * 1.25) + 18 * ctx.scale;
    }
    hHeights.push(h);
    total += h;
  }
  return { total, hHeights };
}

interface RenderArgs {
  photos: string[]; copy: Copy; brand: Brand; W: number; H: number;
  fp: FontPlan; primary: string; accent: string; colorTreatment: string;
  contentType: string; textTreatment: string; badgeLabel: string;
  palette: Record<string, string>;
}

function drawStack(blocks: Block[], heights: number[], x: number, yStart: number, w: number): string {
  let s = ""; let y = yStart;
  blocks.forEach((b, i) => { s += b.draw(x, y, w); y += heights[i]; });
  return s;
}

function brandTopBar(W: number, brand: Brand, accent: string, onDark: boolean): string {
  const col = onDark ? "rgba(250,248,243,0.95)" : INK;
  const bm = (brand.name || "").toUpperCase();
  let size = 25; const track = 5;
  while (size > 14 && (wAdvance(bm, size, F_INTER, 600) + (bm.length - 1) * track) > W - 120) size -= 1;
  return textEl(W / 2, 44, size, F_INTER, 600, col, bm, { tracking: track, anchor: "middle" }) +
    `<rect x="${W / 2 - 26}" y="90" width="52" height="2" fill="${accent}"/>`;
}

function compFullBleed(a: RenderArgs): string {
  const pad = 64; const innerW = a.W - pad * 2;
  const ctx: BlockCtx = { copy: a.copy, brand: a.brand, fp: a.fp, primary: a.primary, accent: a.accent, onDark: true, colorTreatment: a.colorTreatment, align: "left", scale: 1 };
  const blocks = buildBlocks(ctx, a.contentType);
  const m = measureBlocks(blocks, innerW, ctx, a.contentType);
  let s = photoEl(a.photos[0], 0, 0, a.W, a.H);
  s += `<rect x="0" y="0" width="${a.W}" height="${Math.round(a.H * 0.2)}" fill="url(#fadeT)"/>`;
  if (a.textTreatment !== "negative_space") s += `<rect x="0" y="0" width="${a.W}" height="${a.H}" fill="url(#fadeB)"/>`;
  s += brandTopBar(a.W, a.brand, a.accent, true);
  if (a.colorTreatment === "color_block") s += pill(pad, 120, a.badgeLabel, 24, { bg: a.accent, color: INK, tracking: 2 }).svg;
  const yStart = a.H - pad - m.total;
  if (a.textTreatment === "scrim") s += `<rect x="${pad - 28}" y="${yStart - 36}" width="${innerW + 56}" height="${m.total + 64}" rx="26" fill="rgba(10,10,10,0.42)"/>`;
  s += drawStack(blocks, m.hHeights, pad, yStart, innerW);
  s += aiLabel(a.W, a.copy.label_text);
  return DEFS + s;
}

function compBottomPanel(a: RenderArgs): string {
  const panelH = Math.round(a.H * (a.contentType === "educational" ? 0.42 : 0.36));
  const photoH = a.H - panelH;
  const pad = 56; const innerW = a.W - pad * 2;
  const panelBg = a.colorTreatment === "color_block" ? a.primary : CREAM;
  const onDark = a.colorTreatment === "color_block";
  const ctx: BlockCtx = { copy: a.copy, brand: a.brand, fp: a.fp, primary: a.primary, accent: a.accent, onDark, colorTreatment: a.colorTreatment, align: "left", scale: 0.92 };
  const blocks = buildBlocks(ctx, a.contentType);
  const m = measureBlocks(blocks, innerW, ctx, a.contentType);
  let s = photoEl(a.photos[0], 0, 0, a.W, photoH);
  s += aiLabel(a.W, a.copy.label_text);
  s += `<rect x="0" y="${photoH}" width="${a.W}" height="${panelH}" fill="${panelBg}"/>`;
  if (a.colorTreatment === "accent_line") s += `<rect x="0" y="${photoH}" width="${a.W}" height="6" fill="${a.accent}"/>`;
  const yStart = photoH + (panelH - m.total) / 2;
  s += drawStack(blocks, m.hHeights, pad, yStart, innerW);
  return DEFS + s;
}

function compSidePanel(a: RenderArgs): string {
  const panelW = Math.round(a.W * 0.46);
  const photoW = a.W - panelW;
  const pad = 56; const innerW = panelW - pad * 2;
  const panelBg = a.colorTreatment === "color_block" ? a.primary : CREAM;
  const onDark = a.colorTreatment === "color_block";
  const ctx: BlockCtx = { copy: a.copy, brand: a.brand, fp: a.fp, primary: a.primary, accent: a.accent, onDark, colorTreatment: a.colorTreatment, align: "left", scale: 0.62 };
  const blocks = buildBlocks(ctx, a.contentType);
  const m = measureBlocks(blocks, innerW, ctx, a.contentType);
  let s = `<rect x="0" y="0" width="${a.W}" height="${a.H}" fill="${panelBg}"/>`;
  s += photoEl(a.photos[0], panelW, 0, photoW, a.H);
  const bm = (a.brand.name || "").toUpperCase();
  let bmSize = 22; const bmTrack = 3;
  while (bmSize > 11 && (wAdvance(bm, bmSize, F_INTER, 600) + (bm.length - 1) * bmTrack) > innerW) bmSize -= 1;
  s += textEl(pad, 56, bmSize, F_INTER, 600, onDark ? CREAM : INK, bm, { tracking: bmTrack });
  s += `<rect x="${pad}" y="96" width="46" height="2" fill="${a.accent}"/>`;
  const yStart = Math.max(140, (a.H - m.total) / 2);
  s += drawStack(blocks, m.hHeights, pad, yStart, innerW);
  s += aiLabel(a.W, a.copy.label_text);
  return DEFS + s;
}

function compFramed(a: RenderArgs): string {
  const margin = 56; const topBar = 120;
  const photoX = margin, photoY = topBar;
  const photoW = a.W - margin * 2;
  const innerW = a.W - margin * 2;
  const fieldBg = a.colorTreatment === "color_block" ? a.primary : CREAM;
  const onDark = a.colorTreatment === "color_block";
  const ctx: BlockCtx = { copy: a.copy, brand: a.brand, fp: a.fp, primary: a.primary, accent: a.accent, onDark, colorTreatment: a.colorTreatment, align: "center", scale: 0.84 };
  const blocks = buildBlocks(ctx, a.contentType);
  const photoH = Math.round(a.H * 0.52);
  const m = measureBlocks(blocks, innerW, ctx, a.contentType);
  let s = `<rect x="0" y="0" width="${a.W}" height="${a.H}" fill="${fieldBg}"/>`;
  const bm = (a.brand.name || "").toUpperCase();
  let bmSize = 24; const bmTrack = 5;
  while (bmSize > 14 && (wAdvance(bm, bmSize, F_INTER, 600) + (bm.length - 1) * bmTrack) > a.W - 120) bmSize -= 1;
  s += textEl(a.W / 2, 50, bmSize, F_INTER, 600, onDark ? CREAM : INK, bm, { tracking: bmTrack, anchor: "middle" });
  s += `<clipPath id="frameClip"><rect x="${photoX}" y="${photoY}" width="${photoW}" height="${photoH}" rx="18"/></clipPath>`;
  s += photoEl(a.photos[0], photoX, photoY, photoW, photoH, "frameClip");
  const yStart = photoY + photoH + 40;
  s += drawStack(blocks, m.hHeights, margin, yStart, innerW);
  s += aiLabel(a.W, a.copy.label_text);
  return DEFS + s;
}

function compSplit(a: RenderArgs): string {
  const half = a.W / 2;
  const p2 = a.photos[1] ?? a.photos[0];
  let s = photoEl(a.photos[0], 0, 0, half, a.H);
  s += photoEl(p2, half, 0, half, a.H);
  s += `<rect x="0" y="0" width="${a.W}" height="${a.H}" fill="url(#fadeB)"/>`;
  s += `<rect x="${half - 2}" y="0" width="4" height="${a.H}" fill="${CREAM}"/>`;
  const leftLab = a.copy.stats?.[0]?.label || "BEFORE";
  const rightLab = a.copy.stats?.[1]?.label || "AFTER";
  s += textEl(half / 2, a.H - 80, 30, F_MONO, 700, CREAM, leftLab.toUpperCase(), { tracking: 4, anchor: "middle" });
  s += textEl(half + half / 2, a.H - 80, 30, F_MONO, 700, CREAM, rightLab.toUpperCase(), { tracking: 4, anchor: "middle" });
  s += brandTopBar(a.W, a.brand, a.accent, true);
  if (a.copy.headline) s += textEl(a.W / 2, 130, 56, a.fp.headline, a.fp.headlineWeight, CREAM, a.copy.headline, { anchor: "middle", italic: a.fp.headlineItalic });
  s += aiLabel(a.W, a.copy.label_text);
  return DEFS + s;
}

function compCollage(a: RenderArgs): string {
  const margin = 48; const innerW = a.W - margin * 2;
  const ink = INK; const hair = "rgba(10,10,10,0.16)";
  let s = `<rect x="0" y="0" width="${a.W}" height="${a.H}" fill="${CREAM}"/>`;
  const bm = (a.brand.name || "").toUpperCase();
  let bmSize = 22; const bmTrack = 4;
  while (bmSize > 13 && (wAdvance(bm, bmSize, F_INTER, 600) + (bm.length - 1) * bmTrack) > innerW) bmSize -= 1;
  s += textEl(a.W / 2, 46, bmSize, F_INTER, 600, ink, bm, { tracking: bmTrack, anchor: "middle" });
  s += `<rect x="${a.W / 2 - 26}" y="88" width="52" height="2" fill="${a.accent}"/>`;
  const topY = 128;
  const n = a.photos.length;
  if (n >= 3) {
    const ph = a.photos.slice(0, 3);
    const cellGap = 14;
    const cols = ph.length;
    const cellW = Math.round((innerW - cellGap * (cols - 1)) / cols);
    const rowH = Math.round(a.H * 0.40);
    ph.forEach((p, i) => {
      const x = margin + i * (cellW + cellGap);
      s += `<clipPath id="cg${i}"><rect x="${x}" y="${topY}" width="${cellW}" height="${rowH}" rx="14"/></clipPath>`;
      s += photoEl(p, x, topY, cellW, rowH, `cg${i}`);
    });
    const cx = a.W / 2;
    let ty = topY + rowH + 44;
    const kicker = (a.copy.kicker || a.copy.location_text || "").toUpperCase();
    if (kicker) { s += textEl(cx, ty, 19, F_MONO, 700, a.accent, kicker, { tracking: 3, anchor: "middle" }); ty += 42; }
    if (a.copy.headline) { const r = wrapFit(a.copy.headline, 54, innerW - 80, F_SERIF, 400, 2, 32); const lh = Math.round(r.size * 1.04); r.lines.forEach((ln, i) => { s += textEl(cx, ty + i * lh, r.size, F_SERIF, 400, ink, ln, { anchor: "middle" }); }); ty += r.lines.length * lh + 20; }
    if (a.copy.price_text) { s += textEl(cx, ty, 44, F_INTER, 700, ink, a.copy.price_text, { anchor: "middle" }); ty += 64; }
    if (a.copy.specs_text) { const t = a.copy.specs_text.toUpperCase(); const pw = wAdvance(t, 18, F_MONO, 700) + (t.length - 1) * 2 + 18 * 1.05 * 2; s += pill(cx - pw / 2, ty, t, 18, { color: ink, border: hair, tracking: 2 }).svg; ty += 54; }
    if (a.copy.cta_text) { s += textEl(cx, ty, 18, F_MONO, 700, a.accent, a.copy.cta_text.toUpperCase() + "  \u2192", { tracking: 2, anchor: "middle" }); }
  } else if (n === 2) {
    const heroH = Math.round(a.H * 0.42);
    s += `<clipPath id="cgHero"><rect x="${margin}" y="${topY}" width="${innerW}" height="${heroH}" rx="18"/></clipPath>`;
    s += photoEl(a.photos[0], margin, topY, innerW, heroH, "cgHero");
    const rowY = topY + heroH + 18;
    const smallW = Math.round(innerW * 0.38);
    const smallH = (a.H - 56) - rowY;
    s += `<clipPath id="cgSmall"><rect x="${margin}" y="${rowY}" width="${smallW}" height="${smallH}" rx="18"/></clipPath>`;
    s += photoEl(a.photos[1], margin, rowY, smallW, smallH, "cgSmall");
    const tx = margin + smallW + 34; const tw = innerW - smallW - 34;
    const kicker = (a.copy.kicker || a.copy.location_text || "").toUpperCase();
    let hLines: string[] = []; let hSz = 46; let hLh = 0;
    if (a.copy.headline) { const r = wrapFit(a.copy.headline, 46, tw, F_SERIF, 400, 4, 30); hLines = r.lines; hSz = r.size; hLh = Math.round(hSz * 1.06); }
    const blockH = (kicker ? 38 : 0) + (hLines.length ? hLines.length * hLh + 18 : 0) + (a.copy.price_text ? 58 : 0) + (a.copy.specs_text ? 56 : 0) + (a.copy.cta_text ? 24 : 0);
    let ty = rowY + Math.max(0, (smallH - blockH) / 2);
    if (kicker) { s += textEl(tx, ty, 18, F_MONO, 700, a.accent, kicker, { tracking: 2.5 }); ty += 38; }
    if (hLines.length) { hLines.forEach((ln, i) => { s += textEl(tx, ty + i * hLh, hSz, F_SERIF, 400, ink, ln, {}); }); ty += hLines.length * hLh + 18; }
    if (a.copy.price_text) { s += textEl(tx, ty, 44, F_INTER, 700, ink, a.copy.price_text, {}); ty += 58; }
    if (a.copy.specs_text) { s += pill(tx, ty, a.copy.specs_text.toUpperCase(), 18, { color: ink, border: hair, tracking: 2 }).svg; ty += 56; }
    if (a.copy.cta_text) { s += textEl(tx, ty, 18, F_MONO, 700, a.accent, a.copy.cta_text.toUpperCase() + "  \u2192", { tracking: 2 }); }
  } else {
    const heroH = Math.round(a.H * 0.58);
    s += `<clipPath id="cgHero"><rect x="${margin}" y="${topY}" width="${innerW}" height="${heroH}" rx="18"/></clipPath>`;
    s += photoEl(a.photos[0], margin, topY, innerW, heroH, "cgHero");
    let ty = topY + heroH + 34;
    const kicker = (a.copy.kicker || a.copy.location_text || "").toUpperCase();
    if (kicker) { s += textEl(margin, ty, 18, F_MONO, 700, a.accent, kicker, { tracking: 2.5 }); ty += 36; }
    if (a.copy.headline) { const r = wrapFit(a.copy.headline, 48, innerW, F_SERIF, 400, 3, 30); const lh = Math.round(r.size * 1.05); r.lines.forEach((ln, i) => { s += textEl(margin, ty + i * lh, r.size, F_SERIF, 400, ink, ln, {}); }); ty += r.lines.length * lh + 18; }
    if (a.copy.price_text) { s += textEl(margin, ty, 44, F_INTER, 700, ink, a.copy.price_text, {}); }
    if (a.copy.cta_text) { s += textEl(margin, a.H - 60, 18, F_MONO, 700, a.accent, a.copy.cta_text.toUpperCase() + "  \u2192", { tracking: 2 }); }
  }
  s += aiLabel(a.W, a.copy.label_text);
  return DEFS + s;
}

function compShowcase(a: RenderArgs): string {
  const W = a.W, H = a.H;
  const heroW = Math.round(W * 0.5);
  const outerPad = 56;
  const ink = INK; const hair = "rgba(10,10,10,0.16)";
  let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="${CREAM}"/>`;
  s += photoEl(a.photos[0], 0, 0, heroW, H);
  const rightColX = heroW + 28;
  const rightColW = W - rightColX - outerPad;
  const bm = (a.brand.name || "").toUpperCase();
  let bmSize = 22; const bmTrack = 3;
  while (bmSize > 12 && (wAdvance(bm, bmSize, F_INTER, 600) + (bm.length - 1) * bmTrack) > rightColW) bmSize -= 1;
  s += textEl(rightColX, 52, bmSize, F_INTER, 600, ink, bm, { tracking: bmTrack });
  s += `<rect x="${rightColX}" y="92" width="46" height="2" fill="${a.accent}"/>`;
  const thumbs = a.photos.slice(1, 4);
  const tCount = Math.max(thumbs.length, 1);
  const thumbY = 132;
  const gap = 22;
  const startX = 70;
  const tW = Math.round((W - startX - outerPad - gap * (tCount - 1)) / tCount);
  const tH = Math.round(tW * 1.32);
  thumbs.forEach((p, i) => {
    const x = startX + i * (tW + gap);
    s += `<clipPath id="sc${i}"><rect x="${x}" y="${thumbY}" width="${tW}" height="${tH}" rx="12"/></clipPath>`;
    s += photoEl(p, x, thumbY, tW, tH, `sc${i}`);
    s += `<rect x="${x}" y="${thumbY}" width="${tW}" height="${tH}" rx="12" fill="none" stroke="rgba(10,10,10,0.10)" stroke-width="1.5"/>`;
  });
  const kicker = (a.copy.kicker || a.copy.location_text || "").toUpperCase();
  const hr = a.copy.headline ? wrapFit(a.copy.headline, 84, rightColW, F_SERIF, 400, 3, 46) : { lines: [] as string[], size: 0 };
  const hLh = Math.round(hr.size * 1.02);
  const kickerH = kicker ? 40 : 0;
  const priceH = a.copy.price_text ? 58 : 0;
  const specsH = a.copy.specs_text ? 58 : 0;
  const headGap = hr.lines.length ? 26 : 0;
  const headH = hr.lines.length ? hr.lines.length * hLh : 0;
  const ctaH = a.copy.cta_text ? 52 : 0;
  const totalLower = kickerH + priceH + specsH + headGap + headH + ctaH;
  const regionTop = thumbY + tH + 44;
  const regionBottom = H - outerPad;
  let ty = regionTop + Math.max(0, (regionBottom - regionTop - totalLower) / 2);
  if (kicker) { s += textEl(rightColX, ty, 18, F_MONO, 700, a.accent, kicker, { tracking: 2.5 }); ty += kickerH; }
  if (a.copy.price_text) { s += textEl(rightColX, ty, 46, F_INTER, 700, ink, a.copy.price_text, {}); ty += priceH; }
  if (a.copy.specs_text) { const t = a.copy.specs_text.toUpperCase(); s += pill(rightColX, ty, t, 18, { color: ink, border: hair, tracking: 2 }).svg; ty += specsH; }
  if (hr.lines.length) { ty += headGap; hr.lines.forEach((ln, i) => { s += textEl(rightColX, ty + i * hLh, hr.size, F_SERIF, 400, ink, ln, { italic: a.fp.headlineItalic }); }); ty += headH; }
  if (a.copy.cta_text) { ty += 14; s += textEl(rightColX, ty, 18, F_MONO, 700, a.accent, a.copy.cta_text.toUpperCase() + "  \u2192", { tracking: 2 }); }
  s += aiLabel(a.W, a.copy.label_text);
  return DEFS + s;
}

function compFeature(a: RenderArgs): string {
  const W = a.W, H = a.H;
  const pad = Math.round(W * 0.065);
  const p = a.palette || {};
  const pv = (k: string, d: string) => p[k] || d;
  const bg = pv("bg", CREAM);
  const ink = pv("text", INK);
  const soft = pv("soft", "rgba(10,10,10,0.62)");
  const panelBg = pv("panel", "#C9BDA4");
  const panelText = pv("panelText", INK);
  const detail = pv("detail", INK);
  const detailGlyph = pv("detailGlyph", "#FFFFFF");
  const footerBg = pv("footerBg", "#242424");
  const footerText = pv("footerText", CREAM);
  const HEAD = F_MONTS;
  const heroH = Math.round(H * 0.48);

  let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>`;
  s += `<defs><linearGradient id="featFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${bg}" stop-opacity="0"/><stop offset="100%" stop-color="${bg}" stop-opacity="1"/></linearGradient></defs>`;
  s += photoEl(a.photos[0], 0, 0, W, heroH);
  s += `<rect x="0" y="0" width="${W}" height="${Math.round(heroH * 0.26)}" fill="url(#fadeT)"/>`;
  s += `<rect x="0" y="${Math.round(heroH * 0.72)}" width="${W}" height="${heroH - Math.round(heroH * 0.72)}" fill="url(#featFade)"/>`;

  const bm = (a.brand.name || "").toUpperCase();
  s += textEl(W - pad, 48, 22, HEAD, 700, footerText, bm, { tracking: 2.5, anchor: "end" });

  const leftW = Math.round(W * 0.46);
  let ly = heroH + Math.round(H * 0.024);
  if (a.copy.headline) {
    const r = wrapFit(a.copy.headline, 64, leftW, HEAD, 700, 3, 42);
    const lh = Math.round(r.size * 1.04);
    r.lines.forEach((ln, i) => { s += textEl(pad, ly + i * lh, r.size, HEAD, 700, ink, ln, {}); });
    ly += r.lines.length * lh + 16;
  }
  if (a.copy.tagline) {
    const tl = wrap(a.copy.tagline, 26, leftW, F_INTER, 400, 3);
    tl.forEach((ln, i) => { s += textEl(pad, ly + i * 38, 26, F_INTER, 400, soft, ln, {}); });
  }

  const boxX = Math.round(W * 0.57);
  const boxW = (W - pad) - boxX;
  const boxY = Math.round(H * 0.37);
  const feats = (a.copy.bullets || []).slice(0, 5);
  const titleSize = 27; const rowH = 56; const padIn = 28; const headBlock = titleSize + 30;
  const boxH = padIn + headBlock + feats.length * rowH + (padIn - 8);
  s += `<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="6" fill="${panelBg}"/>`;
  const title = a.copy.features_title || "Home Features:";
  s += textEl(boxX + padIn, boxY + padIn, titleSize, HEAD, 700, panelText, title, {});
  const iconNames = ["bed", "bath", "kitchen", "sofa", "view"];
  feats.forEach((f, i) => {
    const ry = boxY + padIn + headBlock + i * rowH;
    const tile = 38; const tx = boxX + padIn;
    s += `<rect x="${tx}" y="${ry}" width="${tile}" height="${tile}" rx="8" fill="${detail}"/>`;
    s += icon(iconNames[i] || "bed", tx + tile / 2, ry + tile / 2, 22, detailGlyph, 2.0);
    s += textEl(tx + tile + 18, ry + 7, 25, HEAD, 400, panelText, f, {});
  });

  const thumbs = a.photos.slice(1, 4);
  const tc = Math.max(thumbs.length, 1);
  const stripY = Math.round(H * 0.752);
  const stripH = Math.round(H * 0.163);
  const gap = Math.round(W * 0.0095);
  const tW = Math.round((W - pad * 2 - gap * (tc - 1)) / tc);
  thumbs.forEach((pp, i) => {
    const x = pad + i * (tW + gap);
    s += `<clipPath id="fts${i}"><rect x="${x}" y="${stripY}" width="${tW}" height="${stripH}" rx="6"/></clipPath>`;
    s += photoEl(pp, x, stripY, tW, stripH, `fts${i}`);
  });

  const barY = Math.round(H * 0.945); const barH = H - barY; const midY = barY + barH / 2;
  s += `<rect x="0" y="${barY}" width="${W}" height="${barH}" fill="${footerBg}"/>`;
  const clabel = (a.copy.contact_label || "CONTACT US AT").toUpperCase();
  s += textEl(pad, midY - 9, 18, HEAD, 700, footerText, clabel, { tracking: 2 });
  const phone = a.copy.phone_text || "";
  if (phone) { const px = Math.round(W * 0.40); s += icon("phone", px, midY, 24, footerText, 2.0); s += textEl(px + 22, midY - 9, 20, HEAD, 600, footerText, phone, {}); }
  const site = a.copy.cta_text || a.copy.location_text || "";
  if (site) { const sx = Math.round(W * 0.66); s += icon("pin", sx, midY, 24, footerText, 2.0); s += textEl(sx + 22, midY - 9, 20, HEAD, 600, footerText, site, {}); }
  s += aiLabel(a.W, a.copy.label_text);
  return DEFS + s;
}

function compNewListing(a: RenderArgs): string {
  const W = a.W, H = a.H; const pad = 56;
  const ink = INK;
  const big = a.primary;
  const acc = a.accent;
  let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="${CREAM}"/>`;
  const newSize = 150;
  s += textEl(pad, 30, newSize, F_DISPLAY, 400, big, "NEW", {});
  const thumbs = a.photos.slice(1, 4);
  const tc = Math.max(thumbs.length, 1);
  const tGap = 12;
  const thumbAreaX = pad + wAdvance("NEW", newSize, F_DISPLAY, 400) + 44;
  const thumbAreaW = W - pad - thumbAreaX;
  const tW = Math.round((thumbAreaW - tGap * (tc - 1)) / tc);
  const tH = 152; const tY = 44;
  thumbs.forEach((p, i) => {
    const x = thumbAreaX + i * (tW + tGap);
    s += `<clipPath id="nl${i}"><rect x="${x}" y="${tY}" width="${tW}" height="${tH}" rx="8"/></clipPath>`;
    s += photoEl(p, x, tY, tW, tH, `nl${i}`);
  });
  const heroY = 216; const heroH = 858;
  s += `<clipPath id="nlHero"><rect x="${pad}" y="${heroY}" width="${W - pad * 2}" height="${heroH}" rx="10"/></clipPath>`;
  s += photoEl(a.photos[0], pad, heroY, W - pad * 2, heroH, "nlHero");
  const bp = pill(0, 0, a.copy.badge_text || "FOR SALE", 18, { bg: acc, color: INK, tracking: 2, font: F_MONO, weight: 700 });
  s += `<g transform="translate(${pad + 26}, ${heroY + 44}) rotate(-12)">${bp.svg}</g>`;
  if (a.copy.price_text) {
    const pp = pill(0, 0, a.copy.price_text, 30, { bg: acc, color: INK, tracking: 1, font: F_INTER, weight: 700 });
    s += `<g transform="translate(${W - pad - 26 - pp.w}, ${heroY + heroH - 26 - pp.h})">${pp.svg}</g>`;
  }
  const listSize = 132;
  const listYTop = H - pad - Math.round(listSize * 0.78);
  s += textEl(W - pad, listYTop, listSize, F_DISPLAY, 400, big, "LISTING", { anchor: "end" });
  if (a.copy.tagline) {
    const dl = wrap(a.copy.tagline, 28, Math.round(W * 0.46), F_INTER, 400, 3);
    const dlh = 36;
    const descY = (H - pad) - Math.round(28 * 0.78) - (dl.length - 1) * dlh;
    dl.forEach((ln, i) => { s += textEl(pad, descY + i * dlh, 28, F_INTER, 400, ink, ln, {}); });
  }
  s += aiLabel(a.W, a.copy.label_text);
  return DEFS + s;
}

function compMagazine(a: RenderArgs): string {
  const pad = 64; const innerW = a.W - pad * 2;
  let s = photoEl(a.photos[0], 0, 0, a.W, a.H);
  s += `<rect x="0" y="0" width="${a.W}" height="${Math.round(a.H * 0.5)}" fill="url(#fadeT)"/>`;
  s += `<rect x="0" y="0" width="${a.W}" height="${a.H}" fill="url(#fadeB)"/>`;
  s += brandTopBar(a.W, a.brand, a.accent, true);
  const kicker = (a.copy.kicker || a.copy.location_text || "").toUpperCase();
  let y = 152;
  if (kicker) { s += textEl(a.W / 2, y, 24, a.fp.kicker, a.fp.kickerWeight, a.accent, kicker, { tracking: 4, anchor: "middle" }); y += 52; }
  if (a.copy.headline) {
    const hSize = 92;
    const lines = wrap(a.copy.headline, hSize, innerW, a.fp.headline, a.fp.headlineWeight, 3);
    const lh = Math.round(hSize * 1.02);
    lines.forEach((ln, i) => { s += textEl(a.W / 2, y + i * lh, hSize, a.fp.headline, a.fp.headlineWeight, CREAM, ln, { anchor: "middle", italic: a.fp.headlineItalic }); });
  }
  const by = a.H - pad - 28;
  if (a.copy.price_text) s += textEl(pad, by - 18, 52, F_INTER, 700, CREAM, a.copy.price_text);
  if (a.copy.specs_text) {
    const tt = a.copy.specs_text.toUpperCase();
    const pw = wAdvance(tt, 22, F_MONO, 700) + (tt.length - 1) * 2 + 22 * 1.05 * 2;
    s += pill(a.W - pad - pw, by - 6, tt, 22, { color: CREAM, border: "rgba(250,248,243,0.4)", tracking: 2 }).svg;
  }
  if (a.copy.cta_text) s += textEl(a.W / 2, a.H - 46, 20, F_MONO, 700, a.accent, a.copy.cta_text.toUpperCase() + "  →", { tracking: 2, anchor: "middle" });
  s += aiLabel(a.W, a.copy.label_text);
  return DEFS + s;
}

function compEditorial(a: RenderArgs): string {
  const photoW = Math.round(a.W * 0.58);
  const colX = photoW; const colW = a.W - photoW;
  const pad = 52; const innerW = colW - pad * 2;
  const colorBlock = a.colorTreatment === "color_block";
  const colBg = colorBlock ? a.primary : CREAM;
  const onDark = colorBlock;
  const inkP = onDark ? CREAM : INK;
  const accentCol = onDark ? a.accent : a.primary;
  let s = `<rect x="0" y="0" width="${a.W}" height="${a.H}" fill="${colBg}"/>`;
  s += photoEl(a.photos[0], 0, 0, photoW, a.H);
  if (a.colorTreatment === "accent_line") s += `<rect x="${colX}" y="0" width="6" height="${a.H}" fill="${a.accent}"/>`;
  const bm = (a.brand.name || "").toUpperCase();
  let bmSize = 19; const bmTrack = 3;
  while (bmSize > 11 && (wAdvance(bm, bmSize, F_INTER, 600) + (bm.length - 1) * bmTrack) > innerW) bmSize -= 1;
  s += textEl(colX + pad, 56, bmSize, F_INTER, 600, inkP, bm, { tracking: bmTrack });
  s += `<rect x="${colX + pad}" y="94" width="40" height="2" fill="${a.accent}"/>`;
  const kicker = (a.copy.kicker || a.copy.location_text || "").toUpperCase();
  const hSize = 50;
  const hLines = a.copy.headline ? wrap(a.copy.headline, hSize, innerW, a.fp.headline, a.fp.headlineWeight, 3) : [];
  const hLh = Math.round(hSize * 1.05);
  const parts = a.copy.specs_text ? a.copy.specs_text.split("·").map((p) => p.trim()).filter(Boolean) : [];
  let blockH = 0;
  if (kicker) blockH += 38;
  blockH += hLines.length * hLh + 24;
  if (a.copy.price_text) blockH += 60;
  if (parts.length) blockH += 64;
  if (a.copy.cta_text) blockH += 48;
  let y = Math.max(150, (a.H - blockH) / 2);
  if (kicker) { s += textEl(colX + pad, y, 21, a.fp.kicker, a.fp.kickerWeight, accentCol, kicker, { tracking: 3 }); y += 38; }
  hLines.forEach((ln, i) => { s += textEl(colX + pad, y + i * hLh, hSize, a.fp.headline, a.fp.headlineWeight, inkP, ln, { italic: a.fp.headlineItalic }); });
  y += hLines.length * hLh + 24;
  if (a.copy.price_text) { s += textEl(colX + pad, y, 44, F_INTER, 700, inkP, a.copy.price_text); y += 60; }
  if (parts.length) {
    let ix = colX + pad;
    parts.slice(0, 2).forEach((p, i) => {
      const idx = p.indexOf(" ");
      const val = idx > 0 && /^[0-9]/.test(p) ? p.slice(0, idx) : p;
      const nm = i === 0 ? "bed" : "bath";
      s += icon(nm, ix + 14, y + 14, 28, accentCol, 2.0);
      s += textEl(ix + 36, y, 28, F_INTER, 600, inkP, val, {});
      ix += 36 + wAdvance(val, 28, F_INTER, 600) + 40;
    });
    y += 64;
  }
  if (a.copy.cta_text) s += textEl(colX + pad, y, 20, F_MONO, 700, accentCol, a.copy.cta_text.toUpperCase() + "  →", { tracking: 2 });
  s += aiLabel(a.W, a.copy.label_text);
  return DEFS + s;
}

function compPostcard(a: RenderArgs): string {
  const colorBlock = a.colorTreatment === "color_block";
  const fieldBg = colorBlock ? a.primary : CREAM;
  const onDark = colorBlock;
  let s = `<rect x="0" y="0" width="${a.W}" height="${a.H}" fill="${fieldBg}"/>`;
  const bm = (a.brand.name || "").toUpperCase();
  let bmSize = 22; const bmTrack = 5;
  while (bmSize > 13 && (wAdvance(bm, bmSize, F_INTER, 600) + (bm.length - 1) * bmTrack) > a.W - 120) bmSize -= 1;
  s += textEl(a.W / 2, 52, bmSize, F_INTER, 600, onDark ? CREAM : INK, bm, { tracking: bmTrack, anchor: "middle" });
  const mat = Math.round(a.W * 0.11);
  const photoX = mat, photoW = a.W - mat * 2;
  const photoY = 128;
  const photoH = Math.round(a.H * 0.46);
  const border = 16;
  s += `<rect x="${photoX - border}" y="${photoY - border}" width="${photoW + border * 2}" height="${photoH + border * 2}" rx="8" fill="${CREAM}" filter="url(#cardShadow)"/>`;
  s += `<clipPath id="pcClip"><rect x="${photoX}" y="${photoY}" width="${photoW}" height="${photoH}" rx="4"/></clipPath>`;
  s += photoEl(a.photos[0], photoX, photoY, photoW, photoH, "pcClip");
  s += `<rect x="${photoX}" y="${photoY}" width="${photoW}" height="${photoH}" rx="4" fill="none" stroke="rgba(10,10,10,0.12)" stroke-width="1.5"/>`;
  const ctx: BlockCtx = { copy: a.copy, brand: a.brand, fp: a.fp, primary: a.primary, accent: a.accent, onDark, colorTreatment: a.colorTreatment, align: "center", scale: 0.82 };
  const blocks = buildBlocks(ctx, a.contentType);
  const m = measureBlocks(blocks, a.W - mat * 2, ctx, a.contentType);
  const yStart = photoY + photoH + border + 44;
  s += drawStack(blocks, m.hHeights, mat, yStart, a.W - mat * 2);
  s += aiLabel(a.W, a.copy.label_text);
  return DEFS + s;
}

function compBand(a: RenderArgs): string {
  const pad = 64;
  let s = photoEl(a.photos[0], 0, 0, a.W, a.H);
  s += `<rect x="0" y="0" width="${a.W}" height="${Math.round(a.H * 0.22)}" fill="url(#fadeT)"/>`;
  const bandY = Math.round(a.H * 0.52);
  const bandH = Math.round(a.H * 0.26);
  s += `<rect x="0" y="${bandY}" width="${a.W}" height="6" fill="${a.accent}"/>`;
  s += `<rect x="0" y="${bandY + 6}" width="${a.W}" height="${bandH}" fill="${a.primary}" fill-opacity="0.94"/>`;
  s += brandTopBar(a.W, a.brand, a.accent, true);
  const kicker = (a.copy.kicker || a.copy.badge_text || a.copy.location_text || "").toUpperCase();
  let y = bandY + 6 + 38;
  if (kicker) { s += textEl(pad, y, 22, a.fp.kicker, a.fp.kickerWeight, a.accent, kicker, { tracking: 3.5 }); y += 44; }
  if (a.copy.headline) {
    const hSize = 62;
    const lines = wrap(a.copy.headline, hSize, a.W - pad * 2, a.fp.headline, a.fp.headlineWeight, 2);
    const lh = Math.round(hSize * 1.04);
    lines.forEach((ln, i) => { s += textEl(pad, y + i * lh, hSize, a.fp.headline, a.fp.headlineWeight, CREAM, ln, { italic: a.fp.headlineItalic }); });
  }
  const fy = bandY + 6 + bandH + 34;
  if (a.copy.price_text) s += textEl(pad, fy, 46, F_INTER, 700, CREAM, a.copy.price_text);
  if (a.copy.cta_text) s += textEl(a.W - pad, fy + 12, 22, F_MONO, 700, CREAM, a.copy.cta_text.toUpperCase() + "  →", { tracking: 2, anchor: "end" });
  if (a.copy.specs_text) s += textEl(pad, fy + 54, 20, F_MONO, 700, "rgba(250,248,243,0.85)", a.copy.specs_text.toUpperCase(), { tracking: 2 });
  s += aiLabel(a.W, a.copy.label_text);
  return DEFS + s;
}

function compQuote(a: RenderArgs): string {
  const pad = 80;
  let s = photoEl(a.photos[0], 0, 0, a.W, a.H);
  s += `<rect x="0" y="0" width="${a.W}" height="${a.H}" fill="rgba(10,10,10,0.55)"/>`;
  s += textEl(a.W / 2, Math.round(a.H * 0.15), 150, F_SERIF, 400, a.accent, "“", { anchor: "middle", italic: true });
  const q = a.copy.tagline || a.copy.headline || a.brand.name || "";
  const qSize = 58;
  const lines = wrap(q, qSize, a.W - pad * 2, F_SERIF, 400, 5);
  const lh = Math.round(qSize * 1.18);
  const blockH = lines.length * lh;
  const qy = Math.round(a.H * 0.5) - blockH / 2;
  lines.forEach((ln, i) => { s += textEl(a.W / 2, qy + i * lh, qSize, F_SERIF, 400, CREAM, ln, { anchor: "middle", italic: true }); });
  const attrY = qy + blockH + 50;
  s += `<rect x="${a.W / 2 - 24}" y="${attrY}" width="48" height="2" fill="${a.accent}"/>`;
  s += textEl(a.W / 2, attrY + 22, 22, F_MONO, 700, CREAM, (a.brand.name || "").toUpperCase(), { tracking: 3, anchor: "middle" });
  const kicker = (a.copy.kicker || a.copy.location_text || "").toUpperCase();
  if (kicker) s += textEl(a.W / 2, attrY + 54, 18, F_MONO, 500, "rgba(250,248,243,0.75)", kicker, { tracking: 2, anchor: "middle" });
  s += aiLabel(a.W, a.copy.label_text);
  return DEFS + s;
}

function compStat(a: RenderArgs): string {
  const photoH = Math.round(a.H * 0.56);
  const pad = 64; const innerW = a.W - pad * 2;
  const colorBlock = a.colorTreatment === "color_block";
  const panelBg = colorBlock ? a.primary : CREAM;
  const onDark = colorBlock;
  const inkP = onDark ? CREAM : INK;
  const inkS = onDark ? "rgba(250,248,243,0.78)" : "rgba(10,10,10,0.55)";
  const hair = onDark ? "rgba(250,248,243,0.28)" : "rgba(10,10,10,0.12)";
  const accentCol = onDark ? a.accent : a.primary;
  let s = photoEl(a.photos[0], 0, 0, a.W, photoH);
  s += aiLabel(a.W, a.copy.label_text);
  s += `<rect x="0" y="${photoH}" width="${a.W}" height="${a.H - photoH}" fill="${panelBg}"/>`;
  if (a.colorTreatment === "accent_line") s += `<rect x="0" y="${photoH}" width="${a.W}" height="6" fill="${a.accent}"/>`;
  let topY = photoH + 54;
  const kicker = (a.copy.kicker || a.copy.location_text || "").toUpperCase();
  if (kicker) { s += textEl(pad, topY, 22, a.fp.kicker, a.fp.kickerWeight, accentCol, kicker, { tracking: 3.5 }); topY += 40; }
  let headBottom = topY;
  if (a.copy.headline) {
    const hSize = 54;
    const lines = wrap(a.copy.headline, hSize, innerW, a.fp.headline, a.fp.headlineWeight, 2);
    const lh = Math.round(hSize * 1.04);
    lines.forEach((ln, i) => { s += textEl(pad, topY + i * lh, hSize, a.fp.headline, a.fp.headlineWeight, inkP, ln, { italic: a.fp.headlineItalic }); });
    headBottom = topY + lines.length * lh;
  }
  const fy = a.H - 60;
  s += `<rect x="${pad}" y="${fy - 28}" width="${innerW}" height="1.5" fill="${hair}"/>`;
  s += textEl(pad, fy, 20, F_MONO, 700, inkS, (a.brand.name || "").toUpperCase(), { tracking: 3 });
  if (a.copy.cta_text) s += textEl(pad + innerW, fy, 20, F_MONO, 700, accentCol, a.copy.cta_text.toUpperCase() + "  →", { tracking: 2, anchor: "end" });
  const cells: { kind: string; value: string; label: string }[] = [];
  if (a.copy.price_text) cells.push({ kind: "price", value: a.copy.price_text, label: "PRICE" });
  if (a.copy.specs_text) {
    const parts = a.copy.specs_text.split("·").map((p) => p.trim()).filter(Boolean);
    parts.slice(0, 2).forEach((p, i) => {
      const idx = p.indexOf(" ");
      const val = idx > 0 && /^[0-9]/.test(p) ? p.slice(0, idx) : p;
      cells.push({ kind: i === 0 ? "bed" : "bath", value: val, label: idx > 0 ? p.slice(idx + 1).toUpperCase() : "" });
    });
  }
  if (cells.length) {
    const cy = (headBottom + 20 + (fy - 28 - 20)) / 2;
    const n = Math.min(cells.length, 3);
    const colW = innerW / n;
    cells.slice(0, n).forEach((c, i) => {
      const cx = pad + colW * i + colW / 2;
      if (i > 0) s += `<rect x="${pad + colW * i}" y="${cy - 56}" width="1.5" height="112" fill="${hair}"/>`;
      if (c.kind === "price") {
        s += textEl(cx, cy - 50, 16, F_MONO, 500, inkS, c.label, { tracking: 2, anchor: "middle" });
        s += textEl(cx, cy - 14, 44, a.fp.headline, a.fp.headlineWeight, inkP, c.value, { anchor: "middle", italic: a.fp.headlineItalic });
      } else {
        s += icon(c.kind, cx, cy - 40, 36, accentCol, 2.0);
        s += textEl(cx, cy - 14, 46, a.fp.headline, a.fp.headlineWeight, inkP, c.value, { anchor: "middle", italic: a.fp.headlineItalic });
        s += textEl(cx, cy + 38, 15, F_MONO, 500, inkS, c.label, { tracking: 2, anchor: "middle" });
      }
    });
  }
  return DEFS + s;
}

function compStatement(a: RenderArgs): string {
  const colW = Math.round(a.W * 0.47);
  const barH = Math.round(a.H * 0.14);
  const topH = a.H - barH;
  const pad = 56; const innerW = colW - pad * 2;
  const ink = INK; const soft = "rgba(10,10,10,0.6)"; const hair = "rgba(10,10,10,0.16)";
  let s = `<rect x="0" y="0" width="${a.W}" height="${a.H}" fill="${CREAM}"/>`;
  s += photoEl(a.photos[0], colW, 0, a.W - colW, topH);
  const initial = (a.brand.name || "A").trim().charAt(0).toUpperCase();
  s += textEl(pad, 60, 48, F_SERIF, 400, a.accent, initial, {});
  s += textEl(pad + 60, 76, 18, F_MONO, 700, ink, (a.brand.name || "").toUpperCase(), { tracking: 3 });
  s += `<rect x="${pad}" y="150" width="44" height="2" fill="${a.accent}"/>`;
  const hSize = 68;
  const hLh = Math.round(hSize * 1.05);
  const hLines = a.copy.headline ? wrap(a.copy.headline, hSize, innerW, F_SERIF, 400, 4) : [];
  let tLines: string[] = []; let tSize = 26;
  if (a.copy.tagline) { const r = wrapFit(a.copy.tagline, 26, innerW, F_INTER, 400, 7, 18); tLines = r.lines; tSize = r.size; }
  const tLh = Math.round(tSize * 1.45);
  const headBlockH = hLines.length ? hLines.length * hLh + 18 : 0;
  const tagBlockH = a.copy.tagline ? tLines.length * tLh + 16 : 0;
  const ctaBlockH = a.copy.cta_text ? 62 : 0;
  const blockH = headBlockH + 42 + tagBlockH + ctaBlockH;
  const bandTop = 200; const bandBottom = topH - 64;
  let y = Math.max(bandTop, bandTop + (bandBottom - bandTop - blockH) / 2);
  if (hLines.length) {
    hLines.forEach((ln, i) => {
      const col = i === hLines.length - 1 ? a.accent : ink;
      s += textEl(pad, y + i * hLh, hSize, F_SERIF, 400, col, ln, {});
    });
    y += headBlockH;
  }
  s += `<rect x="${pad}" y="${y}" width="44" height="2" fill="${a.accent}"/>`;
  y += 42;
  if (a.copy.tagline) {
    tLines.forEach((ln) => { s += textEl(pad, y, tSize, F_INTER, 400, soft, ln, {}); y += tLh; });
    y += 16;
  }
  if (a.copy.cta_text) {
    const label = a.copy.cta_text.toUpperCase();
    const bw = Math.min(wAdvance(label, 18, F_MONO, 700) + (label.length - 1) * 2 + 130, innerW);
    const bh = 62;
    s += `<rect x="${pad}" y="${y}" width="${bw}" height="${bh}" rx="6" fill="none" stroke="${hair}" stroke-width="2"/>`;
    s += textEl(pad + 28, y + 19, 18, F_MONO, 700, ink, label, { tracking: 2 });
    s += textEl(pad + bw - 38, y + 18, 22, F_INTER, 400, ink, "\u2192", {});
  }
  const byTop = topH;
  s += `<rect x="0" y="${byTop}" width="${a.W}" height="${barH}" fill="${CREAM}"/>`;
  s += `<rect x="${pad}" y="${byTop}" width="${a.W - pad * 2}" height="1.5" fill="${hair}"/>`;
  const colCount = 3;
  const fColW = (a.W - pad * 2) / colCount;
  const fcy = byTop + barH / 2 + 8;
  for (let i = 1; i < colCount; i++) s += `<rect x="${pad + fColW * i}" y="${fcy - 28}" width="1.5" height="56" fill="${hair}"/>`;
  const loc = (a.copy.location_text || a.copy.kicker || "").toUpperCase();
  s += icon("pin", pad + 18, fcy, 30, ink, 2.0);
  const locParts = loc.split(",").map((t) => t.trim());
  s += textEl(pad + 44, fcy - 18, 19, F_INTER, 700, ink, locParts[0] || "", {});
  if (locParts[1]) s += textEl(pad + 44, fcy + 8, 14, F_MONO, 500, soft, locParts[1], { tracking: 2 });
  const bl = (a.copy.bullets || []).map((b) => b.toUpperCase());
  const putCol = (ci: number, l1?: string, l2?: string) => {
    const cx0 = pad + fColW * ci + 30;
    if (l1) s += textEl(cx0, fcy - 18, 17, F_INTER, 700, ink, l1, {});
    if (l2) s += textEl(cx0, fcy + 8, 17, F_INTER, 700, ink, l2, {});
  };
  putCol(1, bl[0], bl[1]);
  putCol(2, bl[2], bl[3]);
  s += aiLabel(a.W, a.copy.label_text);
  return DEFS + s;
}

function compProject(a: RenderArgs): string {
  const photoW = Math.round(a.W * 0.52);
  const panelX = photoW; const panelW = a.W - photoW;
  const pad = 48; const innerW = panelW - pad * 2;
  const cx = panelX + panelW / 2;
  let s = photoEl(a.photos[0], 0, 0, a.W, a.H);
  s += `<rect x="${panelX}" y="0" width="${panelW}" height="${a.H}" fill="rgba(16,18,22,0.62)"/>`;
  s += `<rect x="${panelX}" y="0" width="2" height="${a.H}" fill="rgba(250,248,243,0.16)"/>`;
  const bname = (a.brand.name || "").toUpperCase();
  s += textEl(cx, 116, 44, F_INTER, 700, CREAM, bname.split(" ")[0] || bname, { tracking: 2, anchor: "middle" });
  const sub = (a.copy.kicker || a.copy.location_text || bname.split(" ").slice(1).join(" ")).toUpperCase();
  if (sub) s += textEl(cx, 168, 17, F_MONO, 500, "rgba(250,248,243,0.8)", sub, { tracking: 3, anchor: "middle" });
  let y = Math.round(a.H * 0.32);
  if (a.copy.headline) {
    const lines = wrap(a.copy.headline, 44, innerW, a.fp.headline, a.fp.headlineWeight, 2);
    lines.forEach((ln, i) => { s += textEl(cx, y + i * 52, 44, a.fp.headline, a.fp.headlineWeight, CREAM, ln, { anchor: "middle", italic: a.fp.headlineItalic }); });
    y += lines.length * 52 + 22;
  }
  s += `<rect x="${cx - 26}" y="${y}" width="52" height="2" fill="${a.accent}"/>`;
  y += 50;
  const am = (a.copy.bullets || []).slice(0, 5).map((b) => b.toUpperCase());
  const hi = am.length > 2 ? Math.floor(am.length / 2) : -1;
  am.forEach((b, i) => {
    if (i === hi) {
      const pw = wAdvance(b, 20, F_INTER, 700) + 76;
      s += `<rect x="${cx - pw / 2}" y="${y - 24}" width="${pw}" height="50" rx="25" fill="none" stroke="rgba(250,248,243,0.7)" stroke-width="2"/>`;
      s += textEl(cx, y - 12, 20, F_INTER, 700, CREAM, b, { tracking: 1, anchor: "middle" });
    } else {
      s += textEl(cx, y - 12, 19, F_INTER, 500, "rgba(250,248,243,0.85)", b, { tracking: 1.5, anchor: "middle" });
    }
    y += 58;
  });
  y += 8;
  s += `<rect x="${cx - 26}" y="${y}" width="52" height="2" fill="${a.accent}"/>`;
  if (a.copy.cta_text) {
    const label = a.copy.cta_text;
    const pw = wAdvance(label, 19, F_INTER, 600) + 84;
    const cyB = a.H - 112;
    s += `<rect x="${cx - pw / 2}" y="${cyB}" width="${pw}" height="52" rx="26" fill="none" stroke="rgba(250,248,243,0.65)" stroke-width="2"/>`;
    s += textEl(cx, cyB + 16, 19, F_INTER, 600, CREAM, label, { anchor: "middle" });
  }
  s += aiLabel(a.W, a.copy.label_text);
  return DEFS + s;
}

function compPriceHero(a: RenderArgs): string {
  const pad = 64; const innerW = a.W - pad * 2;
  let s = photoEl(a.photos[0], 0, 0, a.W, a.H);
  s += `<rect x="0" y="0" width="${a.W}" height="${a.H}" fill="rgba(10,10,10,0.32)"/>`;
  s += `<rect x="0" y="0" width="${a.W}" height="${a.H}" fill="url(#fadeB)"/>`;
  let y = Math.round(a.H * 0.40);
  const badge = (a.copy.badge_text || a.badgeLabel || "").toUpperCase();
  if (badge) { s += textEl(pad, y, 26, F_INTER, 700, a.accent, badge, { tracking: 3 }); y += 42; }
  if (a.copy.headline) {
    const headW = innerW - 90;
    const { lines: hLines, size: hSize } = wrapFit(a.copy.headline.toUpperCase(), 56, headW, F_INTER, 700, 2, 30);
    const hLh = Math.round(hSize * 1.18);
    hLines.forEach((ln, i) => { s += textEl(pad, y + i * hLh, hSize, F_INTER, 700, CREAM, ln, {}); });
    y += hLines.length * hLh + 10;
  }
  if (a.copy.price_text) {
    let pSize = 132;
    const pw = wAdvance(a.copy.price_text, pSize, F_INTER, 700);
    if (pw > innerW) pSize = Math.floor(pSize * innerW / pw);
    s += textEl(pad, y, pSize, F_INTER, 700, CREAM, a.copy.price_text, {});
    y += Math.round(pSize * 1.12);
  }
  const specLines: string[] = [];
  if (a.copy.specs_text) a.copy.specs_text.split("\u00b7").map((p) => p.trim()).filter(Boolean).forEach((p) => specLines.push(p.toUpperCase()));
  if (specLines.length) {
    const lineH = 40;
    s += `<rect x="${pad}" y="${y - 4}" width="4" height="${specLines.length * lineH - 10}" fill="${a.accent}"/>`;
    specLines.forEach((ln, i) => { s += textEl(pad + 22, y + i * lineH, 28, F_INTER, 700, CREAM, ln, {}); });
    y += specLines.length * lineH + 10;
  }
  const loc = (a.copy.location_text || a.copy.kicker || "").toUpperCase();
  if (loc) {
    s += icon("pin", pad + 16, y + 14, 30, a.accent, 2.2);
    s += textEl(pad + 42, y, 30, F_INTER, 700, CREAM, loc, {});
  }
  const bn = (a.brand.name || "").toUpperCase();
  s += `<g transform="translate(${a.W - 38}, ${Math.round(a.H * 0.5)}) rotate(90)">` +
    textEl(0, 0, 28, F_INTER, 700, "rgba(250,248,243,0.85)", bn, { tracking: 4, anchor: "middle" }) + `</g>`;
  s += aiLabel(a.W, a.copy.label_text);
  return DEFS + s;
}

function compLaunchHero(a: RenderArgs): string {
  const pad = 64; const innerW = a.W - pad * 2;
  let s = photoEl(a.photos[0], 0, 0, a.W, a.H);
  s += `<rect x="0" y="0" width="${a.W}" height="${a.H}" fill="rgba(10,10,10,0.30)"/>`;
  s += `<rect x="0" y="0" width="${a.W}" height="${Math.round(a.H * 0.46)}" fill="url(#fadeT)"/>`;
  s += `<rect x="0" y="0" width="${a.W}" height="${a.H}" fill="url(#fadeB)"/>`;
  s += brandTopBar(a.W, a.brand, a.accent, true);

  let y = 150;
  const eyebrow = (a.copy.badge_text || a.copy.kicker || a.badgeLabel || "").toUpperCase();
  if (eyebrow) { s += textEl(a.W / 2, y, 26, a.fp.kicker, a.fp.kickerWeight, a.accent, eyebrow, { tracking: 4, anchor: "middle" }); y += 52; }
  if (a.copy.headline) {
    const hSize = 84;
    const lines = wrap(a.copy.headline, hSize, innerW, a.fp.headline, a.fp.headlineWeight, 3);
    const lh = Math.round(hSize * 1.04);
    lines.forEach((ln, i) => { s += textEl(a.W / 2, y + i * lh, hSize, a.fp.headline, a.fp.headlineWeight, CREAM, ln, { anchor: "middle", italic: a.fp.headlineItalic }); });
    y += lines.length * lh + 4;
  }
  if (a.copy.tagline) {
    const subSize = 40;
    const subLines = wrap(a.copy.tagline, subSize, innerW, a.fp.headline, a.fp.headlineWeight, 2);
    const slh = Math.round(subSize * 1.1);
    subLines.forEach((ln, i) => { s += textEl(a.W / 2, y + i * slh, subSize, a.fp.headline, a.fp.headlineWeight, "rgba(250,248,243,0.92)", ln, { anchor: "middle", italic: true }); });
  }

  const stats = (a.copy.stats || []).slice(0, 3);
  const rowY = a.H - 156;
  if (stats.length) {
    const n = stats.length;
    const colW = innerW / n;
    stats.forEach((st, i) => {
      const cx = pad + colW * i + colW / 2;
      if (i > 0) s += `<rect x="${pad + colW * i}" y="${rowY - 6}" width="1.5" height="96" fill="rgba(250,248,243,0.4)"/>`;
      s += textEl(cx, rowY, 18, F_MONO, 500, a.accent, (st.label || "").toUpperCase(), { tracking: 2.5, anchor: "middle" });
      s += textEl(cx, rowY + 36, 46, a.fp.headline, a.fp.headlineWeight, CREAM, st.value || "", { anchor: "middle", italic: a.fp.headlineItalic });
    });
  } else {
    let fy = rowY + 12;
    if (a.copy.price_text) { s += textEl(a.W / 2, fy, 56, F_INTER, 700, CREAM, a.copy.price_text, { anchor: "middle" }); fy += 66; }
    if (a.copy.specs_text) s += textEl(a.W / 2, fy, 24, F_MONO, 700, "rgba(250,248,243,0.85)", a.copy.specs_text.toUpperCase(), { tracking: 2, anchor: "middle" });
  }
  s += aiLabel(a.W, a.copy.label_text);
  return DEFS + s;
}

const VALID_COMPOSITIONS = ["full_bleed", "bottom_panel", "side_panel", "framed", "split", "collage", "showcase", "feature", "new_listing", "magazine", "editorial", "postcard", "band", "quote", "stat", "statement", "project", "price_hero", "launch_hero"];
const VALID_CONTENT = ["listing", "brand", "educational", "sold", "launch"];
const VALID_TEXT = ["on_photo", "scrim", "negative_space"];
const VALID_FONTSETS = ["serif", "sans", "mixed"];
const VALID_COLOR = ["photo_only", "accent_line", "color_block"];
const NEED_TWO = ["split"];

async function toDataUri(bytes: Uint8Array, mime: string): Promise<string> {
  let bin = ""; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return `data:${mime};base64,${btoa(bin)}`;
}

async function loadPhoto(admin: any, storagePath: string | undefined, urlVal: string | undefined): Promise<string | null> {
  try {
    if (storagePath) {
      const { data, error } = await admin.storage.from(BUCKET).download(storagePath);
      if (error || !data) return null;
      return await toDataUri(new Uint8Array(await data.arrayBuffer()), data.type || "image/jpeg");
    }
    if (urlVal && urlVal.startsWith("http")) {
      const r = await fetch(urlVal); if (!r.ok) return null;
      return await toDataUri(new Uint8Array(await r.arrayBuffer()), r.headers.get("content-type") || "image/jpeg");
    }
  } catch { return null; }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return j(405, { ok: false, error: "method_not_allowed", message: "Use POST." });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const presented = req.headers.get("x-internal-secret") ?? "";
  const { data: expected } = await admin.rpc("_get_platform_secret", { p_name: "IMAGE_GEN_INTERNAL_SECRET" });
  if (!expected || !constantTimeEqual(presented, expected)) return j(401, { ok: false, error: "unauthorized", message: "Authentication failed." });

  let body: any;
  try { body = await req.json(); } catch { return j(400, { ok: false, error: "invalid_json", message: "Request body must be valid JSON." }); }

  const composition = body?.composition;
  const contentType = body?.content_type ?? "listing";
  if (!VALID_COMPOSITIONS.includes(composition)) return j(400, { ok: false, error: "invalid_composition", message: "Unknown composition." });
  if (!VALID_CONTENT.includes(contentType)) return j(400, { ok: false, error: "invalid_content_type", message: "Unknown content type." });
  const textTreatment = VALID_TEXT.includes(body?.text_treatment) ? body.text_treatment : "on_photo";
  const fontSet = VALID_FONTSETS.includes(body?.font_set) ? body.font_set : "serif";
  const colorTreatment = VALID_COLOR.includes(body?.color_treatment) ? body.color_treatment : "photo_only";

  const W = Number.isInteger(body?.width) ? body.width : 1080;
  const H = Number.isInteger(body?.height) ? body.height : 1350;
  if (W < 400 || W > 2048 || H < 400 || H > 2048) return j(400, { ok: false, error: "invalid_size", message: "Size out of range." });
  const outPath: string = body?.out_path;
  if (!outPath || typeof outPath !== "string" || outPath.includes("..")) return j(400, { ok: false, error: "invalid_out_path", message: "Output path is required." });

  const copy: Copy = { ...(body?.copy ?? {}) };
  const brand: Brand = { name: "AIVENA", ...(body?.brand ?? {}) };
  const primary = brand.primary_color || INK;
  const accent = brand.accent_color || "#0B7C3A";
  const badgeLabel: string = typeof body?.badge_label === "string" && body.badge_label ? body.badge_label : "New listing";
  const palette: Record<string, string> = (body?.palette && typeof body.palette === "object" && !Array.isArray(body.palette)) ? body.palette : {};

  const sp = body?.image_storage_path; const iu = body?.image_url;
  const spArr: (string | undefined)[] = Array.isArray(sp) ? sp : sp ? [sp] : [];
  const iuArr: (string | undefined)[] = Array.isArray(iu) ? iu : iu ? [iu] : [];
  const count = Math.max(spArr.length, iuArr.length, 1);
  const photos: string[] = [];
  for (let i = 0; i < count; i++) {
    const p = await loadPhoto(admin, spArr[i], iuArr[i]);
    if (p) photos.push(p);
  }
  if (photos.length === 0) return j(422, { ok: false, error: "photo_unavailable", message: "The source photo couldn't be loaded." });
  if (NEED_TWO.includes(composition) && photos.length < 2) return j(400, { ok: false, error: "need_two_photos", message: "This layout needs at least two photos." });

  try {
    ensureAssets(); await wasmReady; const fonts = await fontsReady!;
    const fp = fontPlan(fontSet);
    const args: RenderArgs = { photos, copy, brand, W, H, fp, primary, accent, colorTreatment, contentType, textTreatment, badgeLabel, palette };
    let inner: string;
    switch (composition) {
      case "bottom_panel": inner = compBottomPanel(args); break;
      case "side_panel":   inner = compSidePanel(args); break;
      case "framed":       inner = compFramed(args); break;
      case "split":        inner = compSplit(args); break;
      case "collage":      inner = compCollage(args); break;
      case "showcase":     inner = compShowcase(args); break;
      case "feature":      inner = compFeature(args); break;
      case "new_listing":  inner = compNewListing(args); break;
      case "magazine":     inner = compMagazine(args); break;
      case "editorial":    inner = compEditorial(args); break;
      case "postcard":     inner = compPostcard(args); break;
      case "band":         inner = compBand(args); break;
      case "quote":        inner = compQuote(args); break;
      case "stat":         inner = compStat(args); break;
      case "statement":    inner = compStatement(args); break;
      case "project":      inner = compProject(args); break;
      case "price_hero":   inner = compPriceHero(args); break;
      case "launch_hero":  inner = compLaunchHero(args); break;
      default:             inner = compFullBleed(args);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inner}</svg>`;
    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: W }, font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: "Inter" } });
    const png = resvg.render().asPng();
    const { error: upErr } = await admin.storage.from(BUCKET).upload(outPath, png, { contentType: "image/png", upsert: true });
    if (upErr) return j(500, { ok: false, error: "storage_upload_failed", message: "The image couldn't be saved. Please try again." });
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(outPath, SIGNED_TTL);
    return j(200, { ok: true, storage_path: outPath, signed_url: signed?.signedUrl ?? null, bytes: png.length, width: W, height: H, composition, content_type: contentType });
  } catch (e) {
    console.error("compose_failed:", (e as Error)?.message);
    return j(500, { ok: false, error: "compose_failed", message: "The design couldn't be rendered. Please try again." });
  }
});
