import { z } from "zod";
import { CandidateScore, LayerResult } from "../resolver/types";
import { VaultEntry } from "../vault/vaultTypes";
import { RGBA } from "../src/lib/render";
import { LibFont } from "../resolver/fontLibrary";

// ---- Intake (input) : studio/intake/<id>/template.json ----
// NOTE on layer_bbox: corners [x0,y0,x1,y1] in source.png pixels at canvas width, matching the frozen v1
// resolver geometry exactly (resolveLayer consumes the same convention). #4 reuses its measured values.
export const IntakeLayer = z.object({
  id: z.string(),
  type: z.enum(["headline", "body", "stat", "contact", "label", "price"]),
  editable: z.boolean(),
  text: z.string().nullable(), // null -> features mode (content-independent)
  layer_bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  ref_glyph: z.object({ char: z.string(), bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]) }).optional(),
  metric: z.enum(["cap", "x", "ascender"]),
  match_mode: z.enum(["shape", "features"]),
  categories: z.union([z.array(z.enum(["serif", "sans", "display", "script", "mono"])), z.literal("any")]),
  opacity: z.number(),
  color: z.string(),
  metadata_font: z.string().nullable(),
  metadata_reliable: z.boolean(),
  // engine-only, never used by selection: the known-true font (for the pre-filter acceptance guard + LOO).
  known_true_font: z.string().nullable().optional(),
  language: z.string().optional(), // optional required-language tag for the cmap pre-filter
});
export type IntakeLayer = z.infer<typeof IntakeLayer>;

export const IntakeTemplate = z.object({
  template_id: z.string(),
  canvas: z.object({ width: z.number(), height: z.number() }),
  source: z.object({
    svg: z.string().optional(),        // photo-embedded Canva export (optional; not needed for measurement)
    svg_nophoto: z.string(),           // measurement source (photo removed) — REQUIRED
    png: z.string(),                   // rendered reference at canvas size — REQUIRED
  }),
  fixed_assets: z.array(z.string()).optional(),
  layers: z.array(IntakeLayer).min(1),
});
export type IntakeTemplate = z.infer<typeof IntakeTemplate>;

// ---- per-layer outcome (internal) ----
export type LayerLabel = "exact_metadata_match" | "verified_visual_match" | "visual_substitute" | "needs_seed";

export interface LayerOutcome {
  id: string;
  type: string;
  match_mode: "shape" | "features";
  selected_font: string | null;   // display name of the selected font (null if needs_seed)
  selected_id: string | null;
  known_true_font: string | null; // engine-only: the layer's known-true font (guard + LOO)
  downgraded_by_guard: boolean;   // set if the cross-layer guard demoted this layer
  label: LayerLabel;
  score: number;                   // metric layers: v1 confidence; shape layers: visual_match_score
  rank1_font: string;              // display name of rank-1 candidate (even if not selected)
  separation: number;
  leave_one_out_ok: boolean;
  measurement_quality: string;
  improvement_reason: string | null;
  reason: string;
  shortlist_ids: string[];
  bbox: [number, number, number, number]; // layer_bbox corners (for the before/after proof)
  proof?: { overlay: string; contact: string };
  candidates: { font: string; score: number; rank: number }[];
  // internals for cross-layer guard + proof (not serialized verbatim)
  ranked: CandidateScore[];
  renders: { font: LibFont; img: RGBA }[];
  srcBox: any;
  raw: LayerResult;
  metadata_font: string | null;
  metadata_reliable: boolean;
}

export interface CrossLayerFlag {
  font: string;
  collapsed_layer: string;
  also_strong_on: string;
  note: string;
}

export type TemplateStatus =
  | "ready" | "ready_with_minor_difference" | "ready_with_improvement"
  | "needs_seed" | "blocked_missing_source" | "engine_issue";

// shortlist entry from the pre-filter
export interface Shortlisted { entry: VaultEntry; lib: LibFont; }
