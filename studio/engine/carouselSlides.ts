import { renderFreeform, DesignSpec } from "./renderFreeform";
import { textWidth } from "./renderEditable";
import { CarouselBrand } from "./renderCarousel";

// CAROUSEL SLIDE LIBRARY v2 (research-rebuilt 2026-07-16). Built on the carousel-effectiveness doctrine:
//  · slide 1 AND slide 2 are covers (Instagram re-serves unswiped carousels starting at slide 2 — Mosseri 10/2024)
//  · one idea per slide, 15-40 words, open-loop footer teasing the next slide (watch time = #1 ranking signal)
//  · recap slide before the CTA = the screenshot/save/forward unit (saves & sends are the reach levers)
//  · CTA slide leads with a KPI-matched action (save/send/DM keyword) — contact details demoted to the footer
//  · colour rhythm: navy cover → cream content → navy CTA; gold only for large accents/numerals (never body text)
//  · editorial "02 / 08" page marks at the muted tier (never dots, never top-right — Instagram's own pill lives there)
//  · 80px margins; type floor 28px; max 3 sizes per slide; no emoji, no drop shadows, no gradient text.
// The AI writes the words (plan), this library draws every pixel. Fonts: Libre Caslon Display + Jost.

const W = 1080, H = 1350;
const M = 80;                       // doctrine margin (covers IG's 3:4 grid crop + edge safety)
const SERIF = "Libre Caslon Display";
const SANS = "Jost";

export interface CarouselPlan {
  type: "tips" | "quote";
  eyebrow: string;                            // kicker above the cover hook
  hook_title: string;                         // cover headline — 5-8 words, loss/gap framed
  slide2_title: string;                       // second cover: self-qualification headline
  slide2_body: string;                        // who this is for / the stakes (standalone — never a continuation)
  tips: { title: string; body: string; teaser: string }[];  // tips type: teaser = open-loop line for the NEXT slide
  recap_title: string;                        // tips type: recap heading ("En 30 segundos")
  save_line: string;                          // recap: the save trigger ("Guárdalo para tu próxima visita")
  quote_parts: string[];                      // quote type: the quote VERBATIM, in readable chunks
  quote_hook: string;                         // quote type: cover = the most concrete quote fragment (verbatim subset)
  quote_context: string;                      // quote type slide 2: restates only what the quote itself says
  attribution: string;                        // quote type: who said it
  cta_heading: string;                        // CTA headline
  cta_action: string;                         // the KPI action line (save/send framing) — the real CTA
  cta_keyword: string;                        // DM keyword pill text ("Escríbenos: GUÍA")
  swipe_cue: string;                          // "Desliza" / "Swipe" in the post language
  caption: string;
  hashtags: string[];                         // HARD MAX 5 (Instagram cap since Dec 2025)
}

/** Measured word-wrap: freeform splits on \n only (and shrink-fits the widest line), so paragraphs
 *  must be broken into lines HERE, at the real rendered width, or long copy shrinks to nothing. */
export function wrap(text: string, font: string, size: number, maxW: number, weight?: string): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const probe = line ? line + " " + w : w;
    if (line && textWidth(font, probe, size, weight) > maxW) { lines.push(line); line = w; }
    else line = probe;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

// ── CHROME i18n (Christian 2026-07-16: "carousels chooseable in all languages") ─────────────────
// Every FIXED string the deterministic renderers draw (labels, fallbacks, furniture) — the AI copy
// already follows the post language; this dictionary makes the chrome follow it too.
export interface CarouselChrome {
  bed: string; bath: string; sqm: string;
  price: string; area: string; bedrooms: string; bathrooms: string; extras: string;
  the_sheet: string;         // "LA FICHA" — the facts-plate heading
  save_sheet: string;        // "Guarda esta ficha para tu visita"
  follow: string;            // "Sigue"
  swipe: string;             // fallback swipe cue
  write_us: string;          // "ESCRÍBENOS" — DM keyword prefix
  visit_kw: string;          // default DM keyword
  save_cta: string;          // default CTA action
  the_detail: string;        // "EL DETALLE"
  lot: string;               // "LOTE Nº" collector label
  save_calm: string;         // sereno recap line
  on_cover: string;          // "EN PORTADA"
  in_this_issue: string;     // "EN ESTE NÚMERO"
  note_for_you: string;      // recorte CTA note heading
  error_n: string;           // "Nº %1 DE %2" progress label
  found: string;             // recorte script annotation ("encontrada")
  ai_tag: string;            // disclosure micro-tag on slides with a generated image layer
}
const C = (o: CarouselChrome) => o;
export const CAROUSEL_CHROME: Record<string, CarouselChrome> = {
  es: C({ bed: "DORM", bath: "BAÑOS", sqm: "M²", price: "PRECIO", area: "SUPERFICIE", bedrooms: "DORMITORIOS", bathrooms: "BAÑOS", extras: "EXTRAS", the_sheet: "LA FICHA", save_sheet: "Guarda esta ficha para tu visita", follow: "Sigue", swipe: "Desliza", write_us: "ESCRÍBENOS", visit_kw: "VISITA", save_cta: "Guarda este anuncio para tu próxima visita a la zona.", the_detail: "EL DETALLE", lot: "LOTE Nº", save_calm: "Guarda la ficha — vuelve a ella con calma.", on_cover: "EN PORTADA", in_this_issue: "EN ESTE NÚMERO", note_for_you: "NOTA PARA TI:", error_n: "Nº %1 DE %2", found: "encontrada" , ai_tag: "Imagen ilustrativa generada con IA" }),
  en: C({ bed: "BED", bath: "BATH", sqm: "M²", price: "PRICE", area: "SIZE", bedrooms: "BEDROOMS", bathrooms: "BATHROOMS", extras: "EXTRAS", the_sheet: "THE FACTS", save_sheet: "Save this sheet for your viewing", follow: "Next", swipe: "Swipe", write_us: "MESSAGE US", visit_kw: "VISIT", save_cta: "Save this listing for your next trip to the area.", the_detail: "THE DETAIL", lot: "LOT No.", save_calm: "Save the sheet — come back to it calmly.", on_cover: "ON THE COVER", in_this_issue: "IN THIS ISSUE", note_for_you: "NOTE TO YOU:", error_n: "No. %1 OF %2", found: "found it" , ai_tag: "Illustrative image generated with AI" }),
  de: C({ bed: "SCHLAFZ.", bath: "BÄDER", sqm: "M²", price: "PREIS", area: "FLÄCHE", bedrooms: "SCHLAFZIMMER", bathrooms: "BADEZIMMER", extras: "EXTRAS", the_sheet: "DAS EXPOSÉ", save_sheet: "Speichern Sie dieses Exposé für Ihre Besichtigung", follow: "Weiter", swipe: "Wischen", write_us: "SCHREIBEN SIE UNS", visit_kw: "BESUCH", save_cta: "Speichern Sie dieses Angebot für Ihre nächste Reise.", the_detail: "DAS DETAIL", lot: "LOS Nr.", save_calm: "Speichern — und in Ruhe wiederkommen.", on_cover: "AUF DEM COVER", in_this_issue: "IN DIESER AUSGABE", note_for_you: "NOTIZ FÜR SIE:", error_n: "Nr. %1 VON %2", found: "gefunden" , ai_tag: "Illustratives KI-generiertes Bild" }),
  fr: C({ bed: "CH.", bath: "SDB", sqm: "M²", price: "PRIX", area: "SURFACE", bedrooms: "CHAMBRES", bathrooms: "SALLES DE BAIN", extras: "EXTRAS", the_sheet: "LA FICHE", save_sheet: "Gardez cette fiche pour votre visite", follow: "Suite", swipe: "Glissez", write_us: "ÉCRIVEZ-NOUS", visit_kw: "VISITE", save_cta: "Gardez cette annonce pour votre prochain séjour.", the_detail: "LE DÉTAIL", lot: "LOT Nº", save_calm: "Gardez la fiche — revenez-y calmement.", on_cover: "EN COUVERTURE", in_this_issue: "DANS CE NUMÉRO", note_for_you: "NOTE POUR VOUS :", error_n: "Nº %1 SUR %2", found: "trouvée" , ai_tag: "Image illustrative générée par IA" }),
  nl: C({ bed: "SLPK", bath: "BADK", sqm: "M²", price: "PRIJS", area: "OPPERVLAKTE", bedrooms: "SLAAPKAMERS", bathrooms: "BADKAMERS", extras: "EXTRA'S", the_sheet: "DE FICHE", save_sheet: "Bewaar deze fiche voor je bezichtiging", follow: "Verder", swipe: "Swipe", write_us: "STUUR ONS", visit_kw: "BEZOEK", save_cta: "Bewaar deze woning voor je volgende trip.", the_detail: "HET DETAIL", lot: "LOT Nr.", save_calm: "Bewaar de fiche — kom er rustig op terug.", on_cover: "OP DE COVER", in_this_issue: "IN DIT NUMMER", note_for_you: "NOTITIE VOOR JOU:", error_n: "Nr. %1 VAN %2", found: "gevonden" , ai_tag: "Illustratieve AI-gegenereerde afbeelding" }),
  sv: C({ bed: "SOVRUM", bath: "BADRUM", sqm: "M²", price: "PRIS", area: "YTA", bedrooms: "SOVRUM", bathrooms: "BADRUM", extras: "EXTRA", the_sheet: "FAKTABLADET", save_sheet: "Spara bladet till din visning", follow: "Nästa", swipe: "Svep", write_us: "SKRIV TILL OSS", visit_kw: "VISNING", save_cta: "Spara annonsen till din nästa resa hit.", the_detail: "DETALJEN", lot: "POST Nr", save_calm: "Spara bladet — återkom i lugn och ro.", on_cover: "PÅ OMSLAGET", in_this_issue: "I DETTA NUMMER", note_for_you: "ANTECKNING TILL DIG:", error_n: "Nr %1 AV %2", found: "hittad" , ai_tag: "Illustrativ AI-genererad bild" }),
  no: C({ bed: "SOVEROM", bath: "BAD", sqm: "M²", price: "PRIS", area: "AREAL", bedrooms: "SOVEROM", bathrooms: "BAD", extras: "EKSTRA", the_sheet: "FAKTAARKET", save_sheet: "Lagre arket til visningen din", follow: "Neste", swipe: "Sveip", write_us: "SKRIV TIL OSS", visit_kw: "VISNING", save_cta: "Lagre annonsen til neste tur hit.", the_detail: "DETALJEN", lot: "POST Nr", save_calm: "Lagre arket — kom tilbake i ro og mak.", on_cover: "PÅ FORSIDEN", in_this_issue: "I DETTE NUMMERET", note_for_you: "NOTAT TIL DEG:", error_n: "Nr %1 AV %2", found: "funnet" , ai_tag: "Illustrativt AI-generert bilde" }),
  da: C({ bed: "VÆRELSER", bath: "BADEVÆR.", sqm: "M²", price: "PRIS", area: "AREAL", bedrooms: "SOVEVÆRELSER", bathrooms: "BADEVÆRELSER", extras: "EKSTRA", the_sheet: "FAKTAARKET", save_sheet: "Gem arket til din fremvisning", follow: "Næste", swipe: "Swipe", write_us: "SKRIV TIL OS", visit_kw: "BESØG", save_cta: "Gem annoncen til din næste tur hertil.", the_detail: "DETALJEN", lot: "PARTI Nr.", save_calm: "Gem arket — vend roligt tilbage.", on_cover: "PÅ FORSIDEN", in_this_issue: "I DETTE NUMMER", note_for_you: "NOTE TIL DIG:", error_n: "Nr. %1 AF %2", found: "fundet" , ai_tag: "Illustrativt AI-genereret billede" }),
  fi: C({ bed: "MH", bath: "KPH", sqm: "M²", price: "HINTA", area: "PINTA-ALA", bedrooms: "MAKUUHUONEET", bathrooms: "KYLPYHUONEET", extras: "LISÄT", the_sheet: "TIETOKORTTI", save_sheet: "Tallenna kortti näyttöäsi varten", follow: "Seuraava", swipe: "Pyyhkäise", write_us: "KIRJOITA MEILLE", visit_kw: "NÄYTTÖ", save_cta: "Tallenna ilmoitus seuraavaa matkaasi varten.", the_detail: "YKSITYISKOHTA", lot: "ERÄ Nro", save_calm: "Tallenna kortti — palaa siihen rauhassa.", on_cover: "KANNESSA", in_this_issue: "TÄSSÄ NUMEROSSA", note_for_you: "MUISTIINPANO SINULLE:", error_n: "Nro %1 / %2", found: "löytyi" , ai_tag: "Havainnollistava tekoälyllä luotu kuva" }),
  pl: C({ bed: "SYP.", bath: "ŁAZ.", sqm: "M²", price: "CENA", area: "POWIERZCHNIA", bedrooms: "SYPIALNIE", bathrooms: "ŁAZIENKI", extras: "DODATKI", the_sheet: "KARTA OFERTY", save_sheet: "Zapisz kartę na swoją wizytę", follow: "Dalej", swipe: "Przesuń", write_us: "NAPISZ DO NAS", visit_kw: "WIZYTA", save_cta: "Zapisz ogłoszenie na następny wyjazd.", the_detail: "DETAL", lot: "POZYCJA Nr", save_calm: "Zapisz kartę — wróć do niej spokojnie.", on_cover: "NA OKŁADCE", in_this_issue: "W TYM NUMERZE", note_for_you: "NOTATKA DLA CIEBIE:", error_n: "Nr %1 Z %2", found: "znalezione" , ai_tag: "Ilustracja wygenerowana przez AI" }),
  ru: C({ bed: "СПАЛЬНИ", bath: "ВАННЫЕ", sqm: "М²", price: "ЦЕНА", area: "ПЛОЩАДЬ", bedrooms: "СПАЛЬНИ", bathrooms: "ВАННЫЕ", extras: "ДОПОЛНИТЕЛЬНО", the_sheet: "КАРТОЧКА", save_sheet: "Сохраните карточку для просмотра", follow: "Далее", swipe: "Листайте", write_us: "НАПИШИТЕ НАМ", visit_kw: "ВИЗИТ", save_cta: "Сохраните объявление для следующей поездки.", the_detail: "ДЕТАЛЬ", lot: "ЛОТ №", save_calm: "Сохраните карточку — вернитесь к ней спокойно.", on_cover: "НА ОБЛОЖКЕ", in_this_issue: "В ЭТОМ НОМЕРЕ", note_for_you: "ЗАМЕТКА ДЛЯ ВАС:", error_n: "№ %1 ИЗ %2", found: "нашли" , ai_tag: "Иллюстративное изображение, созданное ИИ" }),
  it: C({ bed: "CAMERE", bath: "BAGNI", sqm: "M²", price: "PREZZO", area: "SUPERFICIE", bedrooms: "CAMERE", bathrooms: "BAGNI", extras: "EXTRA", the_sheet: "LA SCHEDA", save_sheet: "Salva questa scheda per la tua visita", follow: "Avanti", swipe: "Scorri", write_us: "SCRIVICI", visit_kw: "VISITA", save_cta: "Salva questo annuncio per il tuo prossimo viaggio.", the_detail: "IL DETTAGLIO", lot: "LOTTO N.", save_calm: "Salva la scheda — riguardala con calma.", on_cover: "IN COPERTINA", in_this_issue: "IN QUESTO NUMERO", note_for_you: "NOTA PER TE:", error_n: "N. %1 DI %2", found: "trovata" , ai_tag: "Immagine illustrativa generata con IA" }),
  pt: C({ bed: "QUARTOS", bath: "WC", sqm: "M²", price: "PREÇO", area: "ÁREA", bedrooms: "QUARTOS", bathrooms: "CASAS DE BANHO", extras: "EXTRAS", the_sheet: "A FICHA", save_sheet: "Guarde esta ficha para a sua visita", follow: "Seguinte", swipe: "Deslize", write_us: "ESCREVA-NOS", visit_kw: "VISITA", save_cta: "Guarde este anúncio para a sua próxima viagem.", the_detail: "O DETALHE", lot: "LOTE Nº", save_calm: "Guarde a ficha — volte a ela com calma.", on_cover: "EM CAPA", in_this_issue: "NESTE NÚMERO", note_for_you: "NOTA PARA SI:", error_n: "Nº %1 DE %2", found: "encontrada" , ai_tag: "Imagem ilustrativa gerada com IA" }),
};
export function chrome(lang: string): CarouselChrome {
  return CAROUSEL_CHROME[lang] ?? CAROUSEL_CHROME.es;
}

/** SEAMLESS device: render ONE wide design (slideCount×1080 wide, 1350 tall) and slice it into
 *  consecutive slides — photos, rules and display type continue across the swipe boundary, the
 *  highest-impact carousel visual there is. Keep critical text ≥80px away from each 1080px seam. */
export async function renderWideSliced(spec: DesignSpec, slideCount: number, photos: Buffer[]): Promise<Buffer[]> {
  const sharp = (await import("sharp")).default;
  const wide = await renderFreeform(spec, { width: slideCount * W, height: H }, photos);
  const out: Buffer[] = [];
  for (let i = 0; i < slideCount; i++) {
    out.push(await sharp(wide).extract({ left: i * W, top: 0, width: W, height: H }).png().toBuffer());
  }
  return out;
}

/** GRAIN: one procedural paper-grain pass over a finished slide — turns flat brand fields into
 *  something that reads printed rather than corporate. Deterministic (seeded LCG, no Math.random),
 *  cached per size+intensity. 0.04-0.06 = editorial; keep identical across a deck (it's the stock). */
const grainCache: Record<string, Buffer> = {};
export async function applyGrain(png: Buffer, intensity = 0.05): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(png).metadata();
  const gw = meta.width ?? W, gh = meta.height ?? H;
  const key = `${gw}x${gh}@${intensity}`;
  if (!grainCache[key]) {
    const px = gw * gh;
    const raw = Buffer.alloc(px * 4);
    const amp = Math.min(1, intensity * 2);
    let s = 123456789 >>> 0;
    for (let i = 0; i < px; i++) {
      s = (1664525 * s + 1013904223) >>> 0;
      const v = Math.round(128 + ((s & 0xff) - 128) * amp);   // near-mid grey → overlay ≈ subtle grain
      raw[i * 4] = v; raw[i * 4 + 1] = v; raw[i * 4 + 2] = v; raw[i * 4 + 3] = 255;
    }
    grainCache[key] = await sharp(raw, { raw: { width: gw, height: gh, channels: 4 } }).png().toBuffer();
  }
  return sharp(png).composite([{ input: grainCache[key], blend: "overlay" }]).png().toBuffer();
}

/** Blend two #rrggbb colours — the deterministic way to hit the 60% "meta" opacity tier for TEXT
 *  (the freeform text element has no opacity, so we mix the ink toward the ground instead). */
export function mix(ink: string, ground: string, inkShare: number): string {
  const c = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [c(ink), c(ground)];
  return "#" + a.map((v, i) => Math.round(v * inkShare + b[i] * (1 - inkShare)).toString(16).padStart(2, "0")).join("");
}

/** The identical bottom band on every slide: agency (left) + editorial "02 / 08" page mark (right),
 *  both at the muted tier so they attribute without competing. Never top-right (Instagram's pill). */
function footerBand(agency: string, index: number, total: number, brand: CarouselBrand, ground: string, onDark: boolean) {
  const muted = mix(onDark ? "#f3efe6" : brand.navy, ground, 0.55);
  const mark = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  return [
    { type: "text" as const, bbox: [M, 1272, 700, 1300] as [number, number, number, number], content: agency.toUpperCase(), font: SANS, size: 17, colour: muted, align: "left" as const, weight: "500", tracking: 4 },
    { type: "text" as const, bbox: [700, 1272, W - M, 1300] as [number, number, number, number], content: mark, font: SANS, size: 17, colour: muted, align: "right" as const, tracking: 3 },
  ];
}

/** The 2026 swipe idiom: a hairline that bleeds off the right edge + a thin arrow. No badges. */
function swipeCue(cue: string, brand: CarouselBrand, y: number) {
  return [
    { type: "text" as const, bbox: [M, y, 560, y + 34] as [number, number, number, number], content: `${cue}  →`, font: SANS, size: 22, colour: brand.gold, align: "left" as const, weight: "500", tracking: 5 },
    { type: "rect" as const, bbox: [560, y + 15, W, y + 16.5] as [number, number, number, number], fill: brand.gold, opacity: 0.45 },
  ];
}

// ── TIPS / GUIDE type ─────────────────────────────────────────────────────────

/** S1 — navy cover. The hook is the only thing happening: kicker, giant serif headline, swipe cue. */
function tipsCover(plan: CarouselPlan, agency: string, brand: CarouselBrand, total: number) {
  return DesignSpec.parse({
    background: brand.navy,
    elements: [
      // top-left identity only — top-right stays empty for Instagram's 1/N pill
      { type: "text", bbox: [M, 96, 700, 130], content: agency.toUpperCase(), font: SANS, size: 21, colour: brand.cream, align: "left", weight: "500", tracking: 5 },
      { type: "text", bbox: [M, 300, W - M, 336], content: plan.eyebrow.toUpperCase(), font: SANS, size: 25, colour: brand.gold, align: "left", tracking: 7 },
      { type: "rect", bbox: [M, 380, M + 84, 384], fill: brand.gold },
      { type: "text", bbox: [M, 430, W - M, 1060], content: wrap(plan.hook_title, SERIF, 112, W - 2 * M), font: SERIF, size: 112, colour: brand.cream, align: "left", line_height: 126, valign: "center" },
      ...swipeCue(plan.swipe_cue.toUpperCase(), brand, 1160),
      ...footerBand(agency, 0, total, brand, brand.navy, true),
    ],
  });
}

/** S2 — the second cover (re-serve mechanic): self-qualification, standalone, cover-grade hierarchy. */
function tipsSlide2(plan: CarouselPlan, agency: string, brand: CarouselBrand, total: number) {
  return DesignSpec.parse({
    background: brand.cream,
    elements: [
      { type: "text", bbox: [M, 96, 700, 130], content: plan.eyebrow.toUpperCase(), font: SANS, size: 21, colour: mix(brand.navy, brand.cream, 0.6), align: "left", weight: "500", tracking: 5 },
      { type: "rect", bbox: [M, 340, M + 84, 344], fill: brand.gold },
      { type: "text", bbox: [M, 400, W - M, 800], content: wrap(plan.slide2_title, SERIF, 78, W - 2 * M), font: SERIF, size: 78, colour: brand.navy, align: "left", line_height: 92, valign: "center" },
      { type: "text", bbox: [M, 860, W - M, 1060], content: wrap(plan.slide2_body, SANS, 34, W - 2 * M), font: SANS, size: 34, colour: brand.text, align: "left", line_height: 52 },
      ...swipeCue(plan.swipe_cue.toUpperCase(), brand, 1160),
      ...footerBand(agency, 1, total, brand, brand.cream, false),
    ],
  });
}

/** Value slide — one idea: oversized gold numeral, heading, 15-40 word body, open-loop footer pill. */
function tipSlide(slideIndex: number, tipNumber: number, total: number, tip: { title: string; body: string; teaser: string }, agency: string, brand: CarouselBrand) {
  const elements: any[] = [
    { type: "text", bbox: [M, 70, 640, 340], content: String(tipNumber).padStart(2, "0"), font: SERIF, size: 250, colour: brand.gold, align: "left" },
    { type: "rect", bbox: [M, 400, M + 84, 404], fill: brand.gold },
    { type: "text", bbox: [M, 452, W - M, 660], content: wrap(tip.title, SERIF, 64, W - 2 * M), font: SERIF, size: 64, colour: brand.navy, align: "left", line_height: 76 },
    { type: "text", bbox: [M, 700, W - M, 1080], content: wrap(tip.body, SANS, 36, W - 2 * M), font: SANS, size: 36, colour: brand.text, align: "left", line_height: 56, valign: "center" },
  ];
  if (tip.teaser) {
    elements.push({
      type: "text", bbox: [M, 1150, 900, 1198], content: tip.teaser, font: SANS, size: 26,
      colour: brand.cream, align: "left", weight: "500", valign: "center",
      pill: { fill: brand.navy, pad_x: 28, pad_y: 14 },
    });
  }
  elements.push(...footerBand(agency, slideIndex, total, brand, brand.cream, false));
  return DesignSpec.parse({ background: brand.cream, elements });
}

/** Recap — the screenshot/save/forward unit: every point on one branded slide + the save trigger. */
function recapSlide(plan: CarouselPlan, slideIndex: number, total: number, agency: string, brand: CarouselBrand) {
  const n = plan.tips.length;
  const listTop = 380, listBottom = 1080;
  const rowH = Math.min(110, (listBottom - listTop) / n);
  const rows: any[] = [];
  plan.tips.forEach((tip, i) => {
    const y = listTop + i * rowH;
    rows.push({ type: "text", bbox: [M, y, M + 90, y + rowH], content: String(i + 1).padStart(2, "0"), font: SERIF, size: 44, colour: brand.gold, align: "left", valign: "center" });
    rows.push({ type: "text", bbox: [M + 110, y, W - M, y + rowH], content: wrap(tip.title, SANS, 32, W - M - (M + 110), "500"), font: SANS, size: 32, colour: brand.navy, align: "left", weight: "500", line_height: 40, valign: "center" });
    if (i < n - 1) rows.push({ type: "rect", bbox: [M + 110, y + rowH, W - M, y + rowH + 1], fill: mix(brand.navy, brand.cream, 0.18) });
  });
  return DesignSpec.parse({
    background: brand.cream,
    elements: [
      { type: "text", bbox: [M, 96, 700, 130], content: plan.eyebrow.toUpperCase(), font: SANS, size: 21, colour: mix(brand.navy, brand.cream, 0.6), align: "left", weight: "500", tracking: 5 },
      { type: "text", bbox: [M, 200, W - M, 320], content: wrap(plan.recap_title, SERIF, 68, W - 2 * M), font: SERIF, size: 68, colour: brand.navy, align: "left", line_height: 80 },
      ...rows,
      {
        type: "text", bbox: [M, 1140, 940, 1192], content: plan.save_line, font: SANS, size: 27,
        colour: brand.navy, align: "left", weight: "500", valign: "center",
        pill: { fill: brand.gold, pad_x: 30, pad_y: 15 },
      },
      ...footerBand(agency, slideIndex, total, brand, brand.cream, false),
    ],
  });
}

// ── QUOTE / CASE-STUDY type ───────────────────────────────────────────────────

/** S1 — the cover is the most concrete VERBATIM fragment + the client's name. Never a "Testimonial" label. */
function quoteCover(plan: CarouselPlan, agency: string, brand: CarouselBrand, total: number) {
  return DesignSpec.parse({
    background: brand.navy,
    elements: [
      { type: "text", bbox: [M, 96, 700, 130], content: agency.toUpperCase(), font: SANS, size: 21, colour: brand.cream, align: "left", weight: "500", tracking: 5 },
      { type: "text", bbox: [M - 10, 210, 420, 420], content: "“", font: SERIF, size: 280, colour: brand.gold, align: "left" },
      { type: "text", bbox: [M, 440, W - M, 960], content: wrap(plan.quote_hook, SERIF, 88, W - 2 * M), font: SERIF, size: 88, colour: brand.cream, align: "left", line_height: 104, valign: "center" },
      { type: "rect", bbox: [M, 1020, M + 64, 1023], fill: brand.gold },
      { type: "text", bbox: [M, 1046, W - M, 1084], content: plan.attribution, font: SANS, size: 27, colour: brand.cream, align: "left", tracking: 1 },
      ...swipeCue(plan.swipe_cue.toUpperCase(), brand, 1160),
      ...footerBand(agency, 0, total, brand, brand.navy, true),
    ],
  });
}

/** S2 — standalone context: who they were / what they wanted, only restating the quote's own content. */
function quoteSlide2(plan: CarouselPlan, agency: string, brand: CarouselBrand, total: number) {
  return DesignSpec.parse({
    background: brand.cream,
    elements: [
      { type: "text", bbox: [M, 96, 700, 130], content: plan.eyebrow.toUpperCase(), font: SANS, size: 21, colour: mix(brand.navy, brand.cream, 0.6), align: "left", weight: "500", tracking: 5 },
      { type: "rect", bbox: [M, 340, M + 84, 344], fill: brand.gold },
      { type: "text", bbox: [M, 400, W - M, 780], content: wrap(plan.slide2_title, SERIF, 76, W - 2 * M), font: SERIF, size: 76, colour: brand.navy, align: "left", line_height: 90, valign: "center" },
      { type: "text", bbox: [M, 840, W - M, 1060], content: wrap(plan.quote_context, SANS, 34, W - 2 * M), font: SANS, size: 34, colour: brand.text, align: "left", line_height: 52 },
      ...swipeCue(plan.swipe_cue.toUpperCase(), brand, 1160),
      ...footerBand(agency, 1, total, brand, brand.cream, false),
    ],
  });
}

/** The client's words, verbatim, large serif — attribution repeats on the last part. */
function quoteSlide(slideIndex: number, total: number, part: string, attribution: string, isLast: boolean, agency: string, brand: CarouselBrand) {
  const elements: any[] = [
    { type: "text", bbox: [M - 10, 100, 380, 300], content: "“", font: SERIF, size: 230, colour: brand.gold, align: "left" },
    { type: "text", bbox: [M + 10, 330, W - M, 1000], content: wrap(part, SERIF, 62, W - 2 * M - 10), font: SERIF, size: 62, colour: brand.navy, align: "left", line_height: 84, valign: "center" },
  ];
  if (isLast && attribution) {
    elements.push({ type: "rect", bbox: [M + 10, 1060, M + 74, 1063], fill: brand.gold });
    elements.push({ type: "text", bbox: [M + 10, 1088, W - M, 1128], content: attribution, font: SANS, size: 29, colour: mix(brand.navy, brand.cream, 0.75), align: "left", tracking: 1 });
  }
  elements.push(...footerBand(agency, slideIndex, total, brand, brand.cream, false));
  return DesignSpec.parse({ background: brand.cream, elements });
}

// ── CTA (shared) — leads with the KPI action; contact is a demoted footer strip ──

function ctaSlide(plan: CarouselPlan, slideIndex: number, total: number, agency: string, contact: string, brand: CarouselBrand) {
  const mutedCream = mix("#f3efe6", brand.navy, 0.65);
  return DesignSpec.parse({
    background: brand.navy,
    elements: [
      { type: "text", bbox: [M, 96, 700, 130], content: agency.toUpperCase(), font: SANS, size: 21, colour: brand.cream, align: "left", weight: "500", tracking: 5 },
      { type: "rect", bbox: [M, 300, M + 84, 304], fill: brand.gold },
      { type: "text", bbox: [M, 356, W - M, 700], content: wrap(plan.cta_heading, SERIF, 92, W - 2 * M), font: SERIF, size: 92, colour: brand.cream, align: "left", line_height: 106, valign: "center" },
      // the real CTA: the save/send action line, largest text after the heading
      { type: "text", bbox: [M, 760, W - M, 920], content: wrap(plan.cta_action, SANS, 36, W - 2 * M, "500"), font: SANS, size: 36, colour: brand.cream, align: "left", weight: "500", line_height: 54 },
      // the DM keyword as the single button
      {
        type: "text", bbox: [M, 980, 720, 1040], content: plan.cta_keyword.toUpperCase(), font: SANS, size: 25,
        colour: brand.navy, align: "left", weight: "600", tracking: 3, valign: "center",
        pill: { fill: brand.gold, pad_x: 40, pad_y: 20 },
      },
      // contact demoted to a muted footer strip
      { type: "rect", bbox: [M, 1140, W - M, 1141.5], fill: brand.gold, opacity: 0.35 },
      { type: "text", bbox: [M, 1172, W - M, 1206], content: contact, font: SANS, size: 22, colour: mutedCream, align: "left", tracking: 2 },
      ...footerBand(agency, slideIndex, total, brand, brand.navy, true),
    ],
  });
}

/** Render a PLANNED carousel. Tips: cover → second cover → one slide per tip → recap → CTA.
 *  Quote: cover (verbatim fragment) → context → quote parts → CTA. Deterministic, seconds. */
export async function renderPlannedCarousel(
  plan: CarouselPlan, agency: string, contact: string, brand: CarouselBrand,
): Promise<Buffer[]> {
  const canvas = { width: W, height: H };
  const specs: any[] = [];
  if (plan.type === "tips") {
    const total = plan.tips.length + 4;      // cover + slide2 + tips + recap + CTA
    specs.push(tipsCover(plan, agency, brand, total));
    specs.push(tipsSlide2(plan, agency, brand, total));
    plan.tips.forEach((tip, i) => specs.push(tipSlide(i + 2, i + 1, total, tip, agency, brand)));
    specs.push(recapSlide(plan, plan.tips.length + 2, total, agency, brand));
    specs.push(ctaSlide(plan, total - 1, total, agency, contact, brand));
  } else {
    const total = plan.quote_parts.length + 3;  // cover + context + parts + CTA
    specs.push(quoteCover(plan, agency, brand, total));
    specs.push(quoteSlide2(plan, agency, brand, total));
    plan.quote_parts.forEach((part, i) =>
      specs.push(quoteSlide(i + 2, total, part, plan.attribution, i === plan.quote_parts.length - 1, agency, brand)));
    specs.push(ctaSlide(plan, total - 1, total, agency, contact, brand));
  }
  const out: Buffer[] = [];
  for (const spec of specs) out.push(await renderFreeform(spec, canvas, []));
  return out;
}
