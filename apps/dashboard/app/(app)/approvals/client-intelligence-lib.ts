/**
 * Pure helpers for the Client Intelligence panel — kept db/React-free so they're
 * unit-testable without RTL/jsdom.
 */

/**
 * Split a reasoning_summary into short bullets — verbatim clauses, meaning
 * unchanged. Comma/semicolon split only (the summaries are clause lists); each
 * clause is trimmed, trailing period removed, first letter capitalised. We never
 * paraphrase.
 */
export function reasonBullets(summary: string | null | undefined): string[] {
  if (!summary) return [];
  return summary
    .split(/[;,]/)
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
}

/** A clause that claims the budget is unknown/missing/unspecified. */
const BUDGET_UNKNOWN_RE =
  /\bno budget\b|\bbudget (?:info|information|not specified|unspecified|unknown|unclear|missing|not provided|not given|not stated|tbd)\b|\bunknown budget\b|\bbudget\s*[:=]\s*\?/i;

/**
 * Bug-2 guard: the n8n-written `reasoning_summary` can carry a stale "no budget
 * info" clause even when the lead's budget IS known (`budget_extracted` present),
 * which contradicts the Budget row shown right above. When the budget is known we
 * drop those budget-unknown clauses; when it is genuinely unknown we keep them
 * (they're accurate). Other clauses are never touched (no paraphrasing).
 */
export function filterStaleBudgetBullets(bullets: string[], budgetKnown: boolean): string[] {
  if (!budgetKnown) return bullets;
  return bullets.filter((b) => !BUDGET_UNKNOWN_RE.test(b));
}

/** Convenience: reasoning_summary → display bullets, budget-contradiction-safe. */
export function nextActionBullets(
  reasoningSummary: string | null | undefined,
  budgetExtracted: number | string | null | undefined,
): string[] {
  const budgetKnown =
    budgetExtracted !== null && budgetExtracted !== undefined && `${budgetExtracted}`.trim() !== "";
  return filterStaleBudgetBullets(reasonBullets(reasoningSummary), budgetKnown);
}
