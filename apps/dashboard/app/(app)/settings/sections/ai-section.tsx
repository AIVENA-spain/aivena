import { getTranslations } from "next-intl/server";

import type { AmandaSettingsResponse, ReplyLanes, SettingsResponse } from "@/lib/api/types";
import { hasAutoSend } from "../automation-safety";
import { AmandaSection } from "./amanda-section";
import { AutomationLevel } from "./automation-level";

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
// Kept for the ToneKey union used by the read-only chip below.
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
  amanda,
}: {
  branding: SettingsResponse["branding"];
  initialLanes: ReplyLanes | undefined;
  amanda?: AmandaSettingsResponse | null;
}) {
  const t = await getTranslations("settings.aiRules");
  const tv = await getTranslations("settings.voice");

  const autoSendActive = hasAutoSend(initialLanes);
  const currentTone = (branding.tone ?? "").toLowerCase();

  // Effective review state per lane (default_lane governs unset lanes).
  const defaultReview = initialLanes?.default_lane !== "auto_send";
  const followup = effectiveReview(initialLanes?.by_action?.followup, defaultReview);

  // WhatsApp replies and bookings are governed by the AMANDA dial, not by the
  // email reply-lanes. Reading them from the lanes produced a live falsehood:
  // on 2026-08-29 this page told Christian "WhatsApp replies · inherited from
  // approval-first · PROTECTED" while the agency was running amanda_mode=full
  // and Amanda was auto-sending. These two rows now read the mode itself.
  const amandaMode = (amanda?.mode ?? "off") as "off" | "shadow" | "approval" | "assisted" | "full";
  const whatsappRow: { state: "review" | "comingSoon" | "off"; note: string } =
    amandaMode === "off"
      ? { state: "comingSoon", note: t("waOff") }
      : amandaMode === "shadow"
        ? { state: "comingSoon", note: t("waShadow") }
        : amandaMode === "approval"
          ? { state: "review", note: t("waApproval") }
          : { state: "off", note: t("waAuto") };
  const bookingsRow: { state: "review" | "comingSoon" | "off"; note: string } =
    amandaMode === "off" || amandaMode === "shadow"
      ? { state: "comingSoon", note: t("bookOff") }
      : amandaMode === "full"
        ? { state: "off", note: t("bookAuto") }
        : { state: "review", note: t("bookReview") };

  const email = effectiveReview(initialLanes?.by_channel?.email, defaultReview);

  return (
    <div className="flex flex-col gap-5">
      {/* Amanda auto-mode (Packet 2 engine) — status + the two viewing knobs +
          screened agency knowledge. Renders one honest line pre-migration. */}
      <AmandaSection data={amanda ?? null} />

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
        {/* ONE chip for the tone actually in use, not five greyed options.
            Five pills that cannot be pressed read as a broken picker, and
            Christian tried to press them (2026-08-31: "also not tap on the
            follow up tone settings"). Tone is genuinely not wired to sending
            yet, so offering a choice would be a fake control — showing the
            current value and saying so is the honest version. */}
        <div className="flex flex-wrap items-center gap-2">
          {currentTone ? (
            <span className="rounded-full border border-border bg-muted/40 px-3.5 py-1.5 text-[12px] font-medium text-muted-foreground">
              {tv(`tone${capitalize(currentTone)}` as ToneKey)}
            </span>
          ) : (
            <span className="text-[12px] text-muted-foreground">{t("followupToneNone")}</span>
          )}
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

      <AutomationLevel mode={amandaMode} />

      {/* Always ask me first — locked/read-only effective review state */}
      <fieldset className="flex flex-col gap-1 border-t border-border pt-4">
        <legend className="text-[13px] font-semibold text-foreground">{t("overridesGroupLabel")}</legend>
        <p className="text-[11.5px] text-muted-foreground">{t("askFirstHelp")}</p>
        <div className="mt-1 flex flex-col gap-0.5">
          <LockedRow label={t("ovScheduling")} state={bookingsRow.state} note={bookingsRow.note} t={t} />
          <LockedRow label={t("ovFollowups")} state={followup.review ? "review" : "off"} note={followup.inherited ? t("inheritedNote") : t("reviewRequired")} t={t} />
          <LockedRow label={t("ovEmail")} state={email.review ? "review" : "off"} note={email.inherited ? t("inheritedNote") : t("reviewRequired")} t={t} />
          <LockedRow label={t("ovWhatsapp")} state={whatsappRow.state} note={whatsappRow.note} t={t} />
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
      {/* A DOT, not a checkbox. These rows are DERIVED from the automation
          level above — there is nothing to tick, and rendering them as
          checkboxes invited exactly the click that does nothing (Christian
          2026-08-31: "i cant tap on the 'always ask me for' buttons, it doesnt
          allow me to check or un check any"). A control that cannot be operated
          must not look operable. */}
      <span
        aria-hidden
        className={`h-2 w-2 shrink-0 rounded-full ${checked ? "bg-brand" : "bg-muted-foreground/40"}`}
      />
      <span className={`text-[13px] ${state === "comingSoon" ? "text-muted-foreground" : "text-foreground"}`}>{label}</span>
      <span className="text-[11px] text-muted-foreground">· {note}</span>
      <span className="ml-auto shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {state === "comingSoon"
          ? t("statusComingSoon")
          : state === "off"
            ? t("statusAuto")
            : t("statusLocked")}
      </span>
    </div>
  );
}
