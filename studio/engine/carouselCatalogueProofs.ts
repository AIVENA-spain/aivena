// CATALOGUE-INSPIRED CAROUSEL PROOFS (Christian 2026-07-16): four styles drawn from his favourite
// templates — Cuarteto (#32: type woven between photo bands), Brisa (#25: editorial line-work),
// Riviera (#10: diagonal poster + azure medallion), Ventana (#13: the illustrated window + the cat).
// Show-first — proofs only. Run: npx tsx studio/engine/carouselCatalogueProofs.ts <outdir> <photoDir>
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { renderFreeform, DesignSpec } from "./renderFreeform";
import { applyGrain, mix, wrap } from "./carouselSlides";

const W = 1080, H = 1350;
const AGENCY = "MEDITERRÁNEO COSTA HOMES";
const FR = "Fraunces 115pt";
const CAS = "Libre Caslon Display";

function frame(b: [number, number, number, number], colour: string, w = 1.5, opacity?: number) {
  const [x0, y0, x1, y1] = b;
  const o = opacity !== undefined ? { opacity } : {};
  return [
    { type: "rect", bbox: [x0, y0, x1, y0 + w], fill: colour, ...o },
    { type: "rect", bbox: [x0, y1 - w, x1, y1], fill: colour, ...o },
    { type: "rect", bbox: [x0, y0, x0 + w, y1], fill: colour, ...o },
    { type: "rect", bbox: [x1 - w, y0, x1, y1], fill: colour, ...o },
  ];
}
function band(i: number, total: number, colour: string) {
  return [
    { type: "text", bbox: [80, 1272, 640, 1300], content: AGENCY, font: "Jost", size: 17, colour, align: "left", weight: "500", tracking: 4 },
    { type: "text", bbox: [640, 1272, 1000, 1300], content: `Nº ${String(i).padStart(2, "0")} — ${String(total).padStart(2, "0")}`, font: "Jost", size: 17, colour, align: "right", tracking: 3 },
  ];
}

// ═══ CUARTETO — type woven between photo bands (template #32 DNA) ═════════════
async function cuarteto(photos: Buffer[]): Promise<Buffer[]> {
  const CREAM = "#f3efe6", INK = "#23272f", TERRA = "#b5502e";
  const inner = (b: [number, number, number, number]) => frame([b[0] + 22, b[1] + 22, b[2] - 22, b[3] - 22], "#ffffff", 1.5, 0.85);
  const specs: any[] = [];

  // S1: giant "Villa in" above a photo band — the sentence starts, the swipe finishes it
  specs.push(DesignSpec.parse({
    background: CREAM,
    elements: [
      { type: "text", bbox: [70, 76, 700, 108], content: AGENCY, font: "Jost", size: 19, colour: mix(INK, CREAM, 0.6), align: "left", weight: "500", tracking: 5 },
      { type: "text", bbox: [700, 76, 1010, 108], content: "ALTEA · ALICANTE", font: "Jost", size: 19, colour: TERRA, align: "right", tracking: 4 },
      { type: "text", bbox: [60, 150, 1020, 420], content: "Villa in", font: CAS, size: 250, colour: INK, align: "left" },
      { type: "photo", photo: 0, bbox: [0, 470, 1080, 1160], tint: TERRA, tint_opacity: 0.06 },
      ...inner([0, 470, 1080, 1160]),
      { type: "text", bbox: [60, 1180, 1020, 1240], content: "…", font: CAS, size: 90, colour: TERRA, align: "right" },
      ...band(1, 5, mix(INK, CREAM, 0.55)),
    ],
  }));

  // S2: the sentence lands — photo band above, giant terracotta "Altea" below-right
  specs.push(DesignSpec.parse({
    background: CREAM,
    elements: [
      { type: "photo", photo: 1, bbox: [0, 90, 1080, 780], tint: TERRA, tint_opacity: 0.06 },
      ...inner([0, 90, 1080, 780]),
      { type: "text", bbox: [60, 820, 1020, 1120], content: "Altea", font: CAS, size: 270, colour: TERRA, align: "right" },
      { type: "text", bbox: [60, 1150, 1020, 1190], content: "3 DORM · 3 BAÑOS · 214 M²", font: "Jost", size: 21, colour: mix(INK, CREAM, 0.7), align: "left", tracking: 5 },
      ...band(2, 5, mix(INK, CREAM, 0.55)),
    ],
  }));

  // S3: two photo bands with the price woven between
  specs.push(DesignSpec.parse({
    background: CREAM,
    elements: [
      { type: "photo", photo: 2, bbox: [0, 80, 1080, 520], tint: TERRA, tint_opacity: 0.06 },
      ...inner([0, 80, 1080, 520]),
      { type: "text", bbox: [60, 560, 1020, 800], content: "€695.000", font: CAS, size: 190, colour: INK, align: "left" },
      { type: "photo", photo: 0, bbox: [0, 850, 1080, 1230], zoom: 1.6, x: 0.5, y: 0.7, tint: TERRA, tint_opacity: 0.06 },
      ...inner([0, 850, 1080, 1230]),
      ...band(3, 5, mix(INK, CREAM, 0.55)),
    ],
  }));

  // S4: la ficha — the quartet grid in miniature + facts
  const kpi: [string, string][] = [["PRECIO", "695.000 €"], ["SUPERFICIE", "214 m²"], ["DORMITORIOS", "3"], ["BAÑOS", "3"]];
  specs.push(DesignSpec.parse({
    background: CREAM,
    elements: [
      { type: "text", bbox: [60, 100, 1020, 300], content: "La ficha", font: CAS, size: 150, colour: INK, align: "left" },
      ...kpi.flatMap(([k, v], i) => {
        const y = 380 + i * 170;
        return [
          { type: "text", bbox: [70, y, 520, y + 34], content: k, font: "Jost", size: 21, colour: TERRA, align: "left", tracking: 5 },
          { type: "text", bbox: [420, y - 30, 1010, y + 70], content: v, font: CAS, size: 76, colour: INK, align: "right" },
          { type: "rect", bbox: [70, y + 104, 1010, y + 105.5], fill: mix(INK, CREAM, 0.25) },
        ];
      }),
      { type: "text", bbox: [70, 1120, 940, 1176], content: "Guarda la ficha para tu visita", font: "Jost", size: 26, colour: CREAM, align: "left", weight: "500", valign: "center", pill: { fill: TERRA, pad_x: 32, pad_y: 15 } },
      ...band(4, 5, mix(INK, CREAM, 0.55)),
    ],
  }));

  // S5: CTA — the closing line in the same giant serif
  specs.push(DesignSpec.parse({
    background: INK,
    elements: [
      { type: "text", bbox: [60, 200, 1020, 560], content: "¿La\nvemos?", font: CAS, size: 210, colour: CREAM, align: "left", line_height: 230 },
      { type: "rect", bbox: [70, 660, 400, 663], fill: TERRA },
      { type: "text", bbox: [70, 720, 1010, 840], content: "Envíaselo a la persona con quien vas a comprar.", font: "Jost", size: 32, colour: mix(CREAM, INK, 0.85), align: "left", line_height: 48 },
      { type: "text", bbox: [70, 920, 620, 980], content: "ESCRÍBENOS: ALTEA", font: "Jost", size: 25, colour: INK, align: "left", weight: "600", tracking: 3, valign: "center", pill: { fill: TERRA, pad_x: 40, pad_y: 20 } },
      { type: "text", bbox: [70, 1080, 1010, 1110], content: "mediterraneocostahomes.es · +34 600 999 066", font: "Jost", size: 21, colour: mix(CREAM, INK, 0.6), align: "left", tracking: 2 },
      ...band(5, 5, mix(CREAM, INK, 0.6)),
    ],
  }));

  const out: Buffer[] = [];
  for (const s of specs) out.push(await applyGrain(await renderFreeform(s, { width: W, height: H }, photos), 0.04));
  return out;
}

// ═══ BRISA — editorial line-work (template #25 DNA) ═══════════════════════════
async function brisa(photos: Buffer[]): Promise<Buffer[]> {
  const CREAM = "#f0ead987", G = "#f0ead9".slice(0, 7);
  const PAPER = "#f0ead9", INK = "#23272f", TERRA = "#c4644a", AZUL = "#2456c4", GOLDY = "#d9a13b";
  void CREAM; void G;
  const specs: any[] = [];

  // S1: the t40 cover translated — rings, waves over the photo edge, highlighter title
  specs.push(DesignSpec.parse({
    background: PAPER,
    elements: [
      { type: "doodle", bbox: [-60, -60, 300, 300], kind: "rings", colour: INK, accent: TERRA, stroke_width: 2 },
      { type: "photo", photo: 0, bbox: [150, 105, 1035, 840], tint: TERRA, tint_opacity: 0.06 },
      ...frame([150, 105, 1035, 840], INK, 2),
      { type: "doodle", bbox: [60, 760, 640, 880], kind: "wave", colour: INK, accent: TERRA, stroke_width: 2.5 },
      { type: "doodle", bbox: [990, 60, 1050, 120], kind: "plus", colour: AZUL, stroke_width: 3 },
      { type: "doodle", bbox: [30, 920, 80, 970], kind: "plus", colour: GOLDY, stroke_width: 3 },
      { type: "text", bbox: [30, 330, 62, 830], content: "VIDA MEDITERRÁNEA — COSTA BLANCA", font: "Jost", size: 19, colour: mix(INK, PAPER, 0.65), tracking: 5, rotate: -90, align: "center" },
      { type: "rect", bbox: [80, 878, 520, 972], fill: TERRA, radius: 18, rotate: -1 },
      { type: "text", bbox: [100, 892, 500, 958], content: "Villa in Altea", font: CAS, size: 58, colour: PAPER, align: "center", valign: "center" },
      { type: "text", bbox: [100, 1000, 700, 1032], content: "ALTEA · ALICANTE", font: "Jost", size: 21, colour: TERRA, align: "left", tracking: 6 },
      { type: "text", bbox: [100, 1060, 1000, 1110], content: "3 DORM  ·  3 BAÑOS  ·  214 M²", font: "Jost", size: 24, colour: INK, align: "left", tracking: 3 },
      { type: "text", bbox: [560, 1090, 1000, 1180], content: "€695.000", font: CAS, size: 74, colour: TERRA, align: "right" },
      { type: "rect", bbox: [80, 1215, 1000, 1217], fill: INK },
      { type: "doodle", bbox: [80, 1226, 240, 1262], kind: "dots_row", colour: INK },
      { type: "doodle", bbox: [930, 1150, 990, 1210], kind: "sparkle", colour: TERRA, stroke_width: 2.5 },
      ...band(1, 4, mix(INK, PAPER, 0.6)),
    ],
  }));

  // S2: photo + museum plate with the line-work vocabulary
  specs.push(DesignSpec.parse({
    background: PAPER,
    elements: [
      { type: "doodle", bbox: [880, -70, 1160, 210], kind: "rings", colour: TERRA, accent: AZUL, stroke_width: 2 },
      { type: "photo", photo: 1, bbox: [45, 120, 930, 855], tint: TERRA, tint_opacity: 0.06 },
      ...frame([45, 120, 930, 855], INK, 2),
      { type: "doodle", bbox: [430, 790, 1010, 905], kind: "wave", colour: INK, accent: AZUL, stroke_width: 2.5 },
      { type: "text", bbox: [80, 950, 700, 982], content: "EL SALÓN", font: "Jost", size: 21, colour: AZUL, align: "left", tracking: 7 },
      { type: "text", bbox: [80, 1010, 1000, 1170], content: "Luz de levante,\nsombra de parra", font: CAS, size: 72, colour: INK, align: "left", line_height: 88 },
      { type: "doodle", bbox: [880, 1000, 950, 1070], kind: "sparkle", colour: GOLDY, stroke_width: 2.5 },
      { type: "doodle", bbox: [-40, 1080, 220, 1340], kind: "arc", colour: AZUL, accent: TERRA, stroke_width: 2.5 },
      ...band(2, 4, mix(INK, PAPER, 0.6)),
    ],
  }));

  // S3: facts with highlighter blobs — every value gets its marker swipe
  const kpi: [string, string, string][] = [["PRECIO", "695.000 €", TERRA], ["SUPERFICIE", "214 m²", AZUL], ["DORMITORIOS", "3", GOLDY], ["BAÑOS", "3", TERRA]];
  specs.push(DesignSpec.parse({
    background: PAPER,
    elements: [
      { type: "text", bbox: [80, 110, 1000, 260], content: "Los datos", font: CAS, size: 110, colour: INK, align: "left" },
      { type: "doodle", bbox: [700, 90, 780, 170], kind: "sparkle", colour: TERRA, stroke_width: 3 },
      ...kpi.flatMap(([k, v, c], i) => {
        const y = 340 + i * 190;
        return [
          { type: "rect", bbox: [420, y - 18, 1000, y + 96], fill: c, radius: 16, opacity: 0.16, rotate: i % 2 ? 1 : -1 },
          { type: "text", bbox: [80, y + 8, 420, y + 42], content: k, font: "Jost", size: 21, colour: mix(INK, PAPER, 0.7), align: "left", tracking: 5 },
          { type: "text", bbox: [440, y - 24, 980, y + 84], content: v, font: CAS, size: 80, colour: INK, align: "right" },
        ];
      }),
      { type: "doodle", bbox: [80, 1130, 240, 1166], kind: "dots_row", colour: INK },
      { type: "text", bbox: [300, 1108, 1000, 1164], content: "Guárdalos para tu visita", font: "Jost", size: 25, colour: PAPER, align: "center", weight: "500", valign: "center", pill: { fill: INK, pad_x: 34, pad_y: 15 } },
      ...band(3, 4, mix(INK, PAPER, 0.6)),
    ],
  }));

  // S4: CTA — the flourish finale
  specs.push(DesignSpec.parse({
    background: PAPER,
    elements: [
      { type: "doodle", bbox: [-80, -80, 340, 340], kind: "rings", colour: AZUL, accent: TERRA, stroke_width: 2 },
      { type: "doodle", bbox: [850, 120, 1040, 250], kind: "birds", colour: INK, stroke_width: 3 },
      { type: "text", bbox: [80, 380, 1000, 700], content: "¿Hablamos\nde Altea?", font: CAS, size: 130, colour: INK, align: "left", line_height: 150 },
      { type: "rect", bbox: [76, 560, 560, 640], fill: TERRA, radius: 14, opacity: 0.2, rotate: -1 },
      { type: "text", bbox: [80, 780, 1000, 880], content: "Envíaselo a quien busca casa contigo.", font: "Jost", size: 30, colour: mix(INK, PAPER, 0.85), align: "left", line_height: 44 },
      { type: "text", bbox: [80, 950, 620, 1010], content: "ESCRÍBENOS: BRISA", font: "Jost", size: 25, colour: PAPER, align: "left", weight: "600", tracking: 3, valign: "center", pill: { fill: AZUL, pad_x: 40, pad_y: 20 } },
      { type: "doodle", bbox: [700, 940, 1020, 1050], kind: "wave", colour: INK, accent: TERRA, stroke_width: 2.5 },
      { type: "text", bbox: [80, 1090, 1010, 1120], content: "mediterraneocostahomes.es · +34 600 999 066", font: "Jost", size: 21, colour: mix(INK, PAPER, 0.6), align: "left", tracking: 2 },
      ...band(4, 4, mix(INK, PAPER, 0.6)),
    ],
  }));

  const out: Buffer[] = [];
  for (const s of specs) out.push(await applyGrain(await renderFreeform(s, { width: W, height: H }, photos), 0.04));
  return out;
}

// ═══ RIVIERA — diagonal poster + azure medallion (template #10 DNA) ═══════════
async function riviera(photos: Buffer[]): Promise<Buffer[]> {
  const OFF = "#f4f2ec", INK = "#101114", AZUL = "#2456c4";
  const diag = (y: number) => ({ type: "rect", bbox: [-200, y, 1280, y + 90], fill: OFF, rotate: -7 });
  const specs: any[] = [];

  // S1: two full-bleeds split by the white diagonal, medallion price, Anton footer title
  specs.push(DesignSpec.parse({
    background: OFF,
    elements: [
      { type: "photo", photo: 0, bbox: [0, 0, 1080, 660] },
      { type: "photo", photo: 1, bbox: [0, 640, 1080, 1120] },
      diag(600),
      { type: "text", bbox: [70, 640, 500, 690], content: "NEW LISTING", font: "Jost", size: 24, colour: AZUL, align: "left", weight: "600", tracking: 6, rotate: -7 },
      { type: "rect", bbox: [720, 540, 1010, 660], fill: AZUL, radius: 60, rotate: -7 },
      { type: "text", bbox: [720, 575, 1010, 630], content: "€695.000", font: "Jost", size: 40, colour: OFF, align: "center", weight: "600", rotate: -7 },
      { type: "rect", bbox: [0, 1120, 1080, 1350], fill: OFF },
      { type: "rect", bbox: [70, 1128, 200, 1136], fill: AZUL },
      { type: "text", bbox: [66, 1150, 1014, 1260], content: "VILLA IN ALTEA", font: "Anton", size: 96, colour: INK, align: "left" },
      ...band(1, 4, mix(INK, OFF, 0.6)),
    ],
  }));

  // S2: inverted diagonal — feature slide
  specs.push(DesignSpec.parse({
    background: OFF,
    elements: [
      { type: "rect", bbox: [0, 0, 1080, 300], fill: OFF },
      { type: "text", bbox: [70, 90, 1010, 190], content: "ALTEA · 2 MIN", font: "Anton", size: 84, colour: INK, align: "left" },
      { type: "text", bbox: [70, 200, 1010, 240], content: "DEL CASCO ANTIGUO A LA PISCINA", font: "Jost", size: 22, colour: AZUL, align: "left", tracking: 5, weight: "600" },
      { type: "photo", photo: 2, bbox: [0, 300, 1080, 1140] },
      { type: "rect", bbox: [-200, 1080, 1280, 1170], fill: OFF, rotate: 7 },
      { type: "rect", bbox: [700, 1010, 1010, 1120], fill: AZUL, radius: 56, rotate: 7 },
      { type: "text", bbox: [700, 1042, 1010, 1094], content: "214 M²", font: "Jost", size: 38, colour: OFF, align: "center", weight: "600", rotate: 7 },
      { type: "text", bbox: [70, 1190, 1010, 1240], content: "3 DORM · 3 BAÑOS · PISCINA PRIVADA", font: "Jost", size: 24, colour: INK, align: "left", tracking: 4 },
      ...band(2, 4, mix(INK, OFF, 0.6)),
    ],
  }));

  // S3: poster facts — Anton stack with azure pills
  const kpi: [string, string][] = [["PRECIO", "€695.000"], ["SUPERFICIE", "214 M²"], ["DORMITORIOS", "3"], ["BAÑOS", "3"]];
  specs.push(DesignSpec.parse({
    background: INK,
    elements: [
      { type: "rect", bbox: [-200, 130, 1280, 220], fill: AZUL, rotate: -7 },
      { type: "text", bbox: [70, 150, 1010, 205], content: "LA FICHA COMPLETA", font: "Anton", size: 52, colour: OFF, align: "center", rotate: -7 },
      ...kpi.flatMap(([k, v], i) => {
        const y = 340 + i * 190;
        return [
          { type: "text", bbox: [80, y, 520, y + 40], content: k, font: "Jost", size: 22, colour: mix(OFF, INK, 0.6), align: "left", tracking: 5, valign: "center" },
          { type: "text", bbox: [420, y - 40, 1000, y + 90], content: v, font: "Anton", size: 96, colour: OFF, align: "right" },
          { type: "rect", bbox: [80, y + 128, 1000, y + 130], fill: AZUL, opacity: 0.6 },
        ];
      }),
      { type: "text", bbox: [230, 1130, 850, 1186], content: "GUÁRDALA PARA TU VISITA", font: "Jost", size: 23, colour: INK, align: "center", weight: "600", tracking: 3, valign: "center", pill: { fill: OFF, pad_x: 36, pad_y: 16 } },
      ...band(3, 4, mix(OFF, INK, 0.6)),
    ],
  }));

  // S4: CTA — azure field, the diagonal hands the deck back
  specs.push(DesignSpec.parse({
    background: AZUL,
    elements: [
      { type: "text", bbox: [70, 220, 1010, 480], content: "¿TE VIENES\nA VERLA?", font: "Anton", size: 130, colour: OFF, align: "left", line_height: 148 },
      { type: "rect", bbox: [-200, 620, 1280, 710], fill: OFF, rotate: -7 },
      { type: "text", bbox: [70, 655, 1010, 700], content: "ESCRÍBENOS: RIVIERA", font: "Anton", size: 46, colour: AZUL, align: "center", rotate: -7, tracking: 3 },
      { type: "text", bbox: [70, 830, 1010, 940], content: "Envíaselo a la persona con quien vas a comprar.", font: "Jost", size: 30, colour: OFF, align: "left", line_height: 44 },
      { type: "text", bbox: [70, 1050, 1010, 1080], content: "MEDITERRANEOCOSTAHOMES.ES · +34 600 999 066", font: "Jost", size: 20, colour: mix(OFF, AZUL, 0.85), align: "left", tracking: 3 },
      ...band(4, 4, mix(OFF, AZUL, 0.85)),
    ],
  }));

  const out: Buffer[] = [];
  for (const s of specs) out.push(await applyGrain(await renderFreeform(s, { width: W, height: H }, photos), 0.035));
  return out;
}

// ═══ VENTANA — the illustrated window + the cat (template #13 DNA) ════════════
async function ventana(photos: Buffer[]): Promise<Buffer[]> {
  const PAPER = "#f0ecdf", INK = "#2b2b26", OLIVEV = "#6d7a55", TERRA = "#c05f3c", DARK = "#33352c";
  const shutters = (x0: number, x1: number, y0: number, y1: number) => {
    const els: any[] = [{ type: "rect", bbox: [x0, y0, x1, y1], fill: OLIVEV, radius: 6 }];
    const n = Math.floor((y1 - y0 - 40) / 34);
    for (let i = 0; i < n; i++) els.push({ type: "rect", bbox: [x0 + 16, y0 + 26 + i * 34, x1 - 16, y0 + 26 + i * 34 + 14], fill: mix(INK, OLIVEV, 0.35), radius: 7 });
    return els;
  };
  const specs: any[] = [];

  // S1: the window cover — arch photo, muntins, shutters, sill, pot, THE CAT
  specs.push(DesignSpec.parse({
    background: PAPER,
    elements: [
      { type: "text", bbox: [80, 84, 1000, 118], content: AGENCY, font: "Jost", size: 21, colour: INK, align: "center", weight: "500", tracking: 6 },
      { type: "doodle", bbox: [90, 150, 230, 250], kind: "birds", colour: INK, stroke_width: 3 },
      { type: "photo", photo: 0, bbox: [240, 170, 840, 810], tint: TERRA, tint_opacity: 0.06 },
      { type: "punch", bbox: [240, 170, 840, 810], fill: PAPER, shape: "arch" },
      // muntins: arch outline + horizontal + vertical bars
      ...frame([240, 470, 840, 810], DARK, 5),
      { type: "rect", bbox: [536, 200, 544, 810], fill: DARK },
      { type: "rect", bbox: [240, 620, 840, 627], fill: DARK },
      // shutters + sill
      ...shutters(120, 236, 460, 860),
      ...shutters(844, 960, 460, 860),
      { type: "rect", bbox: [100, 856, 980, 900], fill: mix("#ffffff", PAPER, 0.7), radius: 8 },
      { type: "doodle", bbox: [230, 742, 330, 862], kind: "pot_plant", colour: TERRA, accent: OLIVEV },
      { type: "doodle", bbox: [700, 738, 820, 866], kind: "cat", colour: INK },
      { type: "text", bbox: [80, 950, 1000, 982], content: "ALTEA · ALICANTE", font: "Jost", size: 21, colour: TERRA, align: "center", tracking: 7 },
      { type: "text", bbox: [120, 1010, 960, 1120], content: "Villa in Altea", font: CAS, size: 92, colour: INK, align: "center" },
      { type: "text", bbox: [120, 1140, 960, 1220], content: "€695.000", font: CAS, size: 64, colour: TERRA, align: "center" },
      ...band(1, 4, mix(INK, PAPER, 0.55)),
    ],
  }));

  // S2: the porthole window — detail + facts line
  specs.push(DesignSpec.parse({
    background: PAPER,
    elements: [
      { type: "photo", photo: 1, bbox: [290, 140, 790, 640], tint: TERRA, tint_opacity: 0.06 },
      { type: "punch", bbox: [290, 140, 790, 640], fill: PAPER, shape: "circle" },
      ...frame([290, 388, 790, 392], DARK, 4),
      { type: "rect", bbox: [536, 140, 544, 640], fill: DARK },
      { type: "doodle", bbox: [770, 560, 890, 690], kind: "cat", colour: INK },
      { type: "doodle", bbox: [180, 590, 270, 700], kind: "pot_plant", colour: TERRA, accent: OLIVEV },
      { type: "rect", bbox: [160, 686, 920, 720], fill: mix("#ffffff", PAPER, 0.7), radius: 8 },
      { type: "text", bbox: [80, 790, 1000, 822], content: "EL SALÓN", font: "Jost", size: 21, colour: OLIVEV, align: "center", tracking: 7 },
      { type: "text", bbox: [110, 860, 970, 1050], content: "Luz de levante\ny suelos de madera", font: CAS, size: 70, colour: INK, align: "center", line_height: 86 },
      { type: "text", bbox: [80, 1100, 1000, 1140], content: "3 DORM · 3 BAÑOS · 214 M²", font: "Jost", size: 22, colour: mix(INK, PAPER, 0.7), align: "center", tracking: 5 },
      ...band(2, 4, mix(INK, PAPER, 0.55)),
    ],
  }));

  // S3: the facts as little windows
  const kpi: [string, string][] = [["PRECIO", "695.000 €"], ["M²", "214"], ["DORM", "3"], ["BAÑOS", "3"]];
  specs.push(DesignSpec.parse({
    background: PAPER,
    elements: [
      { type: "text", bbox: [80, 110, 1000, 150], content: "LA CASA, EN CUATRO VENTANAS", font: "Jost", size: 21, colour: TERRA, align: "center", tracking: 6 },
      ...kpi.flatMap(([k, v], i) => {
        const x = 110 + (i % 2) * 460, y = 230 + Math.floor(i / 2) * 420;
        return [
          { type: "rect", bbox: [x, y, x + 400, y + 330], fill: mix("#ffffff", PAPER, 0.6), radius: 10 },
          ...frame([x + 14, y + 14, x + 386, y + 316], DARK, 4),
          { type: "rect", bbox: [x + 196, y + 14, x + 204, y + 316], fill: DARK },
          { type: "rect", bbox: [x + 14, y + 160, x + 386, y + 167], fill: DARK },
          { type: "text", bbox: [x + 30, y + 40, x + 370, y + 150], content: v, font: CAS, size: 74, colour: INK, align: "center", valign: "center" },
          { type: "text", bbox: [x + 30, y + 220, x + 370, y + 260], content: k, font: "Jost", size: 22, colour: OLIVEV, align: "center", tracking: 5 },
        ];
      }),
      { type: "doodle", bbox: [480, 1090, 600, 1220], kind: "cat", colour: INK },
      ...band(3, 4, mix(INK, PAPER, 0.55)),
    ],
  }));

  // S4: CTA — shutters closing, the cat stays
  specs.push(DesignSpec.parse({
    background: PAPER,
    elements: [
      ...shutters(80, 330, 180, 900),
      ...shutters(750, 1000, 180, 900),
      { type: "text", bbox: [340, 300, 740, 340], content: "ÚLTIMA VENTANA", font: "Jost", size: 20, colour: TERRA, align: "center", tracking: 6 },
      { type: "text", bbox: [340, 380, 740, 660], content: "¿La ves\nen vivo?", font: CAS, size: 92, colour: INK, align: "center", line_height: 112 },
      { type: "text", bbox: [355, 720, 725, 776], content: "ESCRÍBENOS: VENTANA", font: "Jost", size: 22, colour: PAPER, align: "center", weight: "600", tracking: 2, valign: "center", pill: { fill: TERRA, pad_x: 30, pad_y: 16 } },
      { type: "rect", bbox: [60, 896, 1020, 936], fill: mix("#ffffff", PAPER, 0.7), radius: 8 },
      { type: "doodle", bbox: [620, 780, 740, 906], kind: "cat", colour: INK },
      { type: "doodle", bbox: [330, 800, 420, 910], kind: "pot_plant", colour: TERRA, accent: OLIVEV },
      { type: "text", bbox: [80, 1000, 1000, 1100], content: "Envíaselo a quien sueña con esta ventana.", font: "Jost", size: 30, colour: mix(INK, PAPER, 0.85), align: "center", line_height: 44 },
      { type: "text", bbox: [80, 1150, 1000, 1180], content: "mediterraneocostahomes.es · +34 600 999 066", font: "Jost", size: 21, colour: mix(INK, PAPER, 0.6), align: "center", tracking: 2 },
      ...band(4, 4, mix(INK, PAPER, 0.55)),
    ],
  }));

  const out: Buffer[] = [];
  for (const s of specs) out.push(await applyGrain(await renderFreeform(s, { width: W, height: H }, photos), 0.045));
  return out;
}

async function main() {
  const outdir = process.argv[2] ?? "studio/out/carousel-catalogue";
  const photoDir = process.argv[3] ?? "";
  mkdirSync(outdir, { recursive: true });
  const p = (f: string) => readFileSync(join(photoDir, f));
  const photos = [p("altea_ext.jpg"), p("altea_int1.jpg"), p("altea_int2.jpg")];
  const save = async (name: string, slides: Buffer[]) => {
    for (let i = 0; i < slides.length; i++) {
      writeFileSync(join(outdir, `${name}-${i + 1}.jpg`), await sharp(slides[i]).resize({ width: 540 }).jpeg({ quality: 82 }).toBuffer());
    }
    console.log(`${name}: ${slides.length} slides`);
  };
  await save("cuarteto", await cuarteto(photos));
  await save("brisa", await brisa(photos));
  await save("riviera", await riviera(photos));
  await save("ventana", await ventana(photos));
}
main().catch((e) => { console.error(e); process.exit(1); });
