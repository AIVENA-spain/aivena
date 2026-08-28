import fs from "node:fs";
import { abs } from "../src/lib/paths";
import { renderFreeform, DesignSpec } from "./renderFreeform";
import { ensureImages, PROPS } from "./finalRender";

// PROOF of Smart v2's freeform renderer: two hand-authored DesignSpecs (standing in for the design model's
// output) rendered on REAL demo photos + facts. Proves: photos stay photos (framed, not blended), facts are
// server-substituted, scrims/panels/typography draw correctly at two aspect ratios.

async function main() {
  const sharp = (await import("sharp")).default;
  const p = PROPS[0];
  const imgs = (await ensureImages(p)).map((f) => fs.readFileSync(f));

  // canonical facts, as the server would substitute them
  const facts: Record<string, string> = {
    title: `${p.type[0].toUpperCase()}${p.type.slice(1)} in ${p.city}`,
    price: "285.000 €",
    specs: "2 bed · 2 bath · 90 m²",
    location: `${p.city}, ${p.region}`,
    agency: "Mediterráneo Costa Homes",
    website: "aivena.es",
  };

  // ── Design A: 1080×1350 editorial split — hero left, ivory panel right, big serif ──
  const A = DesignSpec.parse({
    background: "#F4F1EA",
    elements: [
      { type: "photo", photo: 0, bbox: [0, 0, 1080, 810] },
      { type: "scrim", bbox: [0, 480, 1080, 810], colour: "#1A2530", direction: "up" },
      { type: "text", bbox: [64, 560, 1016, 700], content: facts.title, font: "Prata", size: 84, colour: "#FFFFFF", align: "left" },
      { type: "text", bbox: [64, 706, 1016, 750], content: facts.location, font: "Poppins", size: 26, colour: "#E8E3D8", align: "left", tracking: 4, uppercase: true },
      { type: "photo", photo: 1, bbox: [64, 860, 380, 1090] },
      { type: "photo", photo: 2, bbox: [396, 860, 712, 1090] },
      { type: "rect", bbox: [744, 860, 1016, 1090], fill: "#1A2530", radius: 0 },
      { type: "text", bbox: [776, 900, 984, 950], content: facts.price, font: "Prata", size: 44, colour: "#D9B36C", align: "left" },
      { type: "text", bbox: [776, 964, 984, 1000], content: facts.specs, font: "Poppins", size: 22, colour: "#FFFFFF", align: "left" },
      { type: "rect", bbox: [776, 1022, 890, 1025], fill: "#D9B36C" },
      { type: "text", bbox: [64, 1170, 700, 1215], content: facts.agency, font: "Poppins", size: 28, colour: "#1A2530", align: "left", weight: "600", tracking: 2, uppercase: true },
      { type: "text", bbox: [64, 1222, 700, 1256], content: facts.website, font: "Poppins", size: 22, colour: "#8A8478", align: "left" },
      { type: "text", bbox: [700, 1180, 1016, 1250], content: "Just\nlisted", font: "Great Vibes", size: 58, colour: "#B0873C", align: "right" },
    ],
  });

  // ── Design B: 1080×1920 story — full-bleed hero, poster type, price pill ──
  const B = DesignSpec.parse({
    background: "#101418",
    elements: [
      { type: "photo", photo: 0, bbox: [0, 0, 1080, 1400], zoom: 1.15, x: 0.5, y: 0.35 },
      { type: "scrim", bbox: [0, 900, 1080, 1400], colour: "#101418", direction: "up" },
      { type: "text", bbox: [72, 1030, 1008, 1120], content: "YOUR MEDITERRANEAN", font: "Poppins", size: 40, colour: "#D9B36C", align: "left", weight: "600", tracking: 8 },
      { type: "text", bbox: [72, 1120, 1008, 1330], content: facts.title, font: "Anton", size: 120, colour: "#FFFFFF", align: "left", uppercase: true, line_height: 128 },
      { type: "photo", photo: 1, bbox: [72, 1440, 516, 1720] },
      { type: "photo", photo: 2, bbox: [536, 1440, 1008, 1720] },
      { type: "rect", bbox: [72, 1770, 480, 1852], fill: "#D9B36C", radius: 41 },
      { type: "text", bbox: [100, 1788, 452, 1836], content: facts.price, font: "Poppins", size: 36, colour: "#101418", align: "center", weight: "700" },
      { type: "text", bbox: [520, 1782, 1008, 1820], content: facts.specs, font: "Poppins", size: 26, colour: "#FFFFFF", align: "left" },
      { type: "text", bbox: [520, 1826, 1008, 1856], content: facts.agency, font: "Poppins", size: 20, colour: "#9AA2AB", align: "left", tracking: 2, uppercase: true },
    ],
  });

  const pngA = await renderFreeform(A, { width: 1080, height: 1350 }, imgs);
  const pngB = await renderFreeform(B, { width: 1080, height: 1920 }, imgs);

  const h = 760;
  const a = await sharp(pngA).resize({ height: h }).png().toBuffer();
  const bb = await sharp(pngB).resize({ height: h }).png().toBuffer();
  const wa = (await sharp(a).metadata()).width!, wb = (await sharp(bb).metadata()).width!;
  const bar = (t: string, w: number) => Buffer.from(`<svg width="${w}" height="34" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="34" fill="#111"/><text x="10" y="23" font-family="sans-serif" font-size="15" fill="#fff">${t}</text></svg>`);
  const W = wa + wb + 30;
  await sharp({ create: { width: W, height: h + 44, channels: 4, background: { r: 24, g: 24, b: 24, alpha: 1 } } })
    .composite([
      { input: bar(`Design A — 1080x1350 editorial (3 photos, facts substituted)`, wa), left: 10, top: 0 },
      { input: a, left: 10, top: 40 },
      { input: bar(`Design B — 1080x1920 story (poster type)`, wb), left: wa + 20, top: 0 },
      { input: bb, left: wa + 20, top: 40 },
    ]).png().toFile(abs("out/freeform_proof.png"));
  console.log("-> " + abs("out/freeform_proof.png"));
}
main().catch((e) => { console.error("ERROR:", e.stack || e.message); process.exit(1); });
