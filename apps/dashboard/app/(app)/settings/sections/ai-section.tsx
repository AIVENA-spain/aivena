import { getTranslations } from "next-intl/server";
import { Check } from "lucide-react";

import type { ReplyLanes, SettingsResponse } from "@/lib/api/types";
import { hasAutoSend } from "../automation-safety";

/**
 * AI behaviour & approvals — accordion body. Fully READ-ONLY / locked for pilot:
 * - Automation level is locked to Approval-first; "Everything auto" disabled.
 * - Follow-up tone read-only; Agency voice disabled.
 * - "Always ask me first": rows show the EFFECTIVE review state, not the raw
 *   key. With the global default_lane = review_first, a lane with no explicit
 *   override INHERITS approval-first, so it is protected (shown ON). There is
 *   no editable OFF state (OFF must never mean auto_send), so the rows are
 *   locked/read-only — no per-lane write path is exposed and no save exists.
 */
const TONE_VALUES = ["warm", "formal", "concise", "playful", "luxury"] as const;

type Effective = { review: boolean; inherited: boolean };

function effectiveReview(explicit: string | undefined, defaultReview: boolean): Effective {
  if (explicit === "auto_send") return { review: false, inherited: false };
  if (explicit === "review_first") return { review: true, inherited: false };
  return { review: defaultReview, inherited: true }; // null / unset → inherit the global lane
}

export async function AiSection({
  branding,
  initialLanes,
}: {
  branding: SettingsResponse["branding"];
  initialLanes: ReplyLanes | undefined;
}) {
  const t = await getTranslations("settings.aiRules");
  const tv = await getTranslations("settings.voice");

  const autoSendActive = hasAutoSend(initialLanes);
  const currentTone = (branding.tone ?? "").toLowerCase();

  // Effective review state per lane (default_lane governs unset lanes).
  const defaultReview = initialLanes?.default_lane !== "auto_send";
  const followup = effectiveReview(initialLanes?.by_action?.followup, defaultReview);
  const email = effectiveReview(initialLanes?.by_channel?.email, defaultReview);
  const whatsapp = effectiveReview(initialLanes?.by_channel?.whatsapp, defaultReview);

  return (
    <div className="flex flex-col gap-5">
      {/* Auto-send safety banner — derived from real reply_rules (hidden when safe) */}
      {autoSendActive ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <span className="font-semibold">{t("autoSendBannerTitle")}</span> {t("autoSendBannerAll")}
        </div>
      ) : null}

      {/* Voice & tone — read-only (tone) + disabled (agency voice) */}
      <div className="flex flex-col gap-2.5">
        <div>
          <h3 className="text-[13px] font-semibold text-foreground">{t("followupToneLabel")}</h3>
          <p className="text-[11.5px] text-muted-foreground">{t("followupToneDisabled")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-disabled>
          {TONE_VALUES.map((value) => {
            const active = currentTone === value;
            return (
              <span
                key={value}
                className={`cursor-not-allowed rounded-full border px-3.5 py-1.5 text-[12px] font-medium ${
                  active ? "border-brand/30 bg-brand-soft text-brand opacity-70" : "border-border bg-muted/40 text-muted-foreground"
                }`}
              >
                {tv(`tone${capitalize(value)}` as ToneKey)}
              </span>
            );
          })}
        </div>
        <div className="mt-1 flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold text-foreground">{tv("describeLabel")}</h3>
          <textarea
            disabled
            rows={2}
            placeholder={t("agencyVoiceDisabled")}
            className="w-full cursor-not-allowed rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
          />
          <p className="text-[11px] text-muted-foreground">{t("agencyVoiceDisabled")}</p>
        </div>
      </div>

      {/* Automation level — locked approval-first */}
      <fieldset className="flex flex-col gap-2.5 border-t border-border pt-4">
        <legend className="text-[13px] font-semibold text-foreground">{t("levelGroupLabel")}</legend>
        <p className="text-[11.5px] text-muted-foreground">{t("levelGroupHelp")}</p>
        <div className="mt-1 flex flex-col gap-1">
          <div className="flex items-start gap-3 rounded-lg border border-brand bg-brand-soft px-3 py-2 text-[13px]">
            <span aria-hidden className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-brand">
              <span className="h-2 w-2 rounded-full bg-brand" />
            </span>
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <span className="font-medium text-foreground">{t("levelNone")}</span>
                <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand">{t("recommendedBadge")}</span>
                <span className="text-[10.5px] font-medium text-muted-foreground">{t("lockedNote")}</span>
              </span>
              <span className="text-[11.5px] text-muted-foreground">{t("levelNoneDesc")}</span>
            </span>
          </div>
          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px] opacity-60" title={t("everythingAutoTooltip")}>
            <span aria-hidden className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground/40" />
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <span className="font-medium text-foreground">{t("levelAll")}</span>
                <span className="text-[10.5px] font-medium text-muted-foreground">{t("everythingAutoOff")}</span>
              </span>
              <span className="text-[11.5px] text-muted-foreground">{t("everythingAutoTooltip")}</span>
            </span>
          </div>
        </div>
      </fieldset>

      {/* Always ask me first — locked/read-only effective review state */}
      <fieldset className="flex flex-col gap-1 border-t border-border pt-4">
        <legend className="text-[13px] font-semibold text-foreground">{t("overridesGroupLabel")}</legend>
        <p className="text-[11.5px] text-muted-foreground">{t("askFirstLockedHelp")}</p>
        <div className="mt-1 flex flex-col gap-0.5">
          <LockedRow label={t("ovScheduling")} state="comingSoon" note={t("bookingsDisabled")} t={t} />
          <LockedRow label={t("ovFollowups")} state={followup.review ? "review" : "off"} note={followup.inherited ? t("inheritedNote") : t("reviewRequired")} t={t} />
          <LockedRow label={t("ovEmail")} state={email.review ? "review" : "off"} note={email.inherited ? t("inheritedNote") : t("reviewRequired")} t={t} />
          <LockedRow label={t("ovWhatsapp")} state={whatsapp.review ? "review" : "off"} note={whatsapp.inherited ? t("inheritedNote") : t("reviewRequired")} t={t} />
        </div>
      </fieldset>
    </div>
  );
}

type ToneKey = "toneWarm" | "toneFormal" | "toneConcise" | "tonePlayful" | "toneLuxury";

function capitalize(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/**
 * Read-only ask-first row. "review" = protected (checked, locked); "comingSoon"
 * = not yet active (muted). There is no editable/OFF affordance — the row never
 * implies a message can bypass review.
 */
function LockedRow({
  label,
  state,
  note,
  t,
}: {
  label: string;
  state: "review" | "comingSoon" | "off";
  note: string;
  t: Awaited<ReturnType<typeof getTranslations<"settings.aiRules">>>;
}) {
  const checked = state === "review";
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span
        aria-hidden
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
          checked ? "border-brand bg-brand text-brand-fg" : "border-muted-foreground/40 bg-muted/40"
        }`}
      >
        {checked ? <Check className="h-3 w-3" /> : null}
      </span>
      <span className={`text-[13px] ${state === "comingSoon" ? "text-muted-foreground" : "text-foreground"}`}>{label}</span>
      <span className="text-[11px] text-muted-foreground">· {note}</span>
      <span className="ml-auto shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {state === "comingSoon" ? t("statusComingSoon") : t("statusLocked")}
      </span>
    </div>
  );
}
