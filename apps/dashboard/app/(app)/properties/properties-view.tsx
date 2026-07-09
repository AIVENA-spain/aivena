"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Bath,
  BedDouble,
  Building2,
  MapPin,
  Plus,
  Ruler,
  Search,
  X,
} from "lucide-react";

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
  const [areaFilter, setAreaFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"newest" | "price_desc" | "price_asc">(
    "newest",
  );

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
  const areas = useMemo(() => distinct((p) => p.location_city), [properties]);

  const filtersActive =
    typeFilter !== "all" ||
    bedsFilter !== "any" ||
    statusFilter !== "all" ||
    areaFilter !== "all";
  const resetAll = () => {
    setQuery("");
    setTypeFilter("all");
    setBedsFilter("any");
    setStatusFilter("all");
    setAreaFilter("all");
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
      if (areaFilter !== "all" && (p.location_city ?? "").toLowerCase() !== areaFilter) return false;
      return true;
    });
  }, [properties, terms, typeFilter, bedsFilter, statusFilter, areaFilter]);

  // Sort AFTER filtering — all on real fields (updated_at / price), no fakes.
  const sorted = useMemo(() => {
    const copy = [...filtered];
    if (sortBy === "price_desc") {
      copy.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
    } else if (sortBy === "price_asc") {
      copy.sort(
        (a, b) =>
          (Number(a.price) || Infinity) - (Number(b.price) || Infinity),
      );
    } else {
      copy.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
    }
    return copy;
  }, [filtered, sortBy]);

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
            {areas.length > 1 ? (
              <select
                value={areaFilter}
                onChange={(e) => setAreaFilter(e.target.value)}
                aria-label="Filter by area"
                className={selectCls}
              >
                <option value="all">All areas</option>
                {areas.map((a) => (
                  <option key={a} value={a}>
                    {a.charAt(0).toUpperCase() + a.slice(1)}
                  </option>
                ))}
              </select>
            ) : null}
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as "newest" | "price_desc" | "price_asc")
              }
              aria-label="Sort properties"
              className={selectCls}
            >
              <option value="newest">Sort: Newest</option>
              <option value="price_desc">Price: high to low</option>
              <option value="price_asc">Price: low to high</option>
            </select>
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
          {sorted.map((p) => (
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
  // Icon spec pairs (mock layout) — zero/null specs hidden entirely.
  const specs: { icon: typeof BedDouble; text: string }[] = [];
  if (p.bedrooms != null && p.bedrooms > 0)
    specs.push({ icon: BedDouble, text: `${p.bedrooms} ${t("bedsShort")}` });
  if (p.bathrooms != null && p.bathrooms > 0)
    specs.push({ icon: Bath, text: `${p.bathrooms} ${t("bathsShort")}` });
  if (p.area_sqm != null && p.area_sqm > 0)
    specs.push({ icon: Ruler, text: formatArea(p.area_sqm) });

  // Card layout per the approved mockups: image (status pill top-left) →
  // title → location with pin → icon specs → bottom row price (bold) + REF.
  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-soft transition-shadow hover:shadow-elevated">
      {/* Thumbnail */}
      <div className="relative aspect-[4/3] w-full bg-muted">
        <Thumb src={thumb} alt={p.title} />
        <div className="absolute left-2 top-2">
          <PropertyStatus status={p.status} t={t} />
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="line-clamp-2 text-[14.5px] font-semibold leading-snug tracking-[-0.01em] text-foreground">
          {p.title}
        </h3>
        {location ? (
          <div className="flex items-center gap-1 text-[12.5px] text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={1.8} />
            <span className="truncate">{location}</span>
          </div>
        ) : null}
        {specs.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[12px] text-muted-foreground tabular-nums">
            {specs.map(({ icon: Icon, text }) => (
              <span key={text} className="inline-flex items-center gap-1">
                <Icon className="h-3.5 w-3.5" aria-hidden strokeWidth={1.8} />
                {text}
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <span className="text-[17px] font-bold tracking-[-0.01em] text-foreground tabular-nums">
            {formatPrice(p.price, p.price_currency)}
          </span>
          <span className="pb-0.5 font-mono text-[10px] uppercase tracking-[0.04em] text-muted-foreground/70">
            {t("colRef")} {p.external_id}
          </span>
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
