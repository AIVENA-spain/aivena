import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  Image as ImageIcon,
  Mail,
  Users,
  CreditCard,
  Building2,
  ArrowRight,
} from "lucide-react";

import { apiFetch, ApiError } from "@/lib/api/client";
import { PageLoadError } from "@/components/shell/page-error";
import { getCurrentUserContext } from "@/lib/auth/context";
import { intlLocaleFor } from "@/lib/i18n/date-locale";
import {
  formatLanguage,
  humanizeToken,
} from "@/app/(app)/overview/overview-format";
import type {
  SettingsResponse,
  ReadinessResponse,
  WorkingHours,
} from "@/lib/api/types";

import { StatusDot, StatusTag } from "./accordion";
import { hasAutoSend } from "./automation-safety";
import { ChecklistSection } from "./sections/checklist-section";
import { SetupProgressSection } from "./sections/setup-progress-section";
import { BrandingSection } from "./sections/branding-section";
import { AiSection } from "./sections/ai-section";
import { ChannelsSection } from "./sections/channels-section";
import { LanguagesSection } from "./sections/languages-section";
import { TeamSection } from "./sections/team-section";
import { PlanPrefsSection } from "./sections/plan-prefs-section";
import { CatalogueSection } from "./sections/catalogue-section";
import { isDone } from "./sections/readiness-display";
import { SettingsCards, FactRow, type SettingsCardDef } from "./settings-cards";

export const dynamic = "force-dynamic";

type PreferencesResponse = { uiLanguage: string; messageLanguage: string; theme: string };
const FALLBACK_PREFERENCES: PreferencesResponse = { uiLanguage: "en", messageLanguage: "en", theme: "system" };

/**
 * Settings — compact agency control center (2026 compactness pass).
 * Summary-first: Setup health + five small overview cards (Agency profile /
 * Client communication / Property catalogue / Team & access / Plan & pilot),
 * each showing status + 1–2 facts + one action. The full section forms are
 * UNCHANGED and mount only when a card is expanded — no behavior, validation,
 * provider, or readiness logic changes. Honest by construction: every status
 * and fact comes from the same live signals the old accordions showed.
 */
export default async function SettingsPage() {
  const t = await getTranslations("settings");
  const ta = await getTranslations("settings.accordion");
  const tc = await getTranslations("settings.cards");
  const locale = intlLocaleFor(await getLocale());

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
  // ChecklistSection. Never block the page on it.
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

  // Property-catalogue readiness rows (O5 catalog.* signals) — read-only display.
  const catalogItems = readiness
    ? readiness.items.filter(
        (it) => it.id.startsWith("catalog") || it.area === "catalog",
      )
    : [];
  const catalogDone = catalogItems.filter((it) => isDone(it.status)).length;
  const catalogAllGood = catalogItems.length > 0 && catalogDone === catalogItems.length;

  const branding = settings.branding;
  const hoursCompact = formatHoursCompact(settings.config.working_hours, locale);
  const websiteCompact = branding.website_url
    ? branding.website_url.replace(/^https?:\/\//, "").replace(/\/$/, "")
    : null;

  const cards: SettingsCardDef[] = [
    // 1. Agency profile — compact identity summary; full form behind Edit.
    {
      id: "profile",
      icon: <ImageIcon className="h-4 w-4" />,
      title: ta("brandingTitle"),
      status: branding.brand_name ? (
        <StatusDot />
      ) : (
        <StatusTag tone="warn">{ta("statusInProgress")}</StatusTag>
      ),
      facts: (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5 pb-1">
            {branding.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.logo_url}
                alt=""
                className="h-8 w-8 shrink-0 rounded-lg border border-border object-contain"
              />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-[13px] font-bold text-background">
                {(branding.brand_name || settings.profile.name || "A").charAt(0)}
              </span>
            )}
            <span className="min-w-0 truncate text-[13.5px] font-semibold text-foreground">
              {branding.brand_name || settings.profile.name}
            </span>
            <span
              aria-hidden
              className="ml-auto h-4 w-4 shrink-0 rounded-full border border-border"
              style={{ backgroundColor: branding.primary_color }}
              title={branding.primary_color}
            />
          </div>
          <FactRow label={tc("phoneLabel")} value={branding.phone ?? "—"} />
          <FactRow label={tc("websiteLabel")} value={websiteCompact ?? "—"} />
        </div>
      ),
      expandLabel: tc("edit"),
      closeLabel: tc("close"),
      children: <BrandingSection branding={branding} />,
    },

    // 2. Client communication — compact status rows; the three full sections
    // (AI behaviour, channels, languages/hours) mount on expand, unchanged.
    {
      id: "communication",
      icon: <Mail className="h-4 w-4" />,
      title: ta("groupCommunication"),
      status:
        aiSafe && whatsappLive ? (
          <StatusDot />
        ) : (
          <StatusTag tone="warn">
            {whatsappLive ? ta("statusReview") : ta("statusRepliesOff")}
          </StatusTag>
        ),
      facts: (
        <div className="flex flex-col">
          <FactRow
            label={tc("approvalMode")}
            value={aiSafe ? tc("approvalFirst") : tc("autoSendOn")}
            tone={aiSafe ? "good" : "warn"}
          />
          <FactRow
            label={tc("emailLabel")}
            value={settings.profile.send_proven ? tc("ready") : tc("inProgress")}
            tone={settings.profile.send_proven ? "good" : "warn"}
          />
          <FactRow
            label={tc("whatsappLabel")}
            value={whatsappLive ? tc("ready") : tc("repliesOff")}
            tone={whatsappLive ? "good" : "warn"}
          />
          <FactRow
            label={tc("languagesLabel")}
            value={tc("languagesActive", { count: langCount })}
          />
          <FactRow label={tc("hoursLabel")} value={hoursCompact ?? "—"} />
        </div>
      ),
      expandLabel: tc("edit"),
      closeLabel: tc("close"),
      children: (
        <div className="flex flex-col gap-6">
          <AiSection branding={branding} initialLanes={lanes} />
          <div className="border-t border-border/60 pt-5">
            <ChannelsSection
              channels={settings.channels}
              sendingDomain={settings.profile.sending_domain}
              fromEmail={settings.profile.from_email}
              replyTo={settings.profile.reply_to}
              providers={readiness?.providers}
            />
          </div>
          <div className="border-t border-border/60 pt-5">
            <LanguagesSection
              initial={settings.profile.supported_languages}
              translationTarget={settings.translation_target_language}
              initialWorkingHours={settings.config.working_hours}
              initialTimezone={settings.config.timezone}
            />
          </div>
        </div>
      ),
    },

    // 3. Property catalogue — friendly summary; detail rows + technical copy
    // only on expand. Management lives on the Properties page.
    {
      id: "catalogue",
      icon: <Building2 className="h-4 w-4" />,
      title: ta("catalogueTitle"),
      status: catalogAllGood ? (
        <StatusDot />
      ) : (
        <StatusTag tone="warn">{ta("statusInProgress")}</StatusTag>
      ),
      facts: (
        <div className="flex flex-col">
          {catalogItems.length > 0 ? (
            <FactRow
              label={ta("catalogueSubtitle")}
              value={tc("checksComplete", {
                done: catalogDone,
                total: catalogItems.length,
              })}
              tone={catalogAllGood ? "good" : "warn"}
            />
          ) : (
            <p className="py-[3px] text-muted-foreground">
              {ta("catalogueUnavailable")}
            </p>
          )}
        </div>
      ),
      expandLabel: tc("viewDetails"),
      closeLabel: tc("close"),
      extraAction: (
        <Link
          href="/properties"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {ta("catalogueOpenProperties")}
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      ),
      children: <CatalogueSection items={catalogItems} />,
    },

    // 4. Team & access — compact count + pilot note.
    {
      id: "team",
      icon: <Users className="h-4 w-4" />,
      title: ta("teamTitle"),
      status:
        memberCount > 1 ? (
          <StatusDot />
        ) : (
          <StatusTag tone="neutral">{tc("pilotBadge")}</StatusTag>
        ),
      facts: (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">
            {tc("teamMembers", { count: memberCount })}
          </span>
          <span className="text-muted-foreground">{tc("pilotInvites")}</span>
        </div>
      ),
      expandLabel: tc("manage"),
      closeLabel: tc("close"),
      children: <TeamSection team={settings.team} currentUserId={currentUserId} />,
    },

    // 5. Plan & pilot — compact read-only summary.
    {
      id: "plan",
      icon: <CreditCard className="h-4 w-4" />,
      title: ta("planTitle"),
      status: (
        <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground">
          {settings.plan_tier}
        </span>
      ),
      facts: (
        <div className="flex flex-col">
          <FactRow
            label={tc("planLabel")}
            value={humanizeToken(settings.plan_tier) ?? "—"}
          />
          <FactRow
            label={tc("regionLabel")}
            value={humanizeToken(settings.profile.region) ?? "—"}
          />
          <FactRow label={tc("billingLabel")} value={tc("billingManaged")} />
          <FactRow
            label={tc("dashLangLabel")}
            value={formatLanguage(settings.dashboard_display_language) ?? "English"}
          />
          <FactRow
            label={tc("appearanceLabel")}
            value={humanizeToken(preferences.theme) ?? "System"}
          />
        </div>
      ),
      expandLabel: tc("edit"),
      closeLabel: tc("close"),
      children: (
        <PlanPrefsSection
          planTier={settings.plan_tier}
          region={settings.profile.region ?? ""}
          dashboardLanguage={settings.dashboard_display_language}
          theme={preferences.theme}
          signedInEmail={signedInEmail}
        />
      ),
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col gap-3">
      {/* Setup health — readiness-driven when available, else the settings-
          derived checklist as a graceful fallback. */}
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

      <SettingsCards cards={cards} />

      <p className="px-1 pt-1 text-[11px] text-muted-foreground">{t("personalDescription")}</p>
    </div>
  );
}

/** "Mon–Fri 09:00–18:00" style compact summary of the working-hours config.
 *  Locale-aware day abbreviations; "varies" when enabled days differ. */
function formatHoursCompact(wh: WorkingHours, locale: string): string | null {
  const order = [
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  ] as const;
  const on = order.filter((d) => wh?.[d]?.enabled);
  if (on.length === 0) return null;
  // 2024-01-01 is a Monday — derive localized short weekday names from it.
  const dayAbbr = (d: (typeof order)[number]) =>
    new Date(Date.UTC(2024, 0, 1 + order.indexOf(d))).toLocaleDateString(locale, {
      weekday: "short",
      timeZone: "UTC",
    });
  const first = wh[on[0]];
  const uniform = on.every((d) => wh[d].start === first.start && wh[d].end === first.end);
  const idx = on.map((d) => order.indexOf(d));
  const contiguous = idx[idx.length - 1] - idx[0] + 1 === idx.length;
  const range =
    on.length === 1
      ? dayAbbr(on[0])
      : contiguous
        ? `${dayAbbr(on[0])}–${dayAbbr(on[on.length - 1])}`
        : `${on.length}d`;
  return uniform ? `${range} ${first.start}–${first.end}` : range;
}

function logFailure(scope: string, err: unknown): void {
  const detail =
    err instanceof ApiError ? `${err.status} ${err.message}` : err instanceof Error ? err.message : String(err);
  console.error(`[/settings] ${scope} fetch failed:`, detail);
}
