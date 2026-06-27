import { LayerOutcome, CrossLayerFlag, TemplateStatus } from "./types";

// Aggregate per-layer labels into the template status (worst applicable wins). blocked_missing_source and
// engine_issue are decided upstream (pre-check / fault handling) and short-circuit before this runs.
export function aggregateStatus(outcomes: LayerOutcome[], crossFlags: CrossLayerFlag[], mode: "faithful" | "production"): { status: TemplateStatus; rationale: string } {
  const anyNeedsSeed = outcomes.some((o) => o.label === "needs_seed");
  if (anyNeedsSeed) {
    const layers = outcomes.filter((o) => o.label === "needs_seed").map((o) => o.id);
    return { status: "needs_seed", rationale: `layer(s) [${layers.join(", ")}] have no active font >= USABLE with clean separation/leave-one-out` };
  }
  // all layers pass (>= USABLE)
  if (mode === "production" && outcomes.some((o) => o.improvement_reason)) {
    const layers = outcomes.filter((o) => o.improvement_reason).map((o) => o.id);
    return { status: "ready_with_improvement", rationale: `production mode: substitute chosen for a measurable reason on [${layers.join(", ")}]` };
  }
  if (outcomes.some((o) => o.label === "visual_substitute") || crossFlags.length > 0) {
    const subs = outcomes.filter((o) => o.label === "visual_substitute").map((o) => o.id);
    return { status: "ready_with_minor_difference", rationale: `all layers pass; substitute(s) on [${subs.join(", ") || "(none)"}]${crossFlags.length ? `; ${crossFlags.length} cross-layer flag(s)` : ""}` };
  }
  return { status: "ready", rationale: "all layers exact/verified tight; no cross-layer flag" };
}
