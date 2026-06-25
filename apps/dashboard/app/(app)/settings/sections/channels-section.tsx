"use client";

import { useCallback, useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Mail, MessageSquare, CalendarDays, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveIdentityAction } from "../section-actions";
import type { SettingsResponse } from "@/lib/api/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Channels & sending identity — accordion body. Channel rows are READ-ONLY
 * status (no Connect buttons — none have a live agency-facing connect path):
 * Email = domain verified, WhatsApp = connected · replies off, Calendar/Social
 * = coming soon. Reply-to is the one editable control (POST /identity →
 * agency_email_config.reply_to).
 */
type Status = "verified" | "repliesOff" | "comingSoon";

export function ChannelsSection({
  channels,
  sendingDomain,
  fromEmail,
  replyTo: initialReplyTo,
}: {
  channels: SettingsResponse["channels"];
  sendingDomain: string;
  fromEmail: string;
  replyTo: string;
}) {
  const t = useTranslations("settings.channels");
  const ti = useTranslations("settings.identity");

  const replyToId = useId();
  const [replyTo, setReplyTo] = useState(initialReplyTo ?? "");
  const [savingReply, startSavingReply] = useTransition();
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySavedAt, setReplySavedAt] = useState<number | null>(null);

  const onSaveReplyTo = useCallback(() => {
    setReplyError(null);
    if (!EMAIL_RE.test(replyTo.trim())) {
      setReplyError(ti("replyToLabel"));
      return;
    }
    startSavingReply(async () => {
      const res = await saveIdentityAction(replyTo.trim());
      if (res.ok) setReplySavedAt(Date.now());
      else setReplyError(res.error);
    });
  }, [replyTo, ti]);

  const emailStatus: Status = sendingDomain ? "verified" : "comingSoon";
  const whatsappStatus: Status = channels.whatsapp.live ? "verified" : "repliesOff";

  return (
    <div className="flex flex-col gap-1">
      <Row
        icon={<Mail className="h-4 w-4" />}
        iconCls="bg-blue-500/15 text-blue-600 dark:text-blue-300"
        name={t("email")}
        sub={fromEmail ? `${sendingDomain || "—"} · ${fromEmail}` : sendingDomain || "—"}
        status={emailStatus}
        first
      />
      <Row
        icon={<MessageSquare className="h-4 w-4" />}
        iconCls="bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
        name={t("whatsapp")}
        sub={t("whatsappSub")}
        status={whatsappStatus}
      />
      <Row
        icon={<CalendarDays className="h-4 w-4" />}
        iconCls="bg-blue-500/12 text-blue-600 dark:text-blue-300"
        name={t("calendar")}
        sub={t("calendarSub")}
        status="comingSoon"
      />
      <Row
        icon={<Sparkles className="h-4 w-4" />}
        iconCls="bg-purple-500/15 text-purple-600 dark:text-purple-300"
        name={t("social")}
        sub={t("socialSub")}
        status="comingSoon"
      />

      {/* Reply-to — the one editable control (sending domain stays read-only) */}
      <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-4">
        <Label htmlFor={replyToId}>{ti("replyToLabel")}</Label>
        <div className="flex items-center gap-2">
          <Input id={replyToId} type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} className="max-w-sm" spellCheck={false} />
          <Button type="button" size="sm" onClick={onSaveReplyTo} disabled={savingReply}>{ti("saveBtn")}</Button>
        </div>
        <p className="text-[11px] text-muted-foreground">{t("replyToHint")}</p>
        {replyError ? (
          <p className="text-xs text-red-600 dark:text-red-300" role="alert">{replyError}</p>
        ) : replySavedAt ? (
          <p className="text-xs text-brand" aria-live="polite">{ti("savedToast")}</p>
        ) : null}
      </div>
    </div>
  );
}

function Row({
  icon,
  iconCls,
  name,
  sub,
  status,
  first,
}: {
  icon: React.ReactNode;
  iconCls: string;
  name: string;
  sub: string;
  status: Status;
  first?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 py-2.5 ${first ? "" : "border-t border-border/60"}`}>
      <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconCls}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-foreground">{name}</div>
        <div className="truncate text-[11.5px] text-muted-foreground">{sub}</div>
      </div>
      <StatusPill status={status} />
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const t = useTranslations("settings.channels");
  const map: Record<Status, { label: string; cls: string }> = {
    verified: { label: t("pillVerified"), cls: "bg-brand-soft text-brand" },
    repliesOff: { label: t("pillRepliesOff"), cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
    comingSoon: { label: t("pillComingSoon"), cls: "bg-muted text-muted-foreground" },
  };
  const { label, cls } = map[status];
  return <span className={`shrink-0 rounded-full px-3 py-1 text-[10.5px] font-semibold ${cls}`}>{label}</span>;
}
