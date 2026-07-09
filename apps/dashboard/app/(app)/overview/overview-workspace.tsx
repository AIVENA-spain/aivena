"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Flame,
  Globe,
  Home,
  Inbox,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  PhoneCall,
  Pencil,
  Send,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { leadStatusTone } from "@/lib/ui-tone";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { approveTaskAction } from "@/app/(app)/approvals/[taskId]/actions";
import { replyWindowState } from "@/app/(app)/overview/overview-window-model";
import {
  formatChannel,
  formatLanguage,
  formatLeadType,
  formatSource,
  formatTemperatureScore,
} from "@/app/(app)/overview/overview-format";
import type {
  ActivityRow,
  NeedsYouRow,
  OverviewKpisResponse,
} from "@/lib/api/types";

// ---------- formatting helpers ----------

function initialsOf(value: string | null | undefined): string {
  if (!value) return "—";
  const parts = value.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0]! + parts[parts.length - 1][0]!).toUpperCase();
  }
  return value.trim().slice(0, 2).toUpperCase();
}

function avatarTone(seed: string | null | undefined): string {
  const tones = [
    "bg-blue-500",
    "bg-violet-500",
    "bg-amber-600",
    "bg-rose-600",
    "bg-emerald-600",
    "bg-sky-600",
    "bg-orange-500",
  ];
  if (!seed) return tones[0];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return tones[Math.abs(hash) % tones.length];
}


// ---------- channel + event icons ----------

const CHANNEL_ICON: Record<string, LucideIcon> = {
  email: Mail,
  whatsapp: MessageCircle,
  instagram: MessageCircle,
  phone: Phone,
  web: Globe,
  website: Globe,
};

function ChannelIcon({ channel }: { channel: string | null }) {
  const key = (channel ?? "").toLowerCase();
  const Icon = CHANNEL_ICON[key] ?? Mail;
  return <Icon className="h-3.5 w-3.5" aria-hidden strokeWidth={1.8} />;
}

const EVENT_ICON: Record<string, LucideIcon> = {
  followup_sent: Send,
  reply_received: MessageSquare,
  task_approved: CheckCircle2,
  lead_received: UserPlus,
  human_alert_sent: Bell,
};

function EventIcon({
  eventType,
  channel,
}: {
  eventType: string;
  channel: string | null;
}) {
  const Icon =
    EVENT_ICON[eventType] ??
    CHANNEL_ICON[(channel ?? "").toLowerCase()] ??
    Globe;
  return <Icon className="h-4 w-4" aria-hidden strokeWidth={1.8} />;
}

// ---------- status pill ----------

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  // Redesign: delegate to the shared Badge + semantic tone (green=active,
  // amber=needs-attention, slate=auto-handled) — no more rose/violet rainbow.
  return (
    <Badge tone={leadStatusTone(status)} size="sm" uppercase>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

// ---------- KPI card ----------

// Per Christian's approved mockups (2026-07-09): each KPI carries a soft
// colored icon chip (blue/amber/rose/violet/green) on a white card.
type KpiTone = "blue" | "amber" | "rose" | "violet" | "green" | "muted";

const KPI_TONE: Record<KpiTone, string> = {
  blue: "bg-blue-500/12 text-blue-600 dark:text-blue-300",
  amber: "bg-amber-500/12 text-amber-600 dark:text-amber-300",
  rose: "bg-rose-500/12 text-rose-600 dark:text-rose-300",
  violet: "bg-violet-500/12 text-violet-600 dark:text-violet-300",
  green: "bg-brand-soft text-brand",
  muted: "bg-muted text-muted-foreground",
};

function KpiCard({
  icon: Icon,
  tone,
  label,
  value,
  delta,
  vsLabel,
  soonLabel,
  soonTeaser,
}: {
  icon: LucideIcon;
  tone: KpiTone;
  label: string;
  value: number;
  /** When set, an arrow + |delta| + vsLabel is rendered. */
  delta?: number;
  vsLabel?: string;
  /** When set, the card is rendered in its honest-empty-state form: greyed
      number, "Soon" pill, subtext, no delta arrow. */
  soonLabel?: string;
  soonTeaser?: string;
}) {
  const isSoon = Boolean(soonLabel);
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-3 px-4">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]",
              KPI_TONE[tone],
            )}
          >
            <Icon className="h-4 w-4" aria-hidden strokeWidth={1.9} />
          </div>
          <span className="text-[11.5px] font-medium leading-tight text-muted-foreground">
            {label}
          </span>
          {isSoon ? (
            <span className="ml-auto whitespace-nowrap rounded-full bg-muted px-1.5 py-[2px] font-mono text-[8.5px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
              {soonLabel}
            </span>
          ) : null}
        </div>
        <div
          className={cn(
            // Overview KPI numerals: bold upright sans, confident & data-like.
            // (Instrument Serif italic is reserved for the Performance hero
            // stat per §3.3, not used here.)
            "font-sans font-bold leading-none tracking-[-0.03em]",
            "text-[26px] sm:text-[32px]",
            isSoon ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {value}
        </div>
        {isSoon ? (
          <div className="text-[10.5px] text-muted-foreground">
            {soonTeaser}
          </div>
        ) : typeof delta === "number" ? (
          <div
            className={cn(
              "flex items-center gap-1 text-[11px] font-medium",
              delta > 0
                ? "text-brand"
                : delta < 0
                  ? "text-rose-600 dark:text-rose-300"
                  : "text-muted-foreground",
            )}
          >
            {delta > 0 ? (
              <ArrowUpRight className="h-3 w-3" aria-hidden />
            ) : delta < 0 ? (
              <ArrowDownRight className="h-3 w-3" aria-hidden />
            ) : (
              <ArrowRight className="h-3 w-3" aria-hidden />
            )}
            <span>{Math.abs(delta)}</span>
            {vsLabel ? (
              <span className="font-normal text-muted-foreground">
                {" "}
                {vsLabel}
              </span>
            ) : null}
          </div>
        ) : (
          // No delta to show and not Soon — reserve the same vertical rhythm.
          <div className="h-[14px]" aria-hidden />
        )}
      </CardContent>
    </Card>
  );
}

// ---------- workspace ----------

export function OverviewWorkspace({
  locale,
  kpis,
  needsYou,
  activity,
}: {
  locale: string;
  kpis: OverviewKpisResponse | null;
  needsYou: NeedsYouRow[];
  activity: ActivityRow[];
}) {
  const t = useTranslations("overview");

  const sortedNeeds = useMemo(() => {
    // Newest first — the freshest lead reply belongs at the top (priority is
    // still visible via the row badges).
    const copy = [...needsYou];
    copy.sort(
      (a, b) =>
        new Date(b.taskCreatedAt).getTime() -
        new Date(a.taskCreatedAt).getTime(),
    );
    return copy;
  }, [needsYou]);

  const [selectedId, setSelectedId] = useState<string | null>(
    sortedNeeds[0]?.taskId ?? null,
  );
  const selected =
    sortedNeeds.find((r) => r.taskId === selectedId) ?? null;

  const vsLabel = t("kpi.vsLast7Days");
  const soonLabel = t("kpi.soon");

  return (
    <div className="flex flex-col gap-3.5">
      {/* 6-card KPI row */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          icon={Users}
          tone="blue"
          label={t("kpi.newLeads")}
          value={kpis?.new_buyers.value ?? 0}
          delta={kpis?.new_buyers.delta}
          vsLabel={vsLabel}
        />
        <KpiCard
          icon={Bell}
          tone="amber"
          label={t("kpi.needsAction")}
          value={kpis?.needs_you.value ?? 0}
        />
        <KpiCard
          icon={Flame}
          tone="rose"
          label={t("kpi.hotLeads")}
          value={kpis?.hot_leads.value ?? 0}
        />
        <KpiCard
          icon={Home}
          tone="muted"
          label={t("kpi.newSellers")}
          value={kpis?.new_sellers.value ?? 0}
          soonLabel={soonLabel}
          soonTeaser={t("kpi.sellersTeaser")}
        />
        <KpiCard
          icon={Send}
          tone="violet"
          label={t("kpi.followupsSent")}
          value={kpis?.followups_sent.value ?? 0}
          delta={kpis?.followups_sent.delta}
          vsLabel={vsLabel}
        />
        {/*
          Calls Recovered — voice_calls pipeline isn't live yet (no Twilio/Vapi
          ingest writes to it). Per the design plan §3.1, render as an honest
          empty state, not a metric. Do NOT bind to a number.
        */}
        <KpiCard
          icon={PhoneCall}
          tone="muted"
          label={t("kpi.callsRecovered")}
          value={0}
          soonLabel={soonLabel}
          soonTeaser={t("kpi.callsTeaser")}
        />
      </section>

      {/*
        Two columns, content-driven heights. Left = Needs Action stacked over
        Recent Activity; right = Selected Lead stacked over Network. items-start
        ensures the columns don't stretch to match each other, so with one lead
        the table is short and Recent Activity pulls straight up beneath it —
        no reserved void in the middle of the page.
      */}
      <section className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-3">
        <div className="flex flex-col gap-3.5 lg:col-span-2">
          <NeedsYouCard
            rows={sortedNeeds}
            selectedId={selectedId}
            onSelect={setSelectedId}
            locale={locale}
          />
          <RecentActivityCard rows={activity} locale={locale} />
        </div>
        <div className="flex flex-col gap-3.5 lg:col-span-1">
          <SelectedLeadPanel lead={selected} />
          <NetworkPreviewCard />
        </div>
      </section>
    </div>
  );
}

// ---------- needs you table ----------

function NeedsYouCard({
  rows,
  selectedId,
  onSelect,
  locale,
}: {
  rows: NeedsYouRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  locale: string;
}) {
  const t = useTranslations("overview.needsAction");

  return (
    <Card size="sm">
      <CardHeader className="border-b border-border px-4 pb-3">
        <CardTitle className="flex items-center gap-2 text-[14px] font-bold">
          <span>{t("title")}</span>
          {rows.length > 0 ? (
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-semibold text-brand">
              {rows.length}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={t("emptyTitle")}
            description={t("emptyText")}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-[12.5px]">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[11%]" />
                <col className="w-[16%]" />
                <col className="w-[8%]" />
                <col className="w-[12%]" />
                <col className="w-[23%]" />
              </colgroup>
              <thead>
                <tr className="text-[10.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                  <th className="px-4 py-2.5 text-left">{t("columnLead")}</th>
                  <th className="px-2 py-2.5 text-left">{t("columnType")}</th>
                  <th className="px-2 py-2.5 text-left">{t("columnArea")}</th>
                  <th className="px-2 py-2.5 text-left">
                    {t("columnChannel")}
                  </th>
                  <th className="px-2 py-2.5 text-left">{t("columnStatus")}</th>
                  <th className="px-4 py-2.5 text-left">{t("columnReply")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isSel = r.taskId === selectedId;
                  return (
                    <tr
                      key={r.taskId}
                      onClick={() => onSelect(r.taskId)}
                      className={cn(
                        "cursor-pointer border-t border-border transition-colors",
                        isSel ? "bg-brand-soft" : "hover:bg-muted/50",
                      )}
                    >
                      <td className="px-4 py-3 align-middle">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span
                            className={cn(
                              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold text-white",
                              avatarTone(r.fullName ?? r.leadId),
                            )}
                          >
                            {initialsOf(r.fullName ?? "Unknown")}
                          </span>
                          <div className="flex min-w-0 flex-col leading-tight">
                            <span className="truncate font-semibold text-foreground">
                              {r.fullName ?? "Unknown"}
                            </span>
                            <RelativeTime
                              iso={r.taskCreatedAt}
                              className="truncate font-mono text-[10px] text-muted-foreground"
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-3 align-middle text-muted-foreground">
                        {formatLeadType(r.leadType) ?? t("leadTypeDefault")}
                      </td>
                      <td className="truncate px-2 py-3 align-middle text-muted-foreground">
                        {r.area ?? "—"}
                      </td>
                      <td className="px-2 py-3 align-middle">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          <ChannelIcon channel={r.channel} />
                        </span>
                      </td>
                      <td className="px-2 py-3 align-middle">
                        <StatusPill status={r.leadStatus} />
                      </td>
                      <td className="px-4 py-3 align-middle">
                        {replyWindowState(r.channel, r.whatsappWindowOpen)
                          .windowClosed ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-300">
                            <Clock className="h-3 w-3" aria-hidden />
                            {t("windowClosed")}
                          </span>
                        ) : (
                          <div className="truncate text-foreground">
                            <span className="mr-1.5 font-mono text-[9px] font-bold text-brand">
                              {t("aiTag")}
                            </span>
                            {r.aiReplyBody ?? "—"}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- selected lead panel ----------

function SelectedLeadPanel({ lead }: { lead: NeedsYouRow | null }) {
  const t = useTranslations("overview.panel");
  const [copied, setCopied] = useState(false);
  const [sendState, sendAction, sending] = useActionState(
    approveTaskAction,
    {},
  );

  if (!lead) {
    return (
      <Card size="sm">
        <EmptyState
          icon={Users}
          title={t("noSelection")}
          description={t("selectALead")}
        />
      </Card>
    );
  }

  function handleCopy() {
    if (!lead?.aiReplyBody) return;
    navigator.clipboard
      .writeText(lead.aiReplyBody)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  const f = t.raw("fields") as Record<string, string>;
  // WhatsApp 24h window: outside it the free-text draft is NOT sendable — mirror the
  // Inbox by routing to an approved check-in / re-engage instead of the stale draft.
  const win = replyWindowState(lead.channel, lead.whatsappWindowOpen);

  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-4 px-5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-white",
              avatarTone(lead.fullName ?? lead.leadId),
            )}
          >
            {initialsOf(lead.fullName ?? "Unknown")}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[15px] font-bold text-foreground">
                {lead.fullName ?? "Unknown"}
              </span>
              <StatusPill status={lead.leadStatus} />
            </div>
            {formatTemperatureScore(
              lead.temperature,
              lead.score,
              t("leadScore"),
            ) ? (
              <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                {formatTemperatureScore(
                  lead.temperature,
                  lead.score,
                  t("leadScore"),
                )}
              </div>
            ) : null}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3 text-[12.5px]">
          <PanelRow
            label={f.type}
            value={formatLeadType(lead.leadType) ?? t("leadTypeDefault")}
          />
          <PanelRow label={f.area} value={lead.area ?? "—"} />
          <PanelRow label={f.source} value={formatSource(lead.source) ?? "—"} />
          <PanelRow
            label={f.language}
            value={formatLanguage(lead.language) ?? "—"}
          />
          <PanelRow label={f.channel} value={formatChannel(lead.channel) ?? "—"} />
        </dl>

        {win.windowClosed ? (
          <div
            role="note"
            className="flex items-start gap-2 rounded-[11px] border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-[12px] leading-[1.5] text-amber-800 dark:text-amber-200"
          >
            <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{t("windowClosedNotice")}</span>
          </div>
        ) : null}

        <div
          className={cn(
            "rounded-[11px] border px-3.5 py-3",
            win.windowClosed
              ? "border-border bg-muted/40"
              : "border-brand/20 bg-brand-soft",
          )}
        >
          <div
            className={cn(
              "mb-1.5 flex items-center gap-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.05em]",
              win.windowClosed ? "text-muted-foreground" : "text-brand",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                win.windowClosed ? "bg-muted-foreground" : "bg-brand",
              )}
            />
            {win.windowClosed ? t("previousSuggestion") : t("aiSuggested")}
          </div>
          {win.windowClosed ? (
            <div className="text-[11.5px] font-semibold text-foreground">
              {lead.aiReplySubject ?? t("previousDraft")}
            </div>
          ) : lead.aiReplySubject ? (
            <div className="text-[11.5px] font-semibold text-foreground">
              {lead.aiReplySubject}
            </div>
          ) : null}
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-[1.5] text-foreground">
            {lead.aiReplyBody ?? ""}
          </p>
        </div>

        {sendState.error ? (
          <div
            role="alert"
            className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-700 dark:text-rose-300"
          >
            {sendState.error}
          </div>
        ) : null}

        {win.windowClosed ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/approvals?lead=${lead.taskId}`}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand px-3 py-2 text-[12.5px] font-semibold text-brand-fg transition-colors hover:bg-brand/90"
            >
              <Send className="h-3.5 w-3.5" aria-hidden />
              {t("reengage")}
              <ExternalLink className="h-3 w-3 opacity-70" aria-hidden />
            </Link>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <form action={sendAction} className="flex-1">
              <input type="hidden" name="taskId" value={lead.taskId} />
              <input
                type="hidden"
                name="subject"
                value={lead.aiReplySubject ?? ""}
              />
              <input
                type="hidden"
                name="body"
                value={lead.aiReplyBody ?? ""}
              />
              <Button
                type="submit"
                className="w-full gap-1.5"
                disabled={sending || !lead.aiReplyBody}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full bg-brand"
                  aria-hidden
                />
                {t("send")}
              </Button>
            </form>
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              onClick={handleCopy}
              disabled={!lead.aiReplyBody}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden />
              )}
              {copied ? t("copied") : t("copy")}
            </Button>
            <Link
              href={`/approvals?lead=${lead.taskId}`}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              {t("openInInbox")}
              <ExternalLink className="h-3 w-3 opacity-60" aria-hidden />
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PanelRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-mono text-[9.5px] uppercase tracking-[0.05em] text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate font-semibold text-foreground">{value}</dd>
    </div>
  );
}

// ---------- recent activity (capped, with inline expand) ----------

const ACTIVITY_VISIBLE = 6;

function RecentActivityCard({
  rows,
  locale,
}: {
  rows: ActivityRow[];
  locale: string;
}) {
  const t = useTranslations("overview.activity");
  const [expanded, setExpanded] = useState(false);

  const hasMore = rows.length > ACTIVITY_VISIBLE;
  const visible = expanded ? rows : rows.slice(0, ACTIVITY_VISIBLE);

  return (
    <Card size="sm">
      <CardHeader className="border-b border-border px-4 pb-3">
        <CardTitle className="text-[14px] font-bold">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {visible.length === 0 ? (
          <EmptyState icon={Activity} title={t("empty")} />
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((r) => (
              <li
                key={r.eventId}
                className="flex items-start gap-3 px-4 py-2.5"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <EventIcon eventType={r.eventType} channel={r.channel} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col leading-snug">
                  <span className="truncate text-[12.5px] text-foreground">
                    {r.label}
                  </span>
                  {r.fullName ? (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {r.fullName}
                    </span>
                  ) : null}
                  {r.excerptTranslated || r.excerpt ? (
                    // Owner-language translation first, original as fallback.
                    <span className="line-clamp-2 text-[11px] italic text-muted-foreground/80">
                      “{r.excerptTranslated ?? r.excerpt}”
                    </span>
                  ) : null}
                </div>
                <RelativeTime
                  iso={r.occurredAt}
                  className="whitespace-nowrap font-mono text-[10px] text-muted-foreground"
                />
              </li>
            ))}
          </ul>
        )}
        {/*
          Inline expand/collapse — stays on Overview, no navigation. The "view
          all" link previously routed to /approvals; per step-3 fix it now
          toggles the visible row count between ACTIVITY_VISIBLE and rows.length.
        */}
        {hasMore ? (
          <div className="border-t border-border px-4 py-2.5">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-[12px] font-semibold text-brand hover:underline"
            >
              {expanded ? t("showLess") : t("viewAll")}
            </button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------- network teaser ----------

function NetworkPreviewCard() {
  const t = useTranslations("overview.network");
  return (
    <Card size="sm">
      <CardHeader className="border-b border-border px-4 pb-3">
        <CardTitle className="flex items-center gap-2 text-[14px] font-bold">
          <span>{t("title")}</span>
          <span className="ml-auto whitespace-nowrap rounded-full bg-muted px-2 py-[2px] font-mono text-[8.5px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
            {t("comingSoon")}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5">
        <div className="text-[13px] font-semibold text-foreground">
          {t("teaserTitle")}
        </div>
        <p className="mt-1.5 text-[12.5px] leading-[1.55] text-muted-foreground">
          {t("teaser")}
        </p>
      </CardContent>
    </Card>
  );
}
