/**
 * Pure model for the "Matching buyers" panel (reverse prospecting, P2-G). The
 * server-side matcher (match_leads_for_property) has ALREADY applied every hard gate
 * (budget · area/zone · exclusions/expansion · beds · baths · type) and ranked the
 * survivors by embedding similarity — so every buyer returned genuinely fits the
 * listing. This model just turns each survivor into honest "why matched" reason
 * chips (from the buyer's own stated criteria) + a fit label. Dependency-free so it
 * unit-tests without React. It NEVER invents a reason the matcher didn't enforce.
 */

export type MatchingBuyer = {
  lead_id: string;
  full_name: string | null;
  language: string | null;
  budget_extracted: number | null;
  location_interest_extracted: string | null;
  bedrooms_min: number | null;
  bedrooms_max: number | null;
  bathrooms_min: number | null;
  property_type_pref: string | null;
  similarity: number;
};

/** Reason keys — each is a criterion the buyer stated that this listing satisfies. */
export type BuyerReason = "budget" | "area" | "open_area" | "beds" | "baths" | "type";

/**
 * The honest reasons this buyer matched the listing. Because the matcher filtered on
 * these, each present criterion is a genuine positive; a buyer with no stated area is
 * shown as "open to this area" rather than pretending they asked for it.
 */
export function buyerMatchReasons(b: MatchingBuyer): BuyerReason[] {
  const reasons: BuyerReason[] = [];
  if (b.budget_extracted != null) reasons.push("budget");
  reasons.push(b.location_interest_extracted?.trim() ? "area" : "open_area");
  if (b.bedrooms_min != null || b.bedrooms_max != null) reasons.push("beds");
  if (b.bathrooms_min != null) reasons.push("baths");
  if (b.property_type_pref?.trim()) reasons.push("type");
  return reasons;
}

export type FitLabel = "strong" | "good" | "fair";

/** Coarse fit band from the embedding similarity (for an at-a-glance cue only). */
export function fitLabel(similarity: number): FitLabel {
  if (similarity >= 0.55) return "strong";
  if (similarity >= 0.45) return "good";
  return "fair";
}

/** Display name with an honest fallback. */
export function buyerName(b: MatchingBuyer, fallback: string): string {
  return b.full_name?.trim() || fallback;
}
