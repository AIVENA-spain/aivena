import { getTranslations } from "next-intl/server";

import { apiFetch, ApiError } from "@/lib/api/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageLoadError } from "@/components/shell/page-error";
import { getCurrentUserContext } from "@/lib/auth/context";
import type { SettingsResponse } from "@/lib/api/types";

import { PreferencesForm } from "./preferences-form";
import { ChecklistSection } from "./sections/checklist-section";
import { PlanSection } from "./sections/plan-section";
import { BrandingAndVoiceSection } from "./sections/branding-section";
import { IdentitySection } from "./sections/identity-section";
import { AiRulesSection } from "./sections/ai-rules-section";
import { LanguagesSection } from "./sections/languages-section";
import { ChannelsSection } from "./sections/channels-section";
import { TeamSection } from "./sections/team-section";

export const dynamic = "force-dynamic";

type PreferencesResponse = {
  uiLanguage: string;
  messageLanguage: string;
  theme: string;
};

const FALLBACK_PREFERENCES: PreferencesResponse = {
  uiLanguage: "en",
  messageLanguage: "en",
  theme: "system",
};

/**
 * Settings — the operator's whole agency in one page. Server-rendered shell;
 * each section is its own client island where interactivity is required.
 *
 * Data sources (both fetched in parallel inside the agency-context tx):
 *   - `/api/v1/settings`             → dashboard_settings(0) (Vega's contract)
 *   - `/api/v1/me/preferences`       → the caller's own user_preferences row
 *
 * Failure model: any infrastructure-level failure ( the API down, schema cache
 * cold) shows the canonical friendly PageLoadError. Per-section save errors
 * are surfaced inline by each client section.
 */
export default async function SettingsPage() {
  const t = await getTranslations("settings");

  const [settingsRes, prefsRes, ctx] = await Promise.allSettled([
    apiFetch<SettingsResponse>("/api/v1/settings"),
    apiFetch<PreferencesResponse>("/api/v1/me/preferences"),
    getCurrentUserContext(),
  ]);

  if (settingsRes.status === "rejected") {
    logFailure("settings", settingsRes.reason);
    return <PageLoadError />;
  }
  const settings = settingsRes.value;

  const preferences =
    prefsRes.status === "fulfilled" ? prefsRes.value : FALLBACK_PREFERENCES;
  if (prefsRes.status === "rejected") {
    logFailure("preferences", prefsRes.reason);
  }

  const currentUserId =
    ctx.status === "fulfilled" && ctx.value ? ctx.value.userId : "";
  const role =
    ctx.status === "fulfilled" && ctx.value
      ? ctx.value.activeAgency?.role ?? null
      : null;
  const isOwner = role === "owner";

  return (
    <div className="flex flex-col gap-6">
      {/* Personal */}
      <Card id="personal" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>{t("personal")}</CardTitle>
          <CardDescription>{t("personalDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <PreferencesForm initial={preferences} />
        </CardContent>
      </Card>

      <ChecklistSection checklist={settings.setup_checklist} />

      <PlanSection planTier={settings.plan_tier} quotas={settings.quotas} />

      <BrandingAndVoiceSection branding={settings.branding} />

      <IdentitySection profile={settings.profile} />

      <AiRulesSection
        initialToggles={settings.config.dashboard_toggles}
        initialWorkingHours={settings.config.working_hours}
        initialTimezone={settings.config.timezone}
      />

      <LanguagesSection
        initial={settings.profile.supported_languages}
        translationTarget={settings.translation_target_language}
        dashboardDisplay={settings.dashboard_display_language}
        canEditDefault={isOwner}
      />

      <ChannelsSection
        channels={settings.channels}
        sendingDomain={settings.profile.sending_domain}
      />

      <TeamSection team={settings.team} currentUserId={currentUserId} />
    </div>
  );
}

function logFailure(scope: string, err: unknown): void {
  const detail =
    err instanceof ApiError
      ? `${err.status} ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  console.error(`[/settings] ${scope} fetch failed:`, detail);
}
