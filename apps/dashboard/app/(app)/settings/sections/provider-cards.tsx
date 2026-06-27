"use client";

import { useTranslations } from "next-intl";
import { Mail, MessageSquare, Languages, CalendarDays, Building2 } from "lucide-react";

import type { ReadinessProviderId, ReadinessProviderState } from "@/lib/api/types";
import { statusLabelKey, statusTone, providerNameKey, type ChipTone } from "./readiness-display";

/**
 * Provider Connection cards (workboard D3) — honest per-provider readiness from
 * GET /api/v1/readiness. NO fake "connected": a provider whose signal is
 * unavailable/missing shows exactly that (e.g. WhatsApp = "Status unavailable"
 * while Chat 3's readiness RPC is undeployed). There are no Connect buttons yet
 * — the connect flows (Embedded Signup H3, Calendar OAuth L1) are separate builds.
 *
 * Localization (D9): provider names + status chips via settings.readiness.*; the
 * per-provider `detail` line is API-provided (English).
 */
const TONE_CLS: Record<ChipTone, string> = {
  good: "bg-brand-soft text-brand",
  info: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  muted: "bg-muted text-muted-foreground",
};

const ICON: Record<ReadinessProviderId, React.ReactNode> = {
  email: <Mail className="h-4 w-4" />,
  whatsapp: <MessageSquare className="h-4 w-4" />,
  whatsapp_templates_multilang: <Languages className="h-4 w-4" />,
  calendar: <CalendarDays className="h-4 w-4" />,
  property_feed: <Building2 className="h-4 w-4" />,
};

const ICON_CLS: Record<ReadinessProviderId, string> = {
  email: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  whatsapp: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  whatsapp_templates_multilang: "bg-purple-500/15 text-purple-600 dark:text-purple-300",
  calendar: "bg-blue-500/12 text-blue-600 dark:text-blue-300",
  property_feed: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

export function ProviderCards({ providers }: { providers: ReadinessProviderState[] }) {
  const t = useTranslations("settings.readiness");
  return (
    <div className="flex flex-col gap-1">
      {providers.map((p, i) => (
        <div
          key={p.provider}
          className={`flex items-center gap-3 py-2.5 ${i === 0 ? "" : "border-t border-border/60"}`}
        >
          <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${ICON_CLS[p.provider]}`}>
            {ICON[p.provider]}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-foreground">{t(`provider.${providerNameKey(p.provider)}`)}</div>
            <div className="truncate text-[11.5px] text-muted-foreground">{p.detail}</div>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-[10.5px] font-semibold ${TONE_CLS[statusTone(p.status)]}`}>
            {t(`status.${statusLabelKey(p.status)}`)}
          </span>
        </div>
      ))}
    </div>
  );
}
