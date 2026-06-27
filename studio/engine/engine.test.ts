import fs from "node:fs";
import { abs } from "../src/lib/paths";
import { adjudicate } from "../adjudicate/studio_adjudicate";
import { extractManifest } from "./extractManifest";
import { runEngineProof } from "./engineProof";
import { ManifestBindings } from "./engineTypes";

// Self-verifying Q2 + Q9 harness (studio idiom: assert + non-zero exit on failure). No deploy/DB/network.
const checks: { name: string; ok: boolean; detail?: string }[] = [];
const add = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });
const layer = (rep: any, id: string) => rep.layers.find((l: any) => l.id === id);

async function main() {
  const id = "04";

  // ---- Q9: faithful mode keeps the honest record ----
  const faith = await adjudicate(id, { mode: "faithful", generatedAt: "test", quiet: true });
  add("faithful: title stays needs_seed (honest source record)", layer(faith.report, "title").label === "needs_seed");
  add("faithful: template status needs_seed", faith.report.status === "needs_seed");

  // ---- Q9: production mode applies the deliberate improvement ----
  const prod = await adjudicate(id, { mode: "production", generatedAt: "test", quiet: true });
  const pTitle = layer(prod.report, "title");
  add("production: title -> Libre Caslon Display (visual_substitute)", pTitle.label === "visual_substitute" && pTitle.selected_font === "Libre Caslon Display");
  add("production: title improvement_reason recorded", !!pTitle.improvement_reason && /Ÿ/.test(pTitle.improvement_reason));
  add("production: title faithful_label preserved = needs_seed", pTitle.faithful_label === "needs_seed");
  add("production: template status ready_with_improvement", prod.report.status === "ready_with_improvement");
  add("production: stats = Poppins (HIGH)", layer(prod.report, "stats").selected_font === "Poppins" && layer(prod.report, "stats").label === "verified_visual_match");
  add("production: body = Libre Caslon Text (HIGH)", layer(prod.report, "body").selected_font === "Libre Caslon Text" && layer(prod.report, "body").label === "verified_visual_match");

  // ---- extractor (reads the production report set above) ----
  const a = extractManifest(id);
  const b = a.bindings;
  add("extractor: all fonts vault-backed", b.all_fonts_vault_backed);
  add("extractor: title bound to Libre Caslon Display (improvement, faithful=needs_seed)", !!b.bindings.find((x) => x.slot_id === "title" && x.vault_id === "librecaslondisplay-400" && x.improvement && x.faithful_label === "needs_seed"));
  add("extractor: all resolved, none unresolved", b.all_resolved && b.unresolved_slots.length === 0);
  add("extractor: stats/body still confirmed", b.bindings.filter((x) => x.adjudicated_layer === "stats").every((x) => x.confirmed) && !!b.bindings.find((x) => x.slot_id === "body" && x.confirmed));

  const j1 = fs.readFileSync(abs(`out/engine/${id}/manifest_bindings.json`), "utf8");
  extractManifest(id);
  const j2 = fs.readFileSync(abs(`out/engine/${id}/manifest_bindings.json`), "utf8");
  add("extractor: deterministic (byte-identical bindings)", j1 === j2);
  try { ManifestBindings.parse(JSON.parse(j2)); add("extractor: bindings schema-valid", true); }
  catch (e: any) { add("extractor: bindings schema-valid", false, e.message); }

  // ---- engine_proof (renders real facts; runEngineProof regenerates the production report) ----
  const { proofs, ok } = await runEngineProof(id);
  const pos = proofs.find((p) => p.property_id === "IC-26537" && p.mode === "source_faithful")!;
  const fs2 = proofs.find((p) => p.mode === "fact_safe")!;
  const ref = proofs.find((p) => p.property_id === "IC-26537-nobeds")!;

  add("engine_proof: IC-26537 render produced", pos.invariants.render_produced && pos.render.bytes > 0);
  add("engine_proof: title rendered in Libre Caslon Display", !!pos.layers.find((l) => l.slot_id === "title" && l.font === "LibreCaslonDisplay"));
  add("engine_proof: no hand-assembly (every value traces to a fact)", pos.invariants.no_hand_assembly);
  add("engine_proof: stats are real facts (55/1/1)", pos.layers.some((l) => l.slot_id === "stat_area" && String(l.fact_value) === "55") && pos.layers.some((l) => l.slot_id === "stat_beds" && String(l.fact_value) === "1"));
  add("engine_proof: fonts vault-backed + deterministic", pos.invariants.fonts_vault_backed && pos.invariants.deterministic);
  add("engine_proof: fact_safe drops unsupported 'luxury' -> clean", fs2.factuality_status === "clean");
  add("engine_proof: refusal on incomplete real property (no invention)", !ref.invariants.render_produced && ref.invariants.no_hand_assembly && ref.failures.some((f) => /required fact missing/i.test(f)));
  add("engine_proof: overall acceptance", ok);

  console.log("== Q2 + Q9 engine acceptance ==");
  let allOk = true;
  for (const c of checks) { console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? "  — " + c.detail : ""}`); allOk = allOk && c.ok; }
  console.log(`\nENGINE TESTS: ${allOk ? "PASS" : "FAIL"}`);
  if (!allOk) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
