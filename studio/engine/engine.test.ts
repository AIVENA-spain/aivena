import fs from "node:fs";
import { abs } from "../src/lib/paths";
import { extractManifest } from "./extractManifest";
import { runEngineProof } from "./engineProof";
import { ManifestBindings } from "./engineTypes";

// Self-verifying Q2 harness (studio idiom: assert + non-zero exit on failure). No deploy/DB/network.
const checks: { name: string; ok: boolean; detail?: string }[] = [];
const add = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });

async function main() {
  const id = "04";

  // ---- extractor ----
  const a = extractManifest(id);
  const b = a.bindings;
  add("extractor: all fonts vault-backed", b.all_fonts_vault_backed);
  add("extractor: stats confirmed (Poppins)", b.bindings.filter((x) => x.adjudicated_layer === "stats").every((x) => x.confirmed && x.vault_id === "poppins-400"));
  add("extractor: body confirmed (Libre Caslon Text)", !!b.bindings.find((x) => x.slot_id === "body" && x.confirmed && x.vault_id === "librecaslontext-400"));
  add("extractor: title NOT confirmed -> needs_seed (Q9 truth surfaced)", !!b.bindings.find((x) => x.slot_id === "title" && !x.confirmed && x.adjudicator_label === "needs_seed"));
  add("extractor: unresolved_slots == [title]", JSON.stringify(b.unresolved_slots) === JSON.stringify(["title"]));

  // determinism of the extractor output
  const j1 = fs.readFileSync(abs(`out/engine/${id}/manifest_bindings.json`), "utf8");
  extractManifest(id);
  const j2 = fs.readFileSync(abs(`out/engine/${id}/manifest_bindings.json`), "utf8");
  add("extractor: deterministic (byte-identical bindings)", j1 === j2);
  // schema re-validation of the written artifact
  try { ManifestBindings.parse(JSON.parse(j2)); add("extractor: bindings schema-valid", true); }
  catch (e: any) { add("extractor: bindings schema-valid", false, e.message); }

  // ---- engine_proof ----
  const { proofs, ok } = await runEngineProof(id);
  const pos = proofs.find((p) => p.property_id === "IC-26537" && p.mode === "source_faithful")!;
  const fs2 = proofs.find((p) => p.mode === "fact_safe")!;
  const ref = proofs.find((p) => p.property_id === "IC-26537-nobeds")!;

  add("engine_proof: IC-26537 render produced", pos.invariants.render_produced && pos.render.bytes > 0);
  add("engine_proof: no hand-assembly (every value traces to a fact)", pos.invariants.no_hand_assembly);
  add("engine_proof: stats are real facts (55/1/1)", pos.layers.some((l) => l.slot_id === "stat_area" && String(l.fact_value) === "55") && pos.layers.some((l) => l.slot_id === "stat_beds" && String(l.fact_value) === "1"));
  add("engine_proof: body is generated-from-facts copy", pos.layers.some((l) => l.slot_id === "body" && l.provenance === "generated_copy"));
  add("engine_proof: fonts vault-backed", pos.invariants.fonts_vault_backed);
  add("engine_proof: deterministic render", pos.invariants.deterministic);
  add("engine_proof: title flagged unconfirmed (font_confirmed=NO)", !!pos.layers.find((l) => l.slot_id === "title" && l.font_confirmed === false));
  add("engine_proof: fact_safe drops unsupported 'luxury' -> clean", fs2.factuality_status === "clean");
  add("engine_proof: refusal on incomplete real property (no invention)", !ref.invariants.render_produced && ref.invariants.no_hand_assembly && ref.failures.some((f) => /required fact missing/i.test(f)));
  add("engine_proof: overall acceptance", ok);

  console.log("== Q2 engine acceptance ==");
  let allOk = true;
  for (const c of checks) { console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? "  — " + c.detail : ""}`); allOk = allOk && c.ok; }
  console.log(`\nQ2 ENGINE TESTS: ${allOk ? "PASS" : "FAIL"}`);
  if (!allOk) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
