import { getTranslations } from "next-intl/server";
import { Check, AlertTriangle } from "lucide-react";

import type { ReplyLanes, SettingsResponse, WorkingHours } from "@/lib/api/types";
import { hasAutoSend } from "../automation-safety";

/**
 * Setup status strip — top of the Settings page. Six tiles, each driven by real
 * data and truthful: WhatsApp shows "Replies off" while not live; AI rules show
 * "Review" only if reply_rules still auto-sends; email is "Ready" only when a real
 * send is proven (send_proven — a successful Resend send), NEVER a faked
 * "domain verified" claim; hours derived from the working_hours config.
 */
const WH_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

export async function ChecklistSection({
  checklist,
  emailSendProven,
  lanes,
  channels,
  workingHours,
}: {
  checklist: SettingsResponse["setup_checklist"];
  emailSendProven: boolean;
  lanes: ReplyLanes | undefined;
  channels: SettingsResponse["channels"];
  workingHours: WorkingHours;
}) {
  const t = await getTranslations("settings.checklist");

  const aiReady = checklist.ai_rules_set.completed && !hasAutoSend(lanes);
  const whatsappLive = Boolean(channels.whatsapp.connected && channels.whatsapp.live);
  const whConfigured = WH_DAYS.some((d) => {
    const slot = (workingHours as Record<string, unknown> | null)?.[d];
    return Boolean(slot && typeof slot === "object" && (slot as { enabled?: boolean }).enabled === true);
  });

  const items: Array<{ key: string; label: string; done: boolean; status: string }> = [
    { key: "branding", label: t("stepBranding"), done: checklist.branding_added.completed, status: checklist.branding_added.completed ? t("stReady") : t("stActionNeeded") },
    // Honest: green only when a real send is proven (send_proven), never on the old
    // "from_email has an @domain" fake. "Ready" — we never claim "domain verified" (J3).
    { key: "domain", label: t("stepDomain"), done: emailSendProven, status: emailSendProven ? t("stReady") : t("stActionNeeded") },
    { key: "whatsapp", label: t("stepWhatsapp"), done: whatsappLive, status: whatsappLive ? t("stConnected") : t("stRepliesOff") },
    { key: "team", label: t("stepTeam"), done: checklist.team_invited.completed, status: checklist.team_invited.completed ? t("stReady") : t("stInviteAgents") },
    { key: "ai_rules", label: t("stepAiRules"), done: aiReady, status: aiReady ? t("stReady") : t("stReview") },
    { key: "working_hours", label: t("stepWorkingHours"), done: whConfigured, status: whConfigured ? t("stReady") : t("stActionNeeded") },
  ];

  const doneCount = items.filter((i) => i.done).length;
  const pct = Math.round((doneCount / items.length) * 100);

  return (
    <section className="rounded-xl bg-card text-card-foreground shadow-elevated ring-1 ring-foreground/10">
      <div className="flex flex-col gap-3.5 px-5 py-4">
        <div className="flex items-baseline gap-3">
          <span className="text-[14px] font-semibold text-foreground">{t("title")}</span>
          <span className="text-[12px] text-muted-foreground">{t("countComplete", { done: doneCount, total: items.length })}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} aria-hidden />
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          {items.map((it) => (
            <div key={it.key} className="flex items-center gap-2.5">
              <span
                aria-hidden
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                  it.done ? "bg-brand text-brand-fg" : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                }`}
              >
                {it.done ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[11.5px] font-semibold leading-tight text-foreground">{it.label}</span>
                <span className={`text-[10.5px] ${it.done ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300"}`}>{it.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
