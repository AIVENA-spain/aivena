import fs from "node:fs";
import path from "node:path";
import { abs } from "../src/lib/paths";

// Q4 (CC verification slice): extract + verify the #4 colour map — hex/role/default/scope per token across
// the agency palettes, flag cross-role hex collisions, dangling/orphan tokens, and lock consistency, and
// check the proposed navy/gold (#0B2545/#C9A45C) presence. READ-ONLY; the canonical colour DECISION
// (which roles get navy/gold, across the full catalogue) stays Chat 1 main + needs Q5.

const EDITABLE = "manifest/templates/04_luxury_apartment.editable.json";
const PALETTES = ["source", "warm_mediterranean", "modern_blue_white"]; // _bad_contrast is a fail fixture, excluded
const NAVY = "#0b2545", GOLD = "#c9a45c";

function collectReferenced(manifest: any): Set<string> {
  const used = new Set<string>();
  for (const l of manifest.locked_layers || []) if (l.color_token) used.add(l.color_token);
  for (const s of manifest.text_slots || []) if (s.color_token) used.add(s.color_token);
  return used;
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(abs(EDITABLE), "utf8"));
  const tokens = manifest.colour_tokens || {};
  const tokenIds = Object.keys(tokens).sort();
  const palettes: Record<string, any> = {};
  for (const p of PALETTES) palettes[p] = JSON.parse(fs.readFileSync(abs(`palettes/${p}.json`), "utf8"));
  const referenced = collectReferenced(manifest);

  // per-token map
  const map = tokenIds.map((id) => {
    const t = tokens[id];
    const perPalette: Record<string, { hex: string; opacity: number; palette_locked: boolean }> = {};
    for (const p of PALETTES) {
      const pal = palettes[p];
      const pt = pal.tokens[id];
      perPalette[p] = { hex: (pt?.hex ?? t.default).toLowerCase(), opacity: pt?.opacity ?? 1, palette_locked: (pal.locked_tokens || []).includes(id) };
    }
    return { id, role: t.role, default: String(t.default).toLowerCase(), manifest_locked: !!t.locked, referenced: referenced.has(id), per_palette: perPalette };
  });

  // dangling references (used by a layer but not defined)
  const dangling = [...referenced].filter((r) => !tokens[r]).sort();
  // orphan tokens (defined but never used by a layer/slot)
  const orphans = tokenIds.filter((id) => !referenced.has(id));

  // cross-role hex collisions per palette: >1 EDITABLE (non-locked) token with distinct roles sharing a hex
  const collisions: any[] = [];
  for (const p of PALETTES) {
    const byHex: Record<string, { id: string; role: string }[]> = {};
    for (const m of map) {
      if (m.manifest_locked || m.per_palette[p].palette_locked) continue; // locked tokens can legitimately share
      const hex = m.per_palette[p].hex;
      (byHex[hex] ||= []).push({ id: m.id, role: m.role });
    }
    for (const hex of Object.keys(byHex)) {
      const grp = byHex[hex];
      const distinctRoles = new Set(grp.map((g) => g.role));
      if (grp.length > 1 && distinctRoles.size > 1) collisions.push({ palette: p, hex, tokens: grp.map((g) => `${g.id}(${g.role})`) });
    }
  }

  // lock consistency: manifest `locked` flag vs palette locked_tokens
  const lockMismatches: any[] = [];
  for (const m of map) for (const p of PALETTES) {
    if (m.manifest_locked !== m.per_palette[p].palette_locked) lockMismatches.push({ token: m.id, palette: p, manifest_locked: m.manifest_locked, palette_locked: m.per_palette[p].palette_locked });
  }

  // navy/gold presence
  const allHex = new Set<string>();
  for (const m of map) { allHex.add(m.default); for (const p of PALETTES) allHex.add(m.per_palette[p].hex); }
  const navyGold = { navy_present: allHex.has(NAVY), gold_present: allHex.has(GOLD) };

  const outDir = abs("out/engine"); fs.mkdirSync(outDir, { recursive: true });
  const report = {
    template_id: "04", generated_by: "studio/engine/colourMap.ts", scope: "#4 editable manifest + agency palettes (source/warm_mediterranean/modern_blue_white). Full catalogue + canonical navy/gold decision = Chat 1 main + Q5.",
    palettes: PALETTES, token_count: tokenIds.length, referenced: [...referenced].sort(), orphans, dangling,
    cross_role_collisions: collisions, lock_mismatches: lockMismatches, navy_gold: navyGold, map,
    verdict: { dangling_refs: dangling.length, orphan_tokens: orphans.length, cross_role_collisions: collisions.length, lock_consistent: lockMismatches.length === 0 },
  };
  fs.writeFileSync(path.join(outDir, "colour_map_04.json"), JSON.stringify(report, null, 2) + "\n");

  let md = `# Q4 (CC slice) — #4 colour map verification\n\nScope: ${report.scope}\n\n`;
  md += `tokens: ${tokenIds.length} · referenced: ${referenced.size} · orphans: ${orphans.length} · dangling: ${dangling.length} · cross-role collisions: ${collisions.length} · lock-consistent: ${lockMismatches.length === 0}\n\n`;
  md += `| token | role | default | locked | referenced | source | warm_med | modern_blue |\n|---|---|---|---|---|---|---|---|\n`;
  for (const m of map) md += `| ${m.id} | ${m.role} | ${m.default} | ${m.manifest_locked ? "yes" : "—"} | ${m.referenced ? "yes" : "NO"} | ${m.per_palette.source.hex} | ${m.per_palette.warm_mediterranean.hex} | ${m.per_palette.modern_blue_white.hex} |\n`;
  md += `\n## Findings\n`;
  md += `- **Cross-role hex collisions** (distinct roles sharing a colour → recolour-ambiguity risk for agencies):\n`;
  for (const c of collisions) md += `  - ${c.palette}: ${c.hex} ← ${c.tokens.join(", ")}\n`;
  md += `- **Orphan tokens** (defined, not used by any #4 layer/slot): ${orphans.join(", ") || "none"}\n`;
  md += `- **Dangling references** (used but undefined): ${dangling.join(", ") || "none"}\n`;
  md += `- **Lock consistency** (manifest vs palette): ${lockMismatches.length === 0 ? "consistent" : JSON.stringify(lockMismatches)}\n`;
  md += `- **Navy/gold** (#0B2545 / #C9A45C): navy present=${navyGold.navy_present}, gold present=${navyGold.gold_present} (board's "unverified on corrected templates" confirmed)\n`;
  md += `\nPARTIAL: #4 + current palettes verified. Canonical navy/gold role assignment + the rest of the catalogue need Chat 1 main + Q5.\n`;
  fs.writeFileSync(path.join(outDir, "colour_map_04.md"), md);

  console.log("== Q4 (CC slice) — #4 colour map verification ==");
  console.log(`  tokens=${tokenIds.length} referenced=${referenced.size} orphans=${orphans.length} dangling=${dangling.length} cross_role_collisions=${collisions.length} lock_consistent=${lockMismatches.length === 0}`);
  for (const c of collisions) console.log(`  collision ${c.palette}: ${c.hex} <- ${c.tokens.join(", ")}`);
  console.log(`  orphans: ${orphans.join(", ") || "none"}`);
  console.log(`  navy/gold present: navy=${navyGold.navy_present} gold=${navyGold.gold_present}`);
  console.log(`  wrote out/engine/colour_map_04.{json,md}`);
  // verification tool: a dangling reference is a real defect -> fail; collisions/orphans are findings, not failures.
  if (dangling.length) { console.log("  FAIL: dangling colour-token reference(s)"); process.exit(1); }
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
