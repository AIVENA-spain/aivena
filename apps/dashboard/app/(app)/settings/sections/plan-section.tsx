"use client";

import { useTranslations } from "next-intl";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PlanTier, QuotaBlock, QuotaUsage } from "@/lib/api/types";

/**
 * Plan — display-only (v1.15.1 / v1.15.4). Shows the agency's tier + the four
 * monthly usage quotas. Tier changes are provisioning-only (Christian's call),
 * so there is deliberately no self-service tier-change control here. A null
 * quota renders as "Unlimited" (the tier convention). Numbers use the mono
 * face per the data-typography rule.
 */
const QUOTA_ORDER: Array<{ key: keyof QuotaBlock; labelKey: string }> = [
  { key: "voiceMinutes", labelKey: "quota_voiceMinutes" },
  { key: "adCreative", labelKey: "quota_adCreative" },
  { key: "socialPost", labelKey: "quota_socialPost" },
  { key: "renovation", labelKey: "quota_renovation" },
];

export function PlanSection({
  planTier,
  quotas,
}: {
  planTier: PlanTier;
  quotas: QuotaBlock;
}) {
  const t = useTranslations("settings.plan");

  return (
    <Card id="plan" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Tier badge */}
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
            {t("currentPlan")}
          </span>
          <span className="inline-flex items-center rounded-full border border-brand/30 bg-brand-soft px-3 py-1 text-[12px] font-semibold text-brand">
            {t(("tier_" + planTier) as TierKey)}
          </span>
        </div>

        {/* Usage rows */}
        <div className="flex flex-col gap-4">
          {QUOTA_ORDER.map(({ key, labelKey }) => (
            <QuotaRow
              key={key}
              label={t(labelKey as QuotaLabelKey)}
              usage={quotas[key]}
              unlimitedLabel={t("unlimited")}
              ofLabel={(used, quota) => t("usageOf", { used, quota })}
            />
          ))}
        </div>

        <p className="text-xs text-muted-foreground">{t("provisioningNote")}</p>
      </CardContent>
    </Card>
  );
}

function QuotaRow({
  label,
  usage,
  unlimitedLabel,
  ofLabel,
}: {
  label: string;
  usage: QuotaUsage;
  unlimitedLabel: string;
  ofLabel: (used: number, quota: number) => string;
}) {
  const quota = usage.quota;
  const pct =
    quota === null || quota === 0
      ? 0
      : Math.min(100, Math.round((usage.used / quota) * 100));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="font-mono text-[12px] text-muted-foreground">
          {quota === null ? unlimitedLabel : ofLabel(usage.used, quota)}
        </span>
      </div>
      {quota === null ? null : (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{ width: `${pct}%` }}
            aria-hidden
          />
        </div>
      )}
    </div>
  );
}

type TierKey = "tier_starter" | "tier_pro" | "tier_unlimited";
type QuotaLabelKey =
  | "quota_voiceMinutes"
  | "quota_adCreative"
  | "quota_socialPost"
  | "quota_renovation";
