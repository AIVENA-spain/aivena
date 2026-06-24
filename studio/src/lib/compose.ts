import fs from "node:fs";
import path from "node:path";
import { abs } from "./paths";
import { fontFamily, openFont, advanceWidth } from "./fonts";
import { escapeXml } from "./text";
import { renderTemplatePng, renderTemplateRGBA, saveRGBA, RGBA } from "./render";
import { inkBox, regionFromArray, colourOpacity, lumaAt } from "./ink";
import { loadPalette, resolveToken, isLockedToken, hexToRgb, contrastRatio } from "./tokens";
import { LocalDeterministic, statValue, PROVIDER_LABEL, PROVIDER_BANNER } from "./copygen";
import { fitTitle, fitBody } from "./fit";
import { detectClaims } from "./claims";
import { loadLang, glyphCoverage } from "./i18n";
import { checkEditableSvg } from "./editability";

const r2 = (n: number) => Math.round(n * 100) / 100;
function mimeFor(p: string): string { return p.endsWith(".png") ? "image/png" : p.endsWith(".jpg") || p.endsWith(".jpeg") ? "image/jpeg" : "application/octet-stream"; }
function dataUri(rel: string): string { const p = abs(rel); if (!fs.existsSync(p)) throw new Error(`Asset missing: ${p}`); return `data:${mimeFor(p)};base64,${fs.readFileSync(p).toString("base64")}`; }

// ---- locked chrome fragment (photo / overlay / fixed_art), token-resolved ----
function chromeFragment(manifest: any, layer: any, palette: any, defs: { v: string; n: number }): string {
  if (layer.type === "photo_slot") {
    const [x, y, w, h] = layer.box;
    const par = layer.fit === "cover" ? "xMidYMid slice" : layer.fit === "contain" ? "xMidYMid meet" : "none";
    return `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="${par}" xlink:href="${dataUri(layer.asset)}"/>`;
  }
  if (layer.type === "overlay") {
    const [x, y, w, h] = layer.box;
    if (layer.kind === "solid") {
      const c = resolveToken(palette, manifest, layer.color_token);
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c.hex}" fill-opacity="${layer.opacity}"/>`;
    }
    if (layer.kind === "asset") {
      const par = layer.fit === "stretch" ? "none" : "xMidYMid meet";
      return `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="${par}" xlink:href="${dataUri(layer.asset)}"/>`;
    }
    if (layer.kind === "gradient") {
      const c = resolveToken(palette, manifest, layer.color_token);
      const id = "g" + defs.n++;
      const stops = layer.stops.map((s: any) => `<stop offset="${s.offset}" stop-color="${c.hex}" stop-opacity="${s.opacity}"/>`).join("");
      defs.v += `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>`;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id})"/>`;
    }
  }
  if (layer.type === "fixed_art") {
    const [x, y, w, h] = layer.box;
    return `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none" xlink:href="${dataUri(layer.asset)}"/>`;
  }
  return "";
}

export interface ComposeOpts {
  template?: string; lang: string; palette: string; mode?: "source_faithful" | "fact_safe";
  factsId?: string; editorialLock?: any; nameBase?: string; outDir?: string;
  edit?: { slot: string; text: string }; disableWidow?: boolean;
}
export interface ComposeResult {
  ok: boolean; reason?: string; nameBase: string; lang: string; palette: string; mode: string;
  paths: any; qa: any;
}

function statCell(anchor: number[]): number[] { const cx = anchor[0]; return [cx - 128, 214, cx + 128, 256]; }

export async function composeOne(opts: ComposeOpts): Promise<ComposeResult> {
  const template = opts.template || "04";
  const mode = opts.mode || "source_faithful";
  const lang = opts.lang, paletteName = opts.palette;
  const manifest = JSON.parse(fs.readFileSync(abs(`manifest/templates/04_luxury_apartment.editable.json`), "utf8"));
  const facts = JSON.parse(fs.readFileSync(abs(`facts/${opts.factsId || "IC-26537"}.json`), "utf8"));
  const palette = loadPalette(paletteName);
  const L = loadLang(lang);
  const provider = new LocalDeterministic();
  const [W, H] = manifest.canvas.output;
  const nameBase = opts.nameBase || `${lang}_${paletteName}`;
  const outDir = opts.outDir || abs(`out/phase2/${template}`);
  fs.mkdirSync(outDir, { recursive: true });

  const slotById = (id: string) => manifest.text_slots.find((s: any) => s.id === id);
  const fit_report: any = {}; const factuality: any = { property_facts: [], generated_factual_copy: [], locked_literals: [], editorial_claims: [], unverified_subjective_claims: [], missing_flags: [] };
  const failures: string[] = [];

  // ---------- TITLE ----------
  const titleSlot = slotById("title");
  const editorialLocks: any[] = [];
  if (opts.editorialLock) editorialLocks.push(opts.editorialLock);
  if (titleSlot.parts[0].editorial_lock) editorialLocks.push(titleSlot.parts[0].editorial_lock);
  const typeText = provider.titleType(facts, lang);
  const adjFact = titleSlot.parts[0].fact; // 'luxury'
  const adjSupported = false; // facts.features empty for IC-26537
  const adjLocked = editorialLocks.some((l) => String(l.claim).toLowerCase() === adjFact);
  let titleLines: string[];
  if (mode === "source_faithful") {
    titleLines = [provider.titleAdjective(adjFact, lang), typeText];
    factuality.locked_literals.push({ slot: "title", part: "type", text: typeText, classification: "property_fact:property_type" });
  } else {
    // fact_safe: drop the unsupported subjective adjective (do NOT substitute)
    titleLines = adjSupported || adjLocked ? [provider.titleAdjective(adjFact, lang), typeText] : [typeText];
  }
  if (opts.edit?.slot === "title") titleLines = opts.edit.text.split("\n");
  const titleText = titleLines.join(" ");
  const titleClaims = detectClaims(titleText, lang, facts, editorialLocks);
  for (const c of titleClaims) factuality[c.category === "editorial_claim" ? "editorial_claims" : "unverified_subjective_claims"].push({ slot: "title", ...c });
  const titleFit = fitTitle(manifest, titleSlot, titleLines, lang);
  fit_report.title = { ok: titleFit.ok, reason: titleFit.reason, chosen: titleFit.chosen, rejected: titleFit.rejected?.slice(0, 4) };
  if (!titleFit.ok) failures.push(`title: ${titleFit.reason}`);

  // ---------- STATS + PRICE ----------
  const statResults: any = {};
  for (const id of ["stat_area", "stat_beds", "stat_baths", "price"]) {
    const slot = slotById(id);
    const sv = statValue(slot, facts, lang, provider);
    if (!sv) {
      if (slot.required === false) { factuality.missing_flags.push({ slot: id, reason: "fact missing", behavior: "omit_and_flag" }); statResults[id] = { omitted: true }; }
      else { failures.push(`${id}: required fact missing`); statResults[id] = { ok: false, reason: "required fact missing" }; }
      continue;
    }
    // mini-fit: shrink size/tracking until the stat fits its cell
    const cell = id === "price" ? slot.measure_region : statCell(slot.anchor);
    const cellW = cell[2] - cell[0];
    const font = openFont(manifest, slot.font);
    let size = slot.size, tracking = slot.tracking, fits = false;
    for (let s = slot.size; s >= slot.font_size.min; s -= 0.5) {
      for (const tr of [slot.tracking, slot.tracking * 0.5, 0]) {
        if (advanceWidth(font, sv.text, s, tr) <= cellW - 8) { size = s; tracking = tr; fits = true; break; }
      }
      if (fits) break;
    }
    const cov = glyphCoverage(manifest, slot.font, sv.text);
    if (!cov.ok) { failures.push(`${id}: glyph_coverage missing [${cov.missing.join("")}]`); }
    if (!fits) failures.push(`${id}: "${sv.text}" does not fit cell ${cellW}px`);
    statResults[id] = { ok: fits && cov.ok, text: sv.text, value: sv.value, size: r2(size), tracking: r2(tracking), cell };
    factuality.property_facts.push({ slot: id, fact: slot.fact, value: sv.value, rendered: sv.text });
  }

  // ---------- BODY ----------
  const bodySlot = slotById("body");
  let bodyText = "";
  let bodyFit: any;
  if (opts.edit?.slot === "body") {
    // human edit: fit the provided text as a single 'edited' variant
    bodyFit = fitBody(manifest, bodySlot, { long: opts.edit.text }, lang, L.locale, !!opts.disableWidow);
    bodyText = opts.edit.text;
  } else {
    const variants = provider.bodyVariants(facts, lang);
    bodyFit = fitBody(manifest, bodySlot, variants, lang, L.locale, !!opts.disableWidow);
    bodyText = bodyFit.ok ? variants[bodyFit.chosen.variant] : variants.long;
    fit_report.body_variants = variants;
  }
  fit_report.body = { ok: bodyFit.ok, reason: bodyFit.reason, chosen: bodyFit.chosen, rejected: bodyFit.rejected?.slice(0, 6) };
  if (!bodyFit.ok) failures.push(`body: ${bodyFit.reason}`);
  // placeholder + factuality + claims on body
  const denyHit = (manifest.placeholder_denylist || []).filter((d: string) => bodyText.toLowerCase().includes(d.toLowerCase()));
  if (denyHit.length) failures.push(`body: placeholder text present: ${denyHit.join(", ")}`);
  const bodyClaims = detectClaims(bodyText, lang, facts, editorialLocks);
  for (const c of bodyClaims) factuality[c.category === "editorial_claim" ? "editorial_claims" : "unverified_subjective_claims"].push({ slot: "body", ...c });
  if (bodyFit.ok) factuality.generated_factual_copy.push({ slot: "body", variant: bodyFit.chosen.variant, text: bodyText, copy_source: PROVIDER_LABEL });
  // numeric fact integrity: any number stated in the body must be backed by a real fact
  const allowedNums = new Set([facts.bedrooms, facts.bathrooms, facts?.size?.built_sqm, facts?.size?.plot_sqm].filter((v) => v != null).map(Number));
  const badNum = (bodyText.match(/\d+/g) || []).map(Number).find((n) => !allowedNums.has(n));
  if (badNum !== undefined) failures.push(`fact_integrity: body states number ${badNum} not backed by facts (allowed: ${[...allowedNums].join(",")})`);
  // fact_safe mode forbids any unverified subjective claim (hard fail); source_faithful only flags it
  if (mode === "fact_safe" && factuality.unverified_subjective_claims.length > 0) {
    failures.push(`fact_safe: unverified subjective claim(s) present: ${factuality.unverified_subjective_claims.map((c: any) => c.term).join(", ")}`);
  }

  // ---------- ASSEMBLE EDITABLE SVG ----------
  const defs = { v: "", n: 0 };
  let chrome = "";
  for (const layer of [...manifest.locked_layers].sort((a, b) => a.z - b.z)) chrome += chromeFragment(manifest, layer, palette, defs);

  const tokenHex = (t: string) => resolveToken(palette, manifest, t);
  let textSvg = "";
  // title
  if (titleFit.ok) {
    const c = tokenHex(titleSlot.color_token);
    const fam = fontFamily(manifest, titleSlot.font);
    const ch = titleFit.chosen!;
    const safe = manifest.safe_areas.title;
    const cx = (safe[0] + safe[2]) / 2;
    const gap = ch.size * (((titleSlot.line_gap_ratio.min) + (titleSlot.line_gap_ratio.max)) / 2);
    const lastBaseline = safe[3] - ch.size * 0.2 - 10;
    titleLines.forEach((line, i) => {
      const by = lastBaseline - (titleLines.length - 1 - i) * gap;
      textSvg += `<text data-slot-id="title" data-source="composed" data-editable="true" data-lang="${lang}" data-token="${titleSlot.color_token}" transform="translate(${cx},${r2(by)}) scale(${ch.scaleX},1)" x="0" y="0" text-anchor="middle" font-family="${fam}" font-size="${ch.size}" letter-spacing="${ch.tracking}" fill="${c.hex}" fill-opacity="${c.opacity}">${escapeXml(line)}</text>`;
    });
  }
  // stats
  for (const id of ["stat_area", "stat_beds", "stat_baths", "price"]) {
    const sr = statResults[id]; if (!sr || sr.omitted || sr.ok === false) continue;
    const slot = slotById(id); const c = tokenHex(slot.color_token); const fam = fontFamily(manifest, slot.font);
    textSvg += `<text data-slot-id="${id}" data-source="property_fact" data-editable="true" data-lang="${lang}" data-token="${slot.color_token}" x="${slot.anchor[0]}" y="${slot.anchor[1]}" text-anchor="middle" font-family="${fam}" font-size="${sr.size}" letter-spacing="${sr.tracking}" fill="${c.hex}" fill-opacity="${c.opacity}">${escapeXml(sr.text)}</text>`;
  }
  // body (one <text> with <tspan> per line)
  if (bodyFit.ok) {
    const slot = bodySlot; const c = tokenHex(slot.color_token); const fam = fontFamily(manifest, slot.font);
    const ch = bodyFit.chosen; const [bx, , bw] = slot.box; const cx = bx + bw / 2; const n = ch.lines.length;
    let tspans = "";
    ch.lines.forEach((line: string, i: number) => {
      const by = slot.baseline_last - (n - 1 - i) * ch.line_spacing;
      tspans += `<tspan x="${cx}" y="${r2(by)}">${escapeXml(line)}</tspan>`;
    });
    textSvg += `<text data-slot-id="body" data-source="generated_copy" data-editable="true" data-lang="${lang}" data-token="${slot.color_token}" text-anchor="middle" font-family="${fam}" font-size="${ch.size}" letter-spacing="${ch.tracking}" fill="${c.hex}" fill-opacity="${c.opacity}">${tspans}</text>`;
  }

  const styleVars = Object.keys(palette.tokens).map((t) => `--${t.replace(/\./g, "-")}:${palette.tokens[t].hex};`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-template="${template}" data-palette="${paletteName}" data-mode="${mode}"><style>:root{${styleVars}}</style><defs>${defs.v}</defs>${chrome}${textSvg}</svg>`;

  // ---------- RENDER + MEASURE + QA ----------
  const svgPath = path.join(outDir, `04_${nameBase}.svg`);
  fs.writeFileSync(svgPath, svg);
  const pngPath = path.join(outDir, `04_${nameBase}.png`);
  fs.writeFileSync(pngPath, renderTemplatePng(svg, W));

  // editability proof (on the editable SVG)
  const expectedSlots = ["title", "stat_area", "stat_beds", "stat_baths", "body"].filter((id) => {
    if (id === "title") return titleFit.ok;
    if (id === "body") return bodyFit.ok;
    return statResults[id] && !statResults[id].omitted && statResults[id].ok !== false;
  });
  const editability = checkEditableSvg(svg, expectedSlots);
  if (!editability.ok) failures.push(`editability: ${editability.issues.join("; ")}`);

  // photo-suppressed render for ink containment + contrast backdrop
  const noPhotoSvg = svg.replace(/<image[^>]*xlink:href="data:image\/jpeg[^"]*"[^>]*\/>/, `<rect x="0" y="0" width="${W}" height="${H}" fill="#000"/>`);
  const noPhoto: RGBA = await renderTemplateRGBA(noPhotoSvg, W, true);
  const withPhoto: RGBA = await renderTemplateRGBA(svg, W, false);
  const T = manifest.diff_config.luma_threshold;

  // containment + contrast per text slot
  const contrast: any = {}; const containment: any = {};
  const slotRegions: Record<string, number[]> = {
    title: manifest.safe_areas.title, body: manifest.safe_areas.body,
    stat_area: statCell(slotById("stat_area").anchor), stat_beds: statCell(slotById("stat_beds").anchor), stat_baths: statCell(slotById("stat_baths").anchor),
  };
  for (const id of Object.keys(slotRegions)) {
    if (!expectedSlots.includes(id)) continue;
    const reg = regionFromArray(slotRegions[id]);
    const box = inkBox(noPhoto, reg, T);
    const within = box ? box.left >= reg.x0 - 2 && box.right <= reg.x1 + 2 && box.top >= reg.y0 - 2 && box.bottom <= reg.y1 + 2 : false;
    containment[id] = { within, box: box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null };
    if (!within) failures.push(`containment: slot '${id}' ink box exceeds its slot region`);
    // contrast: text token vs darker backdrop sampled behind text region (with-photo)
    const slot = id === "title" ? titleSlot : slotById(id);
    const tok = tokenHex(slot.color_token);
    const textRgb = hexToRgb(tok.hex);
    // backdrop = mean of below-median-luma pixels in the region (the film/photo behind)
    let lumas: { l: number; r: number; g: number; b: number }[] = [];
    for (let y = reg.y0; y <= reg.y1; y += 2) for (let x = reg.x0; x <= reg.x1; x += 2) {
      const idx = (y * withPhoto.width + x) * 4;
      lumas.push({ l: lumaAt(withPhoto.data, idx), r: withPhoto.data[idx], g: withPhoto.data[idx + 1], b: withPhoto.data[idx + 2] });
    }
    lumas.sort((a, b) => a.l - b.l);
    const dark = lumas.slice(0, Math.max(1, Math.floor(lumas.length * 0.5)));
    const bg: [number, number, number] = [Math.round(dark.reduce((a, c) => a + c.r, 0) / dark.length), Math.round(dark.reduce((a, c) => a + c.g, 0) / dark.length), Math.round(dark.reduce((a, c) => a + c.b, 0) / dark.length)];
    const ratio = contrastRatio(textRgb, bg);
    const min = id === "title" ? manifest.qa_rules.contrast.large_min : id === "body" ? manifest.qa_rules.contrast.body_min : manifest.qa_rules.contrast.large_min;
    contrast[id] = { ratio, min, backdrop: bg, text: tok.hex, pass: ratio >= min };
    if (ratio < min) failures.push(`contrast: slot '${id}' ratio ${ratio} < ${min}`);
  }

  // factuality verdict
  const factuality_status = factuality.unverified_subjective_claims.length === 0 ? "clean" : "flagged";

  // debug overlay PNG: slot safe areas (cyan) + measured ink boxes (lime) over the render
  let overlay = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  overlay += `<image x="0" y="0" width="${W}" height="${H}" xlink:href="${"data:image/png;base64," + renderTemplatePng(svg, W).toString("base64")}"/>`;
  for (const id of Object.keys(slotRegions)) {
    if (!expectedSlots.includes(id)) continue;
    const r = slotRegions[id];
    overlay += `<rect x="${r[0]}" y="${r[1]}" width="${r[2] - r[0]}" height="${r[3] - r[1]}" fill="none" stroke="#00e5ff" stroke-width="2" stroke-dasharray="6 4"/>`;
    const b = containment[id]?.box;
    if (b) overlay += `<rect x="${b.left}" y="${b.top}" width="${b.right - b.left}" height="${b.bottom - b.top}" fill="none" stroke="#7CFC00" stroke-width="2"/>`;
  }
  overlay += `</svg>`;
  const debugPath = path.join(outDir, `04_${nameBase}.debug.png`);
  fs.writeFileSync(debugPath, renderTemplatePng(overlay, W));

  const ok = failures.length === 0;
  const qa = {
    template, lang, palette: paletteName, mode, ok, failures,
    provider: { copy_source: PROVIDER_LABEL, banner: PROVIDER_BANNER },
    factuality: { status: factuality_status, ...factuality },
    fit_report, contrast, containment, editability,
    locked_tokens: Object.keys(palette.tokens).filter((t) => isLockedToken(palette, manifest, t)),
  };
  const qaPath = path.join(outDir, `04_${nameBase}.qa.json`);
  fs.writeFileSync(qaPath, JSON.stringify(qa, null, 2) + "\n");

  return { ok, reason: failures[0], nameBase, lang, palette: paletteName, mode, paths: { svg: svgPath, png: pngPath, debug: debugPath, qa: qaPath }, qa };
}
