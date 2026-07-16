// CAROUSEL STYLEBOOK PROOFS (2026-07-16): hand-authored decks for the four ship_now styles from the
// visual research — Horizonte (seamless panorama), Cartel (Spanish poster type), Encalada (refined
// Mediterranean), Sereno (quiet luxury). Show-first: Christian picks, then the winners get productionised.
// Run: npx tsx studio/engine/carouselStyleProofs.ts <outdir> <photoDir>
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { renderFreeform, DesignSpec } from "./renderFreeform";
import { renderWideSliced, applyGrain, mix } from "./carouselSlides";

const W = 1080, H = 1350;
const NAVY = "#1f3a5f", GOLD = "#c9a227", CREAM = "#f6f1e7", INK = "#333333";
const LIME = "#f4efe6", TERRA = "#c96a4a", OLIVE = "#5a6b4e";
const AGENCY = "MEDITERRÁNEO COSTA HOMES";

const FR = "Fraunces 115pt";
const CAS = "Libre Caslon Display";

/** hairline rectangle outline (Sotheby's window-frame device) built from 4 thin rects */
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

/** stroke-only double-ring agency seal (initials inside) drawn from concentric circles */
function seal(cx: number, cy: number, r: number, ring: string, ground: string, initials: string) {
  const c = (rr: number, fill: string) => ({ type: "rect", bbox: [cx - rr, cy - rr, cx + rr, cy + rr], fill, radius: rr });
  return [
    c(r, ring), c(r - 2, ground), c(r - 12, ring), c(r - 14, ground),
    { type: "text", bbox: [cx - r, cy - 20, cx + r, cy + 20], content: initials, font: "Jost", size: 26, colour: ring, align: "center", tracking: 6, valign: "center" },
  ];
}

function folio(i: number, total: number, colour: string) {
  return { type: "text", bbox: [700, 1272, 1000, 1300], content: `Nº ${String(i).padStart(2, "0")} — ${String(total).padStart(2, "0")}`, font: "Jost", size: 17, colour, align: "right", tracking: 3 };
}
function anchor(colour: string) {
  return { type: "text", bbox: [80, 1272, 640, 1300], content: AGENCY, font: "Jost", size: 17, colour, align: "left", weight: "500", tracking: 4 };
}

// ═══ HORIZONTE — the seamless panorama (listing) ═══════════════════════════════
async function horizonte(photos: Buffer[]): Promise<Buffer[]> {
  const mutedCream = mix("#f3efe6", NAVY, 0.55);
  // slides 1-3 = ONE 3240px master: continuous photo band, giant word straddling seam 1,
  // medallion bisected at seam 2, per-column safe text
  const wide = DesignSpec.parse({
    background: NAVY,
    elements: [
      // manual band crop: zoom 1 keeps full width, y picks the band with the villa (attention crop grabs treetops)
      { type: "photo", photo: 0, bbox: [0, 0, 3240, 1350], zoom: 1, x: 0.5, y: 0.68, tint: "#c96a4a", tint_opacity: 0.08 },
      { type: "scrim", bbox: [0, 0, 3240, 250], colour: "#0a0c10", direction: "down" },
      { type: "scrim", bbox: [0, 480, 3240, 1350], colour: "#0a0c10" },
      { type: "scrim", bbox: [0, 850, 3240, 1350], colour: "#0a0c10" },
      // the continuous horizon rule
      { type: "rect", bbox: [0, 838, 3240, 840], fill: GOLD, opacity: 0.6 },
      // the giant word breaking across seam 1 (x=1080, mid-letter) — each half readable alone
      { type: "text", bbox: [200, 520, 2400, 920], content: "ALTEA", font: FR, size: 470, colour: "#f3efe6" },
      // medallion bisected exactly at seam 2 (x=2160) = the bridge; the price reads beside it on slide 3
      { type: "rect", bbox: [2160 - 130, 470, 2160 + 130, 730], fill: GOLD, radius: 130 },
      { type: "text", bbox: [2160 - 130, 550, 2160 + 130, 660], content: "€", font: FR, size: 90, colour: NAVY, align: "center" },
      { type: "text", bbox: [2330, 520, 2900, 590], content: "695.000 €", font: CAS, size: 56, colour: GOLD, align: "left" },
      { type: "text", bbox: [2330, 610, 2900, 642], content: "VILLA · 214 M²", font: "Jost", size: 21, colour: "#f3efe6", align: "left", tracking: 4 },
      // column 1 (cover): kicker + hook, inside safe centre
      { type: "text", bbox: [80, 96, 1000, 130], content: AGENCY, font: "Jost", size: 21, colour: "#f3efe6", align: "left", weight: "500", tracking: 5 },
      { type: "text", bbox: [80, 950, 1000, 986], content: "ALTEA · ALICANTE", font: "Jost", size: 22, colour: GOLD, align: "left", tracking: 6 },
      { type: "text", bbox: [80, 1010, 1000, 1180], content: "Atardeceres sobre el\nMediterráneo, cada día", font: CAS, size: 64, colour: "#f3efe6", align: "left", line_height: 78 },
      // column 2: standalone payoff
      { type: "text", bbox: [1160, 96, 2080, 130], content: "ALTEA · ALICANTE", font: "Jost", size: 21, colour: GOLD, align: "left", tracking: 5 },
      { type: "text", bbox: [1160, 1010, 2080, 1160], content: "Una villa que mira al mar\ndesde cada terraza", font: CAS, size: 60, colour: "#f3efe6", align: "left", line_height: 74 },
      // column 3: specs + swipe close of the pano run
      { type: "text", bbox: [2240, 96, 3160, 130], content: AGENCY, font: "Jost", size: 21, colour: "#f3efe6", align: "left", weight: "500", tracking: 5 },
      { type: "text", bbox: [2240, 1010, 3160, 1046], content: "3 DORM · 3 BAÑOS · 214 M² · PISCINA", font: "Jost", size: 24, colour: "#f3efe6", align: "left", tracking: 3 },
      { type: "text", bbox: [2240, 1080, 3160, 1160], content: "Sigue — los interiores", font: CAS, size: 44, colour: GOLD, align: "left" },
      // per-column folios
      { type: "text", bbox: [700, 1272, 1000, 1300], content: "Nº 01 — 06", font: "Jost", size: 17, colour: mutedCream, align: "right", tracking: 3 },
      { type: "text", bbox: [1780, 1272, 2080, 1300], content: "Nº 02 — 06", font: "Jost", size: 17, colour: mutedCream, align: "right", tracking: 3 },
      { type: "text", bbox: [2860, 1272, 3160, 1300], content: "Nº 03 — 06", font: "Jost", size: 17, colour: mutedCream, align: "right", tracking: 3 },
    ],
  });
  const pano = await renderWideSliced(wide, 3, photos);

  // slide 4 — discrete: matted interior + micro KPI strip (Sereno grammar)
  const s4 = DesignSpec.parse({
    background: CREAM,
    elements: [
      { type: "photo", photo: 1, bbox: [80, 150, 1000, 830], tint: "#c96a4a", tint_opacity: 0.08 },
      ...frame([64, 134, 1016, 846], NAVY, 1.5, 0.5),
      { type: "text", bbox: [80, 900, 1000, 932], content: "INTERIOR · LUZ DE LEVANTE", font: "Jost", size: 21, colour: mix(NAVY, CREAM, 0.6), align: "left", tracking: 5 },
      { type: "text", bbox: [80, 960, 1000, 1080], content: "Salón abierto a la terraza,\ncocina de piedra natural", font: CAS, size: 52, colour: NAVY, align: "left", line_height: 66 },
      { type: "rect", bbox: [80, 1130, 1000, 1131.5], fill: GOLD, opacity: 0.5 },
      { type: "text", bbox: [80, 1156, 1000, 1188], content: "214 M²   ·   3 DORM   ·   3 BAÑOS   ·   ORIENTACIÓN SUR", font: "Jost", size: 20, colour: NAVY, align: "left", tracking: 3 },
      anchor(mix(NAVY, CREAM, 0.55)), folio(4, 6, mix(NAVY, CREAM, 0.55)),
    ],
  });

  // slide 5 — navy spec plate (recap/save unit)
  const rows = [["PRECIO", "695.000 €"], ["SUPERFICIE", "214 m²"], ["DORMITORIOS", "3"], ["BAÑOS", "3"], ["EXTRAS", "Piscina · Vistas al mar"]];
  const s5 = DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "text", bbox: [80, 96, 1000, 130], content: AGENCY, font: "Jost", size: 21, colour: CREAM, align: "left", weight: "500", tracking: 5 },
      { type: "text", bbox: [80, 210, 1000, 330], content: "Villa in Altea", font: FR, size: 84, colour: CREAM, align: "left" },
      ...rows.flatMap(([k, v], i) => {
        const y = 420 + i * 132;
        return [
          { type: "text", bbox: [80, y, 460, y + 34], content: k, font: "Jost", size: 22, colour: GOLD, align: "left", tracking: 5 },
          { type: "text", bbox: [460, y - 14, 1000, y + 50], content: v, font: CAS, size: 46, colour: CREAM, align: "right" },
          { type: "rect", bbox: [80, y + 84, 1000, y + 85], fill: GOLD, opacity: 0.3 },
        ];
      }),
      { type: "text", bbox: [80, 1140, 940, 1190], content: "Guarda esta ficha para tu visita", font: "Jost", size: 26, colour: NAVY, align: "left", weight: "500", valign: "center", pill: { fill: GOLD, pad_x: 30, pad_y: 14 } },
      anchor(mix("#f3efe6", NAVY, 0.6)), folio(5, 6, mix("#f3efe6", NAVY, 0.6)),
    ],
  });

  // slide 6 — CTA
  const s6 = DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "text", bbox: [80, 96, 1000, 130], content: AGENCY, font: "Jost", size: 21, colour: CREAM, align: "left", weight: "500", tracking: 5 },
      ...seal(540, 420, 110, GOLD, NAVY, "MCH"),
      { type: "text", bbox: [110, 620, 970, 800], content: "¿La ves desde tu terraza?", font: FR, size: 76, colour: CREAM, align: "center", line_height: 90 },
      { type: "text", bbox: [110, 850, 970, 910], content: "Envíaselo a la persona con quien vas a comprar.", font: "Jost", size: 30, colour: CREAM, align: "center", line_height: 44 },
      { type: "text", bbox: [340, 980, 740, 1040], content: "ESCRÍBENOS: ALTEA", font: "Jost", size: 25, colour: NAVY, align: "center", weight: "600", tracking: 3, valign: "center", pill: { fill: GOLD, pad_x: 40, pad_y: 20 } },
      { type: "text", bbox: [110, 1120, 970, 1150], content: "mediterraneocostahomes.es · +34 600 999 066", font: "Jost", size: 21, colour: mix("#f3efe6", NAVY, 0.65), align: "center", tracking: 2 },
      anchor(mix("#f3efe6", NAVY, 0.6)), folio(6, 6, mix("#f3efe6", NAVY, 0.6)),
    ],
  });

  const rest = [];
  for (const s of [s4, s5, s6]) rest.push(await renderFreeform(s, { width: W, height: H }, photos));
  const all = [...pano, ...rest];
  const out: Buffer[] = [];
  for (const b of all) out.push(await applyGrain(b, 0.045));
  return out;
}

// ═══ CARTEL — the Spanish poster (tips) ════════════════════════════════════════
async function cartel(photos: Buffer[]): Promise<Buffer[]> {
  const rule = (y: number, colour: string, x0 = 200, x1 = 880) => ({ type: "rect", bbox: [x0, y, x1, y + 2], fill: colour });
  const specs: any[] = [];

  // S1 cover — navy ground, giant ¿, cartel stack, one hollow word
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "text", bbox: [60, 100, 420, 520], content: "¿", font: FR, size: 380, colour: GOLD },
      { type: "text", bbox: [80, 470, 1000, 600], content: "LOS 5 ERRORES", font: "Anton", size: 105, colour: CREAM, align: "center" },
      rule(628, GOLD),
      { type: "text", bbox: [80, 656, 1000, 830], content: "MÁS CAROS", font: "Anton", size: 150, colour: CREAM, align: "center", hollow: true, stroke_width: 3 },
      rule(862, GOLD),
      { type: "text", bbox: [80, 890, 1000, 980], content: "AL COMPRAR EN LA COSTA", font: "Anton", size: 62, colour: GOLD, align: "center" },
      { type: "text", bbox: [80, 1050, 1000, 1082], content: "COSTA BLANCA · GUÍA DEL COMPRADOR · MMXXVI", font: "Archivo", size: 20, colour: mix(CREAM, NAVY, 0.7), align: "center", tracking: 4 },
      anchor(mix("#f3efe6", NAVY, 0.6)), folio(1, 6, mix("#f3efe6", NAVY, 0.6)),
    ],
  }));

  // S2 — terracotta gamma turn, standalone qualification stack
  specs.push(DesignSpec.parse({
    background: TERRA,
    elements: [
      { type: "text", bbox: [80, 200, 1000, 260], content: "¿COMPRAS ESTE AÑO?", font: "Anton", size: 56, colour: LIME, align: "center" },
      rule(300, LIME),
      { type: "text", bbox: [80, 350, 1000, 640], content: "ESTO TE\nAHORRA DINERO", font: "Anton", size: 110, colour: LIME, align: "center", line_height: 124 },
      rule(700, LIME),
      { type: "text", bbox: [140, 760, 940, 900], content: "Cinco fallos que vemos cada semana — y cómo evitarlos antes de firmar nada.", font: "Archivo", size: 32, colour: LIME, align: "center", line_height: 48 },
      { type: "text", bbox: [80, 1050, 1000, 1082], content: "SIGUE · Nº 1 ES EL MÁS COMÚN", font: "Archivo", size: 20, colour: LIME, align: "center", tracking: 4 },
      anchor(mix(LIME, TERRA, 0.75)), folio(2, 6, mix(LIME, TERRA, 0.75)),
    ],
  }));

  // S3 — giant numeral fact slide (cream ground)
  specs.push(DesignSpec.parse({
    background: CREAM,
    elements: [
      { type: "text", bbox: [200, -120, 1080, 900], content: "1", font: "Anton", size: 900, colour: mix(GOLD, CREAM, 0.85), align: "center" },
      { type: "text", bbox: [80, 830, 1000, 920], content: "VER LA ZONA SOLO EN VERANO", font: "Anton", size: 58, colour: NAVY, align: "left" },
      { type: "rect", bbox: [80, 950, 760, 952], fill: TERRA },
      { type: "text", bbox: [80, 980, 1000, 1140], content: "Un pueblo de costa cambia por completo en enero. Visita fuera de temporada antes de decidir.", font: "Archivo", size: 33, colour: INK, align: "left", line_height: 50 },
      { type: "text", bbox: [80, 96, 500, 128], content: "ERROR Nº 1 DE 5", font: "Archivo", size: 20, colour: TERRA, align: "left", tracking: 5 },
      anchor(mix(NAVY, CREAM, 0.55)), folio(3, 6, mix(NAVY, CREAM, 0.55)),
    ],
  }));

  // S4 — duotone photo slide with one Anton line (the sanctioned duotone register)
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "photo", photo: 0, bbox: [0, 0, 1080, 1350], tint: "#3a5f94", tint_mode: "duotone" },
      { type: "scrim", bbox: [0, 0, 1080, 260], colour: "#0d1b2e", direction: "down" },
      { type: "scrim", bbox: [0, 700, 1080, 1350], colour: "#0d1b2e" },
      { type: "text", bbox: [80, 96, 500, 128], content: "ERROR Nº 2 DE 5", font: "Archivo", size: 20, colour: GOLD, align: "left", tracking: 5 },
      { type: "text", bbox: [80, 880, 1000, 1100], content: "FIARSE SOLO\nDE LAS FOTOS", font: "Anton", size: 96, colour: CREAM, align: "left", line_height: 110 },
      { type: "text", bbox: [80, 1130, 1000, 1200], content: "La luz real y el ruido de la calle solo se descubren visitando.", font: "Archivo", size: 30, colour: CREAM, align: "left", line_height: 44 },
      anchor(mix("#f3efe6", NAVY, 0.7)), folio(4, 6, mix("#f3efe6", NAVY, 0.7)),
    ],
  }));

  // S5 — the full bill (recap)
  const bill = ["VER LA ZONA EN INVIERNO", "PEDIR LAS ACTAS", "VERIFICAR LOS PAPELES", "VISITAR A OTRAS HORAS", "NEGOCIAR CON DATOS"];
  specs.push(DesignSpec.parse({
    background: CREAM,
    elements: [
      { type: "text", bbox: [80, 110, 1000, 170], content: "EL PROGRAMA", font: "Anton", size: 64, colour: NAVY, align: "center" },
      { type: "text", bbox: [80, 190, 1000, 220], content: "LOS 5 ERRORES, EN 30 SEGUNDOS", font: "Archivo", size: 20, colour: TERRA, align: "center", tracking: 5 },
      ...bill.flatMap((line, i) => {
        const y = 300 + i * 152;
        return [
          { type: "text", bbox: [80, y, 200, y + 90], content: String(i + 1), font: FR, size: 76, colour: GOLD, align: "center" },
          { type: "text", bbox: [220, y + 6, 1000, y + 80], content: line, font: "Anton", size: 46, colour: NAVY, align: "left", valign: "center" },
          { type: "rect", bbox: [80, y + 112, 1000, y + 114], fill: mix(NAVY, CREAM, 0.25) },
        ];
      }),
      { type: "text", bbox: [230, 1120, 850, 1176], content: "GUÁRDALO PARA TU BÚSQUEDA", font: "Archivo", size: 24, colour: CREAM, align: "center", weight: "500", tracking: 2, valign: "center", pill: { fill: NAVY, pad_x: 34, pad_y: 16 } },
      anchor(mix(NAVY, CREAM, 0.55)), folio(5, 6, mix(NAVY, CREAM, 0.55)),
    ],
  }));

  // S6 — CTA on gold ground
  specs.push(DesignSpec.parse({
    background: GOLD,
    elements: [
      { type: "text", bbox: [80, 240, 1000, 420], content: "NO COMPRES\nA CIEGAS", font: "Anton", size: 120, colour: NAVY, align: "center", line_height: 134 },
      { type: "rect", bbox: [340, 500, 740, 503], fill: NAVY },
      { type: "text", bbox: [140, 560, 940, 660], content: "Envíaselo a la persona con quien vas a comprar.", font: "Archivo", size: 32, colour: NAVY, align: "center", line_height: 46 },
      { type: "text", bbox: [300, 760, 780, 824], content: "ESCRÍBENOS: GUÍA", font: "Archivo", size: 26, colour: GOLD, align: "center", weight: "500", tracking: 3, valign: "center", pill: { fill: NAVY, pad_x: 44, pad_y: 20 } },
      { type: "text", bbox: [80, 950, 1000, 1000], content: "→ → →", font: "Anton", size: 44, colour: NAVY, align: "center", tracking: 30 },
      { type: "text", bbox: [80, 1080, 1000, 1110], content: "MEDITERRANEOCOSTAHOMES.ES · +34 600 999 066", font: "Archivo", size: 20, colour: NAVY, align: "center", tracking: 3 },
      anchor(mix(NAVY, GOLD, 0.8)), folio(6, 6, mix(NAVY, GOLD, 0.8)),
    ],
  }));

  const out: Buffer[] = [];
  for (const s of specs) out.push(await applyGrain(await renderFreeform(s, { width: W, height: H }, photos), 0.05));
  return out;
}

// ═══ ENCALADA — refined Mediterranean (listing) ════════════════════════════════
async function encalada(photos: Buffer[]): Promise<Buffer[]> {
  const inkMuted = mix(NAVY, LIME, 0.55);
  const specs: any[] = [];

  // S1 cover — arch-cropped hero with offset echo, sun stamp, hook beneath
  specs.push(DesignSpec.parse({
    background: LIME,
    elements: [
      { type: "photo", photo: 0, bbox: [190, 130, 890, 800], tint: TERRA, tint_opacity: 0.1 },
      { type: "punch", bbox: [190, 130, 890, 800], fill: LIME, shape: "arch", outline: { colour: TERRA, width: 1.5, offset: 14 } },
      { type: "text", bbox: [80, 880, 1000, 912], content: "ALTEA · ALICANTE", font: "Questrial", size: 22, colour: TERRA, align: "center", tracking: 7 },
      { type: "text", bbox: [100, 950, 980, 1140], content: "La villa que mira al mar\ndesde cada terraza", font: FR, size: 62, colour: NAVY, align: "center", line_height: 78 },
      { type: "text", bbox: [500, 1160, 580, 1240], content: "*", font: FR, size: 110, colour: GOLD, align: "center" },
      anchor(inkMuted), folio(1, 5, inkMuted),
    ],
  }));

  // S2 — porthole detail + azulejo band (one motif: the band)
  const tiles = Array.from({ length: 18 }, (_, i) => ({
    type: "rect", bbox: [80 + i * 52, 1180, 80 + i * 52 + 26, 1206], fill: i % 2 ? TERRA : OLIVE, opacity: 0.85, radius: 3,
  }));
  specs.push(DesignSpec.parse({
    background: LIME,
    elements: [
      { type: "photo", photo: 2, bbox: [300, 120, 780, 600], tint: TERRA, tint_opacity: 0.1 },
      { type: "punch", bbox: [300, 120, 780, 600], fill: LIME, shape: "circle", outline: { colour: OLIVE, width: 1.5, offset: 12 } },
      { type: "text", bbox: [80, 680, 1000, 712], content: "EL DETALLE", font: "Questrial", size: 21, colour: OLIVE, align: "center", tracking: 7 },
      { type: "text", bbox: [110, 760, 970, 960], content: "Piedra natural, luz de levante\ny sombra de parra", font: FR, size: 58, colour: NAVY, align: "center", line_height: 74 },
      ...tiles,
      anchor(inkMuted), folio(2, 5, inkMuted),
    ],
  }));

  // S3 — matted photo, museum plate
  specs.push(DesignSpec.parse({
    background: LIME,
    elements: [
      { type: "photo", photo: 1, bbox: [80, 120, 730, 850], tint: TERRA, tint_opacity: 0.1 },
      ...frame([94, 134, 716, 836], LIME, 1.5, 0.9),
      { type: "text", bbox: [770, 300, 1010, 700], content: "REF IC-28746 · ALTEA · MMXXVI", font: "Questrial", size: 20, colour: inkMuted, tracking: 5, rotate: 90, align: "center" },
      { type: "text", bbox: [80, 920, 640, 950], content: "EL SALÓN", font: "Questrial", size: 20, colour: TERRA, align: "left", tracking: 6 },
      { type: "rect", bbox: [80, 968, 250, 969.5], fill: OLIVE },
      { type: "text", bbox: [80, 990, 1000, 1120], content: "Abierto a la terraza, fresco\nen agosto, cálido en enero", font: FR, size: 50, colour: NAVY, align: "left", line_height: 66 },
      anchor(inkMuted), folio(3, 5, inkMuted),
    ],
  }));

  // S4 — KPI recap with olive rules
  const kpi = [["PRECIO", "695.000 €"], ["SUPERFICIE", "214 m²"], ["DORMITORIOS", "3"], ["BAÑOS", "3"]];
  specs.push(DesignSpec.parse({
    background: LIME,
    elements: [
      { type: "text", bbox: [80, 130, 1000, 170], content: "LA FICHA", font: "Questrial", size: 22, colour: TERRA, align: "center", tracking: 7 },
      { type: "text", bbox: [80, 210, 1000, 330], content: "Villa in Altea", font: FR, size: 80, colour: NAVY, align: "center" },
      ...kpi.flatMap(([k, v], i) => {
        const y = 440 + i * 150;
        return [
          { type: "text", bbox: [120, y, 520, y + 34], content: k, font: "Questrial", size: 22, colour: OLIVE, align: "left", tracking: 5 },
          { type: "text", bbox: [520, y - 20, 960, y + 56], content: v, font: FR, size: 54, colour: NAVY, align: "right" },
          { type: "rect", bbox: [120, y + 94, 960, y + 95.5], fill: mix(OLIVE, LIME, 0.5) },
        ];
      }),
      { type: "text", bbox: [230, 1120, 850, 1176], content: "Guárdala para tu próxima visita", font: "Jost", size: 26, colour: LIME, align: "center", weight: "500", valign: "center", pill: { fill: OLIVE, pad_x: 34, pad_y: 16 } },
      anchor(inkMuted), folio(4, 5, inkMuted),
    ],
  }));

  // S5 — terracotta CTA
  specs.push(DesignSpec.parse({
    background: TERRA,
    elements: [
      ...seal(540, 360, 100, LIME, TERRA, "MCH"),
      { type: "text", bbox: [110, 540, 970, 720], content: "¿Te ves aquí este verano?", font: FR, size: 74, colour: LIME, align: "center", line_height: 90 },
      { type: "text", bbox: [140, 780, 940, 860], content: "Envíaselo a quien sueña con vivir junto al mar.", font: "Jost", size: 30, colour: LIME, align: "center", line_height: 44 },
      { type: "text", bbox: [310, 950, 770, 1010], content: "ESCRÍBENOS: ALTEA", font: "Jost", size: 25, colour: TERRA, align: "center", weight: "600", tracking: 3, valign: "center", pill: { fill: LIME, pad_x: 40, pad_y: 20 } },
      { type: "text", bbox: [110, 1090, 970, 1120], content: "mediterraneocostahomes.es · +34 600 999 066", font: "Jost", size: 21, colour: mix(LIME, TERRA, 0.8), align: "center", tracking: 2 },
      anchor(mix(LIME, TERRA, 0.75)), folio(5, 5, mix(LIME, TERRA, 0.75)),
    ],
  }));

  const out: Buffer[] = [];
  for (const s of specs) out.push(await applyGrain(await renderFreeform(s, { width: W, height: H }, photos), 0.045));
  return out;
}

// ═══ SERENO — quiet luxury (listing) ═══════════════════════════════════════════
async function sereno(photos: Buffer[]): Promise<Buffer[]> {
  const warm = "#f5f1e8";
  const inkMuted = mix(NAVY, warm, 0.55);
  const specs: any[] = [];

  // S1 cover — vast field, small matted photo, inset hairline frame, spine text
  specs.push(DesignSpec.parse({
    background: warm,
    elements: [
      ...frame([40, 40, 1040, 1310], NAVY, 1.5, 0.35),
      { type: "photo", photo: 0, bbox: [560, 140, 960, 640], tint: TERRA, tint_opacity: 0.06 },
      ...frame([546, 126, 974, 654], NAVY, 1.5, 0.8),
      { type: "text", bbox: [96, 96, 520, 128], content: AGENCY, font: "Jost", size: 19, colour: inkMuted, align: "left", weight: "500", tracking: 5 },
      { type: "text", bbox: [96, 760, 520, 792], content: "ALTEA · ALICANTE", font: "Glacial Indifference", size: 21, colour: GOLD, align: "left", tracking: 7 },
      { type: "text", bbox: [96, 830, 900, 1100], content: "Una villa,\nel mar delante", font: FR, size: 96, colour: NAVY, align: "left", line_height: 114 },
      { type: "text", bbox: [980, 400, 1050, 950], content: "REF IC-28746 · ALTEA · MMXXVI", font: "Glacial Indifference", size: 19, colour: inkMuted, tracking: 5, rotate: 90, align: "center" },
      { type: "text", bbox: [96, 1240, 700, 1270], content: "Nº 01 — 05 · MEDITERRÁNEO COSTA HOMES · JUL 2026", font: "Jost", size: 16, colour: inkMuted, align: "left", tracking: 3 },
    ],
  }));

  // S2 — window frame shifted onto the photo edge (the Sotheby's device)
  specs.push(DesignSpec.parse({
    background: warm,
    elements: [
      { type: "photo", photo: 1, bbox: [140, 140, 940, 940], tint: TERRA, tint_opacity: 0.06 },
      ...frame([80, 400, 620, 1060], GOLD, 1.5),
      { type: "text", bbox: [96, 1010, 520, 1042], content: "EL SALÓN", font: "Glacial Indifference", size: 20, colour: GOLD, align: "left", tracking: 7 },
      { type: "rect", bbox: [96, 1058, 240, 1059.5], fill: NAVY, opacity: 0.4 },
      { type: "text", bbox: [96, 1080, 980, 1180], content: "Luz de levante, piedra natural", font: FR, size: 52, colour: NAVY, align: "left" },
      { type: "text", bbox: [96, 1240, 700, 1270], content: "Nº 02 — 05 · MEDITERRÁNEO COSTA HOMES", font: "Jost", size: 16, colour: inkMuted, align: "left", tracking: 3 },
    ],
  }));

  // S3 — full-bleed with almost nothing on it (the emptiness is the point)
  specs.push(DesignSpec.parse({
    background: "#0a0c10",
    elements: [
      { type: "photo", photo: 2, bbox: [0, 0, 1080, 1350], tint: TERRA, tint_opacity: 0.06 },
      { type: "scrim", bbox: [0, 1000, 1080, 1350], colour: "#0a0c10" },
      { type: "text", bbox: [96, 1120, 980, 1152], content: "LA COCINA · ORIENTACIÓN SUR", font: "Glacial Indifference", size: 21, colour: "#f3efe6", align: "left", tracking: 6 },
      { type: "rect", bbox: [96, 1176, 320, 1177.5], fill: GOLD, opacity: 0.7 },
      { type: "text", bbox: [96, 1240, 700, 1270], content: "Nº 03 — 05 · MEDITERRÁNEO COSTA HOMES", font: "Jost", size: 16, colour: mix("#f3efe6", "#0a0c10", 0.6), align: "left", tracking: 3 },
    ],
  }));

  // S4 — collector facts: LOT-style numerals
  const lots = [["LOTE Nº 1 · PRECIO", "695.000 €"], ["LOTE Nº 2 · SUPERFICIE", "214 m²"], ["LOTE Nº 3 · DORMITORIOS", "3"], ["LOTE Nº 4 · BAÑOS", "3"]];
  specs.push(DesignSpec.parse({
    background: warm,
    elements: [
      ...frame([40, 40, 1040, 1310], NAVY, 1.5, 0.35),
      { type: "text", bbox: [96, 110, 980, 142], content: "LA FICHA · VILLA IN ALTEA", font: "Glacial Indifference", size: 21, colour: GOLD, align: "left", tracking: 7 },
      ...lots.flatMap(([k, v], i) => {
        const y = 240 + i * 210;
        return [
          { type: "text", bbox: [96, y, 700, y + 30], content: k, font: "Glacial Indifference", size: 19, colour: inkMuted, align: "left", tracking: 5 },
          { type: "text", bbox: [96, y + 40, 980, y + 160], content: v, font: FR, size: 92, colour: NAVY, align: "left" },
          { type: "rect", bbox: [96, y + 174, 980, y + 175], fill: NAVY, opacity: 0.25 },
        ];
      }),
      { type: "text", bbox: [96, 1150, 940, 1200], content: "Guarda la ficha — vuelve a ella con calma.", font: FR, size: 34, colour: NAVY, align: "left", italic: true },
      { type: "text", bbox: [96, 1240, 700, 1270], content: "Nº 04 — 05 · MEDITERRÁNEO COSTA HOMES", font: "Jost", size: 16, colour: inkMuted, align: "left", tracking: 3 },
    ],
  }));

  // S5 — colophon CTA
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      ...seal(540, 430, 110, GOLD, NAVY, "MCH"),
      { type: "text", bbox: [140, 640, 940, 780], content: "Para verla, una palabra basta.", font: FR, size: 58, colour: CREAM, align: "center", line_height: 74 },
      { type: "text", bbox: [320, 860, 760, 920], content: "ESCRÍBENOS: ALTEA", font: "Glacial Indifference", size: 24, colour: NAVY, align: "center", weight: "500", tracking: 4, valign: "center", pill: { fill: GOLD, pad_x: 40, pad_y: 20 } },
      { type: "text", bbox: [140, 1010, 940, 1040], content: "mediterraneocostahomes.es · +34 600 999 066", font: "Jost", size: 20, colour: mix("#f3efe6", NAVY, 0.65), align: "center", tracking: 2 },
      { type: "text", bbox: [96, 1240, 984, 1270], content: "Nº 05 — 05 · MEDITERRÁNEO COSTA HOMES · JUL 2026", font: "Jost", size: 16, colour: mix("#f3efe6", NAVY, 0.6), align: "center", tracking: 3 },
    ],
  }));

  const out: Buffer[] = [];
  for (const s of specs) out.push(await applyGrain(await renderFreeform(s, { width: W, height: H }, photos), 0.035));
  return out;
}

async function main() {
  const outdir = process.argv[2] ?? "studio/out/carousel-styles";
  const photoDir = process.argv[3] ?? "";
  mkdirSync(outdir, { recursive: true });
  const p = (f: string) => readFileSync(join(photoDir, f));
  const photos = [p("altea_ext.jpg"), p("altea_int1.jpg"), p("altea_int2.jpg")];

  const save = async (name: string, slides: Buffer[]) => {
    for (let i = 0; i < slides.length; i++) {
      const jpg = await sharp(slides[i]).resize({ width: 540 }).jpeg({ quality: 82 }).toBuffer();
      writeFileSync(join(outdir, `${name}-${i + 1}.jpg`), jpg);
    }
    console.log(`${name}: ${slides.length} slides`);
  };

  await save("horizonte", await horizonte(photos));
  await save("cartel", await cartel(photos));
  await save("encalada", await encalada(photos));
  await save("sereno", await sereno(photos));
}
main().catch((e) => { console.error(e); process.exit(1); });
