import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { apiFetch, ApiError } from "@/lib/api/client";
import { PageLoadError } from "@/components/shell/page-error";
import type { LeadWithMatch } from "@/lib/api/types";

import {
  Chip,
  PropertyThumb,
  TemperaturePill,
  fmtBedroomsChip,
  fmtBedsBaths,
  fmtBudgetChip,
  fmtPrice,
  langLabel,
  matchPct,
  typeLabel,
  type MatchLabels,
} from "./_shared";

export const dynamic = "force-dynamic";

/**
 * Matches (W20 reverse-prospecting, read-only). Server-rendered list of scored
 * buyers that already have ≥1 property match in the catalog — each row links to
 * the lead in the inbox (?leadId=). Honesty-first: on load failure we show the
 * one calm PageLoadError, never a fabricated list; with zero matches we show an
 * honest empty state.
 */
export default async function MatchesPage() {
  const t = await getTranslations("matches");

  let data: LeadWithMatch[] | null = null;
  let loadFailed = false;

  try {
    const res = await apiFetch<{ ok: boolean; data: LeadWithMatch[] }>(
      "/api/v1/matches",
    );
    if (!res.ok) throw new ApiError(500, "matches not ok");
    data = res.data;
  } catch (err) {
    loadFailed = true;
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[/matches] failed to load matches:", detail);
  }

  if (loadFailed || !data) {
    return <PageLoadError />;
  }

  const labels: MatchLabels = {
    bed: t("unitBed"),
    bath: t("unitBath"),
    studio: t("unitStudio"),
    priceOnRequest: t("priceOnRequest"),
    match: t("match"),
    more: (n: number) => t("more", { n }),
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl leading-tight text-foreground">
          {t("title")}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center text-sm text-muted-foreground">
          {t("emptyBody")}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.map((lead) => {
            const chips = [
              typeLabel(lead.property_type_pref) || null,
              fmtBedroomsChip(lead.bedrooms_min, lead.bedrooms_max, labels),
              lead.bathrooms_min != null
                ? `${lead.bathrooms_min}+ ${t("unitBath")}`
                : null,
              fmtBudgetChip(lead.budget_extracted),
              lead.location_interest_extracted,
            ].filter((c): c is string => !!c);

            const topMeta = [
              typeLabel(lead.top_property_type) || null,
              fmtBedsBaths(lead.top_bedrooms, lead.top_bathrooms, labels) || null,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <li key={lead.lead_id}>
                <Link
                  href={`/approvals?leadId=${encodeURIComponent(lead.lead_id)}`}
                  className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-card p-4 shadow-elevated transition-all hover:-translate-y-px hover:shadow-soft md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.1fr)]"
                >
                  {/* LEFT: who */}
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[15px] font-semibold text-foreground">
                        {lead.full_name}
                      </span>
                      <TemperaturePill temp={lead.temperature} />
                      {lead.score != null ? (
                        <span className="font-mono text-[12px] text-muted-foreground">
                          {lead.score}
                        </span>
                      ) : null}
                    </div>
                    {lead.language ? (
                      <span className="text-[12px] text-muted-foreground">
                        {langLabel(lead.language)}
                      </span>
                    ) : null}
                  </div>

                  {/* MIDDLE: looking for */}
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                      {t("lookingFor")}
                    </span>
                    {chips.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {chips.map((c, i) => (
                          <Chip key={i}>{c}</Chip>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[12.5px] text-muted-foreground">—</span>
                    )}
                  </div>

                  {/* RIGHT: top match preview */}
                  <div className="flex min-w-0 items-start gap-3">
                    <PropertyThumb
                      src={lead.top_images?.[0]}
                      alt={lead.top_title}
                      className="h-16 w-16 shrink-0 rounded-lg"
                    />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[13px] font-semibold text-foreground">
                        {lead.top_title}
                      </span>
                      {topMeta ? (
                        <span className="truncate text-[11.5px] text-muted-foreground">
                          {topMeta}
                        </span>
                      ) : null}
                      <span className="text-[12.5px] font-medium text-foreground">
                        {fmtPrice(lead.top_price, lead.top_price_currency, labels)}
                      </span>
                      <span className="text-[11.5px] text-brand">
                        {matchPct(lead.top_similarity, labels)}
                        {lead.match_count > 1
                          ? ` · ${labels.more(lead.match_count - 1)}`
                          : ""}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
