// BOLD CAROUSEL PROOFS round 2 (Christian 2026-07-16: "4 more templates thats even bolder and more
// visually creative"). Four decks: Plano (blueprint annotations), Portada (the property as a magazine
// issue), Recorte (structured scrapbook), Marea (typographic maximalism). Show-first — proofs only.
// Run: npx tsx studio/engine/carouselBoldProofs.ts <outdir> <photoDir>
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { renderFreeform, DesignSpec } from "./renderFreeform";
import { applyGrain, mix, wrap } from "./carouselSlides";

const W = 1080, H = 1350;
const NAVY = "#1f3a5f", GOLD = "#c9a227", CREAM = "#f6f1e7";
const LIME = "#f4efe6", TERRA = "#c96a4a";
const AGENCY = "MEDITERRÁNEO COSTA HOMES";
const FR = "Fraunces 115pt";

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
function seal(cx: number, cy: number, r: number, ring: string, ground: string, initials: string) {
  const c = (rr: number, fill: string) => ({ type: "rect", bbox: [cx - rr, cy - rr, cx + rr, cy + rr], fill, radius: rr });
  return [
    c(r, ring), c(r - 2, ground), c(r - 12, ring), c(r - 14, ground),
    { type: "text", bbox: [cx - r, cy - 20, cx + r, cy + 20], content: initials, font: "Jost", size: 24, colour: ring, align: "center", tracking: 5, valign: "center" },
  ];
}
function band(i: number, total: number, colour: string) {
  return [
    { type: "text", bbox: [80, 1272, 640, 1300], content: AGENCY, font: "Jost", size: 17, colour, align: "left", weight: "500", tracking: 4 },
    { type: "text", bbox: [640, 1272, 1000, 1300], content: `Nº ${String(i).padStart(2, "0")} — ${String(total).padStart(2, "0")}`, font: "Jost", size: 17, colour, align: "right", tracking: 3 },
  ];
}
/** boxed micro-label with a hairline connector — the Plano annotation unit (paper fill for contrast) */
function callout(x: number, y: number, w: number, text: string, colour: string, toX: number, toY: number, paper?: string) {
  const hairline = Math.abs(toY - y) > Math.abs(toX - x)
    ? { type: "rect", bbox: [Math.min(x + w / 2, toX), Math.min(y, toY), Math.min(x + w / 2, toX) + 1, Math.max(y, toY)], fill: colour, opacity: 0.7 }
    : { type: "rect", bbox: [Math.min(x, toX), Math.min(y + 20, toY), Math.max(x, toX), Math.min(y + 20, toY) + 1], fill: colour, opacity: 0.7 };
  return [
    hairline,
    ...(paper ? [{ type: "rect", bbox: [x, y, x + w, y + 42], fill: paper, opacity: 0.82 }] : []),
    ...frame([x, y, x + w, y + 42], colour, 1),
    { type: "text", bbox: [x + 12, y, x + w - 12, y + 42], content: text, font: "Archivo", size: 17, colour, align: "left", tracking: 3, valign: "center" },
  ];
}

// ═══ PLANO — the property as an annotated blueprint ═══════════════════════════
async function plano(photos: Buffer[]): Promise<Buffer[]> {
  const inkC = CREAM;
  const specs: any[] = [];

  // S1 cover: giant numeral + boxed annotations with connectors, engineering-drawing energy
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      ...frame([40, 40, 1040, 1310], GOLD, 1, 0.4),
      { type: "text", bbox: [70, 250, 1010, 900], content: "214", font: FR, size: 560, colour: inkC, align: "center" },
      { type: "text", bbox: [70, 860, 1010, 900], content: "M² QUE CAMBIAN CÓMO VIVES", font: "Anton", size: 52, colour: GOLD, align: "center" },
      ...callout(90, 150, 300, "REF · IC-28746", GOLD, 240, 320),
      ...callout(700, 150, 290, "ALTEA · ALICANTE", GOLD, 840, 320),
      ...callout(90, 1000, 320, "ORIENTACIÓN · SUR", GOLD, 240, 900),
      ...callout(640, 1000, 350, "37.86 N · -0.10 W", GOLD, 800, 900),
      // measurement ticks along the numeral's baseline
      ...Array.from({ length: 21 }, (_, i) => ({ type: "rect", bbox: [90 + i * 45, 940, 91.5 + i * 45, i % 5 === 0 ? 962 : 952], fill: GOLD, opacity: 0.7 })),
      { type: "text", bbox: [80, 1090, 1000, 1130], content: "VILLA · 695.000 € · 3 DORM · 3 BAÑOS", font: "Archivo", size: 22, colour: inkC, align: "center", tracking: 5 },
      ...band(1, 5, mix(CREAM, NAVY, 0.6)),
    ],
  }));

  // S2: the annotated hero — ticks on two edges + boxed feature callouts over the photo
  specs.push(DesignSpec.parse({
    background: LIME,
    elements: [
      { type: "photo", photo: 0, bbox: [90, 160, 990, 1010], tint: NAVY, tint_opacity: 0.1 },
      ...frame([90, 160, 990, 1010], NAVY, 1.5),
      ...Array.from({ length: 19 }, (_, i) => ({ type: "rect", bbox: [90 + i * 47.4, 1022, 91.5 + i * 47.4, i % 5 === 0 ? 1046 : 1036], fill: NAVY, opacity: 0.7 })),
      ...Array.from({ length: 17 }, (_, i) => ({ type: "rect", bbox: [66, 160 + i * 50, 76, 161.5 + i * 50], fill: NAVY, opacity: 0.7 })),
      ...callout(130, 210, 290, "① PISCINA PRIVADA", NAVY, 380, 700, LIME),
      ...callout(620, 320, 320, "② TERRAZA 40 M²", NAVY, 800, 620, LIME),
      { type: "text", bbox: [1004, 400, 1064, 900], content: "PLANO Nº 2 · IC-28746 · ESCALA 1:100", font: "Archivo", size: 16, colour: mix(NAVY, LIME, 0.6), tracking: 4, rotate: 90, align: "center" },
      { type: "text", bbox: [90, 1080, 990, 1180], content: "La parcela completa, anotada", font: FR, size: 54, colour: NAVY, align: "left" },
      ...band(2, 5, mix(NAVY, LIME, 0.55)),
    ],
  }));

  // S3: specimen case — numbered detail crops (portholes) with caption rules
  specs.push(DesignSpec.parse({
    background: LIME,
    elements: [
      { type: "text", bbox: [80, 110, 1000, 145], content: "PIEZAS · EL CASO DE ESTUDIO", font: "Archivo", size: 20, colour: TERRA, align: "left", tracking: 6 },
      ...[0, 1, 2].map((i) => ({ type: "photo", photo: i, bbox: [110 + i * 300, 240, 370 + i * 300, 500], tint: NAVY, tint_opacity: 0.08 })),
      ...[0, 1, 2].flatMap((i) => ({ type: "punch", bbox: [110 + i * 300, 240, 370 + i * 300, 500], fill: LIME, shape: "circle", outline: { colour: NAVY, width: 1, offset: 8 } })),
      ...[0, 1, 2].flatMap((i) => [
        { type: "text", bbox: [110 + i * 300, 540, 370 + i * 300, 580], content: `0${i + 1}`, font: FR, size: 36, colour: GOLD, align: "center" },
        { type: "text", bbox: [110 + i * 300, 590, 370 + i * 300, 620], content: ["EXTERIOR", "SALÓN", "COCINA"][i], font: "Archivo", size: 16, colour: NAVY, align: "center", tracking: 4 },
        { type: "rect", bbox: [140 + i * 300, 634, 340 + i * 300, 635], fill: mix(NAVY, LIME, 0.4) },
      ]),
      { type: "text", bbox: [80, 720, 1000, 900], content: "Tres detalles que\ncuentan la casa entera", font: FR, size: 72, colour: NAVY, align: "left", line_height: 88 },
      { type: "text", bbox: [80, 960, 1000, 1120], content: wrap("Cada pieza numerada, cada dato real. Sin retoques, sin promesas — lo que ves es lo que visitas.", "Jost", 32, 920), font: "Jost", size: 32, colour: mix(NAVY, LIME, 0.85), align: "left", line_height: 48 },
      ...band(3, 5, mix(NAVY, LIME, 0.55)),
    ],
  }));

  // S4: the full spec sheet — two-column table, the save unit
  const rows: [string, string][] = [["REF", "IC-28746"], ["PRECIO", "695.000 €"], ["SUPERFICIE", "214 m²"], ["DORMITORIOS", "3"], ["BAÑOS", "3"], ["EXTRAS", "Piscina · Vistas"]];
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      ...frame([40, 40, 1040, 1310], GOLD, 1, 0.4),
      { type: "text", bbox: [90, 110, 990, 145], content: "FICHA TÉCNICA · VILLA IN ALTEA", font: "Archivo", size: 20, colour: GOLD, align: "left", tracking: 6 },
      ...rows.flatMap(([k, v], i) => {
        const y = 230 + i * 148;
        return [
          { type: "text", bbox: [90, y, 460, y + 40], content: `${String(i + 1).padStart(2, "0")} · ${k}`, font: "Archivo", size: 20, colour: mix(CREAM, NAVY, 0.65), align: "left", tracking: 4, valign: "center" },
          { type: "text", bbox: [460, y - 24, 990, y + 64], content: v, font: FR, size: 54, colour: CREAM, align: "right" },
          { type: "rect", bbox: [90, y + 92, 990, y + 93], fill: GOLD, opacity: 0.3 },
        ];
      }),
      { type: "text", bbox: [90, 1160, 940, 1206], content: "GUARDA LA FICHA — ES TU CHECKLIST DE VISITA", font: "Archivo", size: 20, colour: NAVY, align: "left", tracking: 2, valign: "center", pill: { fill: GOLD, pad_x: 28, pad_y: 14, radius: 4 } },
      ...band(4, 5, mix(CREAM, NAVY, 0.6)),
    ],
  }));

  // S5 CTA: boxed-label style
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      ...seal(540, 350, 100, GOLD, NAVY, "MCH"),
      ...frame([160, 540, 920, 780], GOLD, 1.5),
      { type: "text", bbox: [200, 590, 880, 660], content: "¿LA VISITAMOS?", font: "Anton", size: 64, colour: CREAM, align: "center" },
      { type: "text", bbox: [200, 680, 880, 730], content: "ESCRÍBENOS: PLANO", font: "Archivo", size: 24, colour: GOLD, align: "center", tracking: 5 },
      ...Array.from({ length: 5 }, (_, i) => ({ type: "rect", bbox: [500 + i * 18, 830, 501.5 + i * 18, 860], fill: GOLD, opacity: 1 - i * 0.18 })),
      { type: "text", bbox: [140, 920, 940, 950], content: "mediterraneocostahomes.es · +34 600 999 066", font: "Jost", size: 21, colour: mix(CREAM, NAVY, 0.65), align: "center", tracking: 2 },
      ...band(5, 5, mix(CREAM, NAVY, 0.6)),
    ],
  }));

  const out: Buffer[] = [];
  for (const s of specs) out.push(await applyGrain(await renderFreeform(s, { width: W, height: H }, photos), 0.04));
  return out;
}

// ═══ PORTADA — the property as a magazine issue ═══════════════════════════════
async function portada(photos: Buffer[]): Promise<Buffer[]> {
  const specs: any[] = [];

  // S1: the cover — masthead, cover lines, issue furniture, price flash, barcode
  specs.push(DesignSpec.parse({
    background: "#0a0c10",
    elements: [
      { type: "photo", photo: 0, bbox: [0, 0, W, H], tint: TERRA, tint_opacity: 0.1 },
      { type: "scrim", bbox: [0, 0, W, 560], colour: "#0a0c10", direction: "down" },
      { type: "scrim", bbox: [0, 0, W, 420], colour: "#0a0c10", direction: "down" },
      { type: "scrim", bbox: [0, 820, W, H], colour: "#0a0c10" },
      { type: "text", bbox: [60, 90, 1020, 330], content: "COSTA", font: "Anton", size: 250, colour: CREAM, align: "center" },
      { type: "text", bbox: [80, 350, 640, 384], content: "LA REVISTA DE TU PRÓXIMA CASA", font: "Jost", size: 20, colour: GOLD, align: "left", tracking: 5 },
      { type: "text", bbox: [640, 350, 1000, 384], content: "Nº 07 · JULIO 2026", font: "Jost", size: 20, colour: CREAM, align: "right", tracking: 4 },
      // cover lines
      { type: "text", bbox: [80, 880, 1000, 918], content: "EN PORTADA", font: "Jost", size: 20, colour: GOLD, align: "left", tracking: 6 },
      { type: "text", bbox: [80, 940, 1000, 1120], content: "La villa de Altea que\nmira al mar desde cada terraza", font: FR, size: 62, colour: CREAM, align: "left", line_height: 78 },
      { type: "text", bbox: [80, 1160, 760, 1195], content: "p.03 — La ficha completa   ·   p.05 — El barrio", font: "Jost", size: 21, colour: mix(CREAM, "#0a0c10", 0.75), align: "left", tracking: 1 },
      // the price flash
      { type: "rect", bbox: [860, 430, 1030, 600], fill: GOLD, radius: 85, rotate: 12 },
      { type: "text", bbox: [860, 480, 1030, 530], content: "695.000 €", font: "Jost", size: 26, colour: NAVY, align: "center", weight: "600", rotate: 12 },
      { type: "text", bbox: [860, 528, 1030, 560], content: "VILLA · 214 M²", font: "Jost", size: 15, colour: NAVY, align: "center", tracking: 2, rotate: 12 },
      // barcode
      ...Array.from({ length: 24 }, (_, i) => ({ type: "rect", bbox: [850 + i * 6, 1240, 850 + i * 6 + (i % 3 === 0 ? 3 : 1.5), 1296], fill: CREAM })),
      { type: "text", bbox: [80, 1256, 640, 1284], content: AGENCY, font: "Jost", size: 17, colour: mix(CREAM, "#0a0c10", 0.7), align: "left", weight: "500", tracking: 4 },
    ],
  }));

  // S2: the spread — drop cap + standfirst + photo column
  specs.push(DesignSpec.parse({
    background: CREAM,
    elements: [
      { type: "text", bbox: [80, 100, 1000, 134], content: "COSTA · EN PORTADA · P.02", font: "Jost", size: 18, colour: mix(NAVY, CREAM, 0.55), align: "left", tracking: 5 },
      { type: "rect", bbox: [80, 158, 1000, 160], fill: NAVY },
      { type: "text", bbox: [80, 210, 1000, 400], content: "Una casa para\nquedarse", font: FR, size: 84, colour: NAVY, align: "left", line_height: 98 },
      { type: "photo", photo: 1, bbox: [560, 460, 1000, 1030], tint: TERRA, tint_opacity: 0.08 },
      ...frame([560, 460, 1000, 1030], NAVY, 1),
      // drop cap paragraph
      { type: "text", bbox: [80, 460, 220, 640], content: "A", font: FR, size: 150, colour: GOLD, align: "left" },
      { type: "text", bbox: [230, 480, 530, 800], content: wrap("quince minutos del casco antiguo, la villa abre el salón a una terraza que corre hacia el mar.", "Jost", 28, 290), font: "Jost", size: 28, colour: "#333333", align: "left", line_height: 44 },
      { type: "text", bbox: [80, 740, 530, 1030], content: wrap("Tres dormitorios, tres baños y una piscina orientada al sur — la casa que se visita una vez y se recuerda toda la semana.", "Jost", 28, 440), font: "Jost", size: 28, colour: "#333333", align: "left", line_height: 44 },
      { type: "rect", bbox: [80, 1080, 1000, 1081], fill: mix(NAVY, CREAM, 0.3) },
      { type: "text", bbox: [80, 1100, 1000, 1135], content: "SIGUE EN LA PÁGINA 3 →", font: "Jost", size: 19, colour: TERRA, align: "right", tracking: 4 },
      ...band(2, 5, mix(NAVY, CREAM, 0.55)),
    ],
  }));

  // S3: full-page photo + pull quote
  specs.push(DesignSpec.parse({
    background: "#0a0c10",
    elements: [
      { type: "photo", photo: 2, bbox: [0, 0, W, H], tint: TERRA, tint_opacity: 0.08 },
      { type: "scrim", bbox: [0, 700, W, H], colour: "#0a0c10" },
      { type: "text", bbox: [80, 96, 700, 128], content: "COSTA · P.03", font: "Jost", size: 18, colour: CREAM, align: "left", tracking: 5 },
      { type: "text", bbox: [70, 850, 320, 1050], content: "“", font: FR, size: 200, colour: GOLD, align: "left" },
      { type: "text", bbox: [80, 1010, 1000, 1160], content: "Atardeceres sobre el\nMediterráneo, cada día.", font: FR, size: 60, colour: CREAM, align: "left", line_height: 76 },
      ...band(3, 5, mix(CREAM, "#0a0c10", 0.7)),
    ],
  }));

  // S4: EN ESTE NÚMERO — the facts as a contents page
  const toc: [string, string, string][] = [["01", "PRECIO", "695.000 €"], ["02", "SUPERFICIE", "214 m²"], ["03", "DORMITORIOS", "3"], ["04", "BAÑOS", "3"], ["05", "EXTRAS", "Piscina · Vistas al mar"]];
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "text", bbox: [80, 110, 1000, 150], content: "EN ESTE NÚMERO", font: "Anton", size: 46, colour: GOLD, align: "left" },
      { type: "rect", bbox: [80, 180, 1000, 182], fill: GOLD, opacity: 0.5 },
      ...toc.flatMap(([n, k, v], i) => {
        const y = 260 + i * 150;
        return [
          { type: "text", bbox: [80, y, 200, y + 60], content: n, font: FR, size: 44, colour: GOLD, align: "left", valign: "center" },
          { type: "text", bbox: [220, y, 620, y + 60], content: k, font: "Jost", size: 24, colour: mix(CREAM, NAVY, 0.7), align: "left", tracking: 4, valign: "center" },
          { type: "text", bbox: [560, y - 10, 1000, y + 70], content: v, font: FR, size: 46, colour: CREAM, align: "right", valign: "center" },
          { type: "rect", bbox: [80, y + 100, 1000, y + 101], fill: mix(CREAM, NAVY, 0.25) },
        ];
      }),
      { type: "text", bbox: [80, 1120, 940, 1170], content: "Guarda este número para tu visita", font: "Jost", size: 25, colour: NAVY, align: "left", weight: "500", valign: "center", pill: { fill: GOLD, pad_x: 30, pad_y: 14 } },
      ...band(4, 5, mix(CREAM, NAVY, 0.6)),
    ],
  }));

  // S5: the back cover
  specs.push(DesignSpec.parse({
    background: CREAM,
    elements: [
      { type: "rect", bbox: [80, 120, 1000, 122], fill: NAVY },
      { type: "text", bbox: [80, 180, 1000, 420], content: "El próximo\nnúmero puede\nser tu casa.", font: FR, size: 92, colour: NAVY, align: "left", line_height: 108 },
      ...seal(540, 640, 100, TERRA, CREAM, "MCH"),
      { type: "text", bbox: [140, 820, 940, 900], content: "Envíaselo a quien busca casa contigo — y escríbenos la palabra PORTADA.", font: "Jost", size: 30, colour: "#333333", align: "center", line_height: 46 },
      { type: "text", bbox: [300, 980, 780, 1040], content: "ESCRÍBENOS: PORTADA", font: "Jost", size: 24, colour: CREAM, align: "center", weight: "600", tracking: 3, valign: "center", pill: { fill: NAVY, pad_x: 40, pad_y: 20 } },
      { type: "text", bbox: [140, 1120, 940, 1150], content: "mediterraneocostahomes.es · +34 600 999 066", font: "Jost", size: 21, colour: mix(NAVY, CREAM, 0.6), align: "center", tracking: 2 },
      ...band(5, 5, mix(NAVY, CREAM, 0.55)),
    ],
  }));

  const out: Buffer[] = [];
  for (const s of specs) out.push(await applyGrain(await renderFreeform(s, { width: W, height: H }, photos), 0.045));
  return out;
}

// ═══ RECORTE — the structured scrapbook ═══════════════════════════════════════
async function recorte(photos: Buffer[]): Promise<Buffer[]> {
  const paper = "#f1ece1";
  const ink = "#2b2f36";
  const tape = (x: number, y: number, deg: number) => ({ type: "rect", bbox: [x, y, x + 150, y + 44], fill: "#e8e0cd", opacity: 0.85, rotate: deg });
  const card = (photo: number, b: [number, number, number, number], deg: number) => [
    { type: "rect", bbox: [b[0] - 18, b[1] - 18, b[2] + 18, b[3] + 60], fill: "#ffffff", rotate: deg },
    { type: "photo", photo, bbox: b, rotate: deg, tint: TERRA, tint_opacity: 0.1 },
  ];
  const specs: any[] = [];

  // S1: two tilted cards, taped; straight type block for contrast
  specs.push(DesignSpec.parse({
    background: paper,
    elements: [
      ...card(0, [110, 170, 610, 590], -3),
      ...card(1, [480, 420, 950, 810], 2),
      tape(180, 130, -8), tape(820, 390, 6),
      { type: "text", bbox: [80, 900, 1000, 940], content: "DIARIO DE BÚSQUEDA · ALTEA", font: "Special Elite", size: 26, colour: TERRA, align: "left" },
      { type: "text", bbox: [80, 960, 1000, 1130], content: "La casa que fuimos\na ver “solo un momento”", font: FR, size: 62, colour: ink, align: "left", line_height: 78 },
      { type: "text", bbox: [700, 1140, 1000, 1210], content: "encontrada", font: "Damion", size: 54, colour: TERRA, align: "center", rotate: -5 },
      ...band(1, 4, mix(ink, paper, 0.55)),
    ],
  }));

  // S2: one big tilted card + taped caption strip
  specs.push(DesignSpec.parse({
    background: paper,
    elements: [
      ...card(2, [120, 140, 960, 850], -2),
      tape(160, 100, -10), tape(800, 110, 7),
      { type: "rect", bbox: [200, 900, 880, 990], fill: "#ffffff", rotate: 1.5 },
      { type: "text", bbox: [220, 920, 860, 975], content: "El salón — luz de las 6 de la tarde", font: "Special Elite", size: 28, colour: ink, align: "center", rotate: 1.5 },
      tape(480, 870, -6),
      { type: "text", bbox: [80, 1060, 1000, 1180], content: "Piscina, tres dormitorios y el mar\nal final de la calle.", font: "Jost", size: 32, colour: mix(ink, paper, 0.85), align: "center", line_height: 48 },
      ...band(2, 4, mix(ink, paper, 0.55)),
    ],
  }));

  // S3: fact notes pinned to the board
  const notes: [string, string, number, number, number][] = [
    ["PRECIO", "695.000 €", 90, 220, -2], ["SUPERFICIE", "214 m²", 560, 200, 2],
    ["DORMITORIOS", "3", 120, 560, 1.5], ["BAÑOS", "3", 580, 580, -2.5],
  ];
  specs.push(DesignSpec.parse({
    background: paper,
    elements: [
      { type: "text", bbox: [80, 110, 1000, 150], content: "LOS DATOS, TAL CUAL", font: "Special Elite", size: 28, colour: TERRA, align: "center" },
      ...notes.flatMap(([k, v, x, y, deg]) => [
        { type: "rect", bbox: [x, y, x + 420, y + 250], fill: "#ffffff", rotate: deg },
        tape(x + 130, y - 22, deg > 0 ? -7 : 7),
        { type: "text", bbox: [x + 30, y + 44, x + 390, y + 80], content: k, font: "Special Elite", size: 22, colour: mix(ink, "#ffffff", 0.6), align: "left", rotate: deg },
        { type: "text", bbox: [x + 30, y + 96, x + 390, y + 210], content: v, font: FR, size: 74, colour: ink, align: "left", rotate: deg },
      ]),
      { type: "text", bbox: [80, 920, 1000, 1050], content: "Sin filtros: lo que cuesta,\nlo que mide, lo que hay.", font: FR, size: 56, colour: ink, align: "center", line_height: 72 },
      ...band(3, 4, mix(ink, paper, 0.55)),
    ],
  }));

  // S4: taped CTA note
  specs.push(DesignSpec.parse({
    background: paper,
    elements: [
      { type: "rect", bbox: [140, 260, 940, 850], fill: "#ffffff", rotate: -1.5 },
      tape(240, 220, -9), tape(700, 230, 8),
      { type: "text", bbox: [200, 340, 880, 420], content: "NOTA PARA TI:", font: "Special Elite", size: 30, colour: TERRA, align: "center", rotate: -1.5 },
      { type: "text", bbox: [200, 440, 880, 640], content: "Si esta casa te ha hecho\nparar el dedo — visítala.", font: FR, size: 54, colour: ink, align: "center", line_height: 70, rotate: -1.5 },
      { type: "text", bbox: [310, 690, 770, 748], content: "ESCRÍBENOS: DIARIO", font: "Jost", size: 24, colour: paper, align: "center", weight: "600", tracking: 3, valign: "center", pill: { fill: ink, pad_x: 38, pad_y: 18 }, rotate: -1.5 },
      { type: "text", bbox: [140, 950, 940, 1000], content: "Guárdalo — o envíaselo a tu compañero de búsqueda.", font: "Jost", size: 28, colour: mix(ink, paper, 0.85), align: "center" },
      { type: "text", bbox: [140, 1060, 940, 1090], content: "mediterraneocostahomes.es · +34 600 999 066", font: "Jost", size: 21, colour: mix(ink, paper, 0.6), align: "center", tracking: 2 },
      ...band(4, 4, mix(ink, paper, 0.55)),
    ],
  }));

  const out: Buffer[] = [];
  for (const s of specs) out.push(await applyGrain(await renderFreeform(s, { width: W, height: H }, photos), 0.08));
  return out;
}

// ═══ MAREA — typographic maximalism over the photo ════════════════════════════
async function marea(photos: Buffer[]): Promise<Buffer[]> {
  const specs: any[] = [];

  // S1: full-bleed duotone + wall-to-wall cascade, hollow/filled interplay
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "photo", photo: 0, bbox: [0, 0, W, H], tint: "#2b4a75", tint_mode: "duotone" },
      { type: "scrim", bbox: [0, 0, W, 300], colour: "#101c2e", direction: "down" },
      { type: "scrim", bbox: [0, 500, W, H], colour: "#101c2e" },
      { type: "text", bbox: [80, 96, 700, 128], content: AGENCY, font: "Jost", size: 20, colour: CREAM, align: "left", weight: "500", tracking: 5 },
      { type: "text", bbox: [-30, 300, 1110, 560], content: "EL MAR", font: "Anton", size: 240, colour: CREAM, align: "center", hollow: true, stroke_width: 3.5 },
      { type: "text", bbox: [-30, 540, 1110, 800], content: "DELANTE", font: "Anton", size: 220, colour: CREAM, align: "center" },
      { type: "rect", bbox: [-100, 880, 1180, 960], fill: GOLD, rotate: -4 },
      { type: "text", bbox: [40, 892, 1040, 948], content: "ALTEA · VILLA · 695.000 €", font: "Anton", size: 44, colour: NAVY, align: "center", rotate: -4 },
      { type: "text", bbox: [80, 1080, 1000, 1130], content: "La villa que se presenta sola. Desliza.", font: FR, size: 36, colour: CREAM, align: "center", italic: true },
      ...band(1, 4, mix(CREAM, NAVY, 0.7)),
    ],
  }));

  // S2: size-cascade stack, no photo — pure type wall
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "text", bbox: [-30, 130, 1110, 400], content: "VISTAS", font: "Anton", size: 230, colour: mix(GOLD, NAVY, 0.4), align: "center" },
      { type: "text", bbox: [-30, 380, 1110, 560], content: "QUE NO", font: "Anton", size: 150, colour: CREAM, align: "center", hollow: true, stroke_width: 3 },
      { type: "text", bbox: [-30, 560, 1110, 830], content: "CADUCAN", font: "Anton", size: 210, colour: CREAM, align: "center" },
      { type: "rect", bbox: [200, 900, 880, 903], fill: GOLD },
      { type: "text", bbox: [140, 950, 940, 1090], content: wrap("Tres dormitorios, tres baños y una terraza que hace de salvapantallas.", "Jost", 30, 780), font: "Jost", size: 30, colour: mix(CREAM, NAVY, 0.85), align: "center", line_height: 46 },
      ...band(2, 4, mix(CREAM, NAVY, 0.6)),
    ],
  }));

  // S3: photo + giant price wall
  specs.push(DesignSpec.parse({
    background: "#101c2e",
    elements: [
      { type: "photo", photo: 1, bbox: [0, 0, W, 900], tint: "#2b4a75", tint_mode: "duotone" },
      { type: "scrim", bbox: [0, 620, W, 900], colour: "#101c2e" },
      { type: "text", bbox: [-40, 860, 1120, 1140], content: "695.000€", font: "Anton", size: 230, colour: GOLD, align: "center" },
      { type: "text", bbox: [80, 1150, 1000, 1190], content: "214 M² · PISCINA · ORIENTACIÓN SUR", font: "Jost", size: 22, colour: CREAM, align: "center", tracking: 5 },
      ...band(3, 4, mix(CREAM, "#101c2e", 0.65)),
    ],
  }));

  // S4 CTA: gold field + navy diagonal
  specs.push(DesignSpec.parse({
    background: GOLD,
    elements: [
      { type: "text", bbox: [-30, 180, 1110, 460], content: "MÍRALA", font: "Anton", size: 250, colour: NAVY, align: "center" },
      { type: "text", bbox: [-30, 450, 1110, 650], content: "EN VIVO", font: "Anton", size: 170, colour: NAVY, align: "center", hollow: true, stroke_width: 3 },
      { type: "rect", bbox: [-100, 760, 1180, 850], fill: NAVY, rotate: -4 },
      { type: "text", bbox: [40, 778, 1040, 838], content: "ESCRÍBENOS: MAR", font: "Anton", size: 46, colour: GOLD, align: "center", rotate: -4, tracking: 4 },
      { type: "text", bbox: [140, 950, 940, 1030], content: "Envíaselo a la persona con quien vas a comprar.", font: "Jost", size: 30, colour: NAVY, align: "center", line_height: 44 },
      { type: "text", bbox: [140, 1090, 940, 1120], content: "mediterraneocostahomes.es · +34 600 999 066", font: "Jost", size: 21, colour: NAVY, align: "center", tracking: 2 },
      ...band(4, 4, mix(NAVY, GOLD, 0.8)),
    ],
  }));

  const out: Buffer[] = [];
  for (const s of specs) out.push(await applyGrain(await renderFreeform(s, { width: W, height: H }, photos), 0.05));
  return out;
}

async function main() {
  const outdir = process.argv[2] ?? "studio/out/carousel-bold";
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
  await save("plano", await plano(photos));
  await save("portada", await portada(photos));
  await save("recorte", await recorte(photos));
  await save("marea", await marea(photos));
}
main().catch((e) => { console.error(e); process.exit(1); });
