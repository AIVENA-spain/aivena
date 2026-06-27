import { THRESHOLDS } from "../resolver/types";
import { USABLE_BAR } from "../resolver/visualMatch";
import { LayerOutcome, CrossLayerFlag } from "./types";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

// Cross-layer consistency guard (the Tinos lesson). After per-layer selection, detect an active font that
// is strong (>= USABLE) on one layer AND collapses a DIFFERENT layer's rank1-vs-rank2 separation below the
// v1 bar. Flag it, keep the affected layer's resolved identity on its OWN true font (the intruder may not
// claim it), and downgrade the affected layer toward needs_seed because its separation was destroyed.
export function guardCrossLayer(outcomes: LayerOutcome[]): { flags: CrossLayerFlag[]; outcomes: LayerOutcome[] } {
  const flags: CrossLayerFlag[] = [];
  // index: family -> layers where it scores >= USABLE (by composite)
  const strongOn: Record<string, string[]> = {};
  for (const o of outcomes) {
    for (const c of o.ranked) {
      if (c.composite >= USABLE_BAR) {
        const k = norm(c.family);
        (strongOn[k] ||= []).push(o.id);
      }
    }
  }

  for (const o of outcomes) {
    const r1 = o.ranked[0], r2 = o.ranked[1];
    if (!r1 || !r2) continue;
    const sep = Math.round((r1.composite - r2.composite) * 1000) / 1000;
    if (sep >= THRESHOLDS.high_separation) continue; // separation intact -> no collapse

    // the rank-2 (or any tied near-top) font that is ALSO strong on a different layer = the intruder
    const intruder = [r2, ...o.ranked.slice(2)].find((c) => {
      if (r1.composite - c.composite >= THRESHOLDS.high_separation) return false;
      const layers = strongOn[norm(c.family)] || [];
      return layers.some((lid) => lid !== o.id);
    });
    if (!intruder) continue;

    const alsoOn = (strongOn[norm(intruder.family)] || []).filter((lid) => lid !== o.id);
    flags.push({
      font: intruder.family, collapsed_layer: o.id, also_strong_on: alsoOn.join(", "),
      note: `${intruder.family} scores >= USABLE on [${alsoOn.join(", ")}] and collapses ${o.id} separation to ${sep} (< ${THRESHOLDS.high_separation}); keeping ${o.id} on its true font and downgrading to needs_seed`,
    });

    // keep the layer's resolved identity on its OWN true font; the intruder may not claim it.
    const trueFont = o.known_true_font;
    let kept = r1.family;
    if (trueFont) {
      const tf = o.ranked.find((c) => norm(c.family) === norm(trueFont));
      if (tf) kept = tf.family; // pin identity to the true font even under a tie with the intruder
    }
    o.rank1_font = kept;
    o.selected_font = null;          // separation destroyed -> not a confident claim
    o.selected_id = null;
    o.label = "needs_seed";
    o.downgraded_by_guard = true;
    o.reason = `cross-layer guard: separation collapsed by ${intruder.family} (strong on ${alsoOn.join(", ")}); resolved identity kept on ${kept}, downgraded to needs_seed`;
  }
  return { flags, outcomes };
}
