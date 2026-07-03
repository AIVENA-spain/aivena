import { getTranslations } from "next-intl/server";
import { Image as ImageIcon, SlidersHorizontal, Mail, Globe, Users, CreditCard } from "lucide-react";

import { apiFetch, ApiError } from "@/lib/api/client";
import { PageLoadError } from "@/components/shell/page-error";
import { getCurrentUserContext } from "@/lib/auth/context";
import type { SettingsResponse, ReadinessResponse } from "@/lib/api/types";

import { AccordionSection, StatusDot, StatusTag } from "./accordion";
import { hasAutoSend } from "./automation-safety";
import { ChecklistSection } from "./sections/checklist-section";
import { SetupProgressSection } from "./sections/setup-progress-section";
import { BrandingSection } from "./sections/branding-section";
import { AiSection } from "./sections/ai-section";
import { ChannelsSection } from "./sections/channels-section";
import { LanguagesSection } from "./sections/languages-section";
import { TeamSection } from "./sections/team-section";
import { PlanPrefsSection } from "./sections/plan-prefs-section";

export const dynamic = "force-dynamic";

type PreferencesResponse = { uiLanguage: string; messageLanguage: string; theme: string };
const FALLBACK_PREFERENCES: PreferencesResponse = { uiLanguage: "en", messageLanguage: "en", theme: "system" };

/**
 * Settings — agency control center, accordion layout (per the finalized spec).
 * Server shell fetches the settings contract + the caller's prefs; each section
 * renders inside a collapsible AccordionSection. Branding (open by default) is
 * the editable centre; AI/channels/languages carry the active controls; team
 * and plan are read-only.
 */
export default async function SettingsPage() {
  const t = await getTranslations("settings");
  const ta = await getTranslations("settings.accordion");

  const [settingsRes, prefsRes, readinessRes, ctx] = await Promise.allSettled([
    apiFetch<SettingsResponse>("/api/v1/settings"),
    apiFetch<PreferencesResponse>("/api/v1/me/preferences"),
    apiFetch<ReadinessResponse>("/api/v1/readiness"),
    getCurrentUserContext(),
  ]);

  if (settingsRes.status === "rejected") {
    logFailure("settings", settingsRes.reason);
    return <PageLoadError />;
  }
  const settings = settingsRes.value;
  const preferences = prefsRes.status === "fulfilled" ? prefsRes.value : FALLBACK_PREFERENCES;
  if (prefsRes.status === "rejected") logFailure("preferences", prefsRes.reason);

  // Readiness (D2/D3) is enhancement, not load-critical: a non-owner gets 403 and
  // a pre-deploy build gets 404 — either way we fall back to the settings-derived
  // ChecklistSection + static channel rows. Never block the page on it.
  const readiness = readinessRes.status === "fulfilled" ? readinessRes.value : null;
  if (readinessRes.status === "rejected") logFailure("readiness", readinessRes.reason);

  const currentUserId = ctx.status === "fulfilled" && ctx.value ? ctx.value.userId : "";

  const lanes = settings.reply_lanes;
  const langCount = settings.profile.supported_languages.length;
  const memberCount = settings.team.member_count;
  const aiSafe = !hasAutoSend(lanes);
  const whatsappLive = Boolean(settings.channels.whatsapp.connected && settings.channels.whatsapp.live);
  const signedInEmail =
    settings.team.members.find((m) => m.user_id === currentUserId)?.email ?? "";

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-3">
      {/* Setup status strip — readiness-driven (D2) when available, else the
          settings-derived checklist as a graceful fallback. */}
      {readiness ? (
        <SetupProgressSection readiness={readiness} />
      ) : (
        <ChecklistSection
          checklist={settings.setup_checklist}
          emailSendProven={settings.profile.send_proven}
          lanes={lanes}
          channels={settings.channels}
          workingHours={settings.config.working_hours}
        />
      )}

      {/* 1. Agency profile & branding (open) */}
      <AccordionSection
        defaultOpen
        icon={<ImageIcon className="h-[18px] w-[18px]" />}
        title={ta("brandingTitle")}
        subtitle={settings.branding.brand_name || ta("brandingSubtitle")}
        status={<StatusDot />}
      >
        <BrandingSection branding={settings.branding} />
      </AccordionSection>

      {/* 2. AI behaviour & approvals */}
      <AccordionSection
        icon={<SlidersHorizontal className="h-[18px] w-[18px]" />}
        title={ta("aiTitle")}
        subtitle={ta("aiSubtitle")}
        status={aiSafe ? <StatusDot /> : <StatusTag tone="warn">{ta("statusReview")}</StatusTag>}
      >
        <AiSection branding={settings.branding} initialLanes={lanes} />
      </AccordionSection>

      {/* 3. Channels & sending identity */}
      <AccordionSection
        icon={<Mail className="h-[18px] w-[18px]" />}
        title={ta("channelsTitle")}
        subtitle={ta("channelsSubtitle")}
        status={whatsappLive ? <StatusDot /> : <StatusTag tone="warn">{ta("statusRepliesOff")}</StatusTag>}
      >
        <ChannelsSection
          channels={settings.channels}
          sendingDomain={settings.profile.sending_domain}
          fromEmail={settings.profile.from_email}
          replyTo={settings.profile.reply_to}
          providers={readiness?.providers}
        />
      </AccordionSection>

      {/* 4. Languages & working hours */}
      <AccordionSection
        icon={<Globe className="h-[18px] w-[18px]" />}
        title={ta("languagesTitle")}
        subtitle={ta("languagesSubtitle", { count: langCount })}
        status={<StatusDot />}
      >
        <LanguagesSection
          initial={settings.profile.supported_languages}
          translationTarget={settings.translation_target_language}
          initialWorkingHours={settings.config.working_hours}
          initialTimezone={settings.config.timezone}
        />
      </AccordionSection>

      {/* 5. Team & access */}
      <AccordionSection
        icon={<Users className="h-[18px] w-[18px]" />}
        title={ta("teamTitle")}
        subtitle={ta("teamSubtitle", { count: memberCount })}
        status={<StatusTag tone="warn">{ta("statusInviteAgents")}</StatusTag>}
      >
        <TeamSection team={settings.team} currentUserId={currentUserId} />
      </AccordionSection>

      {/* 6. Plan & preferences */}
      <AccordionSection
        icon={<CreditCard className="h-[18px] w-[18px]" />}
        title={ta("planTitle")}
        subtitle={ta("planSubtitle", { tier: settings.plan_tier })}
        status={<span className="rounded-full bg-muted px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground">{settings.plan_tier}</span>}
      >
        <PlanPrefsSection
          planTier={settings.plan_tier}
          region={settings.profile.region ?? ""}
          dashboardLanguage={settings.dashboard_display_language}
          theme={preferences.theme}
          signedInEmail={signedInEmail}
        />
      </AccordionSection>

      <p className="px-1 pt-1 text-[11px] text-muted-foreground">{t("personalDescription")}</p>
    </div>
  );
}

function logFailure(scope: string, err: unknown): void {
  const detail =
    err instanceof ApiError ? `${err.status} ${err.message}` : err instanceof Error ? err.message : String(err);
  console.error(`[/settings] ${scope} fetch failed:`, detail);
}
