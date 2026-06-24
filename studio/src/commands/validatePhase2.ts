import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { abs } from "../lib/paths";
import { composeOne } from "../lib/compose";
import { checkEditableSvg } from "../lib/editability";
import { validate04Cmd } from "./validate04";

const LANGS = ["en", "es", "no", "de", "pl"];
const PALETTES = ["source", "warm_mediterranean", "modern_blue_white"];

export async function validatePhase2Cmd(_args: any): Promise<void> {
  const outDir = abs("out/phase2/04");
  fs.mkdirSync(outDir, { recursive: true });
  const res: any = { matrix: [], modes: [], edit_loop: [], fixtures: [], reports: {} };
  console.log("== Phase 2A — validate:04 (editable composition engine) ==");

  // 1) MATRIX 5 langs x 3 palettes (source_faithful)
  console.log("\n-- matrix: 5 languages x 3 palettes (source_faithful) --");
  for (const lang of LANGS) for (const palette of PALETTES) {
    const r = await composeOne({ template: "04", lang, palette, mode: "source_faithful" });
    const contrast_ok = Object.values(r.qa.contrast).every((c: any) => c.pass);
    res.matrix.push({ lang, palette, ok: r.ok, factuality: r.qa.factuality.status, editable: r.qa.editability.ok, contrast_ok, body_variant: r.qa.fit_report.body?.chosen?.variant, title_size: r.qa.fit_report.title?.chosen?.size, failures: r.qa.failures, qa: r.qa });
    console.log(`  ${lang}/${palette.padEnd(18)} ${r.ok ? "OK  " : "FAIL"} | fact:${r.qa.factuality.status.padEnd(7)} | editable:${r.qa.editability.ok ? "y" : "n"} | contrast:${contrast_ok ? "y" : "n"} | body:${r.qa.fit_report.body?.chosen?.variant}${r.ok ? "" : "  <= " + r.qa.failures[0]}`);
  }

  // 2) MODES (en/source): "Luxury" handling
  console.log("\n-- modes (en/source): subjective-claim handling of 'Luxury' --");
  const m1 = await composeOne({ lang: "en", palette: "source", mode: "source_faithful", nameBase: "mode_source_faithful" });
  const m2 = await composeOne({ lang: "en", palette: "source", mode: "source_faithful", editorialLock: { claim: "luxury", approved_by: "agency_demo", scope: "template" }, nameBase: "mode_editorial_lock" });
  const m3 = await composeOne({ lang: "en", palette: "source", mode: "fact_safe", nameBase: "mode_fact_safe" });
  res.modes = [
    { mode: "source_faithful (no lock)", factuality: m1.qa.factuality.status, expect: "flagged", accept: m1.qa.factuality.status === "flagged" && m1.ok },
    { mode: "source_faithful + editorial_lock", factuality: m2.qa.factuality.status, expect: "clean", accept: m2.qa.factuality.status === "clean" && m2.ok },
    { mode: "fact_safe ('Luxury' removed)", factuality: m3.qa.factuality.status, expect: "clean", accept: m3.qa.factuality.status === "clean" && m3.ok },
  ];
  for (const m of res.modes) console.log(`  ${m.mode.padEnd(36)} factuality=${m.factuality.padEnd(7)} (expect ${m.expect}) ${m.accept ? "[OK]" : "[MISS]"}`);

  // 3) HUMAN-EDIT LOOP: accepted + rejected
  console.log("\n-- human-edit revalidation loop --");
  const editAccept = await composeOne({ lang: "en", palette: "source", mode: "source_faithful", edit: { slot: "body", text: "A 1-bedroom apartment in Torrevieja with 55 m² of living space." }, nameBase: "edit_accepted" });
  const editReject = await composeOne({ lang: "en", palette: "source", mode: "source_faithful", edit: { slot: "body", text: "A truly extensive and exhaustively detailed description of this apartment that simply will never fit inside the body slot no matter how far the font shrinks, because it is far too long for the available space, going on and on about rooms and storage and balconies and kitchens and views and amenities and neighbourhood character and transport and shops and restaurants and beaches across the whole coastal town." }, nameBase: "edit_rejected" });
  res.edit_loop = [
    { case: "accepted (valid shorter body)", rendered: editAccept.ok, expect: "pass", accept: editAccept.ok === true },
    { case: "rejected (over-long body)", rendered: editReject.ok, reason: editReject.qa.failures[0], expect: "fail (with reason)", accept: editReject.ok === false },
  ];
  for (const e of res.edit_loop) console.log(`  ${e.case.padEnd(30)} ${e.rendered ? "rendered" : "rejected"} (expect ${e.expect}) ${e.accept ? "[OK]" : "[MISS]"}${e.reason ? " — " + e.reason : ""}`);
  fs.writeFileSync(path.join(outDir, "edit_loop_report.json"), JSON.stringify({ accepted: editAccept.qa, rejected: editReject.qa }, null, 2) + "\n");

  // 4) FAIL-CLOSED FIXTURES
  console.log("\n-- fail-closed fixtures --");
  const fixtures = [
    { id: "too_long_german_title", expect: "title fit", run: () => composeOne({ lang: "de", palette: "source", edit: { slot: "title", text: "Luxuriöse Meeresblick\nPenthouse-Maisonette-Wohnung" }, nameBase: "fx_long_de_title" }) },
    { id: "too_long_body", expect: "overflow", run: () => composeOne({ lang: "en", palette: "source", edit: { slot: "body", text: "An extraordinarily long body paragraph that is padded well beyond any reasonable length so that it cannot possibly fit the body slot at the minimum font size under any wrapping strategy whatsoever, describing every room and balcony and kitchen and corridor and cupboard and window and terrace and garden and garage in exhaustive and unnecessary detail for many lines on end." }, nameBase: "fx_long_body" }) },
    { id: "missing_required_fact", expect: "required fact missing", run: () => composeOne({ lang: "en", palette: "source", factsId: "IC-26537-nobeds", nameBase: "fx_missing_fact" }) },
    { id: "invented_subjective_claim", expect: "fact_safe unverified claim", run: () => composeOne({ lang: "en", palette: "source", mode: "fact_safe", edit: { slot: "body", text: "A 1-bedroom apartment in Torrevieja with sea view and 55 m²." }, nameBase: "fx_invented_claim" }) },
    { id: "bad_contrast", expect: "contrast", run: () => composeOne({ lang: "en", palette: "_bad_contrast", nameBase: "fx_bad_contrast" }) },
    { id: "placeholder_in_body", expect: "placeholder", run: () => composeOne({ lang: "en", palette: "source", edit: { slot: "body", text: "This apartment is now available for rent and ready to view." }, nameBase: "fx_placeholder" }) },
    { id: "locked_fact_changed", expect: "fact_integrity", run: () => composeOne({ lang: "en", palette: "source", edit: { slot: "body", text: "A 3-bedroom apartment in Torrevieja with 55 m² of living space." }, nameBase: "fx_locked_fact" }) },
    { id: "overflow_title", expect: "title fit", run: () => composeOne({ lang: "en", palette: "source", edit: { slot: "title", text: "Extraordinarilywide Unbreakablemegatitle\nApartment" }, nameBase: "fx_overflow_title" }) },
    { id: "orphan_line", expect: "orphan", run: () => composeOne({ lang: "en", palette: "source", disableWidow: true, edit: { slot: "body", text: "Quiet pleasant central Torrevieja coastal home Mediterraneancoastalresidencequarters." }, nameBase: "fx_orphan" }) },
    { id: "unsupported_script", expect: "glyph_coverage", run: () => composeOne({ lang: "en", palette: "source", edit: { slot: "title", text: "豪华公寓\nApartment" }, nameBase: "fx_unsupported_script" }) },
  ];
  for (const fx of fixtures) {
    let failed = false, reason = "";
    try { const r = await fx.run(); failed = !r.ok; reason = r.qa.failures[0] || ""; }
    catch (e: any) { failed = true; reason = "threw: " + e.message; }
    res.fixtures.push({ id: fx.id, expect: fx.expect, failed, reason, accept: failed });
    console.log(`  ${fx.id.padEnd(26)} ${failed ? "FAIL (good)" : "PASSED (BAD!)"}${reason ? " — " + reason : ""}`);
  }
  // editability fixture (outlined slot text in the SVG)
  const outlined = '<svg><g data-slot-id="title"><path data-slot-id="title" d="M0 0 L10 10"/></g></svg>';
  const edChk = checkEditableSvg(outlined, ["title"]);
  res.fixtures.push({ id: "outlined_text_svg", expect: "editability", failed: !edChk.ok, reason: edChk.issues[0], accept: !edChk.ok });
  console.log(`  ${"outlined_text_svg".padEnd(26)} ${!edChk.ok ? "FAIL (good)" : "PASSED (BAD!)"} — ${edChk.issues[0]}`);

  // 5) AGGREGATE REPORTS
  const factuality_report = {
    rule: "factuality 'clean' iff zero unverified_subjective_claims (+ exact stats, no placeholder, no invented number)",
    matrix: res.matrix.map((m: any) => ({ lang: m.lang, palette: m.palette, status: m.factuality, unverified: m.qa.factuality.unverified_subjective_claims.map((c: any) => c.term), missing_flags: m.qa.factuality.missing_flags })),
    modes: res.modes,
  };
  fs.writeFileSync(path.join(outDir, "factuality_report.json"), JSON.stringify(factuality_report, null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "contrast_report.json"), JSON.stringify(res.matrix.map((m: any) => ({ lang: m.lang, palette: m.palette, contrast: m.qa.contrast })), null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "fitting_report.json"), JSON.stringify(res.matrix.map((m: any) => ({ lang: m.lang, palette: m.palette, title: m.qa.fit_report.title, body: m.qa.fit_report.body, body_variants: m.qa.fit_report.body_variants })), null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "copy_variant_selection.json"), JSON.stringify(res.matrix.map((m: any) => ({ lang: m.lang, palette: m.palette, chosen_variant: m.qa.fit_report.body?.chosen?.variant, rejected: m.qa.fit_report.body?.rejected })), null, 2) + "\n");

  // source-vs-render side-by-side (en/source)
  try {
    const srcRef = abs("assets/04/source_ref.png");
    const rebuilt = path.join(outDir, "04_en_source.png");
    const half = 540;
    const left = await sharp(srcRef).resize(half).png().toBuffer();
    const right = await sharp(rebuilt).resize(half).png().toBuffer();
    const h = (await sharp(left).metadata()).height || 675;
    await sharp({ create: { width: half * 2, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
      .composite([{ input: left, left: 0, top: 0 }, { input: right, left: half, top: 0 }]).png().toFile(path.join(outDir, "source_vs_render_en_source.png"));
  } catch (e: any) { console.log("  (side-by-side skipped: " + e.message + ")"); }
  fs.writeFileSync(path.join(outDir, "visual_diff_report.md"), `# Visual diff / Phase-1 compatibility\n\nPhase 2A's fit engine re-fits multilingual/variant copy and does NOT pixel-match the Canva (that is Phase-1 \`calibrate\`'s job). \`source_vs_render_en_source.png\` shows the source (left) vs the Phase-2 editable render (right). Phase-1 \`validate:04\` remains untouched and is re-run below as the compatibility check.\n`);

  // 6) PHASE-1 COMPATIBILITY (validate:04 must still be green)
  console.log("\n-- Phase-1 compatibility: re-running validate:04 --");
  let phase1Green = false;
  try { await validate04Cmd({}); phase1Green = true; } catch { phase1Green = false; }
  console.log(`  Phase-1 validate:04: ${phase1Green ? "GREEN (unbroken)" : "RED (regression!)"}`);

  // ACCEPTANCE
  const matrixOk = res.matrix.every((m: any) => m.ok && m.editable && m.contrast_ok);
  const modesOk = res.modes.every((m: any) => m.accept);
  const editOk = res.edit_loop.every((e: any) => e.accept);
  const fixturesOk = res.fixtures.every((f: any) => f.accept);
  const acceptance = matrixOk && modesOk && editOk && fixturesOk && phase1Green;

  console.log("\n== ACCEPTANCE ==");
  console.log(`  matrix (15 render+editable+contrast): ${matrixOk ? "PASS" : "FAIL"}`);
  console.log(`  modes (flagged/locked-clean/fact_safe-clean): ${modesOk ? "PASS" : "FAIL"}`);
  console.log(`  edit-loop (accept + reject): ${editOk ? "PASS" : "FAIL"}`);
  console.log(`  fail fixtures (${res.fixtures.length} all fail): ${fixturesOk ? "PASS" : "FAIL"}`);
  console.log(`  Phase-1 validate:04 green: ${phase1Green ? "PASS" : "FAIL"}`);
  console.log(`  => VISUAL/EDITABLE COMPOSITION PROOF: ${acceptance ? "PASSED" : "FAILED"}`);
  console.log("  ENGINE/PRODUCTION PROOF: NOT RUN — NOT CLAIMED. No deploy/DB/provider/n8n/KIE.");

  res.acceptance = acceptance;
  fs.writeFileSync(path.join(outDir, "phase2_validate_04.json"), JSON.stringify({ acceptance, matrix: res.matrix.map((m: any) => ({ ...m, qa: undefined })), modes: res.modes, edit_loop: res.edit_loop, fixtures: res.fixtures, phase1_green: phase1Green }, null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "phase2_validate_04.md"), phase2Md(res, acceptance, phase1Green));

  if (!acceptance) throw new Error("Phase 2A acceptance not met");
}

function phase2Md(res: any, acceptance: boolean, phase1Green: boolean): string {
  let md = `# Phase 2A — validate:04 (editable composition engine)\n\nACCEPTANCE: ${acceptance ? "PASSED" : "FAILED"} (visual/editable proof only — engine/production proof NOT claimed)\n\n`;
  md += `## Matrix (5 languages x 3 palettes)\n\n| lang | palette | render | factuality | editable | contrast | body variant |\n|---|---|---|---|---|---|---|\n`;
  for (const m of res.matrix) md += `| ${m.lang} | ${m.palette} | ${m.ok ? "OK" : "FAIL"} | ${m.factuality} | ${m.editable ? "y" : "n"} | ${m.contrast_ok ? "y" : "n"} | ${m.body_variant} |\n`;
  md += `\n## Modes (Luxury)\n\n` + res.modes.map((m: any) => `- ${m.mode}: factuality=${m.factuality} (expect ${m.expect}) ${m.accept ? "OK" : "MISS"}`).join("\n");
  md += `\n\n## Edit loop\n\n` + res.edit_loop.map((e: any) => `- ${e.case}: ${e.rendered ? "rendered" : "rejected"} (expect ${e.expect}) ${e.accept ? "OK" : "MISS"}${e.reason ? " — " + e.reason : ""}`).join("\n");
  md += `\n\n## Fail-closed fixtures\n\n| fixture | expect | result | reason |\n|---|---|---|---|\n`;
  for (const f of res.fixtures) md += `| ${f.id} | ${f.expect} | ${f.failed ? "FAIL (good)" : "PASSED (BAD)"} | ${(f.reason || "").replace(/\|/g, "/")} |\n`;
  md += `\n## Phase-1 compatibility\n\nvalidate:04 re-run: ${phase1Green ? "GREEN (unbroken)" : "RED"}\n`;
  return md;
}
