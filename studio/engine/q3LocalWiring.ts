import fs from "node:fs";
import path from "node:path";
import { abs } from "../src/lib/paths";
import { composeOne } from "../src/lib/compose";
import { adjudicate } from "../adjudicate/studio_adjudicate";
import { extractManifest } from "./extractManifest";

// Q3 (LOCAL half): "wire approved manifests → studio-compose". studio-compose (composeOne) was hardcoded to
// the #4 manifest; it now renders an arbitrary APPROVED manifest by path. This proves the extractor's
// approved manifest renders through the engine on a REAL property, with the Q9 title (Libre Caslon Display),
// and is render-equivalent to the canonical manifest. Engine Proof B (the deployed Railway /studio/render)
// is the GATED remainder — NOT exercised here.

const titleFam = (svg: string): string | null => {
  const m = svg.match(/data-slot-id="title"[^>]*font-family="([^"]+)"/);
  return m ? m[1] : null;
};

async function main() {
  const id = "04";
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const add = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });

  // approved manifest = the extractor's output for the production (Q9) decision
  await adjudicate(id, { mode: "production", generatedAt: "q3", quiet: true });
  extractManifest(id);
  const approvedManifest = `out/engine/${id}/extracted_manifest.json`;
  add("approved manifest artifact exists", fs.existsSync(abs(approvedManifest)));

  // render the SAME real property two ways through studio-compose
  const canon = await composeOne({ template: id, lang: "en", palette: "source", mode: "source_faithful", factsId: "IC-26537", nameBase: "q3_canonical" });
  const approved = await composeOne({ template: id, lang: "en", palette: "source", mode: "source_faithful", factsId: "IC-26537", nameBase: "q3_approved", manifestPath: approvedManifest });

  const svgCanon = fs.readFileSync(canon.paths.svg, "utf8");
  const svgApproved = fs.readFileSync(approved.paths.svg, "utf8");

  add("approved manifest renders via studio-compose (by path)", approved.ok);
  add("canonical manifest renders", canon.ok);
  add("title rendered in Libre Caslon Display (approved)", titleFam(svgApproved) === "Libre Caslon Display", String(titleFam(svgApproved)));
  add("title rendered in Libre Caslon Display (canonical)", titleFam(svgCanon) === "Libre Caslon Display", String(titleFam(svgCanon)));
  add("approved render is lossless (byte-identical SVG vs canonical)", svgApproved === svgCanon);
  // every editable value still traces to a real fact (no hand-assembly) — reuse composeOne's QA
  const noHand = approved.ok && (approved.qa.failures || []).every((f: string) => !/placeholder|fact_integrity|required fact/i.test(f));
  add("no hand-assembly through the approved manifest", noHand);

  const outDir = abs(`out/engine/${id}/q3_local`); fs.mkdirSync(outDir, { recursive: true });
  if (approved.paths.png && fs.existsSync(approved.paths.png)) fs.copyFileSync(approved.paths.png, path.join(outDir, "render_approved_IC-26537.png"));
  const allOk = checks.every((c) => c.ok);
  const report = {
    template_id: id, generated_by: "studio/engine/q3LocalWiring.ts",
    approved_manifest: approvedManifest,
    studio_compose_renders_by_path: approved.ok,
    title_font: titleFam(svgApproved), lossless_vs_canonical: svgApproved === svgCanon,
    engine_proof_a_local: allOk,
    engine_proof_b_gated: "production renderer (Railway /studio/render) — requires deploy + network + Chat 3 CC; NOT run",
    checks,
  };
  fs.writeFileSync(path.join(outDir, "q3_local_wiring.json"), JSON.stringify(report, null, 2) + "\n");
  let md = `# Q3 (local half) — wire approved manifests → studio-compose\n\nstudio-compose now renders an APPROVED manifest by path (was hardcoded to #4). Proven on real property IC-26537 with the Q9 title (Libre Caslon Display).\n\n`;
  for (const c of checks) md += `- ${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}\n`;
  md += `\n**Engine Proof B (production renderer / Railway \`/studio/render\`) is the GATED remainder — not exercised here** (needs deploy + network + Chat 3 CC).\n`;
  fs.writeFileSync(path.join(outDir, "q3_local_wiring.md"), md);

  console.log("== Q3 (local half): wire approved manifests → studio-compose ==");
  for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? "  — " + c.detail : ""}`);
  console.log(`\n  ${allOk ? "Q3 LOCAL WIRING: PASS (approved manifest renders by path; Engine Proof B remains gated)" : "Q3 LOCAL WIRING: FAIL"}`);
  console.log(`  wrote out/engine/04/q3_local/{q3_local_wiring.json,.md,render_approved_IC-26537.png}`);
  if (!allOk) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
