"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Shared formatting helpers + tiny presentational components for the Matches
 * surface (page A + panel B). All colour comes from SEMANTIC Tailwind tokens so
 * theme / dark-mode stay correct — no raw hex. The few human-readable unit words
 * ("bed", "bath", "Studio", "Price on request", "match", "more") are passed in
 * as a `MatchLabels` bag sourced from the `matches` i18n namespace by the caller,
 * so nothing here hard-codes English at render time.
 */

export type MatchLabels = {
  bed: string;
  bath: string;
  studio: string;
  priceOnRequest: string;
  match: string;
  /** "+N more" — caller substitutes {n}; we accept the already-formatted word. */
  more: (n: number) => string;
};

// ── pure formatting helpers ────────────────────────────────────────────────

/** Price on request when null; else currency glyph + grouped digits. EUR → €. */
export function fmtPrice(
  price: number | null,
  currency: string | null,
  labels: Pick<MatchLabels, "priceOnRequest">,
): string {
  if (price == null) return labels.priceOnRequest;
  const sym = !currency || currency.toUpperCase() === "EUR" ? "€" : currency;
  return `${sym}${price.toLocaleString("en-GB")}`;
}

/** "Studio" when beds===0; else present parts joined with " · ", null sides omitted. */
export function fmtBedsBaths(
  beds: number | null,
  baths: number | null,
  labels: Pick<MatchLabels, "bed" | "bath" | "studio">,
): string {
  if (beds === 0) return labels.studio;
  const parts: string[] = [];
  if (beds != null) parts.push(`${beds} ${labels.bed}`);
  if (baths != null) parts.push(`${baths} ${labels.bath}`);
  return parts.join(" · ");
}

/** "N m²" or null when area is missing. */
export function fmtArea(area: number | null): string | null {
  return area != null ? `${area} m²` : null;
}

/** "NN% match", clamped to 0..100 (handles similarity > 1). */
export function matchPct(
  sim: number,
  labels: Pick<MatchLabels, "match">,
): string {
  const pct = Math.min(100, Math.max(0, Math.round(sim * 100)));
  return `${pct}% ${labels.match}`;
}

/** Budget chip from the extracted string — keep digits, group them: "≤ €200,000". */
export function fmtBudgetChip(budget: string | null): string | null {
  if (!budget) return null;
  const digits = budget.replace(/\D/g, "");
  if (!digits) return budget.trim() || null;
  return `≤ €${Number(digits).toLocaleString("en-GB")}`;
}

/** Bedrooms preference chip: "min–max", "min+", "up to max", or null. */
export function fmtBedroomsChip(
  min: number | null,
  max: number | null,
  labels: Pick<MatchLabels, "bed">,
): string | null {
  if (min != null && max != null) return `${min}–${max} ${labels.bed}`;
  if (min != null) return `${min}+ ${labels.bed}`;
  if (max != null) return `up to ${max} ${labels.bed}`;
  return null;
}

/** Title-case a raw type slug: "apartment" → "Apartment". */
export function typeLabel(t: string | null): string {
  if (!t) return "";
  return t
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

const LANG_NAMES: Record<string, string> = {
  no: "Norwegian",
  de: "German",
  pl: "Polish",
  sv: "Swedish",
  en: "English",
  nl: "Dutch",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  ru: "Russian",
  fi: "Finnish",
  da: "Danish",
};

/** Map an ISO code to its English language name; fallback to UPPERCASE code. */
export function langLabel(code: string | null): string {
  const key = (code ?? "").toLowerCase();
  return LANG_NAMES[key] ?? (code ?? "").toUpperCase();
}

// ── tiny components ────────────────────────────────────────────────────────

const TEMP_STYLES: Record<string, string> = {
  // super_hot — deep-green filled (the brief's #0B7C3A intent, tokenised).
  super_hot: "bg-emerald-700 text-white",
  hot: "bg-brand-soft text-brand",
  warm: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  cold: "bg-muted text-muted-foreground",
};

export function TemperaturePill({ temp }: { temp: string }) {
  const key = (temp ?? "").toLowerCase();
  const style = TEMP_STYLES[key] ?? "bg-muted text-muted-foreground";
  const label = (temp ?? "").replace(/_/g, " ");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[10px] uppercase leading-none tracking-[0.04em]",
        style,
      )}
    >
      {label}
    </span>
  );
}

/**
 * Property thumbnail with a guaranteed graceful fallback: a neutral Building2
 * glyph on bg-muted whenever there is no src OR the image fails to load. Never
 * renders a broken <img>.
 */
export function PropertyThumb({
  src,
  alt,
  className,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImg = !!src && !failed;
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden bg-muted text-muted-foreground",
        className,
      )}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src ?? undefined}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <Building2
          className="h-1/3 w-1/3 opacity-60"
          aria-hidden
          strokeWidth={1.6}
        />
      )}
    </div>
  );
}

export function Chip({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "brand";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] leading-none",
        tone === "brand"
          ? "bg-brand-soft text-brand"
          : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
