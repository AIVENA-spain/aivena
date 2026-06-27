import fs from "node:fs";
import path from "node:path";
import { ResolveJob, ResolverReport, LayerResult } from "./types";
import { loadLibrary, abs, LoadedLibrary } from "./fontLibrary";
import { renderSourcePng, renderStringRGBA, inkBox, regionOf } from "./glyphMetrics";
import { resolveLayer, ResolveOpts } from "./resolveLayer";
import { THRESHOLDS } from "./types";
import { FEATURE_WEIGHTS, SHAPE_FLOOR } from "./score";
import { classifyTitle, HIGH_BAR, USABLE_BAR } from "./visualMatch";
import { makeContactSheet } from "./proof";

const OUT = abs("out/resolver");
const SS = 3; // supersample factor for measurement (hairline preservation, §3.3)
const K = 0.5; // adaptive threshold fraction of peak (§3.2)
function ensureOut() { fs.mkdirSync(OUT, { recursive: true }); }

function parseArgs(argv: string[]): any {
  const a: any = { _: [] };
  for (let i = 0; i < argv.length; i++) { const t = argv[i]; if (t.startsWith("--")) { const k = t.slice(2); const n = argv[i + 1]; if (n === undefined || n.startsWith("--")) a[k] = true; else { a[k] = n; i++; } } else a._.push(t); }
  return a;
}

async function loadSource(job: any): Promise<any> {
  // measurement render at SS (supersample); generated from source_svg if the png isn't present.
  let srcPng = abs(`out/resolver/${job.template_id}_nophoto_ss${SS}.png`);
  const svg = job.source_svg && fs.existsSync(abs(job.source_svg)) ? abs(job.source_svg) : null;
  if (!svg && !fs.existsSync(abs(job.source_render))) throw new Error(`source missing: no ${job.source_svg || job.source_render} — BLOCKED (asset bundle absent)`);
  if (svg) {
    const img = await renderSourcePng(svg, 1080 * SS, true); // suppress dimming overlay for measurement (§3.1)
    const sharp = (await import("sharp")).default;
    await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } }).png().toFile(srcPng);
    return img;
  }
  const { loadPng } = await import("./glyphMetrics");
  return loadPng(abs(job.source_render));
}

async function runJob(jobPath: string, args: any) {
  ensureOut();
  const lib = await loadLibrary("resolver/fontLibrary.json");
  for (const w of lib.warnings) console.log("  [lib] " + w);
  const job = ResolveJob.parse(JSON.parse(fs.readFileSync(abs(jobPath), "utf8")));
  const source = await loadSource(job);
  const measureLog: string[] = [];
  const opts: ResolveOpts = { ss: SS, k: K, shapeFloor: SHAPE_FLOOR, measureLog };

  const layers: LayerResult[] = [];
  for (const layer of job.layers) { console.log(`-- resolve ${job.template_id}.${layer.layer_id} (${layer.match_mode}) --`); layers.push(await resolveLayer(source, layer, lib, OUT, job.template_id, opts)); }

  const summary = { accepted: layers.filter((l) => l.decision === "accept").length, review: layers.filter((l) => l.decision === "review").length, fail: layers.filter((l) => l.decision === "fail").length };
  const gt = job.layers.filter((l: any) => l.ground_truth);
  const gatePass = gt.length > 0 && gt.every((l: any) => { const r = layers.find((x) => x.layer_id === l.layer_id)!; return r.decision === "accept" && r.ground_truth_check?.matched; });

  const report: ResolverReport = { template_id: job.template_id, run_at: args["run-at"] || "deterministic", library_version: lib.library_version, thresholds: THRESHOLDS, weights: FEATURE_WEIGHTS as any, layers, summary, ready_for_next: gatePass };
  fs.writeFileSync(path.join(OUT, `${shortId(job.template_id)}.report.json`), JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(path.join(OUT, `${shortId(job.template_id)}.measurement.log`), measureLog.join("\n") + "\n");
  fs.writeFileSync(path.join(OUT, `${shortId(job.template_id)}.summary.txt`), summaryTxt(report, gatePass));
  console.log(summaryTxt(report, gatePass));

  // leave-one-out (§4)
  if (args["leave-one-out"]) await leaveOneOut(job, lib, source, opts);
  if (args.write) console.log("  [--write] DISABLED in v1 (resolver never mutates a manifest).");
  return report;
}

function shortId(t: string): string { return t.startsWith("04") ? "04" : t.startsWith("02") ? "02" : t; }

async function leaveOneOut(job: any, lib: LoadedLibrary, source: any, opts: ResolveOpts) {
  const rows: any[] = [];
  for (const layer of job.layers) {
    if (!layer.ground_truth) continue;
    const gtNorm = layer.ground_truth.family.toLowerCase().replace(/\s+/g, " ").trim();
    const reduced: LoadedLibrary = { ...lib, fonts: lib.fonts.filter((f) => (f.label || f.verified_family).toLowerCase().replace(/\s+/g, " ").trim() !== gtNorm) };
    const res = await resolveLayer(source, layer, reduced, OUT, `${shortId(job.template_id)}_loo`, opts);
    const falseHigh = res.decision === "accept";
    rows.push({ layer: layer.layer_id, removed: layer.ground_truth.family, decision: res.decision, confidence: res.confidence, best_without: res.best.family, false_high: falseHigh, ok: !falseHigh });
  }
  fs.writeFileSync(path.join(OUT, `${shortId(job.template_id)}.leave_one_out.json`), JSON.stringify(rows, null, 2) + "\n");
  let txt = "LEAVE-ONE-OUT (remove the true font; must NOT report a false HIGH on a wrong font)\n\n";
  for (const r of rows) txt += `[${r.layer}] removed ${r.removed} -> decision=${r.decision} (best now ${r.best_without}, conf ${r.confidence}) ${r.ok ? "OK (no false HIGH)" : "FALSE HIGH!"}\n`;
  txt += `\nleave-one-out: ${rows.every((r) => r.ok) ? "CLEAN" : "FAILED"}\n`;
  fs.writeFileSync(path.join(OUT, `${shortId(job.template_id)}.leave_one_out.txt`), txt);
  console.log("\n" + txt);
}

function summaryTxt(r: ResolverReport, gatePass: boolean): string {
  let s = `RESOLVER ${r.template_id} (library ${r.library_version})  ss=${SS}x  k=${K}\n`;
  s += `thresholds: HIGH conf>=${r.thresholds.high} sep>=${r.thresholds.high_separation}; weights ${JSON.stringify(r.weights)}\n\n`;
  for (const l of r.layers) {
    s += `[${l.layer_id}] ${l.decision.toUpperCase()} conf=${l.confidence} sep=${l.separation} mode=${l.match_mode} measurement=${l.measurement_quality}\n`;
    s += `   top: ` + l.top.slice(0, 3).map((c) => `${c.family}(${c.composite})`).join("  ") + "\n";
    if (l.ground_truth_check) s += `   ground_truth: matched=${l.ground_truth_check.matched} rank=${l.ground_truth_check.true_font_rank}\n`;
    if (l.manifest_mapping) s += `   -> manifest_mapping (report-only): ${JSON.stringify(l.manifest_mapping)}\n`;
  }
  s += `\nsummary: ${JSON.stringify(r.summary)}\n#4 GATE: ${gatePass ? "PASS" : "FAIL"}\n`;
  return s;
}

// ---- fixtures ----
async function syntheticSource(lib: LoadedLibrary, trueId: string, str: string) {
  const f = lib.fonts.find((x) => x.id === trueId);
  if (!f) throw new Error(`fixture true_font_id '${trueId}' not in library`);
  const img = await renderStringRGBA(f.verified_family, str, 180 * SS, 1);
  const b = inkBox(img, regionOf([0, 0, img.width - 1, img.height - 1]), 60)!;
  return { img, bbox: [(b.left - 4) / SS, (b.top - 4) / SS, (b.right + 4) / SS, (b.bottom + 4) / SS] };
}

async function runFixtures(): Promise<boolean> {
  ensureOut();
  let allOk = true;
  const opts: ResolveOpts = { ss: SS, k: K, shapeFloor: SHAPE_FLOOR, measureLog: [] };
  for (const name of ["fix_missing", "fix_near", "fix_badname"]) {
    const fx = JSON.parse(fs.readFileSync(abs(`resolver-fixtures/${name}.json`), "utf8"));
    if (fx.kind === "library_validation") {
      const lib = await loadLibrary("resolver/fontLibrary.json", fx.extra_fonts || []);
      const excludedIds = lib.excluded.map((e) => e.id);
      const ok = (fx.expect_excluded || []).every((id: string) => excludedIds.includes(id));
      console.log(`  ${name.padEnd(12)} ${ok ? "PASS" : "FAIL"} — excluded=[${excludedIds.join(",")}]`);
      allOk = allOk && ok;
    } else {
      const lib = await loadLibrary("resolver/fontLibrary.json", fx.extra_fonts || []);
      const syn = await syntheticSource(lib, fx.true_font_id, fx.string);
      let candLib: LoadedLibrary = { ...lib };
      if (fx.exclude_ids) candLib = { ...lib, fonts: lib.fonts.filter((f) => !fx.exclude_ids.includes(f.id)) };
      if (fx.use_only) candLib = { ...lib, fonts: lib.fonts.filter((f) => fx.use_only.includes(f.id)) };
      const layer = { layer_id: name, text: fx.string, layer_bbox: syn.bbox, metric: fx.metric, match_mode: fx.match_mode || "shape", categories: undefined, ground_truth: undefined } as any;
      const res = await resolveLayer(syn.img, layer, candLib, OUT, name, opts);
      const ok = res.decision === fx.expect;
      console.log(`  ${name.padEnd(12)} ${ok ? "PASS" : "FAIL"} — decision=${res.decision} (expect ${fx.expect}) conf=${res.confidence} sep=${res.separation} best=${res.best.family}`);
      allOk = allOk && ok;
    }
  }
  return allOk;
}

async function titleVisualMatch(jobPath: string) {
  ensureOut();
  const lib = await loadLibrary("resolver/fontLibrary.json");
  for (const w of lib.warnings) console.log("  [lib] " + w);
  const raw = JSON.parse(fs.readFileSync(abs(jobPath), "utf8"));
  const job = ResolveJob.parse({ template_id: raw.template_id, source_render: raw.source_render, source_svg: raw.source_svg, layers: raw.layers });
  const metadata = raw.metadata || { metadata_reliable: false, in_library: false };
  const source = await loadSource(job);
  const renders: any[] = []; const srcBoxOut: any = { box: null };
  const opts: ResolveOpts = { ss: SS, k: K, shapeFloor: SHAPE_FLOOR, measureLog: [], collectRenders: renders, srcBoxOut };
  const res = await resolveLayer(source, job.layers[0], lib, OUT, "04_title_vm", opts);
  const vm = classifyTitle(res.top, metadata);

  const top = vm.scored.slice(0, 5).map((c) => ({ label: `${c.family}  visual=${c.visual_match_score}  (shape ${c.shape} / contrast ${c.metric_fit} / stem ${c.stem} / spacing ${c.spacing})`, img: (renders.find((r) => (r.font.label || r.font.verified_family) === c.family) || renders[0]).img }));
  await makeContactSheet(source, srcBoxOut.box, top, path.join(OUT, "04_title.contact.png"));

  const report = {
    template_id: job.template_id, layer: "title", metadata, bars: { HIGH: HIGH_BAR, USABLE: USABLE_BAR },
    candidates: vm.scored.map((c) => ({ font: c.family, visual_match_score: c.visual_match_score, shape: c.shape, contrast: c.metric_fit, stem: c.stem, spacing: c.spacing, composite: c.composite })),
    chosen_font: vm.best.family, chosen_label: vm.label, visual_match_score: vm.best.visual_match_score, separation: vm.separation,
    title_gate_pass: vm.gate_pass, notes: vm.notes,
    recommended_seed: vm.label === "needs_seed" ? "a licensed high-contrast display serif that matches the source pixels (or Liberation Serif / Tinos for the Times New Roman metadata case) — separate, network-allowed/manual step" : null,
  };
  fs.writeFileSync(path.join(OUT, "04_title.report.json"), JSON.stringify(report, null, 2) + "\n");
  let s = `#4 TITLE VISUAL MATCH\n\nchosen_font: ${vm.best.family}\nlabel: ${vm.label}\nvisual_match_score: ${vm.best.visual_match_score}  (HIGH>=${HIGH_BAR}, USABLE>=${USABLE_BAR})\nseparation: ${vm.separation}\ntitle gate: ${vm.gate_pass ? "PASS (visual-equivalence)" : "needs_seed -> does NOT pass"}\n\nranked:\n`;
  s += vm.scored.map((c) => `  ${c.family.padEnd(22)} visual=${c.visual_match_score}  shape=${c.shape} contrast=${c.metric_fit} stem=${c.stem} spacing=${c.spacing}`).join("\n");
  s += `\n\nnotes:\n` + vm.notes.map((n) => "  - " + n).join("\n") + (report.recommended_seed ? `\n\nrecommended seed: ${report.recommended_seed}\n` : "\n");
  fs.writeFileSync(path.join(OUT, "04_title.summary.txt"), s);
  console.log(s);
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (args["title-visual-match"]) { console.log("== #4 title visual match =="); await titleVisualMatch(args.job || "resolver-jobs/04_title_visualmatch.json"); return; }
    if (args.fixtures) { console.log("== resolver fail-fixtures =="); const ok = await runFixtures(); console.log(ok ? "FIXTURES PASS" : "FIXTURES FAIL"); if (!ok) process.exit(1); return; }
    if (args.job) { await runJob(args.job, args); return; }
    console.error("usage: studio_resolve --job resolver-jobs/04.resolve.json [--leave-one-out] | --fixtures"); process.exit(2);
  } catch (e: any) { console.error("ERROR:", e.message); process.exit(1); }
}
main();
