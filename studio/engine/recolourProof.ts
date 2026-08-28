// Does an AI-imagery (illustrated) deck actually repaint when the brand colours change?
// Christian 2026-08-28: "i tried changing the colors here and its not updating".
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import sharp from "sharp";
import { renderTipsImageStyledV2 } from "./carouselTipsImage";
import type { CarouselPlan } from "./carouselSlides";

const OUT = "/private/tmp/claude-501/-Users-christianscholte-aivena/3638da7f-aabe-4cea-8da2-cc182d9bf454/scratchpad/recolour";
mkdirSync(OUT, { recursive: true });

const plan = {
  type: "tips",
  eyebrow: "For families relocating",
  hook_title: "Moving with kids? Here's the real timeline nobody tells you",
  swipe_cue: "Swipe",
  slide2_title: "The dip is normal",
  slide2_body: "Moving with kids isn't one big adjustment, it's a string of small ones.",
  tips: [
    { title: "The first weeks are the hardest, not the last", body: "Kids grieve the friends and routines they left behind long before they notice the upside.", teaser: "Next: the thing that helps most", scene: "" },
    { title: "Routine rebuilds faster than friendship does", body: "A familiar bedtime, the same breakfast, the same buses — these small repeated grooves settle a child before friendships form.", teaser: "", scene: "" },
  ],
  recap_title: "The real timeline",
  save_line: "Save this for the move",
  cta_heading: "Moving this year?",
  cta_action: "Message us and we'll talk it through.",
  cta_keyword: "FAMILY MOVE",
  caption: "x", hashtags: [], image_scenes: [],
  quote_hook: "", quote_context: "", quote_parts: [], attribution: "",
} as unknown as CarouselPlan;

const A = { navy: "#1a2b4a", gold: "#c8a24b", cream: "#f3efe6", text: "#333333" };  // default
const B = { navy: "#2f6f6b", gold: "#8f7a2e", cream: "#f3efe6", text: "#333333" };  // his teal + olive

async function main() {
  const imgs = [1, 2, 3].map((n) => readFileSync(`apps/dashboard/public/studio/carousel-examples/acuarela/${n}.jpg`));
  for (const [tag, brand] of [["A", A], ["B", B]] as const) {
    const slides = await renderTipsImageStyledV2("acuarela", plan, "Mediterráneo Costa Homes", "mediterraneocosta.es", brand, imgs, "en", true, true, 0, false);
    for (let i = 0; i < slides.length; i++) writeFileSync(`${OUT}/${tag}-${i + 1}.png`, slides[i]);
    console.log(tag, "slides", slides.length);
  }
  // pixel diff per slide — how much of each slide actually changed colour
  for (let i = 1; i <= 7; i++) {
    try {
      const a = await sharp(`${OUT}/A-${i}.png`).resize(270).raw().toBuffer();
      const b = await sharp(`${OUT}/B-${i}.png`).resize(270).raw().toBuffer();
      let diff = 0;
      for (let p = 0; p < a.length; p += 3) if (Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]) > 12) diff++;
      console.log(`slide ${i}: ${((diff / (a.length / 3)) * 100).toFixed(1)}% of pixels changed`);
    } catch { /* fewer slides */ }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
