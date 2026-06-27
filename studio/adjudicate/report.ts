import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { LayerOutcome, CrossLayerFlag, TemplateStatus } from "./types";

// ---- report.json schema (validated before write) ----
export const ReportCandidate = z.object({ font: z.string(), score: z.number(), rank: z.number() });
export const ReportLayer = z.object({
  id: z.string(),
  type: z.string(),
  selected_font: z.string().nullable(),
  label: z.string(),
  faithful_label: z.string(),
  score: z.number(),
  rank: z.number(),
  separation: z.number(),
  leave_one_out_ok: z.boolean(),
  candidates: z.array(ReportCandidate),
  improvement_reason: z.string().nullable(),
  reason: z.string(),
  proof: z.object({ overlay: z.string(), contact: z.string() }),
});
export const CrossLayerFlagSchema = z.object({ font: z.string(), collapsed_layer: z.string(), also_strong_on: z.string(), note: z.string() });
export const AdjudicateReport = z.object({
  template_id: z.string(),
  status: z.enum(["ready", "ready_with_minor_difference", "ready_with_improvement", "needs_seed", "blocked_missing_source", "engine_issue"]),
  mode: z.enum(["faithful", "production"]),
  model_version: z.string(),
  vault_version: z.string(),
  generated_at: z.string(),
  layers: z.array(ReportLayer),
  cross_layer_flags: z.array(CrossLayerFlagSchema),
  before_after: z.string().nullable(),
  recommendation: z.string(),
  missing_source: z.array(z.string()),
  engine_error: z.string().nullable(),
});
export type AdjudicateReport = z.infer<typeof AdjudicateReport>;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function buildReport(args: {
  template_id: string; status: TemplateStatus; mode: "faithful" | "production"; vault_version: string;
  outcomes: LayerOutcome[]; crossFlags: CrossLayerFlag[]; beforeAfter: string | null;
  missingSource: string[]; engineError: string | null; generatedAt: string;
}): AdjudicateReport {
  const layers = args.outcomes.map((o) => ({
    id: o.id, type: o.type, selected_font: o.selected_font, label: o.label, faithful_label: o.faithful_label,
    score: r3(o.score), rank: 1, separation: r3(o.separation), leave_one_out_ok: o.leave_one_out_ok,
    candidates: o.candidates.map((c) => ({ font: c.font, score: r3(c.score), rank: c.rank })),
    improvement_reason: o.improvement_reason, reason: o.reason,
    proof: o.proof || { overlay: "", contact: "" },
  }));
  const seeds = args.outcomes.filter((o) => o.label === "needs_seed");
  let recommendation: string;
  if (args.status === "blocked_missing_source") recommendation = `blocked: missing source material — ${args.missingSource.join(", ")}`;
  else if (args.status === "engine_issue") recommendation = `engine issue — ${args.engineError}`;
  else if (seeds.length) {
    recommendation = "needs seed — " + seeds.map((o) => {
      const closest = o.candidates[0];
      return `${o.id}: closest active ${closest?.font} ${closest?.score}${o.metadata_font ? `, metadata claims ${o.metadata_font}${o.metadata_reliable ? "" : " (unreliable)"}` : ""}; seed a closer licensed match`;
    }).join("  |  ");
  } else recommendation = `${args.status}: all layers resolved`;

  const report: AdjudicateReport = {
    template_id: args.template_id, status: args.status, mode: args.mode,
    model_version: "v1-frozen", vault_version: args.vault_version, generated_at: args.generatedAt,
    layers, cross_layer_flags: args.crossFlags, before_after: args.beforeAfter,
    recommendation, missing_source: args.missingSource, engine_error: args.engineError,
  };
  return AdjudicateReport.parse(report); // validate before returning
}

export function writeReport(report: AdjudicateReport, outDir: string): { json: string; summary: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "report.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
  const sumPath = path.join(outDir, "summary.txt");
  fs.writeFileSync(sumPath, summaryTxt(report));
  return { json: jsonPath, summary: sumPath };
}

export function summaryTxt(r: AdjudicateReport): string {
  let s = `ADJUDICATE ${r.template_id}  status=${r.status.toUpperCase()}  mode=${r.mode}  model=${r.model_version}  vault=${r.vault_version}\n\n`;
  for (const l of r.layers) {
    s += `[${l.id}] ${l.label}  score=${l.score} sep=${l.separation} loo_ok=${l.leave_one_out_ok}  selected=${l.selected_font ?? "—"}\n`;
    s += `   top: ` + l.candidates.slice(0, 3).map((c) => `${c.font}(${c.score})`).join("  ") + `\n`;
    s += `   ${l.reason}\n`;
  }
  if (r.cross_layer_flags.length) {
    s += `\ncross_layer_flags:\n`;
    for (const f of r.cross_layer_flags) s += `   - ${f.font} collapses ${f.collapsed_layer} (also strong on ${f.also_strong_on})\n`;
  } else s += `\ncross_layer_flags: none\n`;
  if (r.missing_source.length) s += `missing_source: ${r.missing_source.join(", ")}\n`;
  if (r.engine_error) s += `engine_error: ${r.engine_error}\n`;
  s += `\nrecommendation: ${r.recommendation}\n`;
  s += `before_after: ${r.before_after ?? "—"}\n`;
  return s;
}
