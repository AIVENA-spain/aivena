import fs from "node:fs";
import path from "node:path";
import { abs } from "../lib/paths";
import { loadManifest, loadValues, loadFixture, applyFixture } from "../lib/manifest";
import { measureCmd } from "./measure";
import { calibrateCmd } from "./calibrate";
import { runDiff, Gate } from "./diff";

const GATE_ORDER = ["A_bbox", "B_crop", "C_weight", "D_colour", "E_full", "F_placeholder", "G_overflow"];

function expectedHit(gates: Gate[], exp: { gate: string; element: string }): boolean {
  return gates.some((g) => g.gate === exp.gate && g.scope === exp.element && !g.pass);
}
function failedGateLabels(gates: Gate[]): string[] {
  return gates.filter((g) => !g.pass).map((g) => `${g.gate}[${g.scope}]`);
}

export async function validate04Cmd(_args: any): Promise<void> {
  const template = "04";

  // Pipeline: measure source -> calibrate both title layers (fixes the known-stale title) -> diff good + fixtures.
  console.log("== studio:validate:04 ==");
  console.log("-- step 1: measure source --");
  await measureCmd({ template });
  console.log("-- step 2: calibrate title layers --");
  const calib1 = await calibrateCmd({ template, element: "title_line1" });
  const calib2 = await calibrateCmd({ template, element: "title_line2" });

  const baseManifest = loadManifest(template); // calibrated
  const good = loadValues("values/04_good.json");

  console.log("-- step 3: diff GOOD + 4 fixtures --");
  const goodRes = await runDiff(baseManifest, good);

  const fixtureNames = ["04_bad_title_spacing", "04_bad_body_weight", "04_bad_baseline", "04_bad_placeholder"];
  const fxRows: any[] = [];
  for (const fn of fixtureNames) {
    const fx = loadFixture(fn);
    const m = applyFixture(baseManifest, fx);
    const vals = loadValues(fx.values || "values/04_good.json");
    const res = await runDiff(m, vals);
    const expectsOk = (fx.expect || []).every((e: any) => expectedHit(res.gates, e));
    const accept = res.pass === false && expectsOk;
    fxRows.push({ id: fx.id, expect: fx.expect, overallFail: !res.pass, expectsOk, accept, failedGates: failedGateLabels(res.gates), gates: res.gates });
  }

  // ---- matrix ----
  const lines: string[] = [];
  lines.push("");
  lines.push("PASS/FAIL MATRIX (VISUAL TEMPLATE PROOF)");
  lines.push("case                     | " + GATE_ORDER.join(" | "));
  const gateCell = (gates: Gate[], gate: string) => {
    const gg = gates.filter((g) => g.gate === gate);
    if (gg.length === 0) return " - ";
    return gg.every((g) => g.pass) ? "PASS" : "FAIL";
  };
  const rowFor = (name: string, gates: Gate[]) => name.padEnd(24) + " | " + GATE_ORDER.map((g) => gateCell(gates, g)).join(" | ");
  lines.push(rowFor("GOOD (expect all PASS)", goodRes.gates) + `   => ${goodRes.pass ? "PASS" : "FAIL"}`);
  for (const r of fxRows) {
    const expStr = (r.expect || []).map((e: any) => `${e.gate}[${e.element}]`).join(",");
    lines.push(rowFor(r.id, r.gates) + `   => ${r.overallFail ? "FAIL" : "PASS"} (expect FAIL on ${expStr}) ${r.accept ? "[OK]" : "[ACCEPT-MISS]"}`);
  }

  const finalThresholds = baseManifest.diff_config;
  const acceptance = goodRes.pass && fxRows.every((r) => r.accept);

  lines.push("");
  lines.push("Final thresholds: " + JSON.stringify(finalThresholds));
  lines.push("");
  lines.push("VISUAL TEMPLATE PROOF (A): " + (acceptance ? "harness self-test PASSED" : "harness self-test FAILED"));
  lines.push("ENGINE PROOF (B): NOT RUN — no real-property OCR/vision pass, no renderer-fills-all-slots claim. NOT production-ready.");
  const text = lines.join("\n");
  console.log(text);

  // write artifacts
  const outDir = abs(`out/${template}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "validate_04.json"), JSON.stringify({
    acceptance,
    visual_template_proof: { good: { pass: goodRes.pass, gates: goodRes.gates }, fixtures: fxRows },
    engine_proof: { run: false, claimed: false, note: "Phase 1 is visual-proof tooling only." },
    calibration: { title_line1: calib1, title_line2: calib2 },
    final_thresholds: finalThresholds,
  }, null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "validate_04.md"), "```\n" + text + "\n```\n");

  if (!acceptance) {
    console.error("\nVALIDATE:04 FAILED — acceptance not met (see [ACCEPT-MISS] rows above).");
    throw new Error("studio:validate:04 acceptance failed");
  }
  console.log("\nVALIDATE:04 PASSED — GOOD all-PASS, each fixture FAILs its expected gate. (Visual proof only; engine proof not claimed.)");
}
