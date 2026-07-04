"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Building2, Plus, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { intlLocaleFor } from "@/lib/i18n/date-locale";
import type { PropertyRow } from "@/lib/api/types";

import { PropertyImportPanel } from "./import-panel";
import { expandSearchTerms } from "./town-aliases";

/**
 * Properties — first-class catalog page (§5.17). Card grid of the agency's
 * promoted listings (real data) with thumbnails, plus an inline CSV import
 * panel toggled from the toolbar. Honest empty state when the catalog is empty.
 */
export function PropertiesView({ properties }: { properties: PropertyRow[] }) {
  const t = useTranslations("properties");
  const locale = useLocale();
  const nf = new Intl.NumberFormat(intlLocaleFor(locale));
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [bedsFilter, setBedsFilter] = useState("any");
  const [statusFilter, setStatusFilter] = useState("all");

  // Distinct type/status values present in the catalog (drive the filters, and
  // let us hide a filter that has no variety — e.g. an all-"active" catalog).
  const distinct = (get: (p: PropertyRow) => string | null) => {
    const set = new Set<string>();
    for (const p of properties) {
      const v = (get(p) ?? "").trim().toLowerCase();
      if (v) set.add(v);
    }
    return [...set].sort();
  };
  const types = useMemo(() => distinct((p) => p.property_type), [properties]);
  const statuses = useMemo(() => distinct((p) => p.status), [properties]);

  const filtersActive =
    typeFilter !== "all" || bedsFilter !== "any" || statusFilter !== "all";
  const resetAll = () => {
    setQuery("");
    setTypeFilter("all");
    setBedsFilter("any");
    setStatusFilter("all");
  };

  // Client-side, read-only filter over the already-loaded catalog: search
  // (city/area first — `expandSearchTerms` turns a TOWN into its districts, e.g.
  // "Torrevieja" → "La Mata") AND type/bedrooms/status. Fast for the pilot list
  // size; a server-side ?q= is only needed if a catalog ever grows to thousands.
  const terms = useMemo(() => expandSearchTerms(query), [query]);
  const filtered = useMemo(() => {
    return properties.filter((p) => {
      if (terms.length > 0) {
        const fields = [p.location_city, p.location_region, p.title, p.external_id].map(
          (field) => (field ?? "").toLowerCase(),
        );
        if (!terms.some((term) => fields.some((field) => field.includes(term)))) return false;
      }
      if (typeFilter !== "all" && (p.property_type ?? "").toLowerCase() !== typeFilter) return false;
      if (bedsFilter !== "any" && (p.bedrooms ?? 0) < Number(bedsFilter)) return false;
      if (statusFilter !== "all" && (p.status ?? "").toLowerCase() !== statusFilter) return false;
      return true;
    });
  }, [properties, terms, typeFilter, bedsFilter, statusFilter]);

  return (
    <div className="flex flex-col gap-5">
      {/* Toolbar: search (city/area first) + import */}
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        <div className="flex items-center gap-3">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search properties by city, area, title, or reference…"
              aria-label="Search properties by city, area, title, or reference"
              className="h-9 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-[13px] text-foreground shadow-soft placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant={importing ? "outline" : "default"}
            className="ml-auto flex-none gap-1.5"
            onClick={() => setImporting((v) => !v)}
          >
            {importing ? (
              <>
                <X className="h-3.5 w-3.5" aria-hidden />
                {t("closeImport")}
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t("importCta")}
              </>
            )}
          </Button>
        </div>

        {/* Filters — client-side, compose with the search (AND). */}
        {properties.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {types.length > 1 ? (
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                aria-label="Filter by property type"
                className="h-8 rounded-lg border border-border bg-card px-2 text-[12.5px] text-foreground shadow-soft focus:outline-none focus:ring-2 focus:ring-brand/40"
              >
                <option value="all">All types</option>
                {types.map((ty) => (
                  <option key={ty} value={ty}>
                    {ty.charAt(0).toUpperCase() + ty.slice(1)}
                  </option>
                ))}
              </select>
            ) : null}
            <select
              value={bedsFilter}
              onChange={(e) => setBedsFilter(e.target.value)}
              aria-label="Filter by minimum bedrooms"
              className="h-8 rounded-lg border border-border bg-card px-2 text-[12.5px] text-foreground shadow-soft focus:outline-none focus:ring-2 focus:ring-brand/40"
            >
              <option value="any">Any beds</option>
              <option value="1">1+ beds</option>
              <option value="2">2+ beds</option>
              <option value="3">3+ beds</option>
              <option value="4">4+ beds</option>
            </select>
            {statuses.length > 1 ? (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
                className="h-8 rounded-lg border border-border bg-card px-2 text-[12.5px] text-foreground shadow-soft focus:outline-none focus:ring-2 focus:ring-brand/40"
              >
                <option value="all">All statuses</option>
                {statuses.map((st) => (
                  <option key={st} value={st}>
                    {st.charAt(0).toUpperCase() + st.slice(1)}
                  </option>
                ))}
              </select>
            ) : null}
            {query.trim() || filtersActive ? (
              <button
                type="button"
                onClick={resetAll}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3 w-3" aria-hidden />
                Clear
              </button>
            ) : null}
            <span className="ml-auto text-[12px] text-muted-foreground">
              {filtered.length === properties.length
                ? `${properties.length} propert${properties.length === 1 ? "y" : "ies"}`
                : `${filtered.length} of ${properties.length}`}
            </span>
          </div>
        ) : null}
      </div>

      {/* Inline import panel */}
      {importing ? <PropertyImportPanel /> : null}

      {/* Listings */}
      {properties.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Building2 className="h-6 w-6" aria-hidden strokeWidth={1.7} />
          </div>
          <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
          {!importing ? (
            <Button
              type="button"
              size="sm"
              className="mt-1 gap-1.5"
              onClick={() => setImporting(true)}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t("importCta")}
            </Button>
          ) : null}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Search className="h-6 w-6" aria-hidden strokeWidth={1.7} />
          </div>
          <p className="text-sm font-medium text-foreground">
            {query.trim() ? `No properties match “${query.trim()}”.` : "No properties match these filters."}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            Try a different city, area, or filter — or clear everything to see all listings.
          </p>
          <Button type="button" size="sm" variant="outline" className="mt-1" onClick={resetAll}>
            Clear search &amp; filters
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <PropertyCard key={p.id} p={p} nf={nf} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function PropertyCard({
  p,
  nf,
  t,
}: {
  p: PropertyRow;
  nf: Intl.NumberFormat;
  t: ReturnType<typeof useTranslations<"properties">>;
}) {
  const thumb = Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : null;
  const location = [p.location_city, p.location_region].filter(Boolean).join(", ");
  // Hide zero/null specs entirely — "0 beds" or "null m²" reads as broken.
  const specs: string[] = [];
  if (p.bedrooms != null && p.bedrooms > 0) specs.push(`${p.bedrooms} ${t("bedsShort")}`);
  if (p.bathrooms != null && p.bathrooms > 0) specs.push(`${p.bathrooms} ${t("bathsShort")}`);
  // Built and plot are distinct facts — show each labelled when present; only when
  // neither is set do we show the neutral legacy area as a bare "m²" (never "built").
  const hasBuilt = p.area_built_sqm != null && p.area_built_sqm > 0;
  const hasPlot = p.area_plot_sqm != null && p.area_plot_sqm > 0;
  if (hasBuilt) specs.push(`${nf.format(p.area_built_sqm as number)} ${t("areaUnit")} ${t("areaBuiltShort")}`);
  if (hasPlot) specs.push(`${nf.format(p.area_plot_sqm as number)} ${t("areaUnit")} ${t("areaPlotShort")}`);
  if (!hasBuilt && !hasPlot && p.area_sqm != null && p.area_sqm > 0) specs.push(`${nf.format(p.area_sqm)} ${t("areaUnit")}`);
  const priceNum = p.price == null ? null : Number(p.price);

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-elevated">
      {/* Thumbnail */}
      <div className="relative aspect-[4/3] w-full bg-muted">
        <Thumb src={thumb} alt={p.title} />
        <div className="absolute right-2 top-2">
          <StatusPill status={p.status} t={t} />
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-[14px] font-semibold text-foreground">
            {p.title}
          </h3>
        </div>
        <div className="font-mono text-[15px] font-semibold text-foreground">
          {priceNum == null || Number.isNaN(priceNum)
            ? "—"
            : `${nf.format(priceNum)} ${p.price_currency}`}
        </div>
        {location ? (
          <div className="text-[12.5px] text-muted-foreground">{location}</div>
        ) : null}
        {specs.length > 0 ? (
          <div className="mt-auto pt-1 font-mono text-[11.5px] text-muted-foreground">
            {specs.join(" · ")}
          </div>
        ) : null}
        <div className="pt-1 font-mono text-[10px] uppercase tracking-[0.04em] text-muted-foreground/70">
          {p.external_id}
        </div>
      </div>
    </article>
  );
}

/**
 * External CRM thumbnail with graceful degradation: arbitrary external hosts
 * (montinmo.es etc.) can be slow, hotlink-protected, or down — a failed load
 * swaps to the clean building placeholder instead of a broken-image icon.
 * no-referrer covers hosts that reject foreign Referer headers.
 */
function Thumb({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Building2 className="h-8 w-8 text-muted-foreground/40" aria-hidden />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="h-full w-full object-cover"
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function StatusPill({
  status,
  t,
}: {
  status: string;
  t: ReturnType<typeof useTranslations<"properties">>;
}) {
  const known = ["active", "reserved", "sold"].includes(status);
  const tone =
    status === "active"
      ? "border-brand/30 bg-brand-soft text-brand"
      : "border-border bg-card text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-medium shadow-soft backdrop-blur-sm",
        tone,
      )}
    >
      {known ? t(("status_" + status) as StatusKey) : status}
    </span>
  );
}

type StatusKey = "status_active" | "status_reserved" | "status_sold";
