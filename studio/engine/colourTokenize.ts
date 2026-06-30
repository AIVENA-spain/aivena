import fs from "node:fs";
import path from "node:path";
import { abs } from "../src/lib/paths";
import { renderTemplatePng, pngToRGBA, RGBA } from "../src/lib/render";
import { lumaAt } from "../src/lib/ink";

// Role-agnostic colour-tokenization foundation. Reads a template's baked fills, samples the ACTUAL colour
// per content region (render-based — robust to light/dark polarity, unlike a darkest=bg heuristic), and maps
// them to the flexible editable ROLE SET. Each role is a SEPARATE token even when two roles share the same
// hex — so the colour wheel can recolour them independently. Output: studio/intake/<n>/colour_tokens.draft.json.
// The agency palette = { role -> hex }; the engine resolves token -> hex at render. No bucket writes/deploy.

export const ROLE_SET = ["background", "overlay", "title", "subtitle/body", "accent", "badge.fill", "badge.text", "divider", "icon", "stat.label", "stat.value", "cta"] as const;
export type Role = (typeof ROLE_SET)[number];
const LOCKED_DEFAULT = new Set<Role>(["overlay", "icon"]); // recolourable by default EXCEPT these (still unlockable)

const stripImages = (svg: string) => svg.replace(/<image\b[^>]*\/>/g, "").replace(/<image\b[^>]*>[\s\S]*?<\/image>/g, "");
const toHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

function quant(r: number, g: number, b: number): number { return ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4); } // 16-level/channel (255>>4=15)
function unquant(q: number): [number, number, number] { return [((q >> 8) & 15) * 17, ((q >> 4) & 15) * 17, (q & 15) * 17]; }

interface ModalOpts { box?: { x0: number; y0: number; x1: number; y1: number }; bgLuma?: number; minContrast?: number; }
// modal quantized colour. With minContrast, only counts pixels whose luma differs from bgLuma by >minContrast
// (so a thin dark headline beats a large light panel inside a text region — the panel is low-contrast vs bg).
function modalColour(img: RGBA, opts: ModalOpts = {}): [number, number, number] | null {
  const { box, bgLuma, minContrast } = opts;
  const hist: Record<number, number> = {};
  const x0 = box ? Math.max(0, box.x0) : 0, y0 = box ? Math.max(0, box.y0) : 0;
  const x1 = box ? Math.min(img.width - 1, box.x1) : img.width - 1, y1 = box ? Math.min(img.height - 1, box.y1) : img.height - 1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * img.width + x) * 4; if (img.data[i + 3] < 128) continue;
    if (minContrast !== undefined && bgLuma !== undefined && Math.abs(lumaAt(img.data, i) - bgLuma) < minContrast) continue;
    const q = quant(img.data[i], img.data[i + 1], img.data[i + 2]);
    hist[q] = (hist[q] || 0) + 1;
  }
  let best = -1, bn = 0; for (const k of Object.keys(hist)) { const q = +k; if (hist[q] > bn) { bn = hist[q]; best = q; } }
  return best < 0 ? null : unquant(best);
}
const hexLuma = (c: [number, number, number]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

export interface TokenisedColours { template_id: string; generated_by: string; background_hex: string; dominant_ink_hex: string; tokens: Record<string, { default: string; locked: boolean; sampled: boolean }>; }

export async function tokenizeColours(templateId: string, svgPath: string, regions: { candidate_type: string; bbox: number[] }[]): Promise<TokenisedColours> {
  const svg = fs.readFileSync(svgPath, "utf8");
  const head = svg.slice(0, 4000);
  const W = Math.round(Number((head.match(/\bwidth="([\d.]+)"/) || [])[1] || 1080));
  const img = await pngToRGBA(renderTemplatePng(stripImages(svg), W, "#7f7f7f"), false); // neutral bg surfaces both polarities
  const bg = modalColour(img)!;
  const bgLuma = hexLuma(bg);
  const ink = modalColour(img, { bgLuma, minContrast: 60 }) || bg; // dominant HIGH-CONTRAST colour = the text/ink
  const bgHex = toHex(bg[0], bg[1], bg[2]), inkHex = toHex(ink[0], ink[1], ink[2]);

  // map a region's heuristic type -> a role to sample from (sample the high-contrast ink in that region)
  const typeToRole: Record<string, Role> = { title: "title", "subtitle/body": "subtitle/body", stat: "stat.value", badge: "badge.text", label: "accent" };
  const sampled: Partial<Record<Role, string>> = {};
  for (const r of regions) {
    const role = typeToRole[r.candidate_type]; if (!role) continue;
    const c = modalColour(img, { box: { x0: r.bbox[0], y0: r.bbox[1], x1: r.bbox[2], y1: r.bbox[3] }, bgLuma, minContrast: 60 });
    if (c) sampled[role] = toHex(c[0], c[1], c[2]);
  }

  // defaults per role: background/overlay = bg; ink-ish roles = sampled or dominant ink; badge.fill = bg.
  const tokens: TokenisedColours["tokens"] = {};
  for (const role of ROLE_SET) {
    let def = inkHex, samp = false;
    if (role === "background" || role === "overlay" || role === "badge.fill") def = bgHex;
    if (sampled[role]) { def = sampled[role]!; samp = true; }
    tokens[role] = { default: def, locked: LOCKED_DEFAULT.has(role), sampled: samp };
  }
  return { template_id: templateId, generated_by: "studio/engine/colourTokenize.ts", background_hex: bgHex, dominant_ink_hex: inkHex, tokens };
}

if (require.main === module) {
  (async () => {
    const id = process.argv[2] || "11";
    const draftPath = abs(`intake/${id}/template.draft.json`);
    if (!fs.existsSync(draftPath)) throw new Error(`no autoIntake draft for ${id} (run autoIntake.ts)`);
    const draft = JSON.parse(fs.readFileSync(draftPath, "utf8"));
    const svgPath = abs(`out/bucket/${id}.tokenized.svg`);
    const tk = await tokenizeColours(id, svgPath, draft.text_regions);
    fs.mkdirSync(path.dirname(draftPath), { recursive: true });
    fs.writeFileSync(abs(`intake/${id}/colour_tokens.draft.json`), JSON.stringify(tk, null, 2) + "\n");
    console.log(`== colour-tokenize ${id} ==  bg=${tk.background_hex} ink=${tk.dominant_ink_hex}`);
    for (const [role, t] of Object.entries(tk.tokens)) console.log(`  ${role.padEnd(14)} default=${t.default} locked=${t.locked} sampled=${t.sampled}`);
    console.log(`  wrote studio/intake/${id}/colour_tokens.draft.json`);
  })().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
