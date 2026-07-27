"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, PhoneMissed, X, Info, ShieldCheck, Clock, Send } from "lucide-react";

import type { VoiceRecoveryFacts, VoiceCallRow } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { RelativeTime } from "@/components/ui/relative-time";
import {
  computeRecoveryReadiness,
  callRecoveryState,
  type Prereq,
  type CallRecoveryState,
} from "./voice-recovery-model";
import { sendRecoveryAction } from "./voice-actions";

// Recovery states where an agent can approve + send a text-back (missed, not yet
// sent, reachable non-opted-out contact). "waiting_setup" is included so the button
// is present and, on click, surfaces the exact missing reason (no provider yet).
const ACTIONABLE: ReadonlySet<CallRecoveryState> = new Set<CallRecoveryState>([
  "pending_approval",
  "pending_auto",
  "waiting_setup",
]);

export function CallsWorkspace({
  readiness: facts,
  calls,
}: {
  readiness: VoiceRecoveryFacts;
  calls: VoiceCallRow[];
}) {
  const t = useTranslations("calls");
  const r = computeRecoveryReadiness({ ...facts, auto_toggle: facts.auto_toggle });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {/* Readiness — the honest "ready except X" state of the text-back. */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
            <PhoneMissed className="h-4 w-4 text-muted-foreground" aria-hidden />
            {t("readinessTitle")}
          </h2>
          <HeadlinePill headline={r.headline} t={t} />
        </div>

        <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">
          {r.headline === "ready_auto"
            ? t("blurbAuto")
            : r.headline === "ready_approval"
              ? t("blurbApproval")
              : r.headline === "waiting"
                ? t("blurbWaiting")
                : t("blurbOff")}
        </p>

        {/* Prerequisite checklist — each item green when met, muted + reason when not. */}
        <ul className="mt-3 flex flex-col gap-1.5">
          <PrereqRow met={r.enabled} label={t("prereqEnable")} />
          <PrereqRow met={r.templateApproved} label={t("prereqTemplate")} />
          <PrereqRow met={r.providerLive} label={t("prereqProvider")} />
        </ul>

        {/* Mode — only meaningful once it can actually send. */}
        {r.canSend ? (
          <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-3 text-[12px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-brand" aria-hidden />
            <span>
              {t("modeLabel")}{" "}
              <span className="font-medium text-foreground">
                {r.autoSend ? t("modeAuto") : t("modeApproval")}
              </span>
            </span>
          </div>
        ) : null}
      </div>

      {/* Recent call log. */}
      <div className="flex flex-col gap-2">
        <h2 className="text-[14px] font-semibold text-foreground">{t("callsTitle")}</h2>
        {calls.length === 0 ? (
          <EmptyState icon={PhoneMissed} title={t("emptyTitle")} description={t("emptyBody")} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-[1.3fr_0.9fr_0.7fr_1fr] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>{t("colCaller")}</span>
              <span>{t("colWhen")}</span>
              <span>{t("colCall")}</span>
              <span>{t("colRecovery")}</span>
            </div>
            {calls.map((c) => {
              const state = callRecoveryState(
                {
                  id: c.id,
                  status: c.status,
                  from_number: c.from_number,
                  lead_id: c.lead_id,
                  lead_name: c.lead_name,
                  lead_opt_in: c.lead_opt_in,
                  recovery_sent: c.recovery_sent,
                },
                r,
              );
              return (
                <div
                  key={c.id}
                  className="grid grid-cols-[1.3fr_0.9fr_0.7fr_1fr] items-center gap-2 border-b border-border px-3 py-2.5 text-[12.5px] last:border-0"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-foreground">
                      {c.lead_name?.trim() || c.from_number || t("unknownCaller")}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    <RelativeTime iso={c.started_at ?? c.created_at} />
                  </span>
                  <CallStatusPill status={c.status} t={t} />
                  <div className="flex flex-col items-start gap-1">
                    <RecoveryPill state={state} t={t} />
                    {ACTIONABLE.has(state) ? <RecoveryAction callId={c.id} t={t} /> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

type Tr = ReturnType<typeof useTranslations>;

function HeadlinePill({
  headline,
  t,
}: {
  headline: "ready_auto" | "ready_approval" | "waiting" | "off";
  t: Tr;
}) {
  const map = {
    ready_auto: { cls: "bg-brand-soft text-brand", label: t("statusReadyAuto") },
    ready_approval: { cls: "bg-brand-soft text-brand", label: t("statusReadyApproval") },
    waiting: {
      cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
      label: t("statusWaiting"),
    },
    off: { cls: "bg-muted text-muted-foreground", label: t("statusOff") },
  } as const;
  const m = map[headline];
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium", m.cls)}>
      {m.label}
    </span>
  );
}

function PrereqRow({ met, label }: { met: boolean; label: string }) {
  return (
    <li className="flex items-start gap-2 text-[12.5px]">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
          met ? "bg-brand text-brand-fg" : "border border-amber-500/50 bg-amber-500/10 text-amber-600",
        )}
      >
        {met ? <Check className="h-3 w-3" /> : <X className="h-2.5 w-2.5" />}
      </span>
      <span className="text-foreground">{label}</span>
    </li>
  );
}

function CallStatusPill({ status, t }: { status: string; t: Tr }) {
  const known = ["ringing", "answered", "no_answer", "busy", "failed", "voicemail"].includes(status);
  const missed = status === "no_answer" || status === "voicemail";
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        missed
          ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
          : status === "answered"
            ? "bg-brand-soft text-brand"
            : "bg-muted text-muted-foreground",
      )}
    >
      {missed ? <PhoneMissed className="h-3 w-3" aria-hidden /> : null}
      {known ? t(("callStatus_" + status) as CallStatusKey) : status}
    </span>
  );
}

type CallStatusKey =
  | "callStatus_ringing" | "callStatus_answered" | "callStatus_no_answer"
  | "callStatus_busy" | "callStatus_failed" | "callStatus_voicemail";

/**
 * Approval-first "Send text-back" button for a recoverable missed call. On click it
 * asks the server to enqueue the WhatsApp text-back — which succeeds only when a
 * live provider + approved template exist; otherwise the server returns the exact
 * reason (e.g. "WhatsApp sending isn't connected yet") and we show it inline. So the
 * action is present + honest today, and it sends the moment the provider lands.
 */
function RecoveryAction({ callId, t }: { callId: string; t: Tr }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSend() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await sendRecoveryAction(callId);
    if (res.ok) {
      setBusy(false);
      router.refresh(); // the row's recovery flips to "Sent"
    } else {
      setError(res.error);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={onSend}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-60"
      >
        <Send className="h-3 w-3" aria-hidden />
        {busy ? t("sending") : t("sendTextBack")}
      </button>
      {error ? (
        <p className="max-w-[220px] text-[11px] leading-snug text-amber-700 dark:text-amber-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function RecoveryPill({ state, t }: { state: CallRecoveryState; t: Tr }) {
  if (state === "not_applicable") return <span className="text-[12px] text-muted-foreground">—</span>;

  const map: Record<
    Exclude<CallRecoveryState, "not_applicable">,
    { cls: string; icon: typeof Check | null }
  > = {
    sent: { cls: "bg-brand-soft text-brand", icon: Check },
    pending_auto: { cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300", icon: Clock },
    pending_approval: { cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300", icon: Clock },
    waiting_setup: { cls: "bg-muted text-muted-foreground", icon: Info },
    no_contact: { cls: "bg-muted text-muted-foreground", icon: null },
    opted_out: { cls: "bg-muted text-muted-foreground", icon: null },
  };
  const m = map[state];
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", m.cls)}>
      {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
      {t(("recovery_" + state) as RecoveryKey)}
    </span>
  );
}

type RecoveryKey =
  | "recovery_sent" | "recovery_pending_auto" | "recovery_pending_approval"
  | "recovery_waiting_setup" | "recovery_no_contact" | "recovery_opted_out";
