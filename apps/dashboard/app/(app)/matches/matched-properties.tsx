"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";

import type { Match } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { getLeadMatchesAction, suggestPropertiesAction } from "./matches-actions";
import {
  PropertyThumb,
  fmtArea,
  fmtBedsBaths,
  fmtPrice,
  matchPct,
  typeLabel,
  type MatchLabels,
} from "./_shared";

/**
 * Panel B — top property matches for a single lead, rendered inside the inbox
 * lead pane (right after LeadNotes). Read-only: loads via the matches server
 * action on mount, then shows loading / friendly-error / empty / grid states.
 * Law 2: a failed load shows the one calm message, never any detail.
 */
type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: Match[] };

export function MatchedProperties({
  leadId,
  leadName,
  onSuggested,
}: {
  leadId: string;
  /** Lead's full name — drives the "Suggest these to {firstName}" label. */
  leadName?: string | null;
  /** Called with the new suggestion task id after a successful suggest. */
  onSuggested?: (taskId: string) => void;
}) {
  const t = useTranslations("matches");
  const [state, setState] = useState<State>({ kind: "loading" });
  // Suggest-as-reply posting state + inline friendly error (Law 2: no codes).
  const [posting, setPosting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  // "Suggest these to {firstName}" — first token of the name, or a calm
  // fallback when the lead has no name on file.
  const firstName = leadName?.trim().split(/\s+/)[0] || "this buyer";

  async function handleSuggest() {
    setPosting(true);
    setSuggestError(null);
    const res = await suggestPropertiesAction(leadId);
    if (res.ok) {
      onSuggested?.(res.data.task_id);
    } else {
      setSuggestError(res.error);
    }
    setPosting(false);
  }

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    setSuggestError(null);
    setPosting(false);
    getLeadMatchesAction(leadId).then((res) => {
      if (!alive) return;
      if (res.ok) setState({ kind: "ready", data: res.data });
      else setState({ kind: "error", message: res.error });
    });
    return () => {
      alive = false;
    };
  }, [leadId]);

  const labels: MatchLabels = {
    bed: t("unitBed"),
    bath: t("unitBath"),
    studio: t("unitStudio"),
    priceOnRequest: t("priceOnRequest"),
    match: t("match"),
    more: (n: number) => t("more", { n }),
  };

  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-[13px] font-semibold text-foreground">
        {t("matchedProperties")}
      </h3>

      {state.kind === "loading" ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="flex animate-pulse flex-col gap-2 rounded-xl border border-border bg-card p-2.5"
            >
              <div className="aspect-[4/3] w-full rounded-lg bg-muted" />
              <div className="h-3 w-3/4 rounded bg-muted" />
              <div className="h-3 w-1/2 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : state.kind === "error" ? (
        <p className="rounded-xl border border-border bg-card p-3 text-[12.5px] text-muted-foreground">
          {state.message}
        </p>
      ) : state.data.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/50 p-3 text-[12.5px] text-muted-foreground">
          {t("panelEmpty")}
        </p>
      ) : (
        <>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {state.data.map((m) => {
            const bedsBaths = fmtBedsBaths(m.bedrooms, m.bathrooms, labels);
            const area = fmtArea(m.area_sqm);
            const meta = [bedsBaths, area].filter(Boolean).join(" · ");
            const place = [m.location_city, m.location_region]
              .filter(Boolean)
              .join(", ");
            return (
              <div
                key={m.property_id}
                className="flex flex-col gap-2 overflow-hidden rounded-xl border border-border bg-card p-2.5"
              >
                <PropertyThumb
                  src={m.images?.[0]}
                  alt={m.title}
                  className="aspect-[4/3] w-full rounded-lg"
                />
                <div className="flex flex-col gap-1">
                  <p className="line-clamp-2 text-[13px] font-semibold text-foreground">
                    {m.title}
                  </p>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    {[typeLabel(m.property_type), meta].filter(Boolean).join(" · ")}
                  </p>
                  <p className="text-[12.5px] font-medium text-foreground">
                    {fmtPrice(m.price, m.price_currency, labels)}
                  </p>
                  {place ? (
                    <p className="truncate text-[11.5px] text-muted-foreground">
                      {place}
                    </p>
                  ) : null}
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-brand">
                      {matchPct(m.similarity, labels)}
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
          })}
        </div>

        {/* Suggest the matched properties as the next reply to the buyer.
            Shown only when there are matches; loading + inline friendly error. */}
        <div className="flex flex-col gap-1.5">
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={posting}
            onClick={handleSuggest}
          >
            {posting
              ? t("suggesting")
              : t("suggestToLead", { name: firstName })}
          </Button>
          {suggestError ? (
            <p className="text-[11.5px] text-amber-700 dark:text-amber-300">
              {suggestError}
            </p>
          ) : null}
        </div>
        </>
      )}
    </section>
  );
}
