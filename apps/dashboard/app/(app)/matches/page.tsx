import { getTranslations } from "next-intl/server";
import { Users } from "lucide-react";

import { GatePill } from "@/components/shell/launch-gate";

export const dynamic = "force-dynamic";

/**
 * Matches — W20 inbound reverse-prospecting surface (v1.14.7). When a new
 * property is uploaded, AIVENA matches it against existing buyer contacts and
 * surfaces the matches here for the agent to action manually (no automated
 * send at Pilot 1 inbound mode). The matching engine is Vega's; until it ships
 * this is an honest empty state — never a fabricated match.
 */
export default async function MatchesPage() {
  const t = await getTranslations("matches");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t("subtitle")}</p>
        <GatePill />
      </div>

      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Users className="h-6 w-6" aria-hidden strokeWidth={1.7} />
        </div>
        <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
        <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
      </div>

      {/* How it will work — honest explainer, not a fake list. */}
      <div className="rounded-xl border border-border bg-card/50 px-5 py-4">
        <h2 className="mb-2 text-[13px] font-semibold text-foreground">
          {t("howTitle")}
        </h2>
        <ol className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
          <li>1. {t("how1")}</li>
          <li>2. {t("how2")}</li>
          <li>3. {t("how3")}</li>
        </ol>
      </div>
    </div>
  );
}
