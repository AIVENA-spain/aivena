import { getTranslations } from "next-intl/server";

import { apiFetch, ApiError } from "@/lib/api/client";
import { PageLoadError } from "@/components/shell/page-error";
import type { LeadWithMatch, Match } from "@/lib/api/types";

import { getLeadMatchesAction } from "./matches-actions";
import { MatchesView, type MatchRow } from "./matches-view";
import type { MatchLabels } from "./_shared";

export const dynamic = "force-dynamic";

/** Bound the per-buyer match fan-out (pilot lists are small; this keeps the
 *  page fast if a catalog ever grows). Buyers beyond the cap still render with
 *  the top match the list already carries. */
const FANOUT_CAP = 12;
/** Cards per buyer, per the approved mockups. */
const CARDS = 3;

/**
 * Matches (W20 reverse-prospecting, read-only). Server-fetches the scored buyer
 * list, then the best few real matches per buyer, and hands them to the client
 * view for filter/sort. Honesty-first: a failed list load shows the one calm
 * PageLoadError (never a fabricated list); a failed per-buyer fetch degrades to
 * the single top match the list already returned — never invented.
 */
export default async function MatchesPage() {
  const t = await getTranslations("matches");

  let leads: LeadWithMatch[] | null = null;
  try {
    const res = await apiFetch<{ ok: boolean; data: LeadWithMatch[] }>(
      "/api/v1/matches",
    );
    if (!res.ok) throw new ApiError(500, "matches not ok");
    leads = res.data;
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[/matches] failed to load matches:", detail);
    return <PageLoadError />;
  }

  // The list carries only the #1 match per buyer; the mockup shows the best 2–3,
  // so fan out to the per-buyer endpoint for the first N buyers.
  const fanout = leads.slice(0, FANOUT_CAP);
  const fetched = await Promise.all(
    fanout.map(async (lead) => {
      const res = await getLeadMatchesAction(lead.lead_id);
      return res.ok ? res.data.slice(0, CARDS) : [];
    }),
  );

  const rows: MatchRow[] = leads.map((lead, i) => {
    const got = i < fanout.length ? fetched[i] : [];
    return { lead, matches: got.length > 0 ? got : [topAsMatch(lead)] };
  });

  const labels: MatchLabels = {
    bed: t("unitBed"),
    bath: t("unitBath"),
    studio: t("unitStudio"),
    priceOnRequest: t("priceOnRequest"),
    match: t("match"),
    more: (n: number) => t("more", { n }),
  };

  return (
    <MatchesView
      rows={rows}
      labels={labels}
      copy={{
        title: t("title"),
        subtitle: t("subtitle"),
        emptyBody: t("emptyBody"),
        lookingFor: t("lookingFor"),
        topMatches: t("topMatches"),
        bestMatch: t("bestMatch"),
        kpiBuyers: t("kpiBuyers"),
        kpiAvg: t("kpiAvg"),
        kpiTop: t("kpiTop"),
        searchPh: t("searchPh"),
        allLanguages: t("allLanguages"),
        sortBest: t("sortBest"),
        sortScore: t("sortScore"),
        noMatchFilter: t("noMatchFilter"),
      }}
    />
  );
}

/** Honest fallback: rebuild the #1 match from the list row's own top_* fields
 *  (real server data) when the per-buyer fetch is unavailable. */
function topAsMatch(lead: LeadWithMatch): Match {
  return {
    rank: 1,
    similarity: lead.top_similarity,
    property_id: lead.top_property_id,
    external_id: null,
    title: lead.top_title,
    property_type: lead.top_property_type,
    price: lead.top_price,
    price_currency: lead.top_price_currency,
    bedrooms: lead.top_bedrooms,
    bathrooms: lead.top_bathrooms,
    area_sqm: null,
    location_city: lead.top_location_city,
    location_region: null,
    source_url: null,
    images: lead.top_images,
  };
}
