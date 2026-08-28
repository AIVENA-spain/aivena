// Specimen cards for the FIND YOUR STYLE game — the engine's REAL faces (the dashboard cannot
// load them as webfonts). Christian 2026-08-28: an earlier set locked every face to the same
// point size, so the delicate faces looked weak beside the heavy ones and the duel was unfair
// ("this right one doesnt look good… maybe big letters and bigger writing or more dramatic").
// Now every hero word is auto-fitted to the SAME width by the renderer's own shrink-to-fit, so
// each face is judged at equal optical presence — the only difference is its character.
import { writeFileSync, mkdirSync } from "fs";
import { renderFreeform, DesignSpec } from "./renderFreeform";

const OUT = "apps/dashboard/public/studio/taste";
const W = 800, H = 1000, M = 60;
const INK = "#1a2b4a", MUTED = "#8a8578", BODY = "#4a5568", GOLD = "#c8a24b", GROUND = "#f4f1ea";

// upper = display faces judged as posters set them (that IS how the engine uses them)
const FACES: Array<{ key: string; family: string; upper?: boolean; sans?: boolean }> = [
  { key: "playfair", family: "Playfair Display Medium" },
  { key: "prata", family: "Prata" },
  { key: "fraunces", family: "Fraunces 115pt" },
  { key: "caslon", family: "Libre Caslon Display" },
  { key: "anton", family: "Anton", upper: true },
  { key: "italiana", family: "Italiana", upper: true },
  { key: "archivo", family: "Archivo", sans: true },
  { key: "jost", family: "Jost", sans: true },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const f of FACES) {
    const hero = f.upper ? "MEDITERRÁNEO" : "Mediterráneo";
    const spec = DesignSpec.parse({
      background: GROUND,
      elements: [
        { type: "text", bbox: [M, 92, W - M, 122], content: "YOUR POSTS, SET IN THIS", font: "Jost", size: 19, colour: MUTED, align: "left", tracking: 6 },
        // size is deliberately oversized: the renderer shrinks each face to fill exactly this
        // box, so every specimen spans the same width whatever its natural proportions
        { type: "text", bbox: [M, 200, W - M, 470], content: hero, font: f.family, size: 240, colour: INK, align: "left", valign: "center", ...(f.upper ? { tracking: f.key === "italiana" ? 4 : 0 } : {}) },
        { type: "rect", bbox: [M, 530, M + 110, 533], fill: GOLD },
        { type: "text", bbox: [M, 590, W - M - 40, 800], content: "A house by the sea,\nin the right light.", font: f.family, size: 76, colour: BODY, align: "left", line_height: 100 },
        { type: "rect", bbox: [M, 880, W - M, 881], fill: INK, opacity: 0.12 },
        { type: "text", bbox: [M, 906, W - M, 934], content: f.sans ? "SMALL TEXT · CAPTIONS · LABELS" : "HEADLINES · TITLES · COVERS", font: "Jost", size: 17, colour: MUTED, align: "left", tracking: 4 },
      ],
    });
    writeFileSync(`${OUT}/${f.key}.png`, await renderFreeform(spec, { width: W, height: H }, []));
    console.log("specimen", f.key);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
