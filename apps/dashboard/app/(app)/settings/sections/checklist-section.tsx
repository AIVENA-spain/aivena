import { getTranslations } from "next-intl/server";
import { Check } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SettingsResponse } from "@/lib/api/types";

/**
 * "Finish setting up" — five honest rows driven by setup_checklist. Green tick
 * + muted label when completed; amber ! and a right-side action button that
 * scrolls to the relevant section when not. Domain-verified intentionally has
 * no action button (per the Vera brief — you can't action a domain verify
 * from inside this page).
 */

type Item = "domain_verified" | "branding_added" | "ai_rules_set" | "team_invited" | "whatsapp_connected";

export async function ChecklistSection({
  checklist,
}: {
  checklist: SettingsResponse["setup_checklist"];
}) {
  const t = await getTranslations("settings.checklist");

  const rows: Array<{
    key: Item;
    label: string;
    completed: boolean;
    actionHref: string | null;
    actionLabel: string | null;
  }> = [
    {
      key: "domain_verified",
      label: t("domainVerified"),
      completed: checklist.domain_verified.completed,
      actionHref: null,
      actionLabel: null,
    },
    {
      key: "branding_added",
      label: t("brandingAdded"),
      completed: checklist.branding_added.completed,
      actionHref: "#branding",
      actionLabel: t("actionAdd"),
    },
    {
      key: "ai_rules_set",
      label: t("aiRulesSet"),
      completed: checklist.ai_rules_set.completed,
      actionHref: "#ai-rules",
      actionLabel: t("actionAdd"),
    },
    {
      key: "team_invited",
      label: t("teamInvited"),
      completed: checklist.team_invited.completed,
      actionHref: "#team",
      actionLabel: t("actionInvite"),
    },
    {
      key: "whatsapp_connected",
      label: t("whatsappConnected"),
      completed: checklist.whatsapp_connected.completed,
      actionHref: "#channels",
      actionLabel: t("actionConnect"),
    },
  ];

  return (
    <Card className="border-brand/30">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        {rows.map((row, idx) => (
          <div
            key={row.key}
            className={`flex items-center gap-3 py-2.5 ${
              idx > 0 ? "border-t border-border/60" : ""
            }`}
          >
            <span
              aria-hidden
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                row.completed
                  ? "bg-brand-soft text-brand"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
              }`}
            >
              {row.completed ? <Check className="h-3.5 w-3.5" /> : "!"}
            </span>
            <span
              className={`text-[13px] ${row.completed ? "text-muted-foreground" : "text-foreground"}`}
            >
              {row.label}
            </span>
            {row.actionHref && !row.completed ? (
              <a
                href={row.actionHref}
                className="ml-auto rounded-md border border-border bg-card px-3 py-1 text-[11.5px] font-medium text-foreground shadow-soft hover:bg-muted"
              >
                {row.actionLabel}
              </a>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
