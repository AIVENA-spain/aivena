import fs from "node:fs";
import { abs } from "../src/lib/paths";
import { renderFreeform, DesignSpec } from "./renderFreeform";

// SHOWCASE (Christian 2026-07-15: "showcase your best... a template for 2 property images... wow me").
// Design rationale — every choice deliberate:
//   CONCEPT   "The Collector's Card": the listing presented like two mounted prints in a gallery
//             catalogue — hero exterior full-width, the interior as a matted print overlapping it.
//             The overlap is the one bold move; everything else is quiet discipline around it.
//   GRID      64px outer margins everywhere; one axis at x=64 carries masthead-rule, script, title,
//             location, price, specs and the footer line — the eye never hunts for an edge.
//   SYMMETRY  the frame is symmetric (centred masthead + full-width footer close the page top and
//             bottom); inside it, asymmetric balance — text column bottom-left vs. print card upper-
//             right — so it feels composed by hand, not by a grid generator.
//   COLOUR    warm gallery paper #F3F0E9 (lets Spanish light/pool blues sing), charcoal-navy ink
//             #23272F, and ONE metal: burnished gold #B08A47 used exactly four small times (rule,
//             script, price, hairline). Restraint is the luxury signal.
//   TYPE      Italiana (high-fashion hairline display) for title + price — distinctive, editorial;
//             Poppins for every supporting label (tracked caps, small); Great Vibes for a single
//             handwritten flourish. Three faces, three strictly separated jobs.
//   SIZE      clear hierarchy: script 54 → title ~92 → price 60 → labels 21-24. Facts scannable in
//             under a second: what → where → how much → how big.
async function main() {
  const sharp = (await import("sharp")).default;
  const S = "/private/tmp/claude-501/-Users-christianscholte-aivena/3638da7f-aabe-4cea-8da2-cc182d9bf454/scratchpad";
  const photos = [fs.readFileSync(`${S}/altea_ext.jpg`), fs.readFileSync(`${S}/altea_int1.jpg`)];

  const PAPER = "#f3f0e9", INK = "#23272f", GOLD = "#b08a47", MUTE = "#6a6e76";

  const spec = DesignSpec.parse({
    background: PAPER,
    elements: [
      // ── masthead: centred, engraved-invitation quiet ─────────────────────────
      { type: "text", bbox: [64, 56, 1016, 92], content: "Mediterráneo Costa Homes", font: "Poppins", size: 23, colour: INK, align: "center", valign: "center", weight: "500", tracking: 6, uppercase: true },
      { type: "rect", bbox: [508, 106, 572, 109], fill: GOLD }, // 64px gold rule, centred on the axis of symmetry

      // ── hero print: the villa in the pines, full grid width ──────────────────
      { type: "photo", photo: 0, bbox: [64, 150, 1016, 790] },

      // ── the interior as a matted print, overlapping the hero's lower right ───
      { type: "rect", bbox: [604, 692, 1028, 1116], fill: INK, opacity: 0.08 },        // soft cast shadow
      { type: "rect", bbox: [592, 680, 1016, 1104], fill: PAPER },                     // the mat
      { type: "photo", photo: 1, bbox: [606, 694, 1002, 1090] },                       // the print

      // ── the text column, all flush to the x=64 axis ──────────────────────────
      { type: "text", bbox: [64, 820, 560, 890], content: "Mediterranean living", font: "Great Vibes", size: 54, colour: GOLD, align: "left" },
      { type: "text", bbox: [64, 902, 570, 1010], content: "Villa in Altea", font: "Italiana", size: 92, colour: INK, align: "left" },
      { type: "text", bbox: [64, 1024, 570, 1054], content: "Altea · Alicante", font: "Poppins", size: 22, colour: MUTE, align: "left", weight: "500", tracking: 5, uppercase: true },
      { type: "text", bbox: [64, 1082, 570, 1150], content: "695.000 €", font: "Italiana", size: 60, colour: GOLD, align: "left" },
      { type: "text", bbox: [64, 1166, 570, 1196], content: "3 bed · 3 bath", font: "Poppins", size: 23, colour: INK, align: "left", weight: "500", tracking: 3, uppercase: true },

      // ── footer: full-width hairline closes the page; contact quiet at the ends ─
      { type: "rect", bbox: [64, 1246, 1016, 1248], fill: GOLD },
      { type: "text", bbox: [64, 1268, 520, 1300], content: "aivena.es", font: "Poppins", size: 21, colour: INK, align: "left", weight: "500", tracking: 2 },
      { type: "text", bbox: [540, 1268, 1016, 1300], content: "+34 600 999 066", font: "Poppins", size: 21, colour: MUTE, align: "right", tracking: 1 },
    ],
  });

  const png = await renderFreeform(spec, { width: 1080, height: 1350 }, photos);
  await sharp(png).png().toFile(abs("out/showcase_2photo.png"));
  console.log("-> " + abs("out/showcase_2photo.png"));
}
main().catch((e) => { console.error("ERROR:", e.stack || e.message); process.exit(1); });
