"use client";

import { useTranslations } from "next-intl";

import type {
  MatchDimension,
  MatchExplanationItem,
  MatchFeature,
} from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { typeLabel } from "./_shared";

/**
 * "Why matched" — the honest, per-dimension + per-feature explanation of why a
 * property fits a lead (Day-2 Client Intelligence). The wording is deliberate
 * and must never imply knowledge AIVENA lacks:
 *   • `not_confirmed` = "the listing data doesn't say", NEVER "no" / a red ✗.
 *   • `unknown` = the lead gave no criterion (or the field is missing).
 *   • similarity is a SOFT fit cue only — never a numeric "match %".
 * A requested-but-not-confirmed amenity is the agent's real talking point, so we
 * surface those prominently and hide the noisy non-requested not_confirmed ones.
 */
export type ExplainState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; byProp: Record<string, MatchExplanationItem> };

type Tone = "positive" | "caution" | "muted";

const TONE_TEXT: Record<Tone, string> = {
  positive: "text-brand",
  caution: "text-amber-700 dark:text-amber-400",
  muted: "text-muted-foreground",
};

const TONE_DOT: Record<Tone, string> = {
  positive: "bg-brand",
  caution: "bg-amber-500",
  muted: "bg-muted-foreground/40",
};

type Tr = ReturnType<typeof useTranslations>;

type DimRow = { text: string; tone: Tone; contrast: string | null };

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "Requested → listing" contrast, honest from the real values (capitalised). */
function contrastOf(dim: MatchDimension): string | null {
  const l = dim.lead_value == null ? "" : String(dim.lead_value).trim();
  const p = dim.property_value == null ? "" : String(dim.property_value).trim();
  if (!l || !p) return null;
  return `${cap(l)} → ${cap(p)}`;
}

/**
 * Honest one-line label + tone for a single match dimension, plus a
 * "requested → listing" contrast for the area/type/bed/bath cases where seeing
 * both sides is the agent's real talking point (e.g. "Guardamar → El Raso",
 * "house → villa"). The contrast is verbatim from the RPC values — never invented.
 */
function dimensionRow(dim: MatchDimension, t: Tr): DimRow {
  const v = dim.verdict;
  const n = dim.property_value == null ? "" : String(dim.property_value);
  const contrast = contrastOf(dim);
  switch (dim.key) {
    case "budget":
      if (v === "match") return { text: t("budgetMatch"), tone: "positive", contrast: null };
      if (v === "slightly_over")
        return { text: t("budgetSlightlyOver"), tone: "caution", contrast: null };
      if (v === "over_budget")
        return { text: t("budgetOver"), tone: "caution", contrast: null };
      return { text: t("budgetUnknown"), tone: "muted", contrast: null };
    case "location":
      if (v === "match") return { text: t("locationMatch"), tone: "positive", contrast: null };
      if (v === "different_area")
        return { text: t("locationDifferent"), tone: "caution", contrast };
      return { text: t("locationUnknown"), tone: "muted", contrast: null };
    case "bedrooms":
      if (v === "match")
        return { text: t("bedroomsMatch", { n }), tone: "positive", contrast: null };
      if (v === "mismatch")
        return { text: t("bedroomsMismatch"), tone: "caution", contrast };
      return { text: t("bedroomsUnknown"), tone: "muted", contrast: null };
    case "bathrooms":
      if (v === "match")
        return { text: t("bathroomsMatch", { n }), tone: "positive", contrast: null };
      if (v === "mismatch")
        return { text: t("bathroomsMismatch"), tone: "caution", contrast };
      return { text: t("bathroomsUnknown"), tone: "muted", contrast: null };
    case "property_type":
      if (v === "match") return { text: t("typeMatch"), tone: "positive", contrast: null };
      if (v === "mismatch")
        return { text: t("typeMismatch"), tone: "caution", contrast };
      return { text: t("typeUnknown"), tone: "muted", contrast: null };
    default:
      return { text: "", tone: "muted", contrast: null };
  }
}

export function WhyMatched({
  explain,
  propertyId,
}: {
  explain: ExplainState;
  propertyId: string;
}) {
  const t = useTranslations("matches.why");

  if (explain.kind === "idle" || explain.kind === "loading") {
    return (
      <p className="mt-2 text-[11.5px] text-muted-foreground">{t("loading")}</p>
    );
  }
  if (explain.kind === "error") {
    return (
      <p className="mt-2 text-[11.5px] text-muted-foreground">{t("error")}</p>
    );
  }

  const item = explain.byProp[propertyId];
  if (!item) {
    // The lead's explanation loaded, but this property wasn't in it — calm note.
    return (
      <p className="mt-2 text-[11.5px] text-muted-foreground">
        {t("noExplanation")}
      </p>
    );
  }

  const featLabel = (f: MatchFeature) => typeLabel(f.name);

  // One premium, scannable list: dimensions (unknowns hidden so it reads as an
  // AI explanation, not an exhaustive error list), then confirmed amenities,
  // then the requested-but-not-confirmed gaps — the agent's real talking point.
  const confirmed = item.features.filter((f) => f.verdict === "confirmed");
  const requestedGap = item.features.filter(
    (f) => f.requested && f.verdict === "not_confirmed",
  );
  const rows: DimRow[] = [
    ...item.dimensions
      .map((d) => dimensionRow(d, t))
      .filter((r) => r.tone !== "muted"),
    ...confirmed.map((f) => ({
      text: t("featureConfirmed", { name: featLabel(f) }),
      tone: "positive" as Tone,
      contrast: null,
    })),
    ...requestedGap.map((f) => ({
      text: t("featureRequestedNotConfirmed", { name: featLabel(f) }),
      tone: "caution" as Tone,
      contrast: null,
    })),
  ].filter((r) => r.text);

  if (rows.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground">{t("noFeatureSignals")}</p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span
            className={cn(
              "mt-[6px] h-2 w-2 shrink-0 rounded-full",
              TONE_DOT[r.tone],
            )}
            aria-hidden
          />
          <span className="text-[12.5px] leading-snug">
            <span className={cn("font-medium", TONE_TEXT[r.tone])}>{r.text}</span>
            {r.contrast ? (
              <span className="text-muted-foreground">: {r.contrast}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
