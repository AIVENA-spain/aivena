import fs from "node:fs";
import path from "node:path";
import { abs } from "../src/lib/paths";
import { fontFamily } from "../src/lib/fonts";
import { loadVault } from "../vault/buildVault";
import { VaultFile, VaultEntry } from "../vault/vaultTypes";
import { ManifestBindings, FontBinding } from "./engineTypes";

const EDITABLE_MANIFEST = "manifest/templates/04_luxury_apartment.editable.json";
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// Phase-2 editable text_slots -> the adjudicate layer that decided that slot's font.
const SLOT_TO_LAYER: Record<string, string> = {
  title: "title", stat_area: "stats", stat_beds: "stats", stat_baths: "stats", price: "stats", body: "body",
};

interface AdjLayer { id: string; label: string; score: number; selected_font: string | null; candidates: { font: string; score: number }[]; }

function vaultByFamily(vault: VaultFile, family: string): VaultEntry | null {
  return vault.fonts.find((f) => norm(f.family) === norm(family)) || null;
}
function vaultByDisplay(vault: VaultFile, display: string): VaultEntry | null {
  return vault.fonts.find((f) => norm(f.display_name) === norm(display)) || null;
}

// Build font bindings for a template by reconciling the Phase-2 manifest's per-slot fonts with the
// adjudicator's vault-backed decisions. Surfaces where the manifest's font is NOT adjudicator-confirmed
// (e.g. #4 title still hard-set to Prata while the adjudicator says needs_seed).
export function extractManifest(templateId: string): { bindings: ManifestBindings; outDir: string } {
  const manifest = JSON.parse(fs.readFileSync(abs(EDITABLE_MANIFEST), "utf8"));
  const reportPath = abs(`out/adjudicate/${templateId}/report.json`);
  if (!fs.existsSync(reportPath)) throw new Error(`adjudication report missing: out/adjudicate/${templateId}/report.json — run studio_adjudicate ${templateId} first`);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const vault = loadVault();
  const layerById: Record<string, AdjLayer> = {};
  for (const l of report.layers) layerById[l.id] = l;

  const bindings: FontBinding[] = [];
  for (const slot of manifest.text_slots) {
    const layerId = SLOT_TO_LAYER[slot.id];
    const adj = layerId ? layerById[layerId] : undefined;
    const manifest_family = fontFamily(manifest, slot.font);
    const ve = vaultByFamily(vault, manifest_family);
    const confirmed = !!adj && (adj.label === "verified_visual_match" || adj.label === "exact_metadata_match");
    const adjSelectedVault = adj?.selected_font ? vaultByDisplay(vault, adj.selected_font) : null;
    const agrees = !!adjSelectedVault && norm(adjSelectedVault.family) === norm(manifest_family);

    let note: string;
    if (!adj) note = `no adjudicate layer mapped for slot '${slot.id}'`;
    else if (confirmed && agrees) note = `confirmed: manifest font ${slot.font} (${manifest_family}) == adjudicator-selected ${adj.selected_font} (${adj.label} ${adj.score})`;
    else if (confirmed && !agrees) note = `WARNING: adjudicator confirmed ${adj.selected_font} but manifest uses ${slot.font} (${manifest_family}) — mismatch`;
    else note = `NOT confirmed: adjudicator label '${adj.label}' (score ${adj.score}); manifest hard-sets ${slot.font} (${manifest_family}) — closest active candidate ${adj.candidates?.[0]?.font ?? "?"} ${adj.candidates?.[0]?.score ?? ""}; needs seed/source truth (Q9)`;

    bindings.push({
      slot_id: slot.id, adjudicated_layer: layerId || "(none)",
      manifest_font: slot.font, manifest_family,
      adjudicator_label: adj?.label ?? "(no layer)", adjudicator_score: adj?.score ?? 0,
      adjudicator_selected_font: adj?.selected_font ?? null,
      closest_candidate: adj?.candidates?.[0]?.font ?? null,
      vault_id: ve?.id ?? null, vault_status: ve?.status ?? null, production_safe: !!ve?.production_safe,
      confirmed, agrees_with_manifest: agrees, note,
    });
  }

  const unresolved = bindings.filter((b) => !b.confirmed).map((b) => b.slot_id);
  const result = ManifestBindings.parse({
    template_id: templateId,
    generated_by: "studio/engine/extractManifest.ts (binds Phase-2 manifest fonts to the adjudicator + vault)",
    vault_version: vault.vault_version,
    adjudication_status: report.status,
    bindings,
    unresolved_slots: unresolved,
    all_fonts_vault_backed: bindings.every((b) => b.vault_id !== null),
    all_confirmed: unresolved.length === 0,
  });

  const outDir = abs(`out/engine/${templateId}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "manifest_bindings.json"), JSON.stringify(result, null, 2) + "\n");
  fs.writeFileSync(path.join(outDir, "manifest_bindings.md"), bindingsMd(result));

  // extracted manifest: the editable manifest annotated with the resolved bindings (composeOne ignores
  // unknown fields, so it stays renderable). Title is marked needs_seed where the adjudicator says so.
  const extracted = JSON.parse(JSON.stringify(manifest));
  extracted.font_bindings = result.bindings;
  extracted.extracted_by = result.generated_by;
  for (const slot of extracted.text_slots) {
    const b = result.bindings.find((x) => x.slot_id === slot.id);
    if (!b) continue;
    slot.font_binding = { vault_id: b.vault_id, family: b.manifest_family, confirmed: b.confirmed, status: b.vault_status };
    if (!b.confirmed) slot.font_status = b.adjudicator_label; // e.g. needs_seed for the title
  }
  fs.writeFileSync(path.join(outDir, "extracted_manifest.json"), JSON.stringify(extracted, null, 2) + "\n");
  return { bindings: result, outDir };
}

function bindingsMd(b: ManifestBindings): string {
  let s = `# Manifest font bindings — ${b.template_id}\n\nadjudication status: \`${b.adjudication_status}\` · vault \`${b.vault_version}\` · all confirmed: ${b.all_confirmed} · unresolved: ${b.unresolved_slots.join(", ") || "(none)"}\n\n`;
  s += `| slot | manifest font (family) | adjudicator | confirmed | vault | note |\n|---|---|---|---|---|---|\n`;
  for (const x of b.bindings) {
    s += `| ${x.slot_id} | ${x.manifest_font} (${x.manifest_family}) | ${x.adjudicator_label} ${x.adjudicator_score} | ${x.confirmed ? "yes" : "NO"} | ${x.vault_id ?? "—"}/${x.vault_status ?? "—"} | ${x.note.replace(/\|/g, "/")} |\n`;
  }
  return s + "\n";
}

if (require.main === module) {
  const id = process.argv[2] || "04";
  try {
    const { bindings, outDir } = extractManifest(id);
    console.log(`== manifest extractor — ${id} ==`);
    for (const b of bindings.bindings) console.log(`  ${b.slot_id.padEnd(10)} ${b.manifest_font.padEnd(16)} adj=${b.adjudicator_label.padEnd(22)} confirmed=${b.confirmed ? "yes" : "NO "} vault=${b.vault_id ?? "—"}`);
    console.log(`\n  all_fonts_vault_backed=${bindings.all_fonts_vault_backed} all_confirmed=${bindings.all_confirmed} unresolved=[${bindings.unresolved_slots.join(",")}]`);
    console.log(`  wrote ${path.relative(abs("."), outDir)}/{manifest_bindings.json,.md,extracted_manifest.json}`);
  } catch (e: any) { console.error("ERROR:", e.message); process.exit(1); }
}
