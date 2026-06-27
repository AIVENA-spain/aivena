import { z } from "zod";

// ---- Q2: Manifest extractor + engine_proof ----
// The extractor binds the Phase-2 editable manifest's per-slot fonts to the ADJUDICATOR's vault-backed
// decisions (Engine Spine truth), instead of trusting hand-set font names. engine_proof then runs the real
// studio-compose engine on REAL property facts and asserts machine-checkable provenance / no-hand-assembly.

export const FontBinding = z.object({
  slot_id: z.string(),
  adjudicated_layer: z.string(),          // which adjudicate layer this slot maps to (title/stats/body)
  manifest_font: z.string(),              // the font KEY in the manifest (e.g. "Prata")
  manifest_family: z.string(),            // its name-table family (resvg render name, e.g. "LCText400")
  adjudicator_label: z.string(),          // verified_visual_match | visual_substitute | needs_seed | ...
  adjudicator_score: z.number(),
  adjudicator_selected_font: z.string().nullable(), // display name the adjudicator selected (null if needs_seed)
  closest_candidate: z.string().nullable(),
  vault_id: z.string().nullable(),        // the vault entry the manifest font resolves to (by family)
  vault_status: z.string().nullable(),    // active | seed_only | rejected
  production_safe: z.boolean(),
  confirmed: z.boolean(),                 // adjudicator confirms this slot's font (verified/exact)
  agrees_with_manifest: z.boolean(),      // manifest font == adjudicator-confirmed font
  note: z.string(),
});
export type FontBinding = z.infer<typeof FontBinding>;

export const ManifestBindings = z.object({
  template_id: z.string(),
  generated_by: z.string(),
  vault_version: z.string(),
  adjudication_status: z.string(),        // the adjudicator's template status (e.g. needs_seed)
  bindings: z.array(FontBinding),
  unresolved_slots: z.array(z.string()),  // slots whose font is not adjudicator-confirmed (need seed)
  all_fonts_vault_backed: z.boolean(),
  all_confirmed: z.boolean(),
});
export type ManifestBindings = z.infer<typeof ManifestBindings>;

export const ProofLayer = z.object({
  slot_id: z.string(),
  provenance: z.string(),                 // property_fact | generated_copy | locked_literal | composed
  fact_key: z.string().nullable(),
  fact_value: z.union([z.string(), z.number(), z.null()]),
  rendered_text: z.string(),
  font: z.string(),
  font_confirmed: z.boolean(),
  traces_to_fact: z.boolean(),            // the rendered value came from a real fact / fact-derived copy
});
export type ProofLayer = z.infer<typeof ProofLayer>;

export const EngineProof = z.object({
  template_id: z.string(),
  property_id: z.string(),
  generated_by: z.string(),
  mode: z.string(),
  lang: z.string(),
  palette: z.string(),
  render: z.object({ ok: z.boolean(), svg: z.string().nullable(), png: z.string().nullable(), bytes: z.number() }),
  layers: z.array(ProofLayer),
  fonts: z.object({ all_vault_backed: z.boolean(), all_confirmed: z.boolean(), unresolved: z.array(z.string()) }),
  invariants: z.object({
    render_produced: z.boolean(),
    no_hand_assembly: z.boolean(),        // every editable value traces to a fact; no placeholder; no invented number
    fonts_vault_backed: z.boolean(),
    deterministic: z.boolean(),
    factuality_honest: z.boolean(),       // subjective claims flagged or removed, never silently asserted
  }),
  factuality_status: z.string(),          // clean | flagged
  failures: z.array(z.string()),
  verdict: z.string(),
  caveats: z.array(z.string()),
});
export type EngineProof = z.infer<typeof EngineProof>;
