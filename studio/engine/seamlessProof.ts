// SEAMLESS LISTING PROOFS — round 5 (2026-07-17). Christian rejected the one-photo-per-slide
// cinematic grammar and pointed at the seamless magazine-collage genre (the continuous strip that
// flows across every slide, multi-photo plates, section narrative, contact closer). This proves the
// four researched styles on the REAL San Javier demo listing (IC-28746, 8 photos) using our own
// grid/type/doodle system — genre conventions, never a traced template (divergence check per style).
// Each strip is ONE wide canvas (N×1080 × 1350) sliced by renderWideSliced(); seam laws from the
// 2026-07-17 research: facts never within 70px of a cut, photos/bands/ghost-type/doodles do the
// crossing, every interior seam gets at least one deliberate crosser, slide 1 stands alone.
// PROOF SCOPE: fixed Spanish copy + hand-placed collages; production wiring (AI copy, room grouping,
// fact gates, i18n, seeded micro-variation) comes after style selection.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { DesignSpec } from "./renderFreeform";
import { renderWideSliced, applyGrain, mix, wrap, photoPalette } from "./carouselSlides";

const W = 1080, H = 1350;
const FR = "Fraunces 115pt";

// ── the real demo listing ─────────────────────────────────────────────────────
const F = {
  title: "Chalet en San Javier",
  zone: "SAN JAVIER · MAR MENOR",
  price: "285.000 €",
  ref: "REF. IC-28746",
  specs: [["2", "HAB."], ["2", "BAÑOS"], ["90", "M²"]] as [string, string][],
  agency: "Mediterráneo Costa Homes",
  initials: "MCH",
  contact: "mediterraneocostahomes.es",
  phone: "+34 600 999 066",
  about:
    "A diez minutos del Mar Menor, esta casa nueva reúne lo que buscabas: luz todo el año, obra terminada y una terraza que pide cenas largas. Lista para entrar a vivir.",
  bullets: ["Obra nueva — lista para entrar", "Piscina privada con solárium", "Terraza y comedor exterior", "A 10 minutos del Mar Menor", "Cocina abierta equipada"],
  pd: "P.D. — Escríbenos «SAN JAVIER» por WhatsApp y te mandamos la ficha.",
};
// photo indices: 0 hero ext+pool · 1 pool terrace · 2 pool deck · 3 gate · 4 salón · 5 salón long · 6 cocina · 7 dormitorio

type El = Record<string, unknown>;
type Pal = { accent: string; ground: string };

/** per-panel brand rail (every slice must self-identify) */
function rail(panel: number, total: number, colour: string, extra = ""): El[] {
  const x = panel * W;
  return [
    { type: "text", bbox: [x + 80, 1272, x + 700, 1300], content: (F.agency + (extra ? `  ·  ${extra}` : "")).toUpperCase(), font: "Jost", size: 16, colour, align: "left", weight: "500", tracking: 3 },
    { type: "text", bbox: [x + 700, 1272, x + 1000, 1300], content: `${String(panel + 1).padStart(2, "0")} — ${String(total).padStart(2, "0")}`, font: "Jost", size: 16, colour, align: "right", tracking: 3 },
  ];
}
function frame(b: [number, number, number, number], colour: string, w = 1.5, opacity?: number): El[] {
  const [x0, y0, x1, y1] = b;
  const o = opacity !== undefined ? { opacity } : {};
  return [
    { type: "rect", bbox: [x0, y0, x1, y0 + w], fill: colour, ...o },
    { type: "rect", bbox: [x0, y1 - w, x1, y1], fill: colour, ...o },
    { type: "rect", bbox: [x0, y0, x0 + w, y1], fill: colour, ...o },
    { type: "rect", bbox: [x1 - w, y0, x1, y1], fill: colour, ...o },
  ];
}
function seal(cx: number, cy: number, r: number, ring: string, ground: string): El[] {
  const c = (rr: number, fill: string): El => ({ type: "rect", bbox: [cx - rr, cy - rr, cx + rr, cy + rr], fill, radius: rr });
  return [
    c(r, ring), c(r - 2, ground), c(r - 12, ring), c(r - 14, ground),
    { type: "text", bbox: [cx - r, cy - 20, cx + r, cy + 20], content: F.initials, font: "Jost", size: 28, colour: ring, align: "center", tracking: 6, valign: "center" },
  ];
}
/** spec row: numeral + label columns with hairline dividers, panel-locked */
function specRow(x: number, y: number, colW: number, num: string, ink: string, muted: string): El[] {
  const els: El[] = [];
  F.specs.forEach(([v, l], i) => {
    const cx = x + i * colW;
    els.push(
      { type: "text", bbox: [cx, y, cx + colW - 20, y + 56], content: v, font: num, size: 46, colour: ink, align: "left" },
      { type: "text", bbox: [cx, y + 62, cx + colW - 20, y + 88], content: l, font: "Jost", size: 17, colour: muted, align: "left", tracking: 3 },
    );
    if (i < F.specs.length - 1) els.push({ type: "rect", bbox: [cx + colW - 34, y + 4, cx + colW - 32.5, y + 82], fill: muted, opacity: 0.55 });
  });
  return els;
}
/** swipe chevrons just left of a seam, bottom rail zone */
function chevrons(seamX: number, colour: string): El[] {
  return [0, 1].map((k) => ({
    type: "text", bbox: [seamX - 110 + k * 34, 1150, seamX - 60 + k * 34, 1190], content: "›", font: "Jost", size: 40, colour, align: "left", weight: "500",
  }));
}

// ══════════════════════════════════════════════════════════════════════════════
// CINTA — the light editorial spine-strip: one tinted band runs the whole deck
// like a ribbon of masthead; plates hang from shared rails beneath it.
// ══════════════════════════════════════════════════════════════════════════════
function cinta(pal: Pal[]): { spec: unknown; slices: number } {
  const N = 6, SW = N * W;
  const paper = "#f7f3ea";
  const ink = "#22303e";
  const accent = pal[0].accent;                       // pool teal drives the deck
  const band = mix(accent, paper, 0.12);              // band = paper tinted toward the water
  const muted = mix(ink, paper, 0.55);
  const els: El[] = [];

  // the ribbon — drawn once across the entire strip (seamless by construction)
  els.push({ type: "rect", bbox: [0, 95, SW, 352], fill: band });
  els.push({ type: "rect", bbox: [0, 352, SW, 354], fill: mix(accent, paper, 0.45) });

  // P1 · COVER ────────────────────────────────────────────────────────────────
  els.push({ type: "text", bbox: [80, 130, 460, 172], content: "A LA VENTA", font: "Jost", size: 20, colour: paper, align: "center", weight: "600", tracking: 5, valign: "center", pill: { fill: ink, pad_x: 26, pad_y: 12 } });
  els.push({ type: "text", bbox: [80, 206, 1040, 330], content: "Una piscina para agosto,", font: FR, size: 78, colour: ink, align: "left" });
  els.push({ type: "text", bbox: [80, 372, 1040, 480], content: "una casa para siempre.", font: FR, size: 78, colour: mix(accent, ink, 0.75), align: "left", italic: true });
  // vertical price rail — the signature fact treatment
  els.push({ type: "text", bbox: [6, 560, 76, 1150], content: `${F.price} · ${F.ref}`, font: "Jost", size: 24, colour: ink, align: "center", tracking: 5, rotate: 90 });
  // hero plate crossing seam 1 — the sole cut element of slide 1
  els.push({ type: "photo", photo: 0, bbox: [190, 560, 1500, 1180], tint: accent, tint_opacity: 0.05 });
  els.push(...frame([172, 542, 1518, 1198], mix(accent, ink, 0.6), 1.5, 0.65));
  els.push({ type: "text", bbox: [190, 1208, 1000, 1240], content: F.zone, font: "Jost", size: 19, colour: muted, align: "left", tracking: 5 });
  els.push(...chevrons(W, mix(ink, paper, 0.7)));

  // P2 · SOBRE LA CASA ─────────────────────────────────────────────────────────
  els.push({ type: "text", bbox: [1620, 150, 2120, 186], content: "SOBRE LA CASA", font: "Jost", size: 20, colour: mix(ink, band, 0.75), align: "left", tracking: 6 });
  els.push({ type: "text", bbox: [1620, 206, 2560, 322], content: "Luz todo el año.", font: FR, size: 76, colour: ink, align: "left" });
  els.push({ type: "text", bbox: [1620, 450, 1950, 960], content: wrap(F.about, "Jost", 26, 330), font: "Jost", size: 26, colour: mix(ink, paper, 0.85), align: "left", line_height: 42 });
  els.push(...specRow(1620, 1110, 132, FR, ink, muted));
  // rimmed circle plates deliberately CENTERED on seam 2 (x = 2160)
  els.push({ type: "photo", photo: 2, bbox: [1990, 560, 2450, 1020], zoom: 1.3, x: 0.45, y: 0.6 });
  els.push({ type: "punch", bbox: [1990, 560, 2450, 1020], fill: paper, shape: "circle", outline: { colour: accent, width: 2, offset: 8 } });
  els.push({ type: "photo", photo: 1, bbox: [2310, 380, 2630, 700], zoom: 1.2, x: 0.55, y: 0.45 });
  els.push({ type: "punch", bbox: [2310, 380, 2630, 700], fill: paper, shape: "circle", outline: { colour: mix(accent, ink, 0.55), width: 1.5, offset: 6 } });
  els.push(...chevrons(2 * W, mix(ink, paper, 0.7)));

  // P3 · LA PISCINA ────────────────────────────────────────────────────────────
  els.push({ type: "text", bbox: [2700, 150, 3200, 186], content: "LA PISCINA", font: "Jost", size: 20, colour: mix(ink, band, 0.75), align: "left", tracking: 6 });
  els.push({ type: "text", bbox: [2700, 206, 3230, 320], content: "El agua, primero.", font: FR, size: 64, colour: ink, align: "left", italic: true });
  els.push({ type: "photo", photo: 1, bbox: [2700, 430, 3460, 1050], tint: accent, tint_opacity: 0.05 });
  els.push(...frame([2682, 412, 3478, 1068], mix(accent, ink, 0.6), 1.5, 0.65));
  // detail cold-open crop survives as a satellite — La Mirada folded into the collage
  els.push({ type: "photo", photo: 2, bbox: [3120, 880, 3420, 1160], zoom: 2.2, x: 0.4, y: 0.75 });
  els.push(...frame([3120, 880, 3420, 1160], paper, 8));
  els.push({ type: "text", bbox: [2700, 1090, 3080, 1200], content: wrap("El turquesa que se ve desde la cocina.", FR, 25, 370), font: FR, size: 25, colour: muted, align: "left", italic: true, line_height: 34 });

  // P4 · DENTRO DE CASA ────────────────────────────────────────────────────────
  const p4a = pal[4].accent;
  els.push({ type: "text", bbox: [3460, 150, 3980, 186], content: "DENTRO DE CASA", font: "Jost", size: 20, colour: mix(ink, band, 0.75), align: "left", tracking: 6 });
  els.push({ type: "text", bbox: [3460, 206, 4200, 320], content: "Cabemos todos.", font: FR, size: 64, colour: ink, align: "left" });
  els.push({ type: "photo", photo: 4, bbox: [3460, 430, 4180, 1000] });
  els.push(...frame([3442, 412, 4198, 1018], mix(p4a, ink, 0.6), 1.5, 0.65));
  // satellites cross seam 4 (photo-class crossers)
  els.push({ type: "photo", photo: 6, bbox: [4240, 430, 4620, 740] });
  els.push(...frame([4240, 430, 4620, 740], paper, 8));
  els.push({ type: "photo", photo: 7, bbox: [4240, 780, 4620, 1080], zoom: 1.15 });
  els.push(...frame([4240, 780, 4620, 1080], paper, 8));
  els.push({ type: "text", bbox: [3460, 1060, 4180, 1120], content: "Salón, cocina abierta y dos dormitorios.", font: FR, size: 26, colour: muted, align: "left", italic: true });

  // P5 · LOS DETALLES — the save/screenshot slide ─────────────────────────────
  els.push({ type: "rect", bbox: [4700, 420, 5330, 1180], fill: mix(band, paper, 0.55), radius: 6 });
  els.push({ type: "text", bbox: [4760, 150, 5260, 186], content: "LOS DETALLES", font: "Jost", size: 20, colour: mix(ink, band, 0.75), align: "left", tracking: 6 });
  els.push({ type: "text", bbox: [4760, 206, 5320, 320], content: "Para tu lista.", font: FR, size: 64, colour: ink, align: "left" });
  F.bullets.forEach((b, i) => {
    els.push({ type: "text", bbox: [4760, 490 + i * 84, 4800, 530 + i * 84], content: "—", font: FR, size: 26, colour: accent, align: "left" });
    els.push({ type: "text", bbox: [4816, 490 + i * 84, 5290, 534 + i * 84], content: b, font: "Jost", size: 25, colour: mix(ink, paper, 0.88), align: "left" });
  });
  els.push({ type: "text", bbox: [4760, 950, 5290, 1026], content: F.price, font: FR, size: 58, colour: ink, align: "left" });
  els.push({ type: "text", bbox: [4760, 1058, 5290, 1128], content: wrap(F.specs.map(([v, l]) => `${v} ${l.toLowerCase()}`).join(" · "), "Jost", 21, 500), font: "Jost", size: 21, colour: muted, align: "left", line_height: 30 });
  els.push(...chevrons(5 * W, mix(ink, paper, 0.7)));

  // P6 · CONTACTO — double-outlined card floating over the band ────────────────
  const cx0 = 5 * W + 170, cx1 = 5 * W + 910;
  els.push({ type: "rect", bbox: [cx0, 180, cx1, 1180], fill: paper, radius: 4 });
  els.push(...frame([cx0, 180, cx1, 1180], ink, 1.5));
  els.push(...frame([cx0 + 14, 194, cx1 - 14, 1166], mix(accent, ink, 0.5), 1));
  els.push(...seal(5 * W + 540, 400, 96, mix(accent, ink, 0.7), paper));
  els.push({ type: "text", bbox: [cx0 + 40, 540, cx1 - 40, 600], content: F.agency, font: FR, size: 42, colour: ink, align: "center" });
  els.push({ type: "text", bbox: [cx0 + 40, 616, cx1 - 40, 650], content: F.zone, font: "Jost", size: 18, colour: muted, align: "center", tracking: 5 });
  els.push({ type: "text", bbox: [cx0 + 40, 730, cx1 - 40, 830], content: "¿La vemos esta semana?", font: FR, size: 50, colour: ink, align: "center", italic: true });
  els.push({ type: "text", bbox: [cx0 + 40, 880, cx1 - 40, 918], content: "ESCRÍBENOS POR WHATSAPP", font: "Jost", size: 21, colour: paper, align: "center", weight: "600", tracking: 3, valign: "center", pill: { fill: mix(accent, ink, 0.75), pad_x: 30, pad_y: 14 } });
  els.push({ type: "text", bbox: [cx0 + 40, 964, cx1 - 40, 996], content: `${F.phone} · ${F.contact}`, font: "Jost", size: 20, colour: mix(ink, paper, 0.8), align: "center" });
  els.push({ type: "text", bbox: [cx0 + 50, 1050, cx1 - 50, 1130], content: wrap(F.pd, FR, 24, cx1 - cx0 - 110), font: FR, size: 24, colour: muted, align: "center", italic: true, line_height: 34 });

  for (let p = 0; p < N; p++) els.push(...rail(p, N, muted, p === 0 ? F.ref : ""));
  return { spec: { background: paper, elements: els }, slices: N };
}

// ══════════════════════════════════════════════════════════════════════════════
// DAMERO — the checkerboard masonry strip: two continuous rows, cells alternating
// photo/text so every text plate is bordered by photographs. Catalogue-confident.
// ══════════════════════════════════════════════════════════════════════════════
function damero(pal: Pal[]): { spec: unknown; slices: number } {
  const N = 6;
  const paper = "#f4f1e8";
  const ink = "#232e3a";
  const accent = pal[0].accent;
  const cell = mix(accent, paper, 0.1);
  const gold = "#b98d3e";
  const muted = mix(ink, paper, 0.55);
  const els: El[] = [];
  const R1: [number, number] = [140, 640], R2: [number, number] = [676, 1188];

  // P1 · COVER breaks the rows: rotated full-height title + hero + price bar ───
  els.push({ type: "text", bbox: [16, 170, 140, 1210], content: "CHALET EN SAN JAVIER", font: FR, size: 64, colour: ink, align: "center", rotate: -90 });
  els.push({ type: "photo", photo: 0, bbox: [160, R1[0], 1980, 900], tint: accent, tint_opacity: 0.05 });
  els.push({ type: "text", bbox: [160, 1110, 1000, 1146], content: F.zone, font: "Jost", size: 19, colour: muted, align: "left", tracking: 5 });

  // P2 · text cell (about) above, pool photo crossing seam 2 below ─────────────
  els.push({ type: "rect", bbox: [1160, 400, 2100, R1[1]], fill: cell });
  els.push({ type: "text", bbox: [1210, 440, 1260, 480], content: "◆", font: "Jost", size: 20, colour: gold, align: "left" });
  els.push({ type: "text", bbox: [1260, 438, 1760, 476], content: "SOBRE LA CASA", font: "Jost", size: 19, colour: mix(ink, cell, 0.7), align: "left", tracking: 5 });
  els.push({ type: "text", bbox: [1210, 496, 2050, R1[1] - 30], content: wrap(F.about, "Jost", 24, 820), font: "Jost", size: 24, colour: mix(ink, cell, 0.9), align: "left", line_height: 38 });
  els.push({ type: "photo", photo: 1, bbox: [1440, R2[0], 2620, R2[1]], x: 0.5, y: 0.55 });
  // price bar rides OVER the pool photo, crossing seam 1 as a field; both text blocks stay panel-locked
  els.push({ type: "rect", bbox: [160, 966, 2130, 1080], fill: gold });
  els.push({ type: "text", bbox: [200, 966, 1000, 1080], content: `A LA VENTA · ${F.price}`, font: "Jost", size: 30, colour: paper, align: "left", weight: "600", tracking: 3, valign: "center" });
  els.push({ type: "text", bbox: [1240, 966, 2050, 1080], content: F.title.toUpperCase(), font: "Jost", size: 24, colour: paper, align: "left", tracking: 3, valign: "center" });

  // P3 · top: salón crossing seam 3 · bottom: punched circle + specs card ──────
  els.push({ type: "photo", photo: 4, bbox: [2660, R1[0], 3580, R1[1]] });
  els.push({ type: "photo", photo: 2, bbox: [2700, 780, 3140, 1180], zoom: 1.25, x: 0.45, y: 0.65 });
  els.push({ type: "punch", bbox: [2700, 780, 3140, 1180], fill: paper, shape: "circle", outline: { colour: gold, width: 2, offset: 7 } });
  els.push({ type: "rect", bbox: [3300, R2[0], 4180, R2[1]], fill: ink });
  els.push({ type: "text", bbox: [3350, R2[0] + 56, 3850, R2[0] + 94], content: "◆  LA CASA EN CIFRAS", font: "Jost", size: 19, colour: mix(paper, ink, 0.75), align: "left", tracking: 4 });
  F.specs.forEach(([v, l], i) => {
    const cx = 3350 + i * 260;
    els.push({ type: "text", bbox: [cx, R2[0] + 170, cx + 220, R2[0] + 250], content: v, font: FR, size: 64, colour: paper, align: "left" });
    els.push({ type: "text", bbox: [cx, R2[0] + 260, cx + 220, R2[0] + 292], content: l, font: "Jost", size: 18, colour: mix(paper, ink, 0.65), align: "left", tracking: 3 });
    if (i < 2) els.push({ type: "rect", bbox: [cx + 236, R2[0] + 180, cx + 237.5, R2[0] + 280], fill: mix(paper, ink, 0.4) });
  });
  els.push({ type: "text", bbox: [3350, R2[1] - 120, 4130, R2[1] - 60], content: F.price, font: FR, size: 54, colour: gold, align: "left" });

  // P4 · text cell top (panel-locked), kitchen right · bedroom crosses seam 4 ──
  els.push({ type: "rect", bbox: [3600, R1[0], 4300, R1[1]], fill: cell });
  els.push({ type: "text", bbox: [3650, R1[0] + 52, 4160, R1[0] + 90], content: "◆  DENTRO DE CASA", font: "Jost", size: 19, colour: mix(ink, cell, 0.7), align: "left", tracking: 4 });
  els.push({ type: "text", bbox: [3650, R1[0] + 128, 4250, R1[1] - 50], content: wrap("Cocina abierta, salón con doble altura de luz y dos dormitorios que miran al este.", FR, 31, 580), font: FR, size: 31, colour: ink, align: "left", line_height: 46, italic: true });
  els.push({ type: "photo", photo: 6, bbox: [4360, R1[0], 5040, R1[1]] });
  els.push({ type: "photo", photo: 7, bbox: [4240, R2[0], 4660, R2[1]], zoom: 1.1 });

  // P5 · barrio cell + gate crossing seam 5 · pool crossing below ──────────────
  els.push({ type: "photo", photo: 3, bbox: [5100, R1[0], 5560, R1[1]] });
  els.push({ type: "rect", bbox: [4720, R2[0], 5330, R2[1]], fill: cell });
  els.push({ type: "text", bbox: [4770, R2[0] + 52, 5280, R2[0] + 90], content: "◆  EL BARRIO", font: "Jost", size: 19, colour: mix(ink, cell, 0.7), align: "left", tracking: 4 });
  els.push({ type: "text", bbox: [4770, R2[0] + 128, 5280, R2[1] - 50], content: wrap("Playas del Mar Menor a diez minutos, cafés abiertos todo el año y golf a un paso.", FR, 28, 490), font: FR, size: 28, colour: ink, align: "left", line_height: 42, italic: true });
  els.push({ type: "photo", photo: 5, bbox: [5340, R2[0], 5700, R2[1]], zoom: 1.1 });

  // P6 · CLOSER: double-outlined banner + contact row ──────────────────────────
  els.push(...frame([5620, R1[0], 6440, R1[1]], ink, 1.5));
  els.push(...frame([5634, R1[0] + 14, 6426, R1[1] - 14], gold, 1));
  els.push({ type: "text", bbox: [5660, R1[0] + 110, 6400, R1[0] + 230], content: "¿La vemos esta semana?", font: FR, size: 52, colour: ink, align: "center", italic: true });
  els.push({ type: "text", bbox: [5660, R1[0] + 280, 6400, R1[0] + 330], content: "VISITA PRIVADA · POR WHATSAPP", font: "Jost", size: 20, colour: mix(ink, paper, 0.7), align: "center", tracking: 4 });
  els.push(...seal(5800, 900, 80, gold, paper));
  els.push({ type: "text", bbox: [5910, 832, 6440, 880], content: F.agency, font: FR, size: 31, colour: ink, align: "left" });
  els.push({ type: "text", bbox: [5910, 892, 6440, 922], content: `${F.phone} · ${F.contact}`, font: "Jost", size: 19, colour: muted, align: "left" });
  els.push({ type: "text", bbox: [5910, 932, 6440, 960], content: F.ref, font: "Jost", size: 17, colour: muted, align: "left", tracking: 3 });
  els.push({ type: "text", bbox: [5640, 1030, 6420, 1110], content: wrap(F.pd, FR, 23, 760), font: FR, size: 23, colour: muted, align: "left", italic: true, line_height: 32 });

  for (let p = 0; p < N; p++) els.push(...rail(p, N, muted, p === 0 ? F.ref : ""));
  return { spec: { background: paper, elements: els }, slices: N };
}

// ══════════════════════════════════════════════════════════════════════════════
// ALBOROTO — the scrapbook strip: polaroid stacks, washi tape, one wandering
// doodle line crossing every seam. The "a friend made this" antidote to templates.
// ══════════════════════════════════════════════════════════════════════════════
function alboroto(pal: Pal[]): { spec: unknown; slices: number } {
  const N = 6;
  const ground = mix("#c8825f", mix(pal[4].ground, "#e8c9a8", 0.5), 0.32);  // dusty terracotta from the interiors
  const ink = "#3d2b22";
  const paper = "#fdfaf3";
  const tape = mix("#e8b64c", ground, 0.5);
  const muted = mix(ink, ground, 0.6);
  const note = mix(paper, ground, 0.9);
  const els: El[] = [];

  /** polaroid: paper plate + photo + bottom lip, rotated; optional washi tape */
  const pola = (photo: number, b: [number, number, number, number], rot: number, taped = true, zoom?: number, px?: number, py?: number): El[] => {
    const [x0, y0, x1, y1] = b;
    const bw = Math.round((x1 - x0) * 0.035);
    const out: El[] = [
      { type: "rect", bbox: [x0 - bw, y0 - bw, x1 + bw, y1 + bw * 3], fill: paper, rotate: rot, radius: 2 },
      { type: "photo", photo, bbox: b, rotate: rot, ...(zoom ? { zoom, x: px, y: py } : {}) },
    ];
    if (taped) out.push({ type: "rect", bbox: [x0 + (x1 - x0) * 0.32, y0 - bw - 26, x0 + (x1 - x0) * 0.68, y0 - bw + 30], fill: tape, opacity: 0.8, rotate: -rot * 1.4, radius: 2 });
    return out;
  };
  // the wandering doodle line — arcs + waves threading BETWEEN clusters, crossing every seam
  const wander: El[] = [
    { type: "doodle", kind: "arc", bbox: [830, 1020, 1330, 1260], colour: ink },
    { type: "doodle", kind: "wave", bbox: [2020, 70, 2520, 190], colour: ink },
    { type: "doodle", kind: "arc", bbox: [3140, 1100, 3580, 1300], colour: ink },
    { type: "doodle", kind: "wave", bbox: [4200, 110, 4700, 230], colour: ink },
    { type: "doodle", kind: "sparkle", bbox: [5390, 150, 5550, 310], colour: ink },
    { type: "doodle", kind: "arc", bbox: [4240, 1170, 4680, 1310], colour: ink },
  ];

  // P1 · COVER: display phrase on ground, hero polaroid crossing seam 1 ────────
  els.push({ type: "text", bbox: [80, 140, 1000, 250], content: "Nueva en", font: FR, size: 86, colour: paper, align: "left" });
  els.push({ type: "text", bbox: [80, 262, 1030, 380], content: "San Javier.", font: FR, size: 86, colour: ink, align: "left", italic: true });
  els.push(...pola(0, [200, 520, 1420, 1120], -3));
  els.push({ type: "text", bbox: [110, 1170, 760, 1240], content: F.price, font: FR, size: 54, colour: ink, align: "center", valign: "center", pill: { fill: paper, pad_x: 34, pad_y: 16 } });
  els.push({ type: "rect", bbox: [300, 1146, 480, 1188], fill: tape, opacity: 0.8, rotate: 6, radius: 2 });

  // P2 · about scrap-plate + pool polaroid pair ────────────────────────────────
  els.push({ type: "rect", bbox: [1620, 220, 2480, 620], fill: paper, rotate: 1, radius: 3 });
  els.push({ type: "text", bbox: [1670, 262, 2140, 300], content: "SOBRE LA CASA", font: "Jost", size: 18, colour: muted, align: "left", tracking: 5 });
  els.push({ type: "text", bbox: [1670, 320, 2430, 580], content: wrap(F.about, "Jost", 25, 740), font: "Jost", size: 25, colour: ink, align: "left", line_height: 40 });
  els.push(...pola(1, [1700, 740, 2460, 1150], 2.5));
  els.push(...pola(2, [2380, 620, 2900, 1010], -4, true, 1.2, 0.45, 0.6));
  els.push({ type: "text", bbox: [1740, 1162, 2440, 1216], content: "la luz de la mañana en la terraza…", font: FR, size: 25, colour: ink, align: "left", italic: true });

  // P3 · gate polaroid + spec scraps ───────────────────────────────────────────
  els.push(...pola(3, [3020, 220, 3760, 700], 3));
  F.specs.forEach(([v, l], i) => {
    const sx = 2980 + i * 240;
    els.push({ type: "rect", bbox: [sx, 800 + (i % 2) * 26, sx + 208, 960 + (i % 2) * 26], fill: paper, rotate: i % 2 ? 2 : -2, radius: 3 });
    els.push({ type: "text", bbox: [sx, 830 + (i % 2) * 26, sx + 208, 894 + (i % 2) * 26], content: v, font: FR, size: 52, colour: ink, align: "center" });
    els.push({ type: "text", bbox: [sx, 900 + (i % 2) * 26, sx + 208, 930 + (i % 2) * 26], content: l, font: "Jost", size: 16, colour: muted, align: "center", tracking: 3 });
  });
  els.push({ type: "text", bbox: [2990, 1010, 3700, 1070], content: "y sitio para la siesta ↓", font: FR, size: 26, colour: note, align: "left", italic: true });

  // P4 · interiors cluster: salón dominant crossing seam 4, cocina above ───────
  els.push(...pola(4, [3760, 360, 4760, 970], -2));
  els.push(...pola(6, [4840, 200, 5340, 600], 3.5, true, 1.1));
  els.push({ type: "text", bbox: [3820, 992, 4700, 1046], content: "el salón donde caben todos", font: FR, size: 25, colour: ink, align: "left", italic: true });

  // P5 · bedroom crossing seam 5 + the cat ─────────────────────────────────────
  els.push(...pola(7, [4900, 660, 5460, 1080], 2));
  els.push({ type: "text", bbox: [4930, 1088, 5450, 1136], content: "dormir con las ventanas abiertas", font: FR, size: 23, colour: ink, align: "left", italic: true });

  // P6 · CONTACTO: taped card + seal + P.D.; the wander line ends in a flourish ─
  els.push({ type: "rect", bbox: [5550, 260, 6440, 1130], fill: paper, rotate: -1, radius: 3 });
  els.push({ type: "rect", bbox: [5830, 214, 6130, 292], fill: tape, opacity: 0.8, rotate: 3, radius: 2 });
  els.push(...seal(5960, 480, 88, mix(ink, paper, 0.8), paper));
  els.push({ type: "text", bbox: [5620, 620, 6380, 680], content: F.agency, font: FR, size: 40, colour: ink, align: "center" });
  els.push({ type: "text", bbox: [5620, 700, 6380, 800], content: "¿La vemos esta semana?", font: FR, size: 48, colour: ink, align: "center", italic: true });
  els.push({ type: "text", bbox: [5620, 850, 6380, 888], content: "ESCRÍBENOS POR WHATSAPP", font: "Jost", size: 20, colour: paper, align: "center", weight: "600", tracking: 3, valign: "center", pill: { fill: ink, pad_x: 30, pad_y: 14 } });
  els.push({ type: "text", bbox: [5620, 930, 6380, 962], content: `${F.phone} · ${F.contact} · ${F.ref}`, font: "Jost", size: 19, colour: muted, align: "center" });
  els.push({ type: "text", bbox: [5660, 1010, 6340, 1090], content: wrap(F.pd, FR, 23, 1080), font: FR, size: 23, colour: mix(ink, paper, 0.6), align: "center", italic: true, line_height: 32 });
  els.push({ type: "doodle", kind: "cat", bbox: [6180, 1150, 6360, 1310], colour: ink });
  els.push(...wander);

  for (let p = 0; p < N; p++) els.push(...rail(p, N, mix(paper, ground, 0.85), p === 0 ? F.ref : ""));
  return { spec: { background: ground, elements: els }, slices: N };
}

// ══════════════════════════════════════════════════════════════════════════════
// BASALTO — the dark luxury mosaic: flush photo columns, colour-block text cells,
// a ghost word running UNDER the plates across three panels. The evening style.
// ══════════════════════════════════════════════════════════════════════════════
function basalto(pal: Pal[]): { spec: unknown; slices: number } {
  const N = 6;
  const ground = "#16233a";                 // brand navy home turf
  const cellD = mix("#0e1726", ground, 0.5);
  const bone = "#efe9dc";
  const gold = "#c2a05a";
  const muted = mix(bone, ground, 0.55);
  const els: El[] = [];

  // GHOST WORD — under everything, spanning panels 2-4, cut mid-letter at seams;
  // the mosaic leaves deliberate voids where the giant letters surface.
  els.push({ type: "text", bbox: [1180, 140, 4900, 900], content: "HOGAR", font: FR, size: 540, colour: mix(bone, ground, 0.1), align: "left" });
  // journey rule: gold line the whole strip, terminates at the contact seal
  els.push({ type: "rect", bbox: [0, 1216, 5870, 1219], fill: mix(gold, ground, 0.8) });

  // P1 · COVER: full-bleed exterior + colour block bottom-left crossing seam 1 ──
  els.push({ type: "photo", photo: 0, bbox: [0, 0, W + 200, 1350], tint: ground, tint_opacity: 0.14 });
  els.push({ type: "rect", bbox: [0, 790, 660, 1216], fill: ground, opacity: 0.94 });
  els.push({ type: "text", bbox: [60, 846, 600, 882], content: "A LA VENTA", font: "Jost", size: 19, colour: gold, align: "left", tracking: 6 });
  els.push({ type: "text", bbox: [60, 900, 620, 1040], content: F.title, font: FR, size: 56, colour: bone, align: "left", line_height: 66 });
  els.push({ type: "text", bbox: [60, 1076, 600, 1150], content: F.price, font: FR, size: 54, colour: gold, align: "left" });

  // P2 · salón column + spec cell; the void above right lets the ghost surface ─
  els.push({ type: "photo", photo: 4, bbox: [1290, 0, 2000, 810] });
  els.push({ type: "rect", bbox: [1290, 818, 2000, 1216], fill: cellD });
  els.push({ type: "text", bbox: [1350, 878, 1950, 914], content: "LA CASA EN CIFRAS", font: "Jost", size: 18, colour: muted, align: "left", tracking: 5 });
  F.specs.forEach(([v, l], i) => {
    const cx = 1350 + i * 200;
    els.push({ type: "text", bbox: [cx, 950, cx + 170, 1030], content: v, font: FR, size: 56, colour: bone, align: "left" });
    els.push({ type: "text", bbox: [cx, 1040, cx + 170, 1070], content: l, font: "Jost", size: 16, colour: muted, align: "left", tracking: 3 });
    if (i < 2) els.push({ type: "rect", bbox: [cx + 176, 960, cx + 177.5, 1050], fill: mix(bone, ground, 0.3) });
  });

  // P3 · quote on ground (ghost passes behind) + pool column crossing seam 3 ───
  els.push({ type: "text", bbox: [2080, 700, 2760, 740], content: "EL AGUA, PRIMERO", font: "Jost", size: 18, colour: gold, align: "left", tracking: 6 });
  els.push({ type: "text", bbox: [2080, 780, 2760, 1010], content: wrap("Piscina privada, solárium y diez minutos del Mar Menor.", FR, 38, 660), font: FR, size: 38, colour: bone, align: "left", line_height: 54, italic: true });
  els.push({ type: "photo", photo: 1, bbox: [2820, 0, 3560, 1216], x: 0.5, y: 0.55 });

  // P4 · kitchen column + quiet cell; bedroom crosses seam 4 ───────────────────
  els.push({ type: "photo", photo: 6, bbox: [3770, 0, 4180, 700] });
  els.push({ type: "rect", bbox: [3770, 710, 4180, 1216], fill: cellD });
  els.push({ type: "text", bbox: [3820, 780, 4140, 816], content: "DENTRO DE CASA", font: "Jost", size: 17, colour: muted, align: "left", tracking: 4 });
  els.push({ type: "text", bbox: [3820, 850, 4140, 1150], content: wrap("Cocina abierta, obra nueva, luz del este.", FR, 32, 300), font: FR, size: 32, colour: bone, align: "left", line_height: 46, italic: true });
  els.push({ type: "photo", photo: 7, bbox: [4240, 0, 4720, 810], zoom: 1.1 });

  // P5 · the breather: details recap on pure ground ────────────────────────────
  els.push({ type: "rect", bbox: [4780, 0, 6480, 1350], fill: ground });
  els.push({ type: "text", bbox: [4860, 170, 5330, 206], content: "LOS DETALLES", font: "Jost", size: 19, colour: gold, align: "left", tracking: 6 });
  F.bullets.forEach((b, i) => {
    els.push({ type: "rect", bbox: [4864, 306 + i * 96, 4904, 308 + i * 96], fill: gold });
    els.push({ type: "text", bbox: [4924, 278 + i * 96, 5340, 366 + i * 96], content: wrap(b, "Jost", 24, 400), font: "Jost", size: 24, colour: mix(bone, ground, 0.88), align: "left", line_height: 32 });
  });
  els.push({ type: "text", bbox: [4860, 830, 5340, 906], content: F.price, font: FR, size: 56, colour: bone, align: "left" });
  els.push({ type: "text", bbox: [4860, 940, 5340, 1010], content: wrap(`${F.zone} · ${F.ref}`, "Jost", 16, 440), font: "Jost", size: 16, colour: muted, align: "left", tracking: 2, line_height: 24 });
  // gold plus crossing seam 5 (the breather's only decor)
  els.push({ type: "doodle", kind: "plus", bbox: [5330, 120, 5470, 260], colour: mix(gold, ground, 0.75) });

  // P6 · CONTACTO: gold-ring seal + arch flourish, the once-per-deck punch ─────
  els.push({ type: "photo", photo: 3, bbox: [6020, 120, 6420, 700], zoom: 1.1 });
  els.push({ type: "punch", bbox: [6020, 120, 6420, 700], fill: ground, shape: "arch", outline: { colour: gold, width: 1.5, offset: 10 } });
  els.push(...seal(5700, 360, 90, gold, ground));
  els.push({ type: "text", bbox: [5540, 500, 5860, 540], content: F.agency.toUpperCase(), font: "Jost", size: 16, colour: muted, align: "center", tracking: 3 });
  els.push({ type: "text", bbox: [5540, 760, 6400, 860], content: "¿La vemos esta semana?", font: FR, size: 54, colour: bone, align: "left", italic: true });
  els.push({ type: "text", bbox: [5540, 910, 6400, 948], content: "VISITA PRIVADA · POR WHATSAPP", font: "Jost", size: 20, colour: gold, align: "left", tracking: 4 });
  els.push({ type: "text", bbox: [5540, 980, 6400, 1012], content: `${F.phone} · ${F.contact}`, font: "Jost", size: 20, colour: mix(bone, ground, 0.75), align: "left" });
  els.push({ type: "text", bbox: [5540, 1080, 6380, 1160], content: wrap(F.pd, FR, 24, 840), font: FR, size: 24, colour: muted, align: "left", italic: true, line_height: 34 });

  for (let p = 0; p < N; p++) els.push(...rail(p, N, muted, p === 0 ? F.ref : ""));
  return { spec: { background: ground, elements: els }, slices: N };
}

// ── runner ────────────────────────────────────────────────────────────────────
const SCRATCH = process.env.SEAMLESS_OUT ?? "studio/out/seamless";
async function main() {
  const dir = process.env.SEAMLESS_PHOTOS ?? SCRATCH;
  const files = ["sj-41682", "sj-41683", "sj-41684", "sj-41685", "sj-41686", "sj-41687", "sj-41688", "sj-41689"];
  const photos = files.map((f) => readFileSync(join(dir, `${f}.jpg`)));
  const pal = await Promise.all(photos.map((b) => photoPalette(b)));
  console.log("palettes:", JSON.stringify(pal.map((p) => p.accent)));
  mkdirSync(SCRATCH, { recursive: true });

  const styles: [string, (p: Pal[]) => { spec: unknown; slices: number }][] = [
    ["cinta", cinta], ["damero", damero], ["alboroto", alboroto], ["basalto", basalto],
  ];
  for (const [name, fn] of styles) {
    const { spec, slices } = fn(pal);
    const parsed = DesignSpec.parse(spec);
    const out = await renderWideSliced(parsed, slices, photos);
    const graded: Buffer[] = [];
    for (const s of out) graded.push(await applyGrain(s, name === "basalto" ? 0.03 : 0.045));
    for (let i = 0; i < graded.length; i++) {
      writeFileSync(join(SCRATCH, `${name}-${String(i + 1).padStart(2, "0")}.jpg`), await sharp(graded[i]).resize({ width: 560 }).jpeg({ quality: 84 }).toBuffer());
    }
    // the seamless strip view (what the swipe feels like)
    const thumbs = await Promise.all(graded.map((b) => sharp(b).resize({ width: 380 }).jpeg({ quality: 80 }).toBuffer()));
    const tw = 380, th = Math.round(380 * H / W);
    const comps = thumbs.map((b, i) => ({ input: b, left: i * tw, top: 0 }));
    writeFileSync(join(SCRATCH, `${name}-strip.jpg`), await sharp({ create: { width: tw * slices, height: th, channels: 3 as const, background: "#ffffff" } }).composite(comps).jpeg({ quality: 82 }).toBuffer());
    console.log(`${name}: ${slices} slides ok`);
  }
}
main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
