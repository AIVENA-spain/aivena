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

// luma stddev over a box, EXCLUDING pixels that fall inside any of `exclude` (the drawn text bboxes). A knockout
// region that underlies text (e.g. a full CTA-bar knockout) is only verified on its text-free parts — where a
// stray baked artifact or a leaked baked glyph would still show.
function lumaStdExcl(img: RGBA, b: number[], exclude: number[][]): { std: number; n: number } {
  const inAny = (x: number, y: number) => exclude.some((e) => x >= e[0] && x < e[2] && y >= e[1] && y < e[3]);
  const vals: number[] = [];
  for (let y = Math.max(0, b[1]); y < Math.min(img.height, b[3]); y++)
    for (let x = Math.max(0, b[0]); x < Math.min(img.width, b[2]); x++) {
      if (inAny(x, y)) continue;
      const i = (y * img.width + x) * 4;
      vals.push(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]);
    }
  if (!vals.length) return { std: 0, n: 0 };
  const m = vals.reduce((a, v) => a + v, 0) / vals.length;
  return { std: Math.sqrt(vals.reduce((a, v) => a + (v - m) * (v - m), 0) / vals.length), n: vals.length };
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
  // 5. no stray baked artifacts (incl. CTA-bar marks + neutralized icon columns) — each declared knockout
  //    region must render as a near-uniform patch
  if (m.knockout_regions?.length) {
    const img = await pngToRGBA(r.png, false);
    const excl = m.text_slots.filter((s) => s.text.trim()).map((s) => s.bbox);
    // the adaptive-panel trim creates a legitimate bg-colour band below the content — exclude it (its
    // beige→bg transition is intended, not a stray artifact).
    if (m.adaptive_panel) {
      const ap = m.adaptive_panel;
      const lastY = m.text_slots.filter((s) => ap.fit_to.includes(s.id) && s.text.trim()).reduce((mx, s) => Math.max(mx, s.bbox[3]), ap.area[1]);
      const cutY = Math.round(lastY + ap.pad);
      if (cutY < ap.area[3]) excl.push([ap.area[0], cutY, ap.area[2], ap.area[3]]);
    }
    for (const kr of m.knockout_regions) {
      const s = lumaStdExcl(img, kr, excl);
      if (s.n < 40) continue; // region fully under drawn text / trimmed band — nothing artifact-like to verify
      add("knockout region clean (stray artifact removed)", s.std < 24, `stddev ${s.std.toFixed(1)} (n=${s.n})`);
    }
  }
  // 6. no CTA/adjacent-slot collision — two text slots must not overlap in BOTH axes (they'd collide/overprint).
  //    Combined with the width-in-safe-zone check (text stays inside each bbox), this guarantees no CTA overlap
  //    regardless of how long the agency's phone/website is.
  const S = m.text_slots;
  const collisions: string[] = [];
  for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
    const a = S[i].bbox, b = S[j].bbox;
    const xov = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), yov = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    if (xov > 2 && yov > 2) collisions.push(`${S[i].id}×${S[j].id}(${xov.toFixed(0)}×${yov.toFixed(0)})`);
  }
  add("no slot-bbox collision (CTA/contact safe)", collisions.length === 0, collisions.join(" "));
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
