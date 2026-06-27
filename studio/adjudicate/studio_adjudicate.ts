import fs from "node:fs";
import path from "node:path";
import { LayerSpec } from "../resolver/types";
import { abs } from "../resolver/fontLibrary";
import { renderSourcePng } from "../resolver/glyphMetrics";
import { ResolveOpts } from "../resolver/resolveLayer";
import { SHAPE_FLOOR } from "../resolver/score";
import { loadVault } from "../vault/buildVault";
import { REQUIRED_CHARS, Lang } from "../vault/vaultTypes";
import { IntakeTemplate, LayerOutcome, CrossLayerFlag, TemplateStatus } from "./types";
import { prefilter, requiredCharsFor } from "./prefilter";
import { matchLayer } from "./match";
import { guardCrossLayer } from "./crossLayer";
import { aggregateStatus } from "./status";
import { perLayerProof, beforeAfter } from "./proof";
import { buildReport, writeReport, summaryTxt, AdjudicateReport } from "./report";

const SS = 3, K = 0.5; // identical to the frozen v1 resolver

export interface AdjudicateOpts { mode?: "faithful" | "production"; tinosActive?: boolean; generatedAt?: string; intakeRoot?: string; quiet?: boolean; }

function v1LayerOf(L: any): LayerSpec {
  return {
    layer_id: L.id, text: L.text ?? "(content-independent)",
    layer_bbox: L.layer_bbox, ref_glyph_bbox: L.ref_glyph?.bbox,
    metric: L.metric === "x" ? "x" : "cap",
    match_mode: L.match_mode === "features" ? "metric" : "shape",
    categories: L.categories === "any" ? undefined : (L.categories as any[]).filter((c) => c !== "mono"),
    ground_truth: L.known_true_font ? { family: L.known_true_font } : undefined,
  } as LayerSpec;
}

// blocked_missing_source pre-check: genuinely-absent required source material -> block, naming files. Never
// because a font could not be decided.
function preCheck(tpl: IntakeTemplate, intakeDir: string, fontFiles: string[]): string[] {
  const missing: string[] = [];
  const need = (rel: string) => { if (!fs.existsSync(abs(rel))) missing.push(rel); };
  need(tpl.source.svg_nophoto);
  need(tpl.source.png);
  for (const a of tpl.fixed_assets || []) need(a);
  for (const f of fontFiles) if (!fs.existsSync(abs(f))) missing.push(f);
  return missing;
}

export async function adjudicate(id: string, opts: AdjudicateOpts = {}): Promise<{ report: AdjudicateReport; outcomes: LayerOutcome[]; crossFlags: CrossLayerFlag[] }> {
  const mode = opts.mode ?? "faithful";
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const intakeRoot = opts.intakeRoot ?? "intake";
  const intakeDir = abs(path.join(intakeRoot, id));
  const outDir = abs(path.join("out/adjudicate", id));
  fs.mkdirSync(outDir, { recursive: true });
  const log = (m: string) => { if (!opts.quiet) console.log(m); };

  const vault = loadVault();
  const activeEntries = vault.fonts.filter((f) => f.status === "active" || (opts.tinosActive && /tinos/i.test(f.id)));
  const fontFiles = activeEntries.map((f) => f.file);

  // ---- pre-check (template parse + required source) ----
  const tplPath = path.join(intakeDir, "template.json");
  if (!fs.existsSync(tplPath)) {
    const report = buildReport({ template_id: id, status: "blocked_missing_source", mode, vault_version: vault.vault_version, outcomes: [], crossFlags: [], beforeAfter: null, missingSource: [path.relative(abs("."), tplPath)], engineError: null, generatedAt });
    writeReport(report, outDir); log(summaryTxt(report)); return { report, outcomes: [], crossFlags: [] };
  }
  let tpl: IntakeTemplate;
  try { tpl = IntakeTemplate.parse(JSON.parse(fs.readFileSync(tplPath, "utf8"))); }
  catch (e: any) {
    const report = buildReport({ template_id: id, status: "blocked_missing_source", mode, vault_version: vault.vault_version, outcomes: [], crossFlags: [], beforeAfter: null, missingSource: [`${path.relative(abs("."), tplPath)} (parse: ${e.message})`], engineError: null, generatedAt });
    writeReport(report, outDir); log(summaryTxt(report)); return { report, outcomes: [], crossFlags: [] };
  }
  const missing = preCheck(tpl, intakeDir, fontFiles);
  if (missing.length) {
    const report = buildReport({ template_id: tpl.template_id, status: "blocked_missing_source", mode, vault_version: vault.vault_version, outcomes: [], crossFlags: [], beforeAfter: null, missingSource: missing, engineError: null, generatedAt });
    writeReport(report, outDir); log(summaryTxt(report)); return { report, outcomes: [], crossFlags: [] };
  }

  try {
    // ---- render measurement source (no-photo svg at SS, overlay suppressed) ----
    const sourceImg = await renderSourcePng(abs(tpl.source.svg_nophoto), tpl.canvas.width * SS, true);
    const opts2: ResolveOpts = { ss: SS, k: K, shapeFloor: SHAPE_FLOOR, measureLog: [] };

    const outcomes: LayerOutcome[] = [];
    for (const L of tpl.layers) {
      const v1 = v1LayerOf(L);
      const langAccents = L.language ? REQUIRED_CHARS[L.language as Lang] || null : null;
      const required = requiredCharsFor(L.text, langAccents);
      // ---- stage-1 pre-filter (permissive) + acceptance guard ----
      let pf = prefilter(sourceImg, v1, L.categories, required, activeEntries, SS, K, { bandFactor: 3.0 });
      for (const line of pf.log) log("  " + line);
      const trueInShortlist = () => !L.known_true_font || pf.shortlist.some((s) => s.entry.display_name.toLowerCase() === String(L.known_true_font).toLowerCase());
      if (!trueInShortlist()) {
        log(`  [guard] true font '${L.known_true_font}' missing from shortlist -> widening bands`);
        pf = prefilter(sourceImg, v1, L.categories, required, activeEntries, SS, K, { bandFactor: 6.0 });
        for (const line of pf.log) log("  " + line);
      }
      if (!trueInShortlist()) throw new Error(`acceptance guard: known-true font '${L.known_true_font}' for layer '${L.id}' was pre-filtered out (bug)`);

      const oc = await matchLayer(sourceImg, v1, L, pf.shortlist, outDir, L.id, vault.vault_version, opts2);
      log(`  [${oc.id}] ${oc.label} score=${oc.score} sep=${oc.separation} loo_ok=${oc.leave_one_out_ok} selected=${oc.selected_font ?? "—"}`);
      outcomes.push(oc);
    }

    // ---- cross-layer consistency guard ----
    const { flags } = guardCrossLayer(outcomes);
    for (const f of flags) log(`  [cross-layer] ${f.note}`);

    // ---- proof ----
    for (const oc of outcomes) oc.proof = await perLayerProof(sourceImg, oc, outDir);
    const ba = await beforeAfter(abs(tpl.source.png), tpl.canvas, outcomes, path.join(outDir, "before_after.png"));

    // ---- status + report ----
    const { status, rationale } = aggregateStatus(outcomes, flags, mode);
    log(`  status: ${status} — ${rationale}`);
    const report = buildReport({ template_id: tpl.template_id, status, mode, vault_version: vault.vault_version, outcomes, crossFlags: flags, beforeAfter: ba, missingSource: [], engineError: null, generatedAt });
    writeReport(report, outDir);
    log("\n" + summaryTxt(report));
    return { report, outcomes, crossFlags: flags };
  } catch (e: any) {
    const report = buildReport({ template_id: tpl.template_id, status: "engine_issue", mode, vault_version: vault.vault_version, outcomes: [], crossFlags: [], beforeAfter: null, missingSource: [], engineError: e.message, generatedAt });
    writeReport(report, outDir); log(summaryTxt(report)); return { report, outcomes: [], crossFlags: [] };
  }
}

// ---- fixtures ----
async function fixtureGuard(): Promise<boolean> {
  console.log("== guard fixture: Tinos temporarily ACTIVE — prove the Tinos<->body ambiguity protection ==");
  const { report, outcomes, crossFlags } = await adjudicate("04", { mode: "faithful", tinosActive: true, generatedAt: "fixture", intakeRoot: "intake", quiet: true });
  const tinosBodyFlag = crossFlags.some((f) => /tinos/i.test(f.font) && f.collapsed_layer === "body");
  const body = outcomes.find((o) => o.id === "body");
  const bodyKeptLCText = !!body && /libre caslon text/i.test(body.rank1_font) && !/tinos/i.test(body.selected_font || "");
  console.log(`  cross_layer_flags: ${JSON.stringify(crossFlags.map((f) => `${f.font}->${f.collapsed_layer}`))}`);
  console.log(`  body rank1=${body?.rank1_font} selected=${body?.selected_font ?? "—"} label=${body?.label}`);
  const ok = tinosBodyFlag && bodyKeptLCText;
  console.log(`  flag Tinos<->body: ${tinosBodyFlag ? "yes" : "NO"} | body stays Libre Caslon Text & Tinos not selected: ${bodyKeptLCText ? "yes" : "NO"}`);
  console.log(`  GUARD FIXTURE: ${ok ? "PASS" : "FAIL"}`);
  return ok;
}

async function fixtureMissingSource(): Promise<boolean> {
  console.log("== missing-source fixture: intake with source.png absent -> blocked_missing_source ==");
  const { report } = await adjudicate("_fix_missing_source", { mode: "faithful", generatedAt: "fixture", intakeRoot: "intake", quiet: true });
  const ok = report.status === "blocked_missing_source" && report.missing_source.some((m) => /\.png/i.test(m));
  console.log(`  status=${report.status} missing_source=${JSON.stringify(report.missing_source)}`);
  console.log(`  MISSING-SOURCE FIXTURE: ${ok ? "PASS" : "FAIL"} (must be blocked_missing_source naming the .png, not needs_seed)`);
  return ok;
}

async function main() {
  const argv = process.argv.slice(2);
  const a: any = { _: [] };
  for (let i = 0; i < argv.length; i++) { const t = argv[i]; if (t.startsWith("--")) { const k = t.slice(2); const n = argv[i + 1]; if (n === undefined || n.startsWith("--")) a[k] = true; else { a[k] = n; i++; } } else a._.push(t); }

  if (a.fixture === "guard") { process.exit((await fixtureGuard()) ? 0 : 1); }
  if (a.fixture === "missing-source") { process.exit((await fixtureMissingSource()) ? 0 : 1); }
  if (a.fixtures) { const g = await fixtureGuard(); const m = await fixtureMissingSource(); process.exit(g && m ? 0 : 1); }

  const id = a._[0];
  if (!id) { console.error("usage: studio_adjudicate <id> [--mode faithful|production] [--tinos-active] [--at <iso>]  |  --fixtures"); process.exit(2); }
  const { report } = await adjudicate(id, { mode: a.mode === "production" ? "production" : "faithful", tinosActive: !!a["tinos-active"], generatedAt: a.at || undefined });
  console.log(`\n=> ${report.template_id} status=${report.status}  (report: out/adjudicate/${id}/report.json)`);
}

if (require.main === module) main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
