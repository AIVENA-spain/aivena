"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { BadgeCheck, ChevronDown, ExternalLink, Home, Info } from "lucide-react";

import type { Match, MatchExplanationItem } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  getLeadMatchesAction,
  getMatchExplanationAction,
  suggestPropertiesAction,
} from "./matches-actions";
import {
  PropertyThumb,
  fmtArea,
  fmtBedsBaths,
  fmtPrice,
  typeLabel,
  type MatchLabels,
} from "./_shared";
import { WhyMatched, type ExplainState } from "./why-matched";

/**
 * Matched Property + Why this matches — the matches block of the Client
 * Intelligence panel. The top-ranked match shows its card + an always-open
 * honest "why" side-by-side; any extra matches list below with a collapsible
 * why. Read-only; Law 2: a failed load shows one calm message, never detail.
 * The "Suggest" action is gated when the WhatsApp 24h window is closed — it must
 * never imply a send the window won't allow.
 */
type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: Match[] };

/** Soft, qualitative fit cue — never a raw "match %". ~0.51 → "Good fit". */
function fitLabel(sim: number, t: ReturnType<typeof useTranslations>): string {
  if (sim >= 0.6) return t("fitStrong");
  if (sim >= 0.4) return t("fitGood");
  return t("fitFair");
}

export function MatchedProperties({
  leadId,
  leadName,
  onSuggested,
  windowClosed = false,
  refreshKey,
  basedOn,
}: {
  leadId: string;
  /** Lead's full name — drives the "Suggest these to {firstName}" label. */
  leadName?: string | null;
  /** Called with the new suggestion task id after a successful suggest. */
  onSuggested?: (taskId: string) => void;
  /** True only when the WhatsApp 24h window is known-closed → gate Suggest. */
  windowClosed?: boolean;
  /**
   * Changes whenever the conversation does (e.g. message count). Re-fetches the
   * matches so the rail can't sit on a cached list. NOTE: this fixes the UI-cache
   * half only — the engine keys off the lead's STORED preference
   * (leads.location_interest_extracted), which is set at capture and is not yet
   * updated from later messages (backend gap, owned by the ingestion/matching
   * lanes). So a re-fetch returns the same set until that lands; `basedOn` below
   * makes that honest instead of silently stale.
   */
  refreshKey?: string | number;
  /** The stored preference the recommendations are actually keyed to. */
  basedOn?: string | null;
}) {
  const t = useTranslations("matches");
  const tIntel = useTranslations("inbox.intel");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [posting, setPosting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [explain, setExplain] = useState<ExplainState>({ kind: "idle" });
  const [openWhy, setOpenWhy] = useState<Set<string>>(new Set());

  async function ensureExplain() {
    if (explain.kind !== "idle") return;
    setExplain({ kind: "loading" });
    const res = await getMatchExplanationAction(leadId);
    if (res.ok) {
      const byProp: Record<string, MatchExplanationItem> = {};
      for (const it of res.data) byProp[it.property_id] = it;
      setExplain({ kind: "ready", byProp });
    } else {
      setExplain({ kind: "error", message: res.error });
    }
  }

  function toggleWhy(propertyId: string) {
    setOpenWhy((prev) => {
      const next = new Set(prev);
      if (next.has(propertyId)) next.delete(propertyId);
      else next.add(propertyId);
      return next;
    });
    void ensureExplain();
  }

  const firstName = leadName?.trim().split(/\s+/)[0] || "this buyer";

  async function handleSuggest() {
    if (windowClosed) return; // gated — never bypass the closed window
    setPosting(true);
    setSuggestError(null);
    const res = await suggestPropertiesAction(leadId);
    if (res.ok) onSuggested?.(res.data.task_id);
    else setSuggestError(res.error);
    setPosting(false);
  }

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    setSuggestError(null);
    setPosting(false);
    setExplain({ kind: "idle" });
    setOpenWhy(new Set());
    getLeadMatchesAction(leadId).then((res) => {
      if (!alive) return;
      if (res.ok) {
        setState({ kind: "ready", data: res.data });
        // Load the explanation up-front so the top match's "why" is ready.
        if (res.data.length > 0) void ensureExplain();
      } else {
        setState({ kind: "error", message: res.error });
      }
    });
    return () => {
      alive = false;
    };
    // ensureExplain is stable per leadId; intentionally omitted.
    // refreshKey re-runs the fetch when the conversation changes (no stale cache).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, refreshKey]);

  const labels: MatchLabels = {
    bed: t("unitBed"),
    bath: t("unitBath"),
    studio: t("unitStudio"),
    priceOnRequest: t("priceOnRequest"),
    match: t("match"),
    more: (n: number) => t("more", { n }),
  };

  const matches = state.kind === "ready" ? state.data : [];
  // Top-ranked first (the list arrives ordered, but be defensive).
  const ordered = [...matches].sort((a, b) => a.rank - b.rank);
  const top = ordered[0];
  const rest = ordered.slice(1);

  return (
    <section className="border-t border-border pt-3">
      {state.kind === "loading" ? (
        <div className="grid gap-5 @[420px]:grid-cols-2">
          <div className="flex animate-pulse flex-col gap-2 rounded-xl border border-border bg-card p-2.5">
            <div className="h-20 w-full rounded-lg bg-muted" />
            <div className="h-3 w-3/4 rounded bg-muted" />
            <div className="h-3 w-1/2 rounded bg-muted" />
          </div>
          <div className="flex animate-pulse flex-col gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-3 w-5/6 rounded bg-muted" />
            ))}
          </div>
        </div>
      ) : state.kind === "error" ? (
        <p className="rounded-xl border border-border bg-card p-3 text-[12px] text-muted-foreground">
          {state.message}
        </p>
      ) : !top ? (
        <p className="rounded-xl border border-dashed border-border bg-card/50 p-3 text-[12px] text-muted-foreground">
          {t("panelEmpty")}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Honesty line: the engine keys these recommendations off the lead's
              STORED preference. It is captured at intake and NOT yet refreshed
              from later messages, so if the buyer has since asked for other
              areas these can be behind — say so plainly rather than let a stale
              list look current. (Real fix is backend: re-extract preferences
              from inbound messages + re-run the match.) */}
          {basedOn ? (
            <p className="flex items-start gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
              <Info className="mt-[1px] h-3 w-3 shrink-0" aria-hidden />
              <span>
                {tIntel("basedOnPrefix")}{" "}
                <span className="font-medium text-foreground">{basedOn}</span>
                {" — "}
                {tIntel("basedOnHint")}
              </span>
            </p>
          ) : null}

          {/* Top match: card + always-open why, side-by-side when wide. */}
          <div className="grid gap-x-5 gap-y-3 @[420px]:grid-cols-2">
            {/* Matched property */}
            <div className="flex flex-col gap-2.5">
              <h3 className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.01em] text-foreground">
                <Home className="h-4 w-4 text-muted-foreground" aria-hidden />
                {tIntel("matchedPropertyHeading")}
              </h3>
              {/* Compact horizontal card — small thumb + details beside. With no
                  real photo the placeholder stays small (no wasted image block). */}
              <div className="flex gap-3 rounded-xl border border-border bg-card p-2.5">
                <PropertyThumb
                  srcs={top.images ?? []}
                  alt={top.title}
                  className="h-[68px] w-[68px] shrink-0 rounded-lg"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="line-clamp-1 text-[13px] font-semibold text-foreground">
                    {top.title}
                  </p>
                  {top.external_id ? (
                    <p className="font-mono text-[10px] tracking-wide text-muted-foreground">
                      {t("ref")} {top.external_id}
                    </p>
                  ) : null}
                  <p className="text-[12.5px] font-semibold text-foreground">
                    {fmtPrice(top.price, top.price_currency, labels)}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {[typeLabel(top.property_type), fmtBedsBaths(top.bedrooms, top.bathrooms, labels)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand">
                      {fitLabel(top.similarity, t)}
                    </span>
                    {top.source_url ? (
                      <a
                        href={top.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
                      >
                        {t("viewListing")}
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
              {/* Suggest — gated when the WhatsApp window is closed (no fake send). */}
              <div className="flex flex-col gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  className="w-full"
                  disabled={posting || windowClosed}
                  onClick={handleSuggest}
                  title={windowClosed ? tIntel("suggestGated") : undefined}
                >
                  {posting ? t("suggesting") : t("suggestToLead", { name: firstName })}
                </Button>
                {windowClosed ? (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    {tIntel("suggestGated")}
                  </p>
                ) : null}
                {suggestError ? (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    {suggestError}
                  </p>
                ) : null}
              </div>
            </div>

            {/* Why this matches */}
            <div className="flex flex-col gap-2.5">
              <h3 className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.01em] text-foreground">
                <BadgeCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
                {tIntel("whyHeading")}
              </h3>
              <WhyMatched explain={explain} propertyId={top.property_id} />
            </div>
          </div>

          {/* Additional matches (rare in pilot) — compact, collapsible why. */}
          {rest.length > 0 ? (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              {rest.map((m) => (
                <div
                  key={m.property_id}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2.5"
                >
                  <PropertyCard m={m} labels={labels} t={t} compact />
                  <div className="border-t border-border pt-2">
                    <button
                      type="button"
                      onClick={() => toggleWhy(m.property_id)}
                      aria-expanded={openWhy.has(m.property_id)}
                      className="flex w-full items-center justify-between gap-2 text-[11.5px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      {t("why.toggle")}
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 transition-transform",
                          openWhy.has(m.property_id) && "rotate-180",
                        )}
                        aria-hidden
                      />
                    </button>
                    {openWhy.has(m.property_id) ? (
                      <WhyMatched explain={explain} propertyId={m.property_id} />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** A single matched-property card (image, title, ref, meta, price, fit cue). */
function PropertyCard({
  m,
  labels,
  t,
  compact = false,
}: {
  m: Match;
  labels: MatchLabels;
  t: ReturnType<typeof useTranslations>;
  compact?: boolean;
}) {
  const bedsBaths = fmtBedsBaths(m.bedrooms, m.bathrooms, labels);
  const area = fmtArea(m.area_sqm);
  const meta = [bedsBaths, area].filter(Boolean).join(" · ");
  const place = [m.location_city, m.location_region].filter(Boolean).join(", ");
  return (
    <div className="flex flex-col gap-2 overflow-hidden rounded-xl border border-border bg-card p-2.5">
      {!compact ? (
        <PropertyThumb
          srcs={m.images ?? []}
          alt={m.title}
          emptyLabel={t("noPhoto")}
          className="h-20 w-full rounded-lg"
        />
      ) : null}
      <div className="flex flex-col gap-0.5">
        <p className="line-clamp-2 text-[13px] font-semibold text-foreground">
          {m.title}
        </p>
        {m.external_id ? (
          <p className="font-mono text-[10.5px] tracking-wide text-muted-foreground">
            {t("ref")} {m.external_id}
          </p>
        ) : null}
        <p className="text-[12.5px] font-medium text-foreground">
          {fmtPrice(m.price, m.price_currency, labels)}
        </p>
        <p className="truncate text-[11.5px] text-muted-foreground">
          {[typeLabel(m.property_type), meta].filter(Boolean).join(" · ")}
        </p>
        {place ? (
          <p className="truncate text-[11.5px] text-muted-foreground">{place}</p>
        ) : null}
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="inline-flex items-center rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand">
            {fitLabel(m.similarity, t)}
          </span>
          {m.source_url ? (
            <a
              href={m.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11.5px] font-medium text-brand hover:underline"
            >
              {t("viewListing")}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
