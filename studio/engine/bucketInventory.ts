import fs from "node:fs";
import path from "node:path";
import { abs } from "../src/lib/paths";

// Studio discovery (read-only): inventory the Canva templates in the private `studio-templates` Supabase
// bucket. Downloads each tokenized SVG via the storage REST API (service-role key, read from the repo .env —
// never logged/committed) and analyses size/aspect, photo + token slots, editable <text> vs outlined paths,
// fonts, and colours. Emits a catalogue (metadata only) to studio/catalogue/. The downloaded SVGs go to the
// gitignored studio/out/bucket/. NO writes to the bucket, no deploy, no provider calls.

const BUCKET = "studio-templates";
// distinct templates present in the bucket (from storage.objects): raw <n>.svg + <n>.tokenized.svg pairs.
const TEMPLATES = ["1", "2", "3", "4", "5", "6", "6b", "7", "8", "10", "11", "14", "15"];

// Post type INFERRED from the rendered contact sheet (the outlined headline). Product/Chat 1 main must
// confirm the canonical taxonomy — these are best-effort reads, not decisions.
const POST_TYPE_INFERRED: Record<string, string> = {
  "1": "Open House", "2": "Luxury listing (villa)", "3": "Luxury listing (apartment)",
  "4": "Luxury listing (apartment)", "5": "Listing (villa)", "6": "Open House (multi-photo gallery)",
  "6b": "Open House variant (multi-photo)", "7": "Agency/brand promo — 'Discover Your Dream' (multi-photo)",
  "8": "Minimal listing / gallery (4 photos)", "10": "New Listing (multi-photo)",
  "11": "Brand / CTA — 'Step Into Your Dream Home'", "14": "Just Sold announcement", "15": "Luxury Living",
};

function readEnv(): { url: string; key: string } | null {
  // prefer process.env; else parse the repo-root .env (two levels up from studio/).
  let url = process.env.SUPABASE_URL || "";
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) {
    const envPath = path.resolve(abs("."), "..", ".env");
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (!m) continue;
        const v = m[2].replace(/^["']|["']$/g, "").trim();
        if (m[1] === "SUPABASE_URL" && !url) url = v;
        if (m[1] === "SUPABASE_SERVICE_ROLE_KEY" && !key) key = v;
      }
    }
  }
  return url && key ? { url, key } : null;
}

function classifySize(w: number, h: number): { aspect: string; family: string } {
  if (!w || !h) return { aspect: "unknown", family: "unknown" };
  const r = w / h;
  const aspect = Math.abs(r - 1) < 0.02 ? "1:1 square" : Math.abs(r - 0.8) < 0.03 ? "4:5 portrait" : Math.abs(r - 0.5625) < 0.03 ? "9:16 story" : r > 1.4 ? "landscape" : `${r.toFixed(3)}`;
  // Instagram feed = square/portrait/story (current size family). Facebook link = wide landscape (later family).
  const family = r > 1.3 ? "facebook/later" : "instagram/current";
  return { aspect, family };
}

function analyze(svg: string) {
  const head = svg.slice(0, 4000);
  const wM = head.match(/\bwidth="([\d.]+)"/);
  const hM = head.match(/\bheight="([\d.]+)"/);
  const vbM = head.match(/viewBox="([\d.\s-]+)"/);
  const vb = vbM ? vbM[1].trim().split(/\s+/).map(Number) : null;
  const width = wM ? Number(wM[1]) : vb ? vb[2] : 0;
  const height = hM ? Number(hM[1]) : vb ? vb[3] : 0;

  const allTokens = Array.from(new Set(svg.match(/@@[A-Za-z0-9_]+@@/g) || [])).sort();
  const photoTokens = allTokens.filter((t) => /@@PHOTO\d+@@/.test(t));
  const otherTokens = allTokens.filter((t) => !/@@PHOTO\d+@@/.test(t));
  const imageTags = (svg.match(/<image\b[^>]*>/g) || []).length;
  const textTags = (svg.match(/<text\b[^>]*>/g) || []).length;
  const tspanTags = (svg.match(/<tspan\b[^>]*>/g) || []).length;
  const pathTags = (svg.match(/<path\b[^>]*>/g) || []).length;
  const fonts = Array.from(new Set((svg.match(/font-family="([^"]+)"/g) || []).map((m) => m.replace(/font-family="|"/g, "")))).sort();
  const fills = Array.from(new Set((svg.match(/fill="(#[0-9a-fA-F]{3,8})"/g) || []).map((m) => m.replace(/fill="|"/g, "").toLowerCase())));
  const editableText = textTags > 0;
  return { width, height, ...classifySize(width, height), photo_slots: photoTokens.length, photo_tokens: photoTokens, other_tokens: otherTokens, image_tags: imageTags, text_elements: textTags, tspan_elements: tspanTags, path_elements: pathTags, fonts, distinct_fill_colours: fills.length, fills, editable_text_present: editableText };
}

async function main() {
  const env = readEnv();
  const outBucket = abs("out/bucket"); fs.mkdirSync(outBucket, { recursive: true });
  const catDir = abs("catalogue"); fs.mkdirSync(catDir, { recursive: true });

  if (!env) {
    const msg = "MISSING CREDENTIALS: need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (repo-root .env or env). Cannot read the private studio-templates bucket.";
    console.error(msg);
    fs.writeFileSync(path.join(catDir, "catalogue.json"), JSON.stringify({ error: msg, bucket: BUCKET, templates_expected: TEMPLATES }, null, 2) + "\n");
    process.exit(1);
  }

  const rows: any[] = [];
  for (const t of TEMPLATES) {
    const name = `${t}.tokenized.svg`;
    const u = `${env.url}/storage/v1/object/${BUCKET}/${encodeURIComponent(name)}`;
    let svg = "";
    try {
      const r = await fetch(u, { headers: { Authorization: `Bearer ${env.key}` } });
      if (!r.ok) { rows.push({ template: t, name, ok: false, http: r.status }); console.log(`  ${t.padEnd(4)} FETCH FAIL http=${r.status}`); continue; }
      svg = await r.text();
      fs.writeFileSync(path.join(outBucket, name), svg);
    } catch (e: any) { rows.push({ template: t, name, ok: false, error: e.message }); console.log(`  ${t.padEnd(4)} ERROR ${e.message}`); continue; }
    const a = analyze(svg);
    rows.push({ template: t, name, ok: true, post_type_inferred: POST_TYPE_INFERRED[t] || "TBD", bytes: svg.length, ...a });
    console.log(`  ${t.padEnd(4)} ${String(a.width)+"x"+String(a.height)} ${a.aspect.padEnd(13)} ${a.family.padEnd(20)} photo_slots=${a.photo_slots} other_tokens=${a.other_tokens.length} text=${a.text_elements} paths=${a.path_elements} fonts=[${a.fonts.join(",")||"none-in-svg"}]`);
  }

  const ok = rows.filter((r) => r.ok);
  const igCount = ok.filter((r) => r.family === "instagram/current").length;
  const fbCount = ok.filter((r) => r.family === "facebook/later").length;
  const catalogue = {
    generated_by: "studio/engine/bucketInventory.ts",
    bucket: BUCKET, templates_found: ok.length, templates_expected_count: TEMPLATES.length,
    instagram_current: igCount, facebook_later: fbCount,
    note: "tokenized SVGs analysed (raw <n>.svg also in bucket). other_tokens are non-photo @@..@@ placeholders (recolour/text). text_elements=0 => Canva-outlined text (NOT editable) => the Studio engine must re-inject editable text via the manifest.",
    templates: rows,
  };
  fs.writeFileSync(path.join(catDir, "catalogue.json"), JSON.stringify(catalogue, null, 2) + "\n");
  fs.writeFileSync(path.join(catDir, "catalogue.md"), catalogueMd(catalogue));
  console.log(`\n  found ${ok.length}/${TEMPLATES.length} templates  (instagram/current=${igCount}, facebook/later=${fbCount})`);
  console.log(`  wrote studio/catalogue/catalogue.{json,md}; tokenized SVGs in gitignored studio/out/bucket/`);

  // visual contact sheet (text is outlined paths -> renders without fonts; photo slots blanked grey)
  try {
    const { renderTemplatePng } = await import("../src/lib/render");
    const sharp = (await import("sharp")).default;
    const GREY = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";
    const TW = 240, cols = 5;
    const thumbs: { t: string; buf: Buffer }[] = [];
    for (const r of ok) {
      let svg = fs.readFileSync(path.join(outBucket, r.name), "utf8").replace(/@@PHOTO\d+@@/g, GREY);
      const png = renderTemplatePng(svg, TW);
      thumbs.push({ t: r.template, buf: await sharp(png).resize({ width: TW }).png().toBuffer() });
    }
    const th = (await sharp(thumbs[0].buf).metadata()).height || 300;
    const rows2 = Math.ceil(thumbs.length / cols), lbl = 18, gap = 6;
    const W = cols * TW + (cols + 1) * gap, H = rows2 * (th + lbl + gap) + gap;
    const comps: any[] = []; let svgTxt = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
    thumbs.forEach((tn, i) => { const cx = gap + (i % cols) * (TW + gap), cy = gap + Math.floor(i / cols) * (th + lbl + gap);
      comps.push({ input: tn.buf, left: cx, top: cy + lbl }); svgTxt += `<text x="${cx + 4}" y="${cy + 13}" font-family="sans-serif" font-size="13" fill="#fff">#${tn.t}</text>`; });
    svgTxt += `</svg>`;
    await sharp({ create: { width: W, height: H, channels: 4, background: { r: 30, g: 30, b: 30, alpha: 1 } } })
      .composite([...comps, { input: Buffer.from(svgTxt), top: 0, left: 0 }]).png().toFile(path.join(outBucket, "contact_sheet.png"));
    console.log(`  rendered visual contact sheet -> studio/out/bucket/contact_sheet.png`);
  } catch (e: any) { console.log(`  (contact sheet skipped: ${e.message})`); }
}

function catalogueMd(c: any): string {
  let s = `# Studio template catalogue — \`${c.bucket}\`\n\nFound **${c.templates_found}** templates (instagram/current=${c.instagram_current}, facebook/later=${c.facebook_later}).\n\n${c.note}\n\n`;
  s += `| # | post type (inferred) | size | aspect | family | photo slots | colour tokens | <text> editable | <path> | colours |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of c.templates) {
    if (!r.ok) { s += `| ${r.template} | — | — | — | FETCH FAIL (${r.http || r.error}) | | | | | |\n`; continue; }
    s += `| ${r.template} | ${r.post_type_inferred} | ${r.width}x${r.height} | ${r.aspect} | ${r.family} | ${r.photo_slots} | ${r.other_tokens.length} | ${r.editable_text_present ? "yes" : "NO (outlined)"} | ${r.path_elements} | ${r.distinct_fill_colours} |\n`;
  }
  return s + "\n";
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
