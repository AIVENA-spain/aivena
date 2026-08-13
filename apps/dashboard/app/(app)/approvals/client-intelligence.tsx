"use client";

import { useEffect, useState } from "react";
import { useNow, useTranslations } from "next-intl";
import {
  Sparkles,
  RefreshCw,
  MessageCircle,
  Lock,
  Wallet,
  Gauge,
  Flame,
  CalendarClock,
  MapPin,
  BedDouble,
  Bath,
  Home,
  Languages,
  Pencil,
  Wrench,
  ChevronDown,
  Send,
  Check,
  type LucideIcon,
} from "lucide-react";

import type { ContactReadiness, InboxRow, LeadIntel } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/ui/relative-time";
import { Button } from "@/components/ui/button";
import { langLabel, typeLabel } from "@/app/(app)/matches/_shared";
import { LeadNotes } from "./lead-notes";
import { MatchedProperties } from "@/app/(app)/matches/matched-properties";
import {
  getLeadIntelAction,
  getLeadWhatsappStateAction,
  getLeadContactReadinessAction,
  getLeadBriefSummaryAction,
  requestTemplateAction,
} from "./lead-intel-actions";
import { BuyerProfileEdit } from "./buyer-profile-edit";
import type { EditablePrefs } from "./buyer-profile-edit-model";
import {
  contactBlockNotice,
  deriveContactGate,
  gateBlocksAllSends,
  languageName,
  type ContactBlockNotice,
  type ContactGate,
} from "./contact-gate";

/**
 * AIVENA Brief — the right column of /approvals. A calm decision panel (not a
 * CRM data dump), in this order: natural summary → contactability → recommended
 * next step → buyer profile (tiles) → top match + why → notes/follow-up →
 * technical details. Every contactability/next-step statement obeys the same
 * get_lead_contact_readiness truth the composer does; the summary is generated
 * server-side (LLM-primary, deterministic-fallback, grounded on facts only).
 */
type IntelState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: LeadIntel };

type WaOpen = boolean | null;

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
  const [editVersion, setEditVersion] = useState(0);

  const isWhatsapp = (lead.channel ?? "").toLowerCase().includes("whatsapp");
  const [waOpen, setWaOpen] = useState<WaOpen>(null);
  const [waResolved, setWaResolved] = useState(false);
  const [readiness, setReadiness] = useState<ContactReadiness | null>(null);
  const [readinessResolved, setReadinessResolved] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [briefVersion, setBriefVersion] = useState(0);

  // Intel (buyer profile + follow-up) — reloads after a profile edit.
  useEffect(() => {
    let alive = true;
    setIntel({ kind: "loading" });
    getLeadIntelAction(lead.leadId).then((res) => {
      if (!alive) return;
      setIntel(res.ok ? { kind: "ready", data: res.data } : { kind: "error", message: res.error });
    });
    return () => {
      alive = false;
    };
  }, [lead.leadId, editVersion]);

  // WhatsApp window + deterministic readiness — two fetches; the gate is trusted
  // only once BOTH resolve (never flash a stale/false state).
  useEffect(() => {
    if (!isWhatsapp) {
      setWaOpen(null);
      setWaResolved(true);
      setReadiness(null);
      setReadinessResolved(true);
      return;
    }
    let alive = true;
    setWaResolved(false);
    setReadinessResolved(false);
    getLeadWhatsappStateAction(lead.leadId).then((res) => {
      if (!alive) return;
      setWaOpen(res.ok && res.data ? res.data.window_open : null);
      setWaResolved(true);
    });
    getLeadContactReadinessAction(lead.leadId).then((res) => {
      if (!alive) return;
      setReadiness(res.ok ? res.data : null);
      setReadinessResolved(true);
    });
    return () => {
      alive = false;
    };
    // latestInboundAt in deps: when a new buyer message arrives the window/gate
    // can flip open, so refetch rather than drift stale vs the composer.
  }, [lead.leadId, isWhatsapp, lead.latestInboundAt]);

  // Brief summary (LLM-primary, deterministic fallback server-side). Refetched on
  // lead change, on profile edit, and on the "Refresh brief" button.
  useEffect(() => {
    let alive = true;
    setSummary(null);
    setSummaryLoading(true);
    getLeadBriefSummaryAction(lead.leadId).then((res) => {
      if (!alive) return;
      setSummary(res.ok ? res.data.summary : null);
      setSummaryLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [lead.leadId, editVersion, briefVersion]);

  const data = intel.kind === "ready" ? intel.data : null;
  const loading = intel.kind === "loading";

  const windowClosed = isWhatsapp && waOpen === false;
  const contactResolved = !isWhatsapp || (waResolved && readinessResolved);
  const gate = deriveContactGate(readiness, windowClosed, isWhatsapp);
  const langName = languageName(readiness?.lead_language_normalized ?? lead.language);
  const firstName = (lead.fullName ?? "").trim().split(/\s+/)[0] || "this buyer";
  const block: ContactBlockNotice =
    isWhatsapp && contactResolved ? contactBlockNotice(gate, langName) : null;

  // Suggest fails closed until contact resolves, then when the window is closed
  // or a hard gate forbids all contact.
  const suggestDisabled =
    isWhatsapp && (!contactResolved || windowClosed || gateBlocksAllSends(gate));
  const suggestReason: string | null = !suggestDisabled
    ? null
    : !contactResolved
      ? t("suggestChecking")
      : block
        ? t(block.suggestKey, { language: block.language, code: block.code, name: firstName })
        : gate.kind === "checkin_cooldown"
          ? t("suggestBlockCooldown", { name: firstName })
          : t("suggestGated");

  return (
    <div className="@container flex flex-col gap-3">
      <BriefHeader t={t} onRefresh={() => setBriefVersion((v) => v + 1)} />

      <SummaryCard summary={summary} loading={summaryLoading} t={t} />

      {isWhatsapp ? (
        <ContactabilityCard
          gate={gate}
          block={block}
          windowClosed={windowClosed}
          resolved={contactResolved}
          lastInboundAt={lead.latestInboundAt ?? readiness?.last_inbound_at ?? null}
          langName={langName}
          t={t}
        />
      ) : null}

      {isWhatsapp && contactResolved ? (
        <NextStepCard
          gate={gate}
          leadId={lead.leadId}
          firstName={firstName}
          langName={langName}
          t={t}
        />
      ) : null}

      <BuyerTiles
        lead={lead}
        data={data}
        loading={loading}
        t={t}
        onEdited={() => setEditVersion((v) => v + 1)}
      />

      <section className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3.5">
        <MatchedProperties
          key={"m-" + lead.leadId}
          leadId={lead.leadId}
          leadName={lead.fullName}
          onSuggested={onSuggested}
          suggestDisabled={suggestDisabled}
          suggestReason={suggestReason}
          refreshKey={`${lead.latestInboundAt ?? ""}:${editVersion}`}
          basedOn={data?.location_interest_extracted ?? null}
        />
      </section>

      <div className="grid items-start gap-3 @[440px]:grid-cols-2">
        <LeadNotes key={lead.leadId} leadId={lead.leadId} authors={authors} />
        <FollowUp data={data} loading={loading} t={t} />
      </div>

      {isWhatsapp ? (
        <TechnicalDetails lead={lead} readiness={readiness} waOpen={waOpen} t={t} />
      ) : null}
    </div>
  );
}

type Tr = ReturnType<typeof useTranslations>;

// ── header ──────────────────────────────────────────────────────────────────

function BriefHeader({ t, onRefresh }: { t: Tr; onRefresh: () => void }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
          <Sparkles className="h-4 w-4" aria-hidden strokeWidth={2} />
        </span>
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight text-foreground">
            {t("aivenaBrief")}
          </h2>
          <p className="text-[11.5px] text-muted-foreground">{t("briefSubtitle")}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11.5px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        {t("refreshBrief")}
      </button>
    </div>
  );
}

// ── 1. summary (green) ──────────────────────────────────────────────────────

function SummaryCard({ summary, loading, t }: { summary: string | null; loading: boolean; t: Tr }) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.05] p-3.5">
        <div className="flex flex-col gap-2">
          <div className="h-3 w-full animate-pulse rounded bg-emerald-500/15" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-emerald-500/15" />
          <p className="text-[11px] text-emerald-700/70 dark:text-emerald-300/70">{t("summarizing")}</p>
        </div>
      </div>
    );
  }
  if (!summary) return null;
  return (
    <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.05] p-3.5">
      {/* Plain text node — the summary is server-generated + guarded, never markup. */}
      <p className="text-[13px] leading-[1.55] text-foreground">{summary}</p>
    </div>
  );
}

// ── 2. contactability (pink when blocked, amber when reopenable, green when open) ──

function closedSinceLabel(iso: string | null, now: Date, t: Tr): string | null {
  if (!iso) return null;
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const days = Math.floor(ms / 86_400_000);
  if (days >= 14) return t("closedSinceWeeks", { n: Math.floor(days / 7) });
  if (days >= 1) return t("closedSinceDays", { n: days });
  return t("closedSinceToday");
}

function ContactabilityCard({
  gate,
  block,
  windowClosed,
  resolved,
  lastInboundAt,
  langName,
  t,
}: {
  gate: ContactGate;
  block: ContactBlockNotice;
  /** The single window truth from the parent (from waOpen) — same source the
   *  gate/Suggest use, so this card can never diverge from them. */
  windowClosed: boolean;
  resolved: boolean;
  lastInboundAt: string | null;
  langName: string;
  t: Tr;
}) {
  const now = useNow();
  const blocked = block != null;
  const cooldown = gate.kind === "checkin_cooldown";
  // Neutral until BOTH truths resolve; then block→pink, closed→amber, open→green.
  const tone: "muted" | "block" | "warn" | "ok" = !resolved
    ? "muted"
    : blocked
      ? "block"
      : windowClosed
        ? "warn"
        : "ok";

  const box =
    tone === "block"
      ? "border-rose-500/20 bg-rose-500/[0.06]"
      : tone === "warn"
        ? "border-amber-500/20 bg-amber-500/[0.05]"
        : tone === "ok"
          ? "border-emerald-500/15 bg-emerald-500/[0.05]"
          : "border-border bg-muted/40";
  const iconWrap =
    tone === "block"
      ? "bg-rose-500/15 text-rose-600 dark:text-rose-300"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-600 dark:text-amber-300"
        : tone === "ok"
          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
          : "bg-muted text-muted-foreground";

  const statusLine = !resolved
    ? t("contactChecking")
    : windowClosed
      ? t("statusWindowClosed")
      : t("statusWindowOpen");
  // Sub-line consumes the GATE (not a re-derived boolean) so cooldown, template
  // gaps, and reopenable states each read truthfully.
  const subLine = !resolved
    ? null
    : blocked
      ? block!.code
        ? t("subNoTemplate", { language: langName })
        : subForReason(gate, t)
      : cooldown
        ? t("subCooldown")
        : windowClosed
          ? t("subCheckinReopen")
          : t("subReplyNow");

  const bullets: string[] = [];
  if (blocked) {
    const since = closedSinceLabel(lastInboundAt, now, t);
    if (windowClosed && since) bullets.push(since);
    const reasonBullet = whyBullet(gate, langName, t);
    if (reasonBullet) bullets.push(reasonBullet);
  }

  return (
    <div className={cn("rounded-2xl border p-3.5", box)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", iconWrap)}>
            {tone === "ok" ? (
              <MessageCircle className="h-4 w-4" aria-hidden strokeWidth={2} />
            ) : (
              <Lock className="h-4 w-4" aria-hidden strokeWidth={2} />
            )}
          </span>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t("contactability")}
            </div>
            <div className="text-[13.5px] font-semibold text-foreground">{statusLine}</div>
            {subLine ? <div className="text-[12px] leading-snug text-muted-foreground">{subLine}</div> : null}
          </div>
        </div>
        {bullets.length > 0 ? (
          <div className="hidden max-w-[46%] shrink-0 flex-col gap-1 @[380px]:flex">
            <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{t("whyCantSend")}</div>
            {bullets.map((b, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-muted-foreground">
                <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden />
                <span>{b}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {bullets.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1 @[380px]:hidden">
          <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{t("whyCantSend")}</div>
          {bullets.map((b, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-muted-foreground">
              <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden />
              <span>{b}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function subForReason(gate: ContactGate, t: Tr): string | null {
  if (gate.kind !== "blocked") return null;
  switch (gate.reason) {
    case "opted_out":
      return t("subOptedOut");
    case "provider":
      return t("subProvider");
    case "phone":
      return t("subPhone");
    case "template_unregistered":
      return t("subUnregistered");
    default:
      return null;
  }
}

function whyBullet(gate: ContactGate, langName: string, t: Tr): string | null {
  if (gate.kind === "unverified") return t("whyUnverified");
  if (gate.kind !== "blocked") return null;
  switch (gate.reason) {
    case "no_template":
      return t("whyNoTemplate", { language: langName });
    case "template_unregistered":
      return t("whyUnregistered");
    case "opted_out":
      return t("whyOptedOut");
    case "provider":
      return t("whyProvider");
    case "phone":
      return t("whyPhone");
    default:
      return null;
  }
}

// ── 3. recommended next step (cream) ─────────────────────────────────────────

function NextStepCard({
  gate,
  leadId,
  firstName,
  langName,
  t,
}: {
  gate: ContactGate;
  leadId: string;
  firstName: string;
  langName: string;
  t: Tr;
}) {
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState<"done" | "already" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isTemplateGap =
    gate.kind === "blocked" && (gate.reason === "no_template" || gate.reason === "template_unregistered");

  const { title, hint } = nextStepCopy(gate, firstName, langName, t);
  if (!title) return null;

  async function handleRequest() {
    if (requesting || requested) return;
    setRequesting(true);
    setError(null);
    const res = await requestTemplateAction(leadId);
    if (res.ok) setRequested(res.data.deduped ? "already" : "done");
    else setError(res.error);
    setRequesting(false);
  }

  return (
    <div className="rounded-2xl border border-amber-500/15 bg-amber-500/[0.045] p-3.5">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-700 dark:text-amber-300/90">
        {t("recommendedNextStep")}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold text-foreground">{title}</div>
          {hint ? <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{hint}</p> : null}
        </div>
        {isTemplateGap ? (
          requested ? (
            <div className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[12px] font-medium text-emerald-700 dark:text-emerald-300">
              <Check className="h-3.5 w-3.5" aria-hidden strokeWidth={2.5} />
              {requested === "already" ? t("requestTemplateAlready") : t("requestTemplateDone")}
            </div>
          ) : (
            <Button type="button" size="sm" className="shrink-0 gap-1.5" disabled={requesting} onClick={handleRequest}>
              <Send className="h-3.5 w-3.5" aria-hidden />
              {requesting ? t("requesting") : t("requestTemplate")}
            </Button>
          )
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-[11.5px] text-rose-700 dark:text-rose-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function nextStepCopy(
  gate: ContactGate,
  firstName: string,
  langName: string,
  t: Tr,
): { title: string | null; hint: string | null } {
  switch (gate.kind) {
    case "normal":
      return { title: t("stepReply", { name: firstName }), hint: t("stepReplyHint") };
    case "checkin":
      return { title: t("stepCheckin"), hint: t("stepCheckinHint", { name: firstName }) };
    case "checkin_cooldown":
      return { title: t("stepWait", { name: firstName }), hint: null };
    case "unverified":
      return { title: null, hint: null };
    case "blocked":
      switch (gate.reason) {
        case "no_template":
        case "template_unregistered":
          return {
            title: t("stepGetApproval", { language: langName }),
            hint: t("stepGetApprovalHint", { name: firstName }),
          };
        case "opted_out":
          return { title: t("stepOptedOut"), hint: null };
        case "provider":
          return { title: t("stepProvider"), hint: null };
        case "phone":
          return { title: t("stepPhone", { name: firstName }), hint: null };
        default:
          return { title: null, hint: null };
      }
    default:
      return { title: null, hint: null };
  }
}

// ── 4. buyer profile tiles ───────────────────────────────────────────────────

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

function Tile({ icon: Icon, label, value, loading }: { icon: LucideIcon; label: string; value: string | null; loading?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
        <Icon className="h-3 w-3" aria-hidden strokeWidth={2} />
        {label}
      </div>
      {loading ? (
        <span className="h-3.5 w-14 animate-pulse rounded bg-muted" />
      ) : (
        <div className="truncate text-[13px] font-semibold text-foreground">{value ?? "—"}</div>
      )}
    </div>
  );
}

function BuyerTiles({
  lead,
  data,
  loading,
  t,
  onEdited,
}: {
  lead: InboxRow;
  data: LeadIntel | null;
  loading: boolean;
  t: Tr;
  onEdited: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const isBuyer = (lead.leadType ?? "buyer").toLowerCase() !== "seller";
  const canEdit = isBuyer && !loading && data != null;

  const scoreVal =
    lead.score != null
      ? lead.temperature
        ? `${lead.score} · ${titleCaseWord(lead.temperature.replace(/_/g, " "))}`
        : `${lead.score}`
      : lead.temperature
        ? titleCaseWord(lead.temperature.replace(/_/g, " "))
        : null;

  const original: EditablePrefs = {
    location_interest_extracted: data?.location_interest_extracted ?? null,
    budget_extracted: data?.budget_extracted ?? null,
    property_type_pref: data?.property_type_pref ?? null,
    bedrooms_min: data?.bedrooms_min ?? null,
    bedrooms_max: data?.bedrooms_max ?? null,
    bathrooms_min: data?.bathrooms_min ?? null,
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold tracking-tight text-foreground">{t("buyerProfileHeading")}</h3>
        {canEdit && !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pencil className="h-3 w-3" aria-hidden />
            {t("editPreferences")}
          </button>
        ) : null}
      </div>

      {editing ? (
        <BuyerProfileEdit
          leadId={lead.leadId}
          original={original}
          onSaved={() => {
            setEditing(false);
            onEdited();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="grid grid-cols-2 gap-2 @[360px]:grid-cols-3">
          <Tile icon={Wallet} label={t("budget")} value={fmtEur(data?.budget_extracted ?? null)} loading={loading} />
          <Tile icon={Gauge} label={t("score")} value={scoreVal} />
          <Tile icon={Flame} label={t("urgency")} value={titleCaseWord(data?.urgency ?? null)} loading={loading} />
          <Tile icon={CalendarClock} label={t("timeframe")} value={titleCaseWord(data?.timeframe ?? null)} loading={loading} />
          <Tile icon={MapPin} label={t("location")} value={data?.location_interest_extracted ?? null} loading={loading} />
          <Tile icon={BedDouble} label={t("bedrooms")} value={fmtBedrooms(data?.bedrooms_min ?? null, data?.bedrooms_max ?? null)} loading={loading} />
          <Tile icon={Bath} label={t("bathrooms")} value={fmtBathrooms(data?.bathrooms_min ?? null)} loading={loading} />
          <Tile icon={Home} label={t("propertyType")} value={data?.property_type_pref ? typeLabel(data.property_type_pref) : null} loading={loading} />
          <Tile icon={Languages} label={t("language")} value={langLabel(lead.language)} />
        </div>
      )}
    </section>
  );
}

// ── 5. follow-up (compact) ───────────────────────────────────────────────────

function FollowUp({ data, loading, t }: { data: LeadIntel | null; loading: boolean; t: Tr }) {
  const paused = data?.followup_paused === true;
  const next = data?.next_followup_at ?? null;
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3.5">
      <h3 className="flex items-center gap-2 text-[13.5px] font-semibold tracking-tight text-foreground">
        <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
        {t("followUpHeading")}
      </h3>
      {loading ? (
        <div className="h-3.5 w-28 animate-pulse rounded bg-muted" />
      ) : (
        <ul className="flex flex-col gap-1.5 text-[12px]">
          <li className="flex items-baseline gap-2 leading-tight">
            <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", paused ? "bg-amber-500" : "bg-brand")} aria-hidden />
            <span className={paused ? "text-muted-foreground" : "text-foreground"}>
              {paused ? t("followUpPaused") : t("followUpActive")}
            </span>
          </li>
          <li className="flex items-baseline gap-2 leading-tight">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden />
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
    </section>
  );
}

// ── 6. technical details (collapsible) ───────────────────────────────────────

function TechnicalDetails({
  lead,
  readiness,
  waOpen,
  t,
}: {
  lead: InboxRow;
  readiness: ContactReadiness | null;
  waOpen: WaOpen;
  t: Tr;
}) {
  const [open, setOpen] = useState(false);
  const failReason = readiness?.ok ? (readiness.last_failed_reason ?? null) : null;
  return (
    <section className="rounded-2xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-[12.5px] font-medium text-foreground">{t("technicalDetails")}</span>
          {failReason ? (
            <span className="hidden truncate font-mono text-[10px] text-amber-700 dark:text-amber-300 @[380px]:inline">
              {t("lastCheckinFailedShort", { reason: failReason })}
            </span>
          ) : null}
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <dl className="grid grid-cols-1 gap-1.5 border-t border-border px-3.5 py-2.5 text-[11.5px]">
          <Row label={t("whatsappWindow")} value={waOpen == null ? "—" : waOpen ? t("windowOpen") : t("windowClosed")} />
          <RowTime label={t("lastInbound")} iso={lead.latestInboundAt ?? readiness?.last_inbound_at ?? null} />
          <RowTime label={t("lastOutbound")} iso={lead.lastOutboundAt ?? readiness?.last_successful_outbound_at ?? null} />
          {failReason ? (
            <div className="flex items-baseline justify-between gap-2">
              <dt className="shrink-0 text-muted-foreground">{t("lastCheckinFailedLabel")}</dt>
              {/* text node — the raw code is shown deliberately, only in this drawer */}
              <dd className="truncate text-right font-mono text-[10.5px] text-amber-700 dark:text-amber-300">{failReason}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}
function RowTime({ label, iso }: { label: string; iso: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-medium text-foreground">{iso ? <RelativeTime iso={iso} /> : "—"}</dd>
    </div>
  );
}
