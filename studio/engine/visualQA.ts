import fs from "node:fs";
import path from "node:path";
import { abs } from "../src/lib/paths";
import { pngToRGBA, RGBA } from "../src/lib/render";
import { renderEditable, loadEditableManifest, EditableManifest, SlotLayout, Palette } from "./renderEditable";

// VISUAL QA for editable renders — encodes the review rules Christian called out (2026-07-02) as automated,
// machine-checkable gates so layout regressions can't slip through a "technically passed" proof:
//   • no text touching divider lines / bbox edges  (width within bbox - padding)
//   • title / body stay inside their safe zones     (vertical block within bbox)
//   • contact/info bars not cramped                 (same width + padding rule)
//   • title copy must be meaningful with real data  (not a vague one-word type)
//   • no stray baked source artifacts               (declared knockout regions render clean)
//   • text stays legible after auto-fit             (size floor)
// (The "final agency-ready real-property render, not only technical proof" rule is enforced by finalRender.ts,
//  which runs this QA on the real-property renders and fails the run if any check fails.)

export type QACheck = { slot?: string; name: string; ok: boolean; detail?: string };

function lumaStd(img: RGBA, b: number[]): number {
  const vals: number[] = [];
  for (let y = Math.max(0, b[1]); y < Math.min(img.height, b[3]); y++)
    for (let x = Math.max(0, b[0]); x < Math.min(img.width, b[2]); x++) {
      const i = (y * img.width + x) * 4;
      vals.push(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]);
    }
  if (!vals.length) return 0;
  const m = vals.reduce((a, v) => a + v, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, v) => a + (v - m) * (v - m), 0) / vals.length);
}

export async function runVisualQA(m: EditableManifest, r: { png: Buffer; layout: SlotLayout[] }): Promise<{ ok: boolean; checks: QACheck[] }> {
  const checks: QACheck[] = [];
  const add = (name: string, ok: boolean, detail = "", slot?: string) => checks.push({ slot, name, ok, detail });
  const byId: Record<string, any> = Object.fromEntries(m.text_slots.map((s) => [s.id, s]));

  for (const L of r.layout) {
    // 1. width clearance — text fits inside bbox minus padding, so it never touches dividers / panel edges
    add("text width within safe zone (no divider/edge touch)", L.maxLineWidth <= L.avail + 1, `w=${L.maxLineWidth} avail=${L.avail}`, L.id);
    // 2. vertical safe zone — the text block stays inside its bbox
    add("text block within vertical safe zone", L.blockTop >= L.bbox[1] - 1 && L.blockBottom <= L.bbox[3] + 2, `[${L.blockTop},${L.blockBottom}]⊂[${L.bbox[1]},${L.bbox[3]}]`, L.id);
    // 3. legibility floor after auto-fit
    add("size ≥ 12px (legible after auto-fit)", L.size >= 12, `${L.size}px`, L.id);
    // 4. meaningful title copy (not a vague one-word type like "chalet")
    if (/title/.test(L.id)) {
      const t = (byId[L.id]?.text || "").replace(/\n/g, " ").trim();
      add("title copy meaningful (≥2 words or ≥10 chars)", t.split(/\s+/).length >= 2 || t.length >= 10, `"${t}"`, L.id);
    }
  }
  // 5. no stray baked artifacts — each declared knockout region must render as a near-uniform patch
  if (m.knockout_regions?.length) {
    const img = await pngToRGBA(r.png, false);
    for (const kr of m.knockout_regions) add("knockout region clean (stray artifact removed)", lumaStd(img, kr) < 24, `stddev ${lumaStd(img, kr).toFixed(1)}`);
  }
  return { ok: checks.every((c) => c.ok), checks };
}

// standalone gate: QA a manifest with neutral photos + no palette (template-default). Used as a fast regression.
export async function qaManifest(manifestPath: string): Promise<{ ok: boolean; checks: QACheck[]; id: string }> {
  const m = loadEditableManifest(manifestPath);
  const r = await renderEditable(m);
  const { ok, checks } = await runVisualQA(m, r);
  return { ok, checks, id: m.template_id };
}

if (require.main === module) {
  (async () => {
    const mps = process.argv.slice(2);
    const list = mps.length ? mps : ["1", "7", "11"].map((n) => `manifest/templates/${n}.editable.json`);
    let allOk = true;
    for (const mp of list) {
      const { ok, checks, id } = await qaManifest(mp);
      console.log(`== visual QA #${id} (${mp}) ==`);
      for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.slot ? `[${c.slot}] ` : ""}${c.name}${c.detail ? "  — " + c.detail : ""}`);
      console.log(`  #${id}: ${ok ? "PASS" : "FAIL"}\n`);
      allOk = allOk && ok;
    }
    console.log(`VISUAL QA: ${allOk ? "PASS" : "FAIL"}`);
    if (!allOk) process.exit(1);
  })().catch((e) => { console.error("ERROR:", e.stack || e.message); process.exit(1); });
}
