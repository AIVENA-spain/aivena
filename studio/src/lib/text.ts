import { openFont, advanceWidth, ascentPx } from "./fonts";

// Apply {v}-style format + pluralize to a raw value. Body blocks (no format) pass through.
export function applyValue(rawValue: any, layer: any): string {
  if (layer.format == null) return String(rawValue);
  const n = Number(rawValue);
  let template = layer.format;
  if (layer.pluralize && !Number.isNaN(n) && n !== 1 && layer.pluralize.plural) template = layer.pluralize.plural;
  return template.replace("{v}", String(rawValue));
}

export interface WrapResult { lines: string[]; size: number; nLines: number; overflow: boolean; }

function greedyWrap(font: any, tokens: string[], size: number, tracking: number, boxW: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const tok of tokens) {
    const cand = cur ? cur + " " + tok : tok;
    if (!cur || advanceWidth(font, cand, size, tracking) <= boxW) cur = cand;
    else { lines.push(cur); cur = tok; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function widowFix(lines: string[]): void {
  if (lines.length < 2) return;
  const last = lines[lines.length - 1];
  const prev = lines[lines.length - 2];
  if (last.split(" ").length === 1 && prev.split(" ").length > 1) {
    const pw = prev.split(" ");
    const moved = pw.pop() as string;
    lines[lines.length - 2] = pw.join(" ");
    lines[lines.length - 1] = moved + " " + last;
  }
}

// Renderer owns fit: wrap to box width, widow-guard, auto-size down toward autosize_min.
// Returns null if it cannot fit even at autosize_min (caller -> gate G overflow FAIL).
export function wrapBlock(manifest: any, layer: any, text: string): WrapResult {
  const font = openFont(manifest, layer.font);
  const r = layer.render;
  const boxW = r.box[2];
  const boxTop = r.box[1];
  const tracking = r.tracking_px || 0;
  const minSize = r.autosize_min;
  // regular space breaks; U+00A0 (non-breaking) keeps a token intact (e.g. "55 m²")
  const tokens = text.split(" ");
  let last: { lines: string[]; size: number } = { lines: [text], size: minSize };
  for (let size = r.size; size >= minSize - 1e-6; size -= 0.5) {
    const lines = greedyWrap(font, tokens, size, tracking, boxW);
    if (r.widow_guard) widowFix(lines);
    last = { lines, size };
    const tooWide = lines.some((l) => advanceWidth(font, l, size, tracking) > boxW + 0.5);
    const topBaseline = r.baseline_last - (lines.length - 1) * r.line_spacing;
    const topY = topBaseline - ascentPx(font, size);
    if (!tooWide && topY >= boxTop - 0.5) return { lines, size, nLines: lines.length, overflow: false };
  }
  // did not fit at any size down to autosize_min -> min-size layout, flagged overflow
  return { lines: last.lines, size: last.size, nLines: last.lines.length, overflow: true };
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
