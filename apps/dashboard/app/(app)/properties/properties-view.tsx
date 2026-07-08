"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, Plus, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { FilterBar, FilterSearch } from "@/components/ui/filter-bar";
import { formatArea, formatPrice } from "@/lib/format";
import type { Tone } from "@/lib/ui-tone";
import type { PropertyRow } from "@/lib/api/types";

import { PropertyImportPanel } from "./import-panel";
import { expandSearchTerms } from "./town-aliases";

/**
 * Properties — first-class catalog page (§5.17). Premium card grid of the
 * agency's promoted listings (real data), a clean filter bar, and an inline CSV
 * import panel. Prices render as `€285,000` via the shared formatter. Honest
 * empty state when the catalog is empty.
 */
export function PropertiesView({ properties }: { properties: PropertyRow[] }) {
  const t = useTranslations("properties");
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [bedsFilter, setBedsFilter] = useState("any");
  const [statusFilter, setStatusFilter] = useState("all");

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

  const selectCls =
    "h-9 rounded-lg border border-border bg-background px-2.5 text-[12.5px] text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/30";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button
            type="button"
            size="sm"
            variant={importing ? "outline" : "default"}
            className="gap-1.5"
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
        }
      />

      {/* Filter bar: search (city/area first) + type/beds/status + count */}
      {properties.length > 0 ? (
        <FilterBar>
          <FilterSearch
            value={query}
            onChange={setQuery}
            placeholder="Search by city, area, title, or reference…"
            className="sm:max-w-sm"
          />
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {types.length > 1 ? (
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                aria-label="Filter by property type"
                className={selectCls}
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
              className={selectCls}
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
                className={selectCls}
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
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-3 w-3" aria-hidden />
                Clear
              </button>
            ) : null}
            <span className="whitespace-nowrap text-[12px] font-medium text-muted-foreground">
              {filtered.length === properties.length
                ? `${properties.length} propert${properties.length === 1 ? "y" : "ies"}`
                : `${filtered.length} of ${properties.length}`}
            </span>
          </div>
        </FilterBar>
      ) : null}

      {/* Inline import panel */}
      {importing ? <PropertyImportPanel /> : null}

      {/* Listings */}
      {properties.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card">
          <EmptyState
            icon={Building2}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            action={
              !importing ? (
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setImporting(true)}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {t("importCta")}
                </Button>
              ) : null
            }
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card">
          <EmptyState
            icon={Search}
            title={
              query.trim()
                ? `No properties match “${query.trim()}”.`
                : "No properties match these filters."
            }
            description="Try a different city, area, or filter — or clear everything to see all listings."
            action={
              <Button type="button" size="sm" variant="outline" onClick={resetAll}>
                Clear search &amp; filters
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <PropertyCard key={p.id} p={p} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

const PROPERTY_STATUS_TONE: Record<string, Tone> = {
  active: "success",
  reserved: "info",
  sold: "neutral",
};

function PropertyCard({
  p,
  t,
}: {
  p: PropertyRow;
  t: ReturnType<typeof useTranslations<"properties">>;
}) {
  const thumb = Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : null;
  const location = [p.location_city, p.location_region].filter(Boolean).join(", ");
  const specs: string[] = [];
  if (p.bedrooms != null && p.bedrooms > 0) specs.push(`${p.bedrooms} ${t("bedsShort")}`);
  if (p.bathrooms != null && p.bathrooms > 0) specs.push(`${p.bathrooms} ${t("bathsShort")}`);
  if (p.area_sqm != null && p.area_sqm > 0) specs.push(formatArea(p.area_sqm));

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-soft transition-shadow hover:shadow-elevated">
      {/* Thumbnail */}
      <div className="relative aspect-[4/3] w-full bg-muted">
        <Thumb src={thumb} alt={p.title} />
        <div className="absolute right-2 top-2">
          <PropertyStatus status={p.status} t={t} />
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="text-[17px] font-bold tracking-[-0.01em] text-foreground tabular-nums">
          {formatPrice(p.price, p.price_currency)}
        </div>
        <h3 className="line-clamp-2 text-[13.5px] font-medium leading-snug text-foreground">
          {p.title}
        </h3>
        {location ? (
          <div className="text-[12.5px] text-muted-foreground">{location}</div>
        ) : null}
        {specs.length > 0 ? (
          <div className="mt-auto flex flex-wrap gap-x-2 gap-y-0.5 pt-1.5 text-[11.5px] font-medium text-muted-foreground tabular-nums">
            {specs.join("  ·  ")}
          </div>
        ) : null}
        <div className="pt-1 font-mono text-[10px] uppercase tracking-[0.04em] text-muted-foreground/60">
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

function PropertyStatus({
  status,
  t,
}: {
  status: string;
  t: ReturnType<typeof useTranslations<"properties">>;
}) {
  const key = (status ?? "").toLowerCase();
  const known = ["active", "reserved", "sold"].includes(key);
  return (
    <Badge
      tone={PROPERTY_STATUS_TONE[key] ?? "neutral"}
      size="sm"
      className="shadow-soft backdrop-blur-sm"
    >
      {known ? t(("status_" + key) as StatusKey) : status}
    </Badge>
  );
}

type StatusKey = "status_active" | "status_reserved" | "status_sold";
