"use client";

import { useCallback, useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Mail, MessageSquare, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveIdentityAction } from "../section-actions";
import { CalendarSection } from "./calendar-section";
import { ProviderCards } from "./provider-cards";
import type { SettingsResponse, ReadinessProviderState, CalendarStatusResponse } from "@/lib/api/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Channels & sending identity — accordion body. Channel rows are READ-ONLY
 * status: Email = domain verified, WhatsApp = connected · replies off, Social
 * = coming soon. Google Calendar is the one channel with a live agency-facing
 * connect path (Packet 2 · L2) — the CalendarSection card below the rows.
 * Reply-to is the one editable control (POST /identity →
 * agency_email_config.reply_to).
 */
type Status = "verified" | "repliesOff" | "comingSoon";

export function ChannelsSection({
  channels,
  sendingDomain,
  fromEmail,
  replyTo: initialReplyTo,
  providers,
  calendarStatus,
}: {
  channels: SettingsResponse["channels"];
  sendingDomain: string;
  fromEmail: string;
  replyTo: string;
  /** Live provider readiness (D3) from GET /api/v1/readiness; falls back to the
   *  static rows below when readiness can't load (e.g. non-owner 403). */
  providers?: ReadinessProviderState[];
  /** Google Calendar connection from GET /api/v1/calendar/status (soft-fail null). */
  calendarStatus: CalendarStatusResponse | null;
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

  const hasReadiness = Boolean(providers && providers.length > 0);

  return (
    <div className="flex flex-col gap-1">
      {hasReadiness ? (
        // D3 — live provider readiness from GET /api/v1/readiness (honest states).
        <ProviderCards providers={providers!} />
      ) : (
        // Fallback — static rows when readiness can't load (e.g. non-owner 403).
        <>
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
          {/* Calendar row intentionally absent here — the CalendarSection card
              below is the live status + connect control (L2). */}
          <Row
            icon={<Sparkles className="h-4 w-4" />}
            iconCls="bg-purple-500/15 text-purple-600 dark:text-purple-300"
            name={t("social")}
            sub={t("socialSub")}
            status="comingSoon"
          />
        </>
      )}

      {/* Google Calendar — the one channel with a live connect path (L2). */}
      <div className="mt-3 border-t border-border/60 pt-4">
        <CalendarSection status={calendarStatus} />
      </div>

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
