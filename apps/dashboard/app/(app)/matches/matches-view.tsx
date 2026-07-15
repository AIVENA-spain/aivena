"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Users, Gauge, Trophy } from "lucide-react";

import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { MetricCard } from "@/components/ui/metric-card";
import { FilterBar, FilterSearch } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { temperatureTone } from "@/lib/ui-tone";
import { formatArea, formatPrice } from "@/lib/format";
import { humanizeToken } from "@/app/(app)/overview/overview-format";
import type { LeadWithMatch, Match } from "@/lib/api/types";

import {
  Chip,
  PropertyThumb,
  fmtBedroomsChip,
  fmtBudgetChip,
  langLabel,
  typeLabel,
  type MatchLabels,
} from "./_shared";

/**
 * Matches — the buyer↔property value engine (approved mockups).
 * Each row: the buyer (temperature · score · language), their core preferences,
 * and their best 2–3 real matches as cards with the engine's own % similarity.
 * Everything here is REAL server data: the buyer list + preferences come from
 * GET /api/v1/matches; the per-buyer cards come from GET /api/v1/matches/:leadId
 * (fetched server-side). Nothing is invented — where a per-buyer fetch fails we
 * fall back to the single top match the list already carries, and match REASONS
 * stay in the Inbox's "Why matched" panel (the engine's real explanation) rather
 * than being guessed here. KPIs are computed from the same list.
 */

export type MatchRow = { lead: LeadWithMatch; matches: Match[] };

export function MatchesView({
  rows,
  labels,
  copy,
}: {
  rows: MatchRow[];
  labels: MatchLabels;
  copy: {
    title: string;
    subtitle: string;
    emptyBody: string;
    lookingFor: string;
    topMatches: string;
    bestMatch: string;
    kpiBuyers: string;
    kpiAvg: string;
    kpiTop: string;
    searchPh: string;
    allLanguages: string;
    sortBest: string;
    sortScore: string;
    noMatchFilter: string;
  };
}) {
  const [query, setQuery] = useState("");
  const [lang, setLang] = useState("all");
  const [sort, setSort] = useState<"best" | "score">("best");

  const languages = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.lead.language) set.add(r.lead.language);
    return [...set].sort();
  }, [rows]);

  // KPIs — straight from the real list. Avg/top use the engine's similarity.
  const kpis = useMemo(() => {
    const highIntent = rows.filter((r) =>
      ["hot", "super_hot", "very_hot"].includes(
        (r.lead.temperature ?? "").toLowerCase(),
      ),
    ).length;
    const sims = rows.map((r) => r.lead.top_similarity).filter(Number.isFinite);
    const pct = (n: number) => Math.min(100, Math.max(0, Math.round(n * 100)));
    return {
      buyers: rows.length,
      highIntent,
      avg: sims.length ? pct(sims.reduce((a, b) => a + b, 0) / sims.length) : 0,
      top: sims.length ? pct(Math.max(...sims)) : 0,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (lang !== "all" && (r.lead.language ?? "") !== lang) return false;
      if (q) {
        const hay = `${r.lead.full_name} ${r.lead.location_interest_extracted ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    out.sort((a, b) =>
      sort === "best"
        ? b.lead.top_similarity - a.lead.top_similarity
        : (b.lead.score ?? 0) - (a.lead.score ?? 0),
    );
    return out;
  }, [rows, query, lang, sort]);

  const selectCls =
    "h-9 rounded-lg border border-border bg-background px-2.5 text-[12.5px] text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/30";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={copy.title} description={copy.subtitle} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          icon={Users}
          label={copy.kpiBuyers}
          value={kpis.buyers}
          caption={`${kpis.highIntent} high-intent`}
        />
        <MetricCard icon={Gauge} label={copy.kpiAvg} value={`${kpis.avg}%`} />
        <MetricCard icon={Trophy} label={copy.kpiTop} value={`${kpis.top}%`} />
      </div>

      {rows.length > 0 ? (
        <FilterBar>
          <FilterSearch
            value={query}
            onChange={setQuery}
            placeholder={copy.searchPh}
            className="sm:max-w-sm"
          />
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {languages.length > 1 ? (
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                aria-label="Filter by language"
                className={selectCls}
              >
                <option value="all">{copy.allLanguages}</option>
                {languages.map((l) => (
                  <option key={l} value={l}>
                    {langLabel(l)}
                  </option>
                ))}
              </select>
            ) : null}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as "best" | "score")}
              aria-label="Sort buyers"
              className={selectCls}
            >
              <option value="best">{copy.sortBest}</option>
              <option value="score">{copy.sortScore}</option>
            </select>
          </div>
        </FilterBar>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card">
          <EmptyState icon={Users} title={copy.title} description={copy.emptyBody} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card">
          <EmptyState icon={Users} title={copy.noMatchFilter} />
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map(({ lead, matches }) => (
            <BuyerRow
              key={lead.lead_id}
              lead={lead}
              matches={matches}
              labels={labels}
              copy={copy}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function BuyerRow({
  lead,
  matches,
  labels,
  copy,
}: {
  lead: LeadWithMatch;
  matches: Match[];
  labels: MatchLabels;
  copy: { lookingFor: string; topMatches: string; bestMatch: string };
}) {
  const prefs = [
    typeLabel(lead.property_type_pref) || null,
    fmtBedroomsChip(lead.bedrooms_min, lead.bedrooms_max, labels),
    lead.bathrooms_min != null ? `${lead.bathrooms_min}+ ${labels.bath}` : null,
    fmtBudgetChip(lead.budget_extracted),
    lead.location_interest_extracted,
  ].filter((c): c is string => !!c);

  return (
    <li className="rounded-xl border border-border bg-card p-4 shadow-soft">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,0.9fr)_minmax(0,2fr)]">
        {/* Buyer */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <Link
            href={`/approvals?leadId=${encodeURIComponent(lead.lead_id)}`}
            className="truncate text-[15px] font-semibold text-foreground hover:underline"
          >
            {lead.full_name}
          </Link>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={temperatureTone(lead.temperature)} size="sm">
              {[humanizeToken(lead.temperature), lead.score]
                .filter((v) => v !== null && v !== undefined && v !== "")
                .join(" · ")}
            </Badge>
          </div>
          {lead.language ? (
            <span className="text-[12px] text-muted-foreground">
              {langLabel(lead.language)}
            </span>
          ) : null}
          <span className="text-[11.5px] text-muted-foreground">
            {lead.match_count} {lead.match_count === 1 ? "match" : "matches"}
          </span>
        </div>

        {/* Core preferences */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            {copy.lookingFor}
          </span>
          {prefs.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {prefs.map((c, i) => (
                <Chip key={i}>{c}</Chip>
              ))}
            </div>
          ) : (
            <span className="text-[12.5px] text-muted-foreground">—</span>
          )}
        </div>

        {/* Top matches — real cards from the engine */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            {copy.topMatches}
          </span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {matches.map((m, i) => (
              <MatchCard
                key={m.property_id}
                m={m}
                labels={labels}
                best={i === 0}
                bestLabel={copy.bestMatch}
              />
            ))}
          </div>
        </div>
      </div>
    </li>
  );
}

function MatchCard({
  m,
  labels,
  best,
  bestLabel,
}: {
  m: Match;
  labels: MatchLabels;
  best: boolean;
  bestLabel: string;
}) {
  const pct = Math.min(100, Math.max(0, Math.round(m.similarity * 100)));
  const specs = [
    m.bedrooms != null && m.bedrooms > 0 ? `${m.bedrooms} ${labels.bed}` : null,
    m.bathrooms != null && m.bathrooms > 0 ? `${m.bathrooms} ${labels.bath}` : null,
    m.area_sqm != null && m.area_sqm > 0 ? formatArea(m.area_sqm) : null,
  ].filter(Boolean);
  const place = [m.location_city, m.location_region].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="relative aspect-[4/3] w-full bg-muted">
        <PropertyThumb src={m.images?.[0]} alt={m.title} className="h-full w-full" />
        <span
          className={cn(
            "absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
            best ? "bg-brand text-brand-fg" : "bg-card/90 text-foreground",
          )}
        >
          {pct}%
        </span>
        {best ? (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-card/90 px-1.5 py-0.5 text-[9.5px] font-semibold text-foreground">
            {bestLabel}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-2">
        <span className="truncate text-[12px] font-semibold text-foreground">
          {m.title}
        </span>
        <span className="text-[12.5px] font-bold text-foreground tabular-nums">
          {formatPrice(m.price, m.price_currency, { fallback: labels.priceOnRequest })}
        </span>
        {specs.length > 0 ? (
          <span className="truncate text-[10.5px] text-muted-foreground tabular-nums">
            {specs.join(" · ")}
          </span>
        ) : null}
        {place ? (
          <span className="truncate text-[10.5px] text-muted-foreground">{place}</span>
        ) : null}
      </div>
    </div>
  );
}
