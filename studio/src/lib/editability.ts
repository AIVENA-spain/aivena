export interface EditabilityResult {
  ok: boolean;
  text_nodes: number;
  tspan_nodes: number;
  slot_ids: string[];
  outlined_text: boolean;
  issues: string[];
}

// Introspect an editable SVG string: real <text>/<tspan> nodes, every expected slot tagged with
// data-slot-id on a <text>, and NO slot text converted to <path> (outlined/flattened).
export function checkEditableSvg(svg: string, expectedSlotIds: string[]): EditabilityResult {
  const issues: string[] = [];
  const text_nodes = (svg.match(/<text\b/g) || []).length;
  const tspan_nodes = (svg.match(/<tspan\b/g) || []).length;
  if (text_nodes === 0) issues.push("no <text> nodes — text is flattened/outlined");
  const slot_ids = [...svg.matchAll(/<text\b[^>]*data-slot-id="([^"]+)"/g)].map((m) => m[1]);
  const uniq = [...new Set(slot_ids)];
  for (const id of expectedSlotIds) if (!uniq.includes(id)) issues.push(`slot '${id}' has no <text data-slot-id> node (not editable)`);
  const outlined_text = /<path\b[^>]*data-slot-id/.test(svg);
  if (outlined_text) issues.push("slot text rendered as <path> (outlined/flattened in the editable SVG)");
  return { ok: issues.length === 0, text_nodes, tspan_nodes, slot_ids: uniq, outlined_text, issues };
}
