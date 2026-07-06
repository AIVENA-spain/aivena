"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  User,
  Zap,
  CalendarClock,
  MessageCircle,
  Lock,
  type LucideIcon,
} from "lucide-react";

import type { InboxRow, LeadIntel, WhatsappState } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/ui/relative-time";
import { langLabel, typeLabel } from "@/app/(app)/matches/_shared";
import { LeadNotes } from "./lead-notes";
import { MatchedProperties } from "@/app/(app)/matches/matched-properties";
import { getLeadIntelAction, getLeadWhatsappStateAction } from "./lead-intel-actions";
import { nextActionBullets } from "./client-intelligence-lib";

/**
 * Client Intelligence — the right third column of /approvals (Day-2). A wide,
 * grouped panel: header + window pill · Buyer Profile (2-col label/value rows) ·
 * Next Best Action (bullets) · Matched Property + Why (side-by-side) · Notes ·
 * Follow-up · Conversation. Buyer-profile / next-action / follow-up come from the
 * read-only /leads/:leadId/intel contract; the WhatsApp window comes straight
 * from dashboard_lead_whatsapp_state (window_open is authoritative — never
 * recomputed). Day-3 fields (motivation/objections/best angle) are omitted here.
 */
type IntelState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: LeadIntel };

type WaState =
  | { kind: "off" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; data: WhatsappState | null };

export function ClientIntelligence({
  lead,
  authors,
  onSuggested,
}: {
  lead: InboxRow;
  authors?: Record<string, string>;
  onSuggested?: (taskId: string) => void;
}) {
  const t = useTranslations("inbox.intel");
  const [intel, setIntel] = useState<IntelState>({ kind: "loading" });

  const isWhatsapp = (lead.channel ?? "").toLowerCase().includes("whatsapp");
  const [wa, setWa] = useState<WaState>(
    isWhatsapp ? { kind: "loading" } : { kind: "off" },
  );

  useEffect(() => {
    let alive = true;
    setIntel({ kind: "loading" });
    getLeadIntelAction(lead.leadId).then((res) => {
      if (!alive) return;
      setIntel(
        res.ok
          ? { kind: "ready", data: res.data }
          : { kind: "error", message: res.error },
      );
    });
    return () => {
      alive = false;
    };
  }, [lead.leadId]);

  useEffect(() => {
    if (!isWhatsapp) {
      setWa({ kind: "off" });
      return;
    }
    let alive = true;
    setWa({ kind: "loading" });
    getLeadWhatsappStateAction(lead.leadId).then((res) => {
      if (!alive) return;
      setWa(res.ok ? { kind: "ready", data: res.data } : { kind: "error" });
    });
    return () => {
      alive = false;
    };
  }, [lead.leadId, isWhatsapp]);

  const data = intel.kind === "ready" ? intel.data : null;
  const loading = intel.kind === "loading";

  // Authoritative window read — true only when we KNOW it is closed.
  const windowOpen = wa.kind === "ready" && wa.data ? wa.data.window_open : null;
  const windowClosed = isWhatsapp && windowOpen === false;

  // Panel order (Chat-2 acceptance §8): Buyer Profile · Next Best Action ·
  // Matched + Why · Notes · Follow-up · Conversation.
  return (
    <div className="@container flex flex-col gap-2.5">
      {/* Panel header + window pill */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold tracking-tight text-foreground">
          {t("clientIntelligence")}
        </h2>
        {windowClosed ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            <Lock className="h-3 w-3" aria-hidden />
            {t("windowClosedPill")}
          </span>
        ) : null}
      </div>

      <BuyerProfile lead={lead} data={data} loading={loading} t={t} />
      <NextBestAction data={data} loading={loading} t={t} />

      <MatchedProperties
        key={"m-" + lead.leadId}
        leadId={lead.leadId}
        leadName={lead.fullName}
        onSuggested={onSuggested}
        windowClosed={windowClosed}
      />

      {/* Lower compact sections, side-by-side when the panel is wide enough.
          Notes gets the most room (it has the composer), per the mockup. */}
      <div className="grid items-start gap-x-5 gap-y-0 @[440px]:grid-cols-[1.3fr_0.85fr_1fr]">
        <LeadNotes key={lead.leadId} leadId={lead.leadId} authors={authors} />
        <FollowUp data={data} loading={loading} t={t} />
        <Conversation lead={lead} t={t} windowOpen={windowOpen} />
      </div>
    </div>
  );
}

type Tr = ReturnType<typeof useTranslations>;

// ── small presentational primitives ────────────────────────────────────────

function SectionHeader({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <h3 className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.01em] text-foreground">
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
      {title}
    </h3>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-3">
      <SectionHeader icon={icon} title={title} />
      {children}
    </section>
  );
}

/** Bulleted label/value row (green dot · label · value), value "—" when null. */
function BulletRow({
  label,
  value,
  loading,
  hint,
}: {
  label: string;
  value: string | null;
  loading?: boolean;
  hint?: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[12px] leading-none">
      <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
        {label}
      </span>
      {loading ? (
        <span className="inline-block h-3 w-16 animate-pulse rounded bg-muted" />
      ) : (
        <span className="min-w-0 truncate text-right font-semibold text-foreground">
          {value ?? "—"}
          {hint ? <span className="ml-1 font-normal text-muted-foreground">{hint}</span> : null}
        </span>
      )}
    </div>
  );
}

// ── value formatters (honest: null → null, caller renders "—") ──────────────

function fmtEur(n: number | string | null): string | null {
  if (n == null) return null;
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num)) return String(n);
  return `€${num.toLocaleString("en-GB")}`;
}
function fmtBedrooms(min: number | null, max: number | null): string | null {
  if (min != null && max != null) return min === max ? `${min}` : `${min}–${max}`;
  if (min != null) return `${min}+`;
  if (max != null) return `≤ ${max}`;
  return null;
}
function fmtBathrooms(min: number | null): string | null {
  return min != null ? `${min}+` : null;
}
function titleCaseWord(s: string | null): string | null {
  if (!s) return null;
  const w = s.trim();
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : null;
}

/** "manual_whatsapp_call" → "Manual WhatsApp call" (WhatsApp casing preserved). */
function friendlyChannel(slug: string | null): string | null {
  if (!slug) return null;
  const known: Record<string, string> = {
    manual_whatsapp_call: "Manual WhatsApp call",
    whatsapp: "WhatsApp",
    email: "Email",
    phone_call: "Phone call",
    call: "Call",
  };
  if (known[slug]) return known[slug];
  return slug
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w, i) =>
      w.toLowerCase() === "whatsapp"
        ? "WhatsApp"
        : i === 0
          ? w.charAt(0).toUpperCase() + w.slice(1)
          : w,
    )
    .join(" ");
}

// reasonBullets + the budget-contradiction guard now live in
// ./client-intelligence-lib (pure + unit-tested) — see nextActionBullets.

// ── 1. Buyer Profile (2-col label/value rows) ────────────────────────────────

function BuyerProfile({
  lead,
  data,
  loading,
  t,
}: {
  lead: InboxRow;
  data: LeadIntel | null;
  loading: boolean;
  t: Tr;
}) {
  const scoreVal =
    lead.score != null
      ? lead.temperature
        ? `${lead.score} · ${titleCaseWord(lead.temperature.replace(/_/g, " "))}`
        : `${lead.score}`
      : lead.temperature
        ? titleCaseWord(lead.temperature.replace(/_/g, " "))
        : null;

  return (
    <Section icon={User} title={t("buyerProfileHeading")}>
      <div className="grid gap-x-8 gap-y-1 @[320px]:grid-cols-2">
        <div className="flex flex-col gap-1">
          <BulletRow label={t("type")} value={lead.leadType ? typeLabel(lead.leadType) : null} />
          <BulletRow label={t("score")} value={scoreVal} />
          <BulletRow label={t("urgency")} value={titleCaseWord(data?.urgency ?? null)} loading={loading} />
          <BulletRow label={t("timeframe")} value={titleCaseWord(data?.timeframe ?? null)} loading={loading} />
        </div>
        <div className="flex flex-col gap-1">
          <BulletRow label={t("budget")} value={fmtEur(data?.budget_extracted ?? null)} loading={loading} />
          <BulletRow label={t("location")} value={data?.location_interest_extracted ?? null} loading={loading} />
          <BulletRow label={t("bedrooms")} value={fmtBedrooms(data?.bedrooms_min ?? null, data?.bedrooms_max ?? null)} loading={loading} />
          <BulletRow label={t("bathrooms")} value={fmtBathrooms(data?.bathrooms_min ?? null)} loading={loading} />
          <BulletRow label={t("propertyType")} value={data?.property_type_pref ? typeLabel(data.property_type_pref) : null} loading={loading} />
          <BulletRow label={t("language")} value={langLabel(lead.language)} />
        </div>
      </div>
    </Section>
  );
}

// ── 2. Next Best Action (bullets) ────────────────────────────────────────────

function NextBestAction({
  data,
  loading,
  t,
}: {
  data: LeadIntel | null;
  loading: boolean;
  t: Tr;
}) {
  const channel = friendlyChannel(data?.recommended_channel ?? null);
  // Bug 2: drop stale "no budget info" clauses when the lead's budget IS known,
  // so Next-best-action can't contradict the Budget row shown above.
  const bullets = nextActionBullets(data?.reasoning_summary ?? null, data?.budget_extracted ?? null);
  const hasAny = !!channel || bullets.length > 0 || !!data?.next_action;

  return (
    <Section icon={Zap} title={t("nextActionHeading")}>
      {loading ? (
        <div className="h-3.5 w-44 animate-pulse rounded bg-muted" />
      ) : !hasAny ? (
        <p className="text-[12px] text-muted-foreground">{t("noAction")}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-[12.5px] leading-snug">
          {channel ? (
            <li className="flex items-start gap-2.5">
              <span className="mt-[6px] h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
              <span className="text-foreground">
                <span className="font-semibold">{t("recommended")}:</span> {channel}
              </span>
            </li>
          ) : null}
          {bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="mt-[6px] h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
              <span className="text-muted-foreground">{b}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ── 5. Tasks / Follow-up (read-only) ─────────────────────────────────────────

function FollowUp({
  data,
  loading,
  t,
}: {
  data: LeadIntel | null;
  loading: boolean;
  t: Tr;
}) {
  const paused = data?.followup_paused === true;
  const next = data?.next_followup_at ?? null;

  return (
    <Section icon={CalendarClock} title={t("followUpHeading")}>
      {loading ? (
        <div className="h-3.5 w-28 animate-pulse rounded bg-muted" />
      ) : (
        <ul className="flex flex-col gap-1.5 text-[12px]">
          <li className="flex items-baseline gap-2 leading-tight">
            <span
              className={cn(
                "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                paused ? "bg-amber-500" : "bg-brand",
              )}
              aria-hidden
            />
            <span className={paused ? "text-muted-foreground" : "text-foreground"}>
              {paused ? t("followUpPaused") : t("followUpActive")}
            </span>
          </li>
          <li className="flex items-baseline gap-2 leading-tight">
            <span
              className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40"
              aria-hidden
            />
            <span className="text-muted-foreground">
              {next ? (
                <>
                  {t("nextFollowUp")} <RelativeTime iso={next} className="text-foreground" />
                </>
              ) : (
                t("noFollowUp")
              )}
            </span>
          </li>
        </ul>
      )}
    </Section>
  );
}

// ── 6. Conversation / WhatsApp status ────────────────────────────────────────

function Conversation({
  lead,
  t,
  windowOpen,
}: {
  lead: InboxRow;
  t: Tr;
  /** From dashboard_lead_whatsapp_state; null when not WhatsApp / unknown. */
  windowOpen: boolean | null;
}) {
  const isWhatsapp = (lead.channel ?? "").toLowerCase().includes("whatsapp");
  return (
    <Section icon={MessageCircle} title={t("conversationHeading")}>
      <div className="flex flex-col gap-1.5 text-[11.5px] leading-none">
        <div className="flex items-baseline justify-between gap-2">
          <span className="shrink-0 text-muted-foreground">{t("channel")}</span>
          <span className="truncate font-medium text-foreground">
            {friendlyChannel(lead.channel ?? null) ?? "—"}
          </span>
        </div>
        {isWhatsapp ? (
          <div className="flex items-baseline justify-between gap-2">
            <span className="shrink-0 text-muted-foreground">{t("whatsappWindow")}</span>
            <span
              className={cn(
                "font-medium",
                windowOpen === false
                  ? "text-amber-700 dark:text-amber-400"
                  : windowOpen
                    ? "text-brand"
                    : "text-foreground",
              )}
            >
              {windowOpen == null ? "—" : windowOpen ? t("windowOpen") : t("windowClosed")}
            </span>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-2">
          <span className="shrink-0 text-muted-foreground">{t("lastInbound")}</span>
          <span className="font-medium text-foreground">
            {lead.latestInboundAt ? <RelativeTime iso={lead.latestInboundAt} /> : "—"}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="shrink-0 text-muted-foreground">{t("lastOutbound")}</span>
          <span className="font-medium text-foreground">
            {lead.lastOutboundAt ? <RelativeTime iso={lead.lastOutboundAt} /> : "—"}
          </span>
        </div>
      </div>
      {/* The authoritative 24h SEND gate stays in the composer (centre pane);
          this read-only mirror uses the same RPC. */}
    </Section>
  );
}
