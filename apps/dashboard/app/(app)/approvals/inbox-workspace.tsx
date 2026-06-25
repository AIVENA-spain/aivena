"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  Clock,
  Globe,
  Home,
  Inbox as InboxIcon,
  Languages,
  LayoutGrid,
  Lock,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Search,
  Send,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { GatedActionButton, GateNote } from "@/components/shell/launch-gate";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RelativeTime } from "@/components/ui/relative-time";
import { loadTaskDetailAction } from "./inbox-actions";
import {
  getComposerStateAction,
  sendSuggestedAction,
  sendFreeformAction,
  dismissSuggestedAction,
  getReengagePreviewAction,
  reengageAction,
  type ComposerState,
  type PendingSuggestion,
} from "./composer-actions";
import { ClientIntelligence } from "./client-intelligence";
import type {
  InboxRow,
  TaskDetailResponse,
  ThreadMessage,
} from "@/lib/api/types";

// ---------- helpers ----------

type Stream = "buyers" | "sellers" | "network";
type View = "convo" | "cards";
type NetSub = "find" | "convos";

function isSeller(r: InboxRow): boolean {
  return (r.leadType ?? "").toLowerCase() === "seller";
}

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

function temperatureDot(temp: string | null): string {
  const t = (temp ?? "").toLowerCase();
  if (t === "super_hot" || t === "hot") return "bg-rose-600";
  if (t === "warm") return "bg-amber-500";
  if (t === "cold") return "bg-sky-500";
  return "bg-muted-foreground/40";
}

const CHANNEL_ICON: Record<string, LucideIcon> = {
  email: Mail,
  whatsapp: MessageCircle,
  instagram: MessageCircle,
  phone: Phone,
  web: Globe,
  website: Globe,
};
function ChannelIcon({ channel }: { channel: string | null }) {
  const Icon = CHANNEL_ICON[(channel ?? "").toLowerCase()] ?? Mail;
  return <Icon className="h-3.5 w-3.5" aria-hidden strokeWidth={1.8} />;
}

function isWhatsappChannel(channel: string | null | undefined): boolean {
  return (channel ?? "").toLowerCase() === "whatsapp";
}

/**
 * Honest delivery state for an OUTBOUND message, from its `status`:
 *   - undelivered / failed / cancelled → "failed" (never reached the buyer)
 *   - queued                          → "pending" (in flight; not yet confirmed)
 *   - sent / read / delivered / other → "delivered"
 * Inbound messages don't use this (they're always rendered as received).
 */
function outboundDeliveryState(
  status: string | null,
): "delivered" | "pending" | "failed" {
  const s = (status ?? "").toLowerCase();
  if (s === "undelivered" || s === "failed" || s === "cancelled") return "failed";
  if (s === "queued") return "pending";
  return "delivered";
}

/**
 * Channel pill shown in the open conversation head. WhatsApp gets a distinct
 * green treatment so the operator can see at a glance they're replying on
 * WhatsApp (no subject, chat-style) rather than email.
 */
function ChannelBadge({ channel }: { channel: string | null }) {
  const c = (channel ?? "").toLowerCase();
  const isWa = c === "whatsapp";
  const Icon = CHANNEL_ICON[c] ?? Mail;
  const label = isWa
    ? "WhatsApp"
    : c === "email"
      ? "Email"
      : c
        ? c[0].toUpperCase() + c.slice(1)
        : "—";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.04em]",
        isWa
          ? "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
          : "bg-muted text-muted-foreground",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden strokeWidth={2} />
      {label}
    </span>
  );
}

function languageLabel(code: string | null): string {
  if (!code) return "—";
  return code.toUpperCase();
}

// Readable language names for the "Translated from {lang}" label. (The label
// key itself is localized in messages/*; these names get keyed in the i18n pass.)
const LANG_NAME: Record<string, string> = {
  es: "Spanish", en: "English", no: "Norwegian", sv: "Swedish", da: "Danish",
  de: "German", nl: "Dutch", fr: "French", it: "Italian", pt: "Portuguese",
  ru: "Russian", pl: "Polish", fi: "Finnish",
};
function languageName(code: string | null): string {
  if (!code) return "the buyer's language";
  return LANG_NAME[code.toLowerCase()] ?? code.toUpperCase();
}

/**
 * Linkify http(s) URLs inside message text: split on URLs and render those as
 * real <a> links (new tab, noopener), leaving plain text untouched so the
 * caller's `whitespace-pre-wrap` keeps newlines. Long unbroken URLs wrap via
 * `break-all`. The trailing-punctuation trim keeps a sentence's "." or ")"
 * out of the href.
 */
const URL_RE = /(https?:\/\/[^\s]+)/g;
function linkifyText(text: string): React.ReactNode {
  if (!text) return text;
  const parts = text.split(URL_RE);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const trailing = part.match(/[.,;:!?)\]]+$/)?.[0] ?? "";
      const href = trailing ? part.slice(0, part.length - trailing.length) : part;
      return (
        <Fragment key={i}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline break-all"
          >
            {href}
          </a>
          {trailing}
        </Fragment>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/**
 * Conversation state for the row badge. Precedence is encoded in
 * `resolveConvoState`: anything needing the operator ("needsYou") wins over
 * the handled states.
 */
type ConvoState = "needsYou" | "replied" | "autoHandled" | "waiting";

/** Per-conversation grouping metadata, keyed by the representative task id. */
type ConvoGroupInfo = Map<
  string,
  { taskIds: string[]; pendingCount: number; state: ConvoState }
>;

function resolveConvoState(rep: InboxRow, pendingCount: number): ConvoState {
  // A buyer reply that landed AFTER our last outbound needs attention again,
  // even if no task is pending yet.
  const newInboundAfterOutbound =
    rep.latestInboundAt != null &&
    rep.lastOutboundAt != null &&
    new Date(rep.latestInboundAt).getTime() >
      new Date(rep.lastOutboundAt).getTime();
  if (pendingCount > 0 || newInboundAfterOutbound) return "needsYou";
  if (rep.lastOutboundKind === "operator") return "replied";
  if (rep.lastOutboundKind === "auto") return "autoHandled";
  return "waiting";
}

/**
 * Collapse every task row of a conversation into one list row.
 *
 * Grouping key is `conversation_id` (falling back to `leadId` only if a row
 * lacks one). `dashboard_inbox` returns one row per task across all buckets,
 * so a conversation can contribute several rows (its pending task plus handled
 * history); we keep exactly one. The representative is the first PENDING task
 * if any (so clicking opens the actionable task), else the first row. First
 * occurrence sets the group's position, preserving the server sort order.
 *
 * `pendingCount` counts only rows whose task is still pending (drives the
 * "· N pending" badge), and `state` is the conversation's badge state. The
 * full `taskIds` list lets the row stay highlighted when the selected task is
 * a non-representative member of the group.
 */
function groupConversations(rows: InboxRow[]): {
  dedupedRows: InboxRow[];
  groupInfo: ConvoGroupInfo;
} {
  const order: string[] = [];
  const rowsByKey = new Map<string, InboxRow[]>();
  for (const r of rows) {
    const key = r.conversationId ?? r.leadId;
    const existing = rowsByKey.get(key);
    if (existing) {
      existing.push(r);
    } else {
      rowsByKey.set(key, [r]);
      order.push(key);
    }
  }
  const dedupedRows: InboxRow[] = [];
  const groupInfo: ConvoGroupInfo = new Map();
  for (const k of order) {
    const groupRows = rowsByKey.get(k)!;
    const pendingRows = groupRows.filter((r) => r.taskStatus === "pending");
    const rep = pendingRows[0] ?? groupRows[0];
    dedupedRows.push(rep);
    groupInfo.set(rep.taskId, {
      taskIds: groupRows.map((r) => r.taskId),
      pendingCount: pendingRows.length,
      state: resolveConvoState(rep, pendingRows.length),
    });
  }
  // Surface actionable conversations first, handled ones below. filter() is
  // stable, so the server's recency order is preserved within each group.
  const sorted = [
    ...dedupedRows.filter((r) => groupInfo.get(r.taskId)!.state === "needsYou"),
    ...dedupedRows.filter((r) => groupInfo.get(r.taskId)!.state !== "needsYou"),
  ];
  return { dedupedRows: sorted, groupInfo };
}

// ---------- main workspace ----------

export function InboxWorkspace({
  locale,
  rows,
  initialTaskId,
  initialLeadId,
  authors,
}: {
  locale: string;
  rows: InboxRow[];
  initialTaskId?: string;
  /** Open a specific lead by its leadId (Matches rows link with ?leadId=). */
  initialLeadId?: string;
  /** author_user_id → email, for resolving note authors to a name. */
  authors?: Record<string, string>;
}) {
  const t = useTranslations("inbox");
  const router = useRouter();

  // Mirror the selected lead into the URL (?lead=<taskId>) so a reload restores
  // the same lead instead of falling back to buyers[0]. The page already reads
  // ?lead as initialTaskId. replace (not push) keeps Back behaviour sane.
  const syncLeadUrl = useCallback(
    (taskId: string) => {
      router.replace(`/approvals?lead=${encodeURIComponent(taskId)}`, {
        scroll: false,
      });
    },
    [router],
  );

  // dashboard_inbox spans every bucket, so a conversation stays in the list
  // after Approve & Send (its badge flips needs_you → Replied/Auto-handled)
  // instead of vanishing. We show all buckets and let the per-row state badge
  // carry the meaning.
  const buyers = useMemo(() => rows.filter((r) => !isSeller(r)), [rows]);
  const sellers = useMemo(() => rows.filter((r) => isSeller(r)), [rows]);

  // Resolve the initial selection to a taskId. ?lead=<taskId> wins; otherwise
  // ?leadId=<leadId> (used by the Matches surface) maps to the matching row's
  // taskId. If neither matches a row, fall through to the normal defaults.
  const resolvedInitialTaskId =
    initialTaskId ??
    (initialLeadId
      ? (rows.find((r) => r.leadId === initialLeadId)?.taskId ?? undefined)
      : undefined);

  // Both streams are deduped by conversation, ordered needs-you-first, and
  // carry per-conversation state for the badges + the "Handled" divider.
  const buyerGroups = useMemo(() => groupConversations(buyers), [buyers]);
  const sellerGroups = useMemo(() => groupConversations(sellers), [sellers]);

  // Buyers tab badge = conversations still needing the operator (not the raw
  // task-row count, which now includes handled history).
  const buyerNeedsYouCount = useMemo(
    () =>
      buyerGroups.dedupedRows.filter(
        (r) => buyerGroups.groupInfo.get(r.taskId)?.state === "needsYou",
      ).length,
    [buyerGroups],
  );

  // Default stream = first stream with items needing action; else buyers.
  const initialStream: Stream = (() => {
    if (
      resolvedInitialTaskId &&
      buyers.some((r) => r.taskId === resolvedInitialTaskId)
    )
      return "buyers";
    if (
      resolvedInitialTaskId &&
      sellers.some((r) => r.taskId === resolvedInitialTaskId)
    )
      return "sellers";
    if (buyers.length > 0) return "buyers";
    if (sellers.length > 0) return "sellers";
    return "buyers";
  })();

  const [stream, setStream] = useState<Stream>(initialStream);
  // Session-only view memory via React state — no localStorage.
  const [view, setView] = useState<View>("convo");
  const [wizardOpen, setWizardOpen] = useState(false);

  // Selected lead by stream — independent so switching streams doesn't reset.
  const initialSelected =
    resolvedInitialTaskId &&
    [...buyers, ...sellers].some((r) => r.taskId === resolvedInitialTaskId)
      ? resolvedInitialTaskId
      : (buyers[0]?.taskId ?? sellers[0]?.taskId ?? null);
  const [selectedBuyerId, setSelectedBuyerId] = useState<string | null>(
    isSeller(rows.find((r) => r.taskId === initialSelected) ?? ({} as InboxRow))
      ? (buyers[0]?.taskId ?? null)
      : initialSelected,
  );
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(
    isSeller(rows.find((r) => r.taskId === initialSelected) ?? ({} as InboxRow))
      ? initialSelected
      : (sellers[0]?.taskId ?? null),
  );

  const activeRows = stream === "buyers" ? buyers : sellers;
  const selectedId =
    stream === "buyers" ? selectedBuyerId : selectedSellerId;
  const setSelectedId =
    stream === "buyers" ? setSelectedBuyerId : setSelectedSellerId;
  const selected = activeRows.find((r) => r.taskId === selectedId) ?? null;

  // Thread cache keyed by taskId. Lazily filled when a lead is selected.
  const [threadCache, setThreadCache] = useState<
    Record<string, { status: "loading" | "ok" | "failed"; data?: TaskDetailResponse }>
  >({});
  const [, startThreadLoad] = useTransition();
  const loadedRef = useRef<Set<string>>(new Set());

  const loadThread = useCallback(
    (taskId: string) => {
      if (loadedRef.current.has(taskId)) return;
      loadedRef.current.add(taskId);
      setThreadCache((prev) => ({
        ...prev,
        [taskId]: { status: "loading" },
      }));
      startThreadLoad(async () => {
        const result = await loadTaskDetailAction(taskId);
        setThreadCache((prev) => ({
          ...prev,
          [taskId]: result.ok
            ? { status: "ok", data: result.detail }
            : { status: "failed" },
        }));
      });
    },
    [],
  );

  // FIX #1 — force a re-fetch of a thread that's already loaded, WITHOUT
  // flashing the loading skeleton: we keep showing the current (stale) thread
  // and swap it in place once the fresh detail arrives. Used to reconcile the
  // just-sent message's status (queued → delivered) after an approve/dismiss.
  const reloadThread = useCallback((taskId: string) => {
    loadedRef.current.add(taskId); // already loaded; keep the cached bubble up
    startThreadLoad(async () => {
      const result = await loadTaskDetailAction(taskId);
      if (!result.ok) return; // keep the old thread on a transient refetch fail
      setThreadCache((prev) => ({
        ...prev,
        [taskId]: { status: "ok", data: result.detail },
      }));
    });
  }, []);

  // Force-refetch the open thread now + at ~2s and ~4.5s so a just-sent outbound
  // reconciles (queued → delivered, ~4s through send_queue) and any stuck
  // spinner clears. Shared by the ?approved/?dismissed effect and the composer's
  // onActionDone. Returns a cleanup that cancels the pending refetches.
  const reconcileThread = useCallback(
    (taskId: string) => {
      reloadThread(taskId);
      const t1 = setTimeout(() => reloadThread(taskId), 2000);
      const t2 = setTimeout(() => reloadThread(taskId), 4500);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    },
    [reloadThread],
  );

  // The composer just sent/dismissed for the open conversation. Refresh the
  // server rows (so taskStatus history flips) and reconcile the thread so the
  // new outbound's status settles. router.refresh() is the rows refresh.
  const onComposerDone = useCallback(() => {
    const sel = stream === "buyers" ? selectedBuyerId : selectedSellerId;
    router.refresh();
    if (sel) reconcileThread(sel);
  }, [stream, selectedBuyerId, selectedSellerId, router, reconcileThread]);

  useEffect(() => {
    if (selectedId && view === "convo") loadThread(selectedId);
  }, [selectedId, view, loadThread]);

  // FIX #1 — after an approve/dismiss the shared server action redirects to
  // /approvals?approved=1 | ?dismissed=1 (revalidating the server rows but
  // dropping ?lead). When that flag lands with a conversation still selected,
  // re-sync: refresh the rows (so taskStatus flips → the reply card vanishes)
  // and re-fetch the open thread now + at ~2s and ~4.5s so the new outbound's
  // status reconciles (queued → delivered, ~4s through send_queue). Then
  // restore ?lead so a reload reopens the same conversation. The ref guards
  // the effect to run exactly once per flag occurrence.
  const searchParams = useSearchParams();
  const reconciledFlagRef = useRef<string | null>(null);
  useEffect(() => {
    const flag = searchParams.get("approved")
      ? "approved"
      : searchParams.get("dismissed")
        ? "dismissed"
        : null;
    if (!flag) {
      reconciledFlagRef.current = null;
      return;
    }
    const sel = stream === "buyers" ? selectedBuyerId : selectedSellerId;
    if (!sel) return;
    const guardKey = `${flag}:${sel}`;
    if (reconciledFlagRef.current === guardKey) return;
    reconciledFlagRef.current = guardKey;

    router.refresh();
    const cancel = reconcileThread(sel);
    router.replace(`/approvals?lead=${encodeURIComponent(sel)}`, {
      scroll: false,
    });
    return cancel;
  }, [
    searchParams,
    stream,
    selectedBuyerId,
    selectedSellerId,
    reconcileThread,
    router,
  ]);

  // #3 — a "suggest matched properties" task was just created for the open
  // lead. Refresh the server rows (so the new pending task row arrives →
  // `selected` resolves to it with taskStatus 'pending', surfacing the
  // suggested-reply card), select it in the current stream, and load its
  // thread. Same-stream as the current selection (it's the same lead).
  const handleSuggested = useCallback(
    (taskId: string) => {
      router.refresh();
      if (stream === "buyers") setSelectedBuyerId(taskId);
      else setSelectedSellerId(taskId);
      loadThread(taskId);
      syncLeadUrl(taskId);
    },
    [router, stream, loadThread, syncLeadUrl],
  );

  return (
    <div className="flex flex-col gap-3.5">
      {/* Tabs + view toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <StreamTab
          label={t("tabs.buyers")}
          active={stream === "buyers"}
          badge={buyerNeedsYouCount || null}
          onClick={() => setStream("buyers")}
        />
        <StreamTab
          label={t("tabs.sellers")}
          active={stream === "sellers"}
          badge={sellers.length || null}
          onClick={() => setStream("sellers")}
        />
        <StreamTab
          label={t("tabs.network")}
          active={stream === "network"}
          soonLabel={t("tabs.soon")}
          onClick={() => setStream("network")}
        />
        {stream !== "network" ? (
          <div className="ml-auto">
            <ViewToggle
              view={view}
              onChange={setView}
              labels={{
                convo: t("view.conversation"),
                cards: t("view.cards"),
              }}
            />
          </div>
        ) : null}
      </div>

      {/* Stream content */}
      {stream === "buyers" ? (
        view === "convo" ? (
          <BuyersConvoView
            rows={buyerGroups.dedupedRows}
            groupInfo={buyerGroups.groupInfo}
            selectedId={selectedBuyerId}
            onSelect={(id) => {
              setSelectedBuyerId(id);
              loadThread(id);
              syncLeadUrl(id);
            }}
            selected={
              selected && !isSeller(selected) ? selected : null
            }
            threadEntry={
              selectedBuyerId ? threadCache[selectedBuyerId] : undefined
            }
            onSuggested={handleSuggested}
            onComposerDone={onComposerDone}
            locale={locale}
            authors={authors}
          />
        ) : (
          <BuyersCardsView
            rows={buyerGroups.dedupedRows}
            groupInfo={buyerGroups.groupInfo}
            selectedId={selectedBuyerId}
            onCardClick={(id) => {
              setSelectedBuyerId(id);
              setView("convo");
              loadThread(id);
              syncLeadUrl(id);
            }}
            locale={locale}
          />
        )
      ) : null}

      {stream === "sellers" ? (
        sellers.length > 0 ? (
          view === "convo" ? (
            <BuyersConvoView
              rows={sellerGroups.dedupedRows}
              groupInfo={sellerGroups.groupInfo}
              selectedId={selectedSellerId}
              onSelect={(id) => {
                setSelectedSellerId(id);
                loadThread(id);
                syncLeadUrl(id);
              }}
              selected={
                selected && isSeller(selected) ? selected : null
              }
              threadEntry={
                selectedSellerId ? threadCache[selectedSellerId] : undefined
              }
              onSuggested={handleSuggested}
              onComposerDone={onComposerDone}
              locale={locale}
              authors={authors}
            />
          ) : (
            <BuyersCardsView
              rows={sellerGroups.dedupedRows}
              groupInfo={sellerGroups.groupInfo}
              selectedId={selectedSellerId}
              onCardClick={(id) => {
                setSelectedSellerId(id);
                setView("convo");
                loadThread(id);
                syncLeadUrl(id);
              }}
              locale={locale}
            />
          )
        ) : (
          <SellersEmptyState
            view={view}
            onSetUp={() => setWizardOpen(true)}
          />
        )
      ) : null}

      {stream === "network" ? <NetworkTeaser /> : null}

      {/* Valuation wizard modal */}
      {wizardOpen ? (
        <ValuationWizardModal onClose={() => setWizardOpen(false)} />
      ) : null}
    </div>
  );
}

// ---------- tabs + toggles ----------

function StreamTab({
  label,
  active,
  badge,
  soonLabel,
  onClick,
}: {
  label: string;
  active: boolean;
  badge?: number | null;
  soonLabel?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors shadow-soft",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
      aria-pressed={active}
    >
      <span>{label}</span>
      {typeof badge === "number" && badge > 0 ? (
        <span
          className={cn(
            "rounded-full px-1.5 py-[1px] text-[10px] font-semibold",
            active
              ? "bg-brand text-brand-fg"
              : "bg-brand-soft text-brand",
          )}
        >
          {badge}
        </span>
      ) : null}
      {soonLabel ? (
        <span
          className={cn(
            "whitespace-nowrap rounded-full px-1.5 py-[1px] font-mono text-[8.5px] font-medium uppercase tracking-[0.04em]",
            active
              ? "bg-brand text-brand-fg"
              : "bg-muted text-muted-foreground",
          )}
        >
          {soonLabel}
        </span>
      ) : null}
    </button>
  );
}

function ViewToggle({
  view,
  onChange,
  labels,
}: {
  view: View;
  onChange: (v: View) => void;
  labels: { convo: string; cards: string };
}) {
  return (
    <div
      role="group"
      className="flex items-center gap-0.5 rounded-full border border-border bg-muted/60 p-0.5"
    >
      <ViewToggleOpt
        active={view === "convo"}
        onClick={() => onChange("convo")}
        icon={<MessageSquare className="h-3 w-3" aria-hidden />}
        label={labels.convo}
      />
      <ViewToggleOpt
        active={view === "cards"}
        onClick={() => onChange("cards")}
        icon={<LayoutGrid className="h-3 w-3" aria-hidden />}
        label={labels.cards}
      />
    </div>
  );
}

function ViewToggleOpt({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors",
        active
          ? "bg-card text-foreground shadow-soft"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ---------- conversation state badge ----------

function StateBadge({ state }: { state: ConvoState }) {
  const t = useTranslations("inbox.state");
  // Signal green (brand) is reserved for the one state that needs the operator;
  // the handled states stay neutral/muted so green stays a signal, not decor.
  const tone: Record<ConvoState, string> = {
    needsYou: "bg-brand-soft text-brand",
    replied: "bg-muted text-foreground",
    autoHandled: "bg-muted text-muted-foreground",
    waiting: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-[1px] font-mono text-[9px] font-medium uppercase tracking-[0.03em]",
        tone[state],
      )}
    >
      {t(state)}
    </span>
  );
}

// ---------- buyers convo view (3-pane) ----------

function BuyersConvoView({
  rows,
  groupInfo,
  selectedId,
  onSelect,
  selected,
  threadEntry,
  onSuggested,
  onComposerDone,
  locale,
  authors,
}: {
  rows: InboxRow[];
  /** Present only for the buyers stream (item D). Undefined = no dedup/badge. */
  groupInfo?: ConvoGroupInfo;
  selectedId: string | null;
  onSelect: (id: string) => void;
  selected: InboxRow | null;
  threadEntry?: { status: "loading" | "ok" | "failed"; data?: TaskDetailResponse };
  /** Create a property-suggestion task for the open lead, then open it. */
  onSuggested?: (taskId: string) => void;
  /** Reconcile the open thread + refresh rows after a composer send/dismiss. */
  onComposerDone: () => void;
  locale: string;
  /** author_user_id → email, for resolving note authors to a name. */
  authors?: Record<string, string>;
}) {
  const t = useTranslations("inbox");
  const [query, setQuery] = useState("");

  if (rows.length === 0) {
    return (
      <Card size="sm">
        <EmptyState
          icon={MessageSquare}
          title={t("buyers.emptyTitleConvo")}
          description={t("buyers.emptyText")}
        />
      </Card>
    );
  }

  // Client-side filter for the conversation list search box.
  const q = query.trim().toLowerCase();
  const visibleRows = q
    ? rows.filter(
        (r) =>
          (r.fullName ?? "").toLowerCase().includes(q) ||
          (r.latestInboundPreview ?? "").toLowerCase().includes(q),
      )
    : rows;

  // Rows arrive needs-you-first; the divider marks where handled rows begin.
  // Only shown when both groups are non-empty (index > 0 ⇒ ≥1 needs-you above).
  const firstHandledIdx = groupInfo
    ? visibleRows.findIndex((r) => groupInfo.get(r.taskId)?.state !== "needsYou")
    : -1;

  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-card shadow-elevated lg:h-[calc(100dvh-11.5rem)] lg:min-h-[560px] lg:max-h-[940px] lg:grid-rows-1 lg:grid-cols-[230px_minmax(0,1fr)_minmax(0,1.5fr)]">
      {/* Left: convo list */}
      <div className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
        <div className="shrink-0 border-b border-border p-2.5">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2.5 text-[12px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
        <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {visibleRows.length === 0 ? (
            <li className="px-4 py-6 text-center text-[12px] text-muted-foreground">
              {t("searchNoResults")}
            </li>
          ) : null}
          {visibleRows.map((r, i) => {
          const group = groupInfo?.get(r.taskId);
          const isSel = group
            ? selectedId != null && group.taskIds.includes(selectedId)
            : r.taskId === selectedId;
          const pendingCount = group?.pendingCount ?? 1;
          const state = group?.state;
          return (
            <li key={r.taskId}>
              {firstHandledIdx > 0 && i === firstHandledIdx ? (
                <div className="border-b border-border bg-muted/30 px-4 py-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {t("handledDivider")}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => onSelect(r.taskId)}
                className={cn(
                  "flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left transition-colors",
                  isSel
                    ? "border-l-2 border-l-brand bg-brand-soft pl-[14px]"
                    : "hover:bg-muted/40",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-semibold text-foreground">
                    {r.fullName ?? "Unknown"}
                  </span>
                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    {state ? <StateBadge state={state} /> : null}
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        temperatureDot(r.temperature),
                      )}
                      aria-hidden
                    />
                  </div>
                </div>
                <div className="truncate text-[11.5px] text-muted-foreground">
                  {r.latestInboundPreview ?? r.aiReplyBody ?? "—"}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span
                    className={cn(
                      "flex shrink-0 items-center",
                      isWhatsappChannel(r.channel) &&
                        "text-emerald-600 dark:text-emerald-400",
                    )}
                    title={r.channel ?? undefined}
                  >
                    <ChannelIcon channel={r.channel} />
                  </span>
                  <span>
                    {languageLabel(r.language)} ·{" "}
                    <RelativeTime iso={r.taskCreatedAt} />
                  </span>
                  {pendingCount > 1 ? (
                    <span className="rounded-full bg-muted px-1.5 py-[1px] font-mono text-[9px] font-medium text-muted-foreground">
                      · {t("buyers.pendingBadge", { n: pendingCount })}
                    </span>
                  ) : null}
                </div>
              </button>
            </li>
          );
        })}
        </ul>
      </div>

      {/* Middle: thread + reply */}
      <div className="flex min-h-0 min-w-0 flex-col">
        {selected ? (
          <ThreadAndReply
            lead={selected}
            threadEntry={threadEntry}
            onComposerDone={onComposerDone}
            locale={locale}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
            {t("buyers.emptyConvo")}
          </div>
        )}
      </div>

      {/* Right: stacked Client Intelligence panel */}
      <div className="flex min-h-0 flex-col overflow-y-auto border-t border-border bg-muted/20 p-5 lg:border-t-0 lg:border-l">
        {selected ? (
          <ClientIntelligence
            key={selected.leadId}
            lead={selected}
            authors={authors}
            onSuggested={onSuggested}
          />
        ) : null}
      </div>
    </div>
  );
}

// ---------- thread + reply zone ----------

function ThreadAndReply({
  lead,
  threadEntry,
  onComposerDone,
  locale,
}: {
  lead: InboxRow;
  threadEntry?: { status: "loading" | "ok" | "failed"; data?: TaskDetailResponse };
  /** Reconcile the open thread + refresh rows after a composer send/dismiss. */
  onComposerDone: () => void;
  locale: string;
}) {
  const t = useTranslations("inbox");
  const tThread = useTranslations("inbox.thread");
  const tErr = useTranslations("errors");

  const headSubline = `${lead.area ?? "—"} · ${languageLabel(lead.language)}`;

  // WhatsApp 24h-window state (null for non-WhatsApp leads or if the lookup
  // failed). Drives composer gating + the per-message failure reason lookup.
  const whatsappState =
    threadEntry?.status === "ok"
      ? (threadEntry.data?.whatsappState ?? null)
      : null;
  const failureByMsg = useMemo(() => {
    const m = new Map<string, string | null>();
    whatsappState?.failed_messages?.forEach((f) =>
      m.set(f.message_id, f.failure_reason_code),
    );
    return m;
  }, [whatsappState]);

  // WhatsApp-style: the newest message lives at the bottom — jump there when
  // the thread arrives or the selected lead changes.
  const threadBodyRef = useRef<HTMLDivElement>(null);
  const threadReady = threadEntry?.status === "ok";
  useEffect(() => {
    const el = threadBodyRef.current;
    if (el && threadReady) el.scrollTop = el.scrollHeight;
  }, [threadReady, lead.leadId]);

  // W11-lite viewing pipeline (v1.14.1): when the task is a detected viewing
  // intent, the operator confirms a time rather than (only) sending a reply.
  // The confirm-time RPC + the extracted-times payload are Vega's; until they
  // land this renders the affordance with the action gated.
  const isViewing =
    threadEntry?.status === "ok" &&
    threadEntry.data?.task.taskType === "viewing_intent_detected";

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Head */}
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white",
            avatarTone(lead.fullName ?? lead.leadId),
          )}
        >
          {initialsOf(lead.fullName ?? "Unknown")}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-bold text-foreground">
            {lead.fullName ?? "Unknown"}
          </div>
          <div className="truncate font-mono text-[10.5px] text-muted-foreground">
            {headSubline}
          </div>
        </div>
        <div className="ml-auto">
          <ChannelBadge channel={lead.channel} />
        </div>
      </div>

      {/* Body */}
      <div
        ref={threadBodyRef}
        className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-5"
      >
        {threadEntry?.status === "loading" || threadEntry === undefined ? (
          <ThreadSkeleton />
        ) : threadEntry.status === "failed" ? (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-[12px] text-muted-foreground">
            {tErr("pageLoad")}
          </div>
        ) : threadEntry.data && threadEntry.data.thread.length > 0 ? (
          dedupeThread(threadEntry.data.thread).map((m) => (
            <ThreadBubble
              key={m.id}
              msg={m}
              leadLanguage={lead.language}
              failureReason={failureByMsg.get(m.id) ?? null}
              t={tThread}
            />
          ))
        ) : (
          <>
            {threadEntry?.data?.originalMessage ? (
              <ThreadBubble
                msg={{
                  id: `original-${lead.leadId}`,
                  direction: "inbound",
                  messageType: "first_contact",
                  content: threadEntry.data.originalMessage,
                  bodyClean: null,
                  bodyTranslatedOwner: null,
                  status: null,
                  createdAt: lead.taskCreatedAt,
                }}
                leadLanguage={lead.language}
                t={tThread}
              />
            ) : (
              <div className="rounded-md border border-dashed border-border p-3 text-center text-[12px] text-muted-foreground">
                {tThread("noThread")}
              </div>
            )}
          </>
        )}
      </div>

      {/* Viewing confirm-time affordance (W11-lite) — only for viewing tasks. */}
      {isViewing ? <ViewingConfirmCard /> : null}

      {/* Persistent composer — always rendered, pinned at the bottom of the
          conversation. Keyed by conversation (falling back to lead) so it
          remounts with fresh state per conversation. Polls for a pending
          suggested reply (SUGGESTED state) and falls back to FREEFORM. */}
      <Composer
        key={lead.conversationId ?? lead.leadId}
        conversationId={lead.conversationId}
        leadId={lead.leadId}
        channel={lead.channel}
        leadName={lead.fullName}
        suggestedSubject={lead.aiReplySubject}
        onActionDone={onComposerDone}
      />
    </div>
  );
}

// ---------- viewing confirm-time affordance (W11-lite, v1.14.1) ----------

function ViewingConfirmCard() {
  const t = useTranslations("viewing");
  const [choice, setChoice] = useState<string>("custom");

  // The extracted candidate times come from the viewing_intent_detected task
  // payload once Vega ships it. Until then we show the shape: pick one of the
  // detected times (placeholder slots) or enter a custom time; confirming is
  // gated on the confirm-time RPC.
  const slots = [
    { id: "slot-1", label: t("slotPlaceholder1") },
    { id: "slot-2", label: t("slotPlaceholder2") },
  ];

  return (
    <div className="border-t border-border bg-card px-5 py-4">
      <div className="rounded-[13px] border border-brand/20 bg-brand-soft/60 p-3.5">
        <div className="mb-2 flex items-center gap-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.05em] text-brand">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden />
          {t("title")}
        </div>
        <p className="mb-3 text-[12px] text-muted-foreground">{t("subtitle")}</p>

        <div className="flex flex-col gap-2">
          {slots.map((s) => (
            <label
              key={s.id}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[12.5px] text-foreground"
            >
              <input
                type="radio"
                name="viewing-slot"
                checked={choice === s.id}
                onChange={() => setChoice(s.id)}
                className="h-3.5 w-3.5 accent-[var(--brand)]"
              />
              {s.label}
            </label>
          ))}
          <label className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[12.5px] text-foreground">
            <input
              type="radio"
              name="viewing-slot"
              checked={choice === "custom"}
              onChange={() => setChoice("custom")}
              className="h-3.5 w-3.5 accent-[var(--brand)]"
            />
            {t("customLabel")}
            <input
              type="datetime-local"
              disabled={choice !== "custom"}
              className="ml-2 rounded border border-border bg-background px-2 py-1 text-[12px] text-foreground disabled:opacity-50"
            />
          </label>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <GatedActionButton label={t("confirm")} />
        <GateNote />
      </div>
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="h-12 w-2/3 animate-pulse rounded-[13px] bg-muted/50" />
      <div className="h-16 w-3/4 self-end animate-pulse rounded-[13px] bg-brand-soft" />
    </div>
  );
}

/**
 * Collapse the parked-v0.6 outbound artifact: each approved outbound currently
 * has two conversation_messages rows — a queued "shadow" (raw body, no
 * provider id) and the actually-sent wrapper-baked row (agency branding + the
 * same body). They render as duplicate bubbles. The data fix (the v0.6
 * migration) is parked, so we dedupe at the RENDERER:
 *   - drop a message whose normalized text is a substring of another
 *     same-direction message's strictly-longer text (keeps the delivered,
 *     wrapped row), and
 *   - collapse exact duplicates (e.g. a genuinely double-written inbound),
 *     keeping the first.
 * Short messages (<12 normalized chars) are left untouched so distinct short
 * replies like "Yes" are never collapsed.
 */
function dedupeThread(thread: ThreadMessage[]): ThreadMessage[] {
  const norm = (m: ThreadMessage) =>
    ((m.direction === "inbound" ? (m.bodyClean ?? m.content) : m.content) ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  // Dedupe exists for v0.6 "shadow" artifacts: the same inbound stored twice
  // (raw + cleaned) AT THE SAME MOMENT. A buyer legitimately re-sending the
  // same text later must stay visible, so duplicates only collapse when the
  // two messages are within a short window of each other.
  const DUP_WINDOW_MS = 10 * 60 * 1000;
  const ts = (m: ThreadMessage) => new Date(m.createdAt).getTime();
  const keyed = thread.map((m) => ({ m, key: norm(m) }));
  const seenAt = new Map<string, number>();
  const out: ThreadMessage[] = [];
  for (const it of keyed) {
    if (it.key.length === 0) {
      out.push(it.m);
      continue;
    }
    const exact = `${it.m.direction}|${it.key}`;
    const prevAt = seenAt.get(exact);
    if (prevAt !== undefined && Math.abs(ts(it.m) - prevAt) < DUP_WINDOW_MS) {
      continue;
    }
    const containedByLonger = keyed.some(
      (o) =>
        o.m.id !== it.m.id &&
        o.m.direction === it.m.direction &&
        it.key.length >= 12 &&
        o.key.length > it.key.length &&
        o.key.includes(it.key) &&
        Math.abs(ts(o.m) - ts(it.m)) < DUP_WINDOW_MS,
    );
    if (containedByLonger) continue;
    seenAt.set(exact, ts(it.m));
    out.push(it.m);
  }
  return out;
}

function ThreadBubble({
  msg,
  leadLanguage,
  failureReason,
  t,
}: {
  msg: ThreadMessage;
  leadLanguage: string | null;
  /** Raw provider code for a non-delivered outbound (mapped to friendly copy,
   *  never shown raw). Looked up from whatsapp_state.failed_messages by id. */
  failureReason?: string | null;
  t: ReturnType<typeof useTranslations<"inbox.thread">>;
}) {
  const inbound = msg.direction === "inbound";
  // Honest delivery state — an outbound that never reached the buyer must never
  // look "sent" (the bug this fixes). Inbound is always "received".
  const delivery = inbound ? "inbound" : outboundDeliveryState(msg.status);
  const failed = delivery === "failed";
  const pending = delivery === "pending";

  // Inbound bodies carry the buyer's quote chain / footer in `content`;
  // `bodyClean` is the server-stripped version. Outbound is composed in the
  // dashboard and never quoted, so it renders raw `content`.
  const original = inbound ? (msg.bodyClean ?? msg.content) : msg.content;
  const translated = msg.bodyTranslatedOwner?.trim() || null;
  // Both directions: when a translation into the agency's language exists, read
  // it by default with a toggle to reveal the original. Outbound now carries a
  // translation too (backfilled), so the operator can read what was sent on
  // their behalf — not just the lead-language text. Null translation (same
  // language, or not landed yet) → original only, no toggle, no label.
  const hasTranslation =
    translated !== null && translated !== original?.trim();

  // Read the owner-language version by default, with a toggle to reveal the
  // original. When there's no translation, render the original.
  const [showOriginal, setShowOriginal] = useState(false);
  const primary = hasTranslation && !showOriginal ? translated : original;

  // Friendly, code-free reason for a non-delivered send (Law-2). The 24h-window
  // rejection gets its own line; everything else is the generic retry copy.
  const reasonText = failed
    ? failureReason === "twilio_error_63016"
      ? t("failedWindow")
      : t("failedGeneric")
    : null;

  const metaLabel = inbound
    ? t("inbound")
    : failed
      ? t("notDelivered")
      : pending
        ? t("sending")
        : t("outbound");

  return (
    <div
      className={cn(
        "min-w-0 max-w-[76%] break-words [overflow-wrap:anywhere] rounded-[13px] px-3.5 py-2.5 text-[12.5px] leading-[1.5]",
        inbound
          ? "self-start rounded-bl-[4px] bg-muted/70 text-foreground"
          : failed
            ? "self-end rounded-br-[4px] border border-amber-500/40 bg-amber-500/5 text-foreground"
            : pending
              ? "self-end rounded-br-[4px] bg-brand-soft/50 text-foreground"
              : "self-end rounded-br-[4px] bg-brand-soft text-foreground",
      )}
    >
      {hasTranslation && !showOriginal ? (
        <div className="mb-1.5 flex items-center gap-1 font-mono text-[8.5px] uppercase tracking-[0.05em] text-muted-foreground">
          <Languages className="h-3 w-3" aria-hidden strokeWidth={1.9} />
          {t("translatedFrom", { lang: languageName(leadLanguage) })}
        </div>
      ) : null}
      <div className={cn("whitespace-pre-wrap", failed && "opacity-70")}>
        {primary ? (
          linkifyText(primary)
        ) : (
          <span className="italic opacity-70">(empty)</span>
        )}
      </div>
      {hasTranslation ? (
        <button
          type="button"
          onClick={() => setShowOriginal((v) => !v)}
          className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.05em] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {showOriginal ? t("showTranslation") : t("showOriginal")}
        </button>
      ) : null}
      {failed && reasonText ? (
        <div className="mt-1.5 flex items-start gap-1 text-[10.5px] font-medium text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden strokeWidth={2} />
          <span>{reasonText}</span>
        </div>
      ) : null}
      <div className="mt-1.5 flex items-center gap-1 font-mono text-[9.5px] text-muted-foreground">
        {pending ? <Clock className="h-2.5 w-2.5" aria-hidden strokeWidth={2} /> : null}
        {metaLabel} · <RelativeTime iso={msg.createdAt} />
      </div>
    </div>
  );
}

// ---------- persistent composer (freeform + suggested) ----------

/**
 * The persistent composer pinned at the bottom of the open conversation. Two
 * states, driven by polling for a pending suggested_reply task:
 *
 *   FREEFORM  — no pending suggestion. Empty textarea; Send → send_custom_reply.
 *   SUGGESTED — a pending suggested_reply exists. Textarea pre-filled with the
 *               AI draft (editable), labelled; Send → approve_dashboard_task;
 *               Dismiss → dismiss_dashboard_task.
 *
 * After a successful send/dismiss the composer clears to empty FREEFORM, refetches
 * its state, and calls onActionDone() (the parent reconciles the thread + refreshes
 * rows). It polls on mount, on conversationId change (the parent keys it by
 * conversation so it remounts), on window focus, and every 18s — so a freshly
 * drafted suggestion appears after the buyer replies.
 */
function Composer({
  conversationId,
  leadId,
  channel,
  leadName,
  suggestedSubject,
  onActionDone,
}: {
  conversationId: string | null;
  leadId: string;
  channel: string | null;
  leadName: string | null;
  /** AI-drafted subject (email only), prefilled in the suggested state. */
  suggestedSubject: string | null;
  /** Reconcile the thread + refresh rows after a send/dismiss. */
  onActionDone: () => void;
}) {
  const t = useTranslations("inbox.reply");
  const tComposer = useTranslations("inbox.composer");
  const tWindow = useTranslations("inbox.window");
  const format = useFormatter();
  // Stable "now" (server render time) — avoids relativeTime fallback warnings.
  const now = useNow();

  const isWhatsapp = isWhatsappChannel(channel);

  // Composer text + the operator's edit/dirty tracking.
  const [text, setText] = useState("");
  const [subject, setSubject] = useState(suggestedSubject ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollState, setPollState] = useState<ComposerState | null>(null);
  // The suggestion id currently loaded into the textarea (so a re-poll of the
  // SAME suggestion doesn't clobber edits, but a NEWER one offers a refresh).
  const [shownPendingId, setShownPendingId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [supersedeAvailable, setSupersedeAvailable] = useState(false);
  // Closed-window re-engagement (WhatsApp): preview of the approved template, a
  // send-in-flight flag, and a sent flag. Sending a template does NOT reopen the
  // window from our side — that happens when the buyer replies — so after a
  // successful send we show a "sent" confirmation rather than the button again.
  const [reengagePreview, setReengagePreview] = useState<string | null>(null);
  const [reengagePreviewLoaded, setReengagePreviewLoaded] = useState(false);
  const [reengaging, setReengaging] = useState(false);
  const [reengaged, setReengaged] = useState(false);

  const pending = pollState?.pending ?? null;
  const whatsapp = pollState?.whatsapp ?? null;

  // WhatsApp window is closed only when the RPC positively says so. Email never
  // has window logic. `window_open` is the single source of truth.
  const windowClosed = isWhatsapp && whatsapp?.window_open === false;
  const neverMessaged =
    !!whatsapp && whatsapp.last_inbound_whatsapp_at == null;
  const lastInbound = whatsapp?.last_inbound_whatsapp_at ?? null;
  const relTime = lastInbound
    ? format.relativeTime(new Date(lastInbound), now)
    : null;
  const name = leadName?.trim() || tWindow("thisBuyer");

  // Refetch the composer state. We keep the latest-call guard in a ref so a
  // slow earlier poll can't overwrite a newer one's result.
  const reqRef = useRef(0);
  const refetch = useCallback(async () => {
    const req = ++reqRef.current;
    const res = await getComposerStateAction(conversationId, leadId, channel);
    if (req !== reqRef.current) return; // a newer poll already landed
    if (res.ok) setPollState(res.data);
    // A transient poll failure is silent — we keep the last good state.
  }, [conversationId, leadId, channel]);

  // Poll on mount + on window focus + every 18s; clear on unmount.
  useEffect(() => {
    void refetch();
    const onFocus = () => void refetch();
    window.addEventListener("focus", onFocus);
    const id = setInterval(() => void refetch(), 18000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(id);
    };
  }, [refetch]);

  // Once the WhatsApp window is known-closed, fetch the rendered preview of the
  // approved re-engagement template (what the buyer will receive). Fetched once;
  // null body → the affordance shows a calm fallback, never an empty box.
  useEffect(() => {
    if (!windowClosed || reengagePreviewLoaded) return;
    let alive = true;
    void getReengagePreviewAction(leadId).then((res) => {
      if (!alive) return;
      if (res.ok) setReengagePreview(res.data.body);
      setReengagePreviewLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [windowClosed, reengagePreviewLoaded, leadId]);

  // Sync rule — reconcile the textarea against the freshly-polled pending task.
  useEffect(() => {
    if (!pending) {
      // FREEFORM. Do NOT clobber text the user is typing; text only clears on a
      // successful send/dismiss. Just drop any stale suggested-state markers.
      setShownPendingId(null);
      setSupersedeAvailable(false);
      return;
    }
    if (pending.ai_draft_pending) {
      // The AI couldn't draft here — show the empty composer with a note; the
      // operator writes their own reply (Send still approves with the typed text).
      if (!dirty && shownPendingId !== pending.id) {
        setText("");
        setShownPendingId(pending.id);
      }
      setSupersedeAvailable(false);
      return;
    }
    // A real AI draft is pending.
    if (!dirty) {
      // Adopt the draft (and the email subject) when the operator hasn't edited.
      if (shownPendingId !== pending.id) {
        setText(pending.message_body);
        if (!isWhatsapp) setSubject(suggestedSubject ?? "");
        setShownPendingId(pending.id);
      }
      setSupersedeAvailable(false);
    } else if (pending.id !== shownPendingId) {
      // The operator is mid-edit on an older draft and a newer one arrived —
      // offer a subtle refresh rather than discarding their work.
      setSupersedeAvailable(true);
    }
  }, [pending, dirty, shownPendingId, isWhatsapp, suggestedSubject]);

  // Load the newer suggested draft, discarding the in-progress edit (operator
  // chose "refresh"). Clears dirty so the next render adopts it cleanly.
  const loadNewerDraft = useCallback(() => {
    if (!pending) return;
    setText(pending.message_body);
    if (!isWhatsapp) setSubject(suggestedSubject ?? "");
    setShownPendingId(pending.id);
    setDirty(false);
    setSupersedeAvailable(false);
    setError(null);
  }, [pending, isWhatsapp, suggestedSubject]);

  const trimmed = text.trim();
  const sendDisabled = busy || windowClosed || trimmed.length === 0;

  async function handleSend() {
    if (sendDisabled) return; // double-submit + state guard
    setBusy(true);
    setError(null);
    const res = pending
      ? await sendSuggestedAction(pending.id, text)
      : await sendFreeformAction(
          leadId,
          text,
          !isWhatsapp ? (subject.trim() || null) : null,
          isWhatsapp ? "whatsapp" : "email",
        );
    if (res.ok) {
      setText("");
      setSubject(suggestedSubject ?? "");
      setDirty(false);
      // Mark the just-acted suggestion as already-shown (NOT null) so the sync
      // effect can't re-adopt its draft into the cleared textarea in the window
      // before the refetch nulls `pending` — otherwise the box refills with the
      // message we just sent (a stale freeform re-send risk). The refetch then
      // sets pending → null and the effect resets shownPendingId to null.
      setShownPendingId(pending?.id ?? null);
      setSupersedeAvailable(false);
      setError(null);
      setBusy(false);
      void refetch();
      onActionDone();
    } else {
      setError(res.error);
      setBusy(false); // keep the text so the operator can retry
      // Defensive catch: the window closed between the last poll and this send.
      // Re-poll so windowClosed flips true → the composer swaps to the
      // re-engage affordance instead of leaving a dead error.
      if (res.windowClosed) void refetch();
    }
  }

  /** Send the approved re-engagement template to re-open a closed window. */
  async function handleReengage() {
    if (reengaging || reengaged) return;
    setReengaging(true);
    setError(null);
    const res = await reengageAction(leadId);
    if (res.ok) {
      setReengaged(true);
      setReengaging(false);
      setError(null);
      onActionDone(); // reconcile the thread → the queued template bubble appears
    } else {
      setError(res.error);
      setReengaging(false);
    }
  }

  async function handleDismiss() {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    const res = await dismissSuggestedAction(pending.id);
    if (res.ok) {
      setText("");
      setSubject(suggestedSubject ?? "");
      setDirty(false);
      // Same re-adopt guard as handleSend — keep the acted id so the cleared
      // textarea isn't refilled with the dismissed draft before refetch.
      setShownPendingId(pending?.id ?? null);
      setSupersedeAvailable(false);
      setError(null);
      setBusy(false);
      void refetch();
      onActionDone();
    } else {
      setError(res.error);
      setBusy(false);
    }
  }

  const isSuggested = pending !== null;
  const aiDraftPending = pending?.ai_draft_pending === true;
  // Read-only translated preview of the AI draft, in the agency's language, so
  // the operator can read a draft written in the lead's language. Reference
  // only — the editable textarea (lead language) is always what Send transmits.
  // Null when there's no real draft (ai_draft_pending), no translation needed
  // (same-language lead), or it hasn't landed yet → the helper just hides.
  const draftPreview =
    isSuggested && !aiDraftPending
      ? (pending?.suggested_reply_translated_owner?.trim() || null)
      : null;

  return (
    <div className="border-t border-border bg-card px-5 py-4">
      {/* WhatsApp 24h window banner — honest, code-free (Law 2). Send is
          disabled while it's up; the textarea stays editable. */}
      {windowClosed ? (
        <div className="mb-2.5 rounded-xl border border-amber-500/15 bg-amber-500/[0.045] px-3.5 py-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-600 dark:text-amber-300/90">
            <Lock className="h-3 w-3" aria-hidden strokeWidth={1.75} />
            {neverMessaged ? tWindow("neverTitle") : tWindow("closedTitle")}
          </div>
          <p className="text-[12.5px] leading-[1.55] text-muted-foreground">
            {tComposer("windowBanner")}
          </p>
        </div>
      ) : null}

      {windowClosed ? (
        /* CLOSED WINDOW — a freeform reply is illegal until the buyer messages
           again; the only WhatsApp-legal action is the approved re-engagement
           template. Replace the freeform composer with it. */
        <div className="flex flex-col gap-3">
          {reengaged ? (
            <div className="flex items-start gap-1.5 rounded-[13px] border border-brand/20 bg-brand-soft/50 p-3 text-[12.5px] text-foreground">
              <MessageCircle
                className="mt-px h-3.5 w-3.5 shrink-0 text-brand"
                aria-hidden
                strokeWidth={2}
              />
              <span>{tWindow("reengageSent")}</span>
            </div>
          ) : (
            <>
              <p className="text-[12.5px] leading-[1.5] text-muted-foreground">
                {tWindow("reengageLead")}
              </p>
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                <div className="mb-1 flex items-center gap-1 font-mono text-[8.5px] uppercase tracking-[0.05em] text-muted-foreground">
                  <MessageCircle className="h-3 w-3" aria-hidden strokeWidth={1.9} />
                  {tWindow("reengagePreviewLabel")}
                </div>
                <p className="whitespace-pre-wrap text-[12px] leading-[1.5] text-foreground">
                  {reengagePreview ?? tWindow("reengageNoPreview")}
                </p>
              </div>
              {error ? (
                <div
                  role="alert"
                  className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-700 dark:text-rose-300"
                >
                  {error}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  className="gap-1.5"
                  disabled={reengaging}
                  onClick={handleReengage}
                >
                  <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                  {reengaging ? t("sending") : tWindow("reengageSend")}
                </Button>
                {isSuggested ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="gap-1.5 text-muted-foreground hover:text-foreground"
                    disabled={busy}
                    onClick={handleDismiss}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                    {busy ? t("dismissing") : t("dismiss")}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : (
        <>
      {/* State label — SUGGESTED shows the AI tag (reused styling); FREEFORM
          shows nothing special. */}
      {isSuggested ? (
        <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.05em] text-brand">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          {t("aiSuggested")}
        </div>
      ) : null}

      {/* "AI couldn't draft" note — empty textarea, operator writes their own. */}
      {aiDraftPending ? (
        <p className="mb-2 text-[12px] leading-[1.5] text-muted-foreground">
          {tComposer("aiCouldntDraft")}
        </p>
      ) : null}

      {/* Supersede affordance — a newer draft arrived while the operator was
          editing an older one. */}
      {supersedeAvailable ? (
        <button
          type="button"
          onClick={loadNewerDraft}
          className="mb-2 inline-flex items-center gap-1 rounded-md bg-brand-soft px-2 py-1 text-[11px] font-medium text-brand underline-offset-2 hover:underline"
        >
          {tComposer("supersede")}
        </button>
      ) : null}

      {/* Email subject — prefilled in the suggested state, editable. WhatsApp
          has no subject. */}
      {!isWhatsapp ? (
        <div className="mb-2 flex flex-col gap-1">
          <label
            htmlFor={`composer-subj-${leadId}`}
            className="font-mono text-[9.5px] uppercase tracking-wide text-muted-foreground"
          >
            {t("subjectLabel")}
          </label>
          <Input
            id={`composer-subj-${leadId}`}
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              setDirty(true);
            }}
          />
        </div>
      ) : null}

      <textarea
        id={`composer-body-${leadId}`}
        rows={4}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        placeholder={tComposer("placeholder")}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-[12.5px] leading-[1.5] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      {/* Read-only translated preview of the AI draft — lets the operator read a
          draft written in the lead's language. Visually a static, muted block
          (not an input) so it's unmistakable that editing happens in the box
          above and this never changes what Send transmits. Reflects the original
          AI draft; not re-translated as the operator edits (no endpoint for it). */}
      {draftPreview ? (
        <div className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2">
          <div className="mb-1 flex items-center gap-1 font-mono text-[8.5px] uppercase tracking-[0.05em] text-muted-foreground">
            <Languages className="h-3 w-3" aria-hidden strokeWidth={1.9} />
            {tComposer("translatedPreview")}
          </div>
          <p className="whitespace-pre-wrap text-[12px] leading-[1.5] text-muted-foreground">
            {draftPreview}
          </p>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-700 dark:text-rose-300"
        >
          {error}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          className="gap-1.5"
          disabled={sendDisabled}
          onClick={handleSend}
        >
          <Send className="h-3.5 w-3.5" aria-hidden />
          {busy ? t("sending") : t("send")}
        </Button>

        {isSuggested ? (
          <Button
            type="button"
            variant="ghost"
            className="gap-1.5 text-muted-foreground hover:text-foreground"
            disabled={busy}
            onClick={handleDismiss}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            {busy ? t("dismissing") : t("dismiss")}
          </Button>
        ) : null}
      </div>
        </>
      )}
    </div>
  );
}

// ---------- summary pane ----------

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.05em] text-muted-foreground">
        {label}
      </div>
      <div className="text-[12.5px] font-semibold text-foreground">
        {value}
      </div>
    </div>
  );
}

// ---------- buyers card view ----------

function BuyersCardsView({
  rows,
  groupInfo,
  selectedId,
  onCardClick,
  locale,
}: {
  rows: InboxRow[];
  /** Present only for the buyers stream (item D). Undefined = no dedup/badge. */
  groupInfo?: ConvoGroupInfo;
  selectedId: string | null;
  onCardClick: (id: string) => void;
  locale: string;
}) {
  const t = useTranslations("inbox.buyers");
  const tInbox = useTranslations("inbox");
  const tSum = useTranslations("inbox.summary");

  if (rows.length === 0) {
    return (
      <Card size="sm">
        <EmptyState
          icon={LayoutGrid}
          title={t("emptyTitleCards")}
          description={t("emptyTextCards")}
        />
      </Card>
    );
  }

  const firstHandledIdx = groupInfo
    ? rows.findIndex((r) => groupInfo.get(r.taskId)?.state !== "needsYou")
    : -1;

  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
      {rows.map((r, i) => {
        const group = groupInfo?.get(r.taskId);
        const isSel = group
          ? selectedId != null && group.taskIds.includes(selectedId)
          : r.taskId === selectedId;
        const pendingCount = group?.pendingCount ?? 1;
        const state = group?.state;
        return (
        <Fragment key={r.taskId}>
        {firstHandledIdx > 0 && i === firstHandledIdx ? (
          <div className="col-span-full px-1 pt-1 font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {tInbox("handledDivider")}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => onCardClick(r.taskId)}
          className={cn(
            "group rounded-xl border bg-card p-4 text-left shadow-elevated transition-transform hover:-translate-y-0.5",
            isSel
              ? "border-brand ring-1 ring-brand/40"
              : "border-border",
          )}
        >
          <div className="mb-3 flex items-center gap-2.5">
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white",
                avatarTone(r.fullName ?? r.leadId),
              )}
            >
              {initialsOf(r.fullName ?? "Unknown")}
            </span>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-[14px] font-bold text-foreground">
                {r.fullName ?? "Unknown"}
              </span>
              <RelativeTime
                iso={r.taskCreatedAt}
                className="font-mono text-[10px] text-muted-foreground"
              />
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {state ? <StateBadge state={state} /> : null}
              {pendingCount > 1 ? (
                <span className="rounded-full bg-muted px-1.5 py-[1px] font-mono text-[9px] font-medium text-muted-foreground">
                  {t("pendingBadge", { n: pendingCount })}
                </span>
              ) : null}
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  temperatureDot(r.temperature),
                )}
                aria-hidden
              />
            </div>
          </div>
          <CardKV label={tSum("area")} value={r.area ?? "—"} />
          <CardKV label={tSum("source")} value={r.source ?? "—"} />
          <CardKV label={tSum("language")} value={languageLabel(r.language)} />
          <CardKV label={tSum("channel")} value={r.channel ?? "—"} />
        </button>
        </Fragment>
        );
      })}
    </div>
  );
}

function CardKV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-t border-border py-1.5 text-[11.5px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}

// ---------- sellers empty state ----------

function SellersEmptyState({
  view,
  onSetUp,
}: {
  view: View;
  onSetUp: () => void;
}) {
  const t = useTranslations("inbox.sellers");
  return (
    <Card size="sm">
      <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Home className="h-5 w-5" aria-hidden strokeWidth={1.7} />
        </div>
        <div className="text-[14px] font-semibold text-foreground">
          {view === "convo" ? t("emptyTitleConvo") : t("emptyTitleCards")}
        </div>
        <p className="max-w-[360px] text-[12.5px] leading-[1.5] text-muted-foreground">
          {view === "convo" ? t("emptyText") : t("emptyTextCards")}
        </p>
        {view === "convo" ? (
          <Button type="button" onClick={onSetUp} className="mt-2 gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
            {t("setupButton")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------- network teaser ----------

function NetworkTeaser() {
  const t = useTranslations("inbox.network");
  const [sub, setSub] = useState<NetSub>("find");

  return (
    <div className="flex flex-col gap-3.5">
      {/* Banner */}
      <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-brand/40 bg-brand-soft px-3 py-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-brand">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        {t("banner")}
      </div>

      {/* Sub-toggle */}
      <div
        role="group"
        className="flex w-fit items-center gap-0.5 rounded-full border border-border bg-muted/60 p-0.5"
      >
        <button
          type="button"
          onClick={() => setSub("find")}
          aria-pressed={sub === "find"}
          className={cn(
            "rounded-full px-4 py-1.5 text-[12.5px] font-medium",
            sub === "find"
              ? "bg-card text-foreground shadow-soft"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t("subFind")}
        </button>
        <button
          type="button"
          onClick={() => setSub("convos")}
          aria-pressed={sub === "convos"}
          className={cn(
            "rounded-full px-4 py-1.5 text-[12.5px] font-medium",
            sub === "convos"
              ? "bg-card text-foreground shadow-soft"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t("subConvos")}
        </button>
      </div>

      {sub === "find" ? <NetworkFindView /> : <NetworkConvosView />}
    </div>
  );
}

function NetworkFindView() {
  const t = useTranslations("inbox.network");

  // Sample data — Law 1 explicitly allows watermarked samples here only.
  const listings = [
    {
      id: "s-1",
      title: "2-bed villa · Orihuela Costa",
      price: "€239,000",
      beds: "2 · 1 bath",
      heldBy: "Demo Agency · Costa Sol",
    },
    {
      id: "s-2",
      title: "2-bed apartment · La Zenia",
      price: "€198,000",
      beds: "2 · 2 bath",
      heldBy: "Sample Partner Homes",
    },
    {
      id: "s-3",
      title: "2-bed townhouse · Punta Prima",
      price: "€245,000",
      beds: "2 · 2 bath",
      heldBy: "Demo Costa Agency",
    },
  ];

  return (
    <div className="relative opacity-90">
      <Card size="sm">
        <CardContent className="flex items-center gap-3 px-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500 text-[12px] font-semibold text-white">
            SB
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-bold text-foreground">
              {t("lookingForTitle")}
            </div>
            <div className="truncate font-mono text-[10.5px] text-muted-foreground">
              {t("lookingForSubtitle")}
            </div>
          </div>
          <Button type="button" disabled className="gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
            {t("lookActionBtn")}
          </Button>
        </CardContent>
      </Card>

      <div className="mt-4 mb-3 px-1 font-mono text-[10.5px] tracking-[0.04em] text-muted-foreground">
        {t("matchesCount")}
      </div>

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
        {listings.map((l) => (
          <Card key={l.id} size="sm">
            <CardContent className="flex flex-col gap-2 px-4">
              <div className="mb-1 flex items-start gap-2">
                <Building2
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <div className="text-[13.5px] font-bold text-foreground">
                  {l.title}
                </div>
              </div>
              <CardKV label={t("price")} value={l.price} />
              <CardKV label={t("beds")} value={l.beds} />
              <CardKV label={t("heldBy")} value={l.heldBy} />
              <Button
                type="button"
                disabled
                className="mt-2 w-full justify-center gap-1.5"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
                {t("requestContact")}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2.5 rounded-md border border-brand/30 bg-brand-soft px-4 py-2.5 text-[12px] leading-[1.45] text-brand">
        <Lock className="h-4 w-4 shrink-0" aria-hidden />
        <span>{t("privacy")}</span>
      </div>
    </div>
  );
}

function NetworkConvosView() {
  const t = useTranslations("inbox.network");

  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-card opacity-90 shadow-elevated lg:grid-cols-[270px_minmax(0,1fr)_240px]">
      {/* Left: convo list (sample) */}
      <ul className="flex flex-col border-b border-border lg:border-b-0 lg:border-r">
        {[
          {
            id: "demo-1",
            name: "Demo Agency · Costa Sol",
            snippet: "Yes, still available — happy to split…",
            sel: true,
          },
          {
            id: "demo-2",
            name: "Sample Partner Homes",
            snippet: "Can do 50/50, when can your buyer view?",
            sel: false,
          },
        ].map((c) => (
          <li key={c.id}>
            <div
              className={cn(
                "flex flex-col gap-1 border-b border-border px-4 py-3 text-left",
                c.sel
                  ? "border-l-2 border-l-brand bg-brand-soft pl-[14px]"
                  : "",
              )}
            >
              <div className="truncate text-[13px] font-semibold text-foreground">
                {c.name}
              </div>
              <div className="truncate text-[11.5px] text-muted-foreground">
                {c.snippet}
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">
                {t("convoMeta")}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Middle: sample thread */}
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-500 text-[12px] font-semibold text-white">
            DA
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-bold text-foreground">
              Demo Agency · Costa Sol
            </div>
            <div className="font-mono text-[10.5px] text-muted-foreground">
              Re: 2-bed villa · Orihuela Costa · sample
            </div>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-2.5 p-5">
          <div className="max-w-[76%] self-end rounded-[13px] rounded-br-[4px] bg-brand-soft px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-foreground">
            Hi — I have a buyer who may be a fit for your Orihuela Costa villa.
            Would you consider a collaboration?
            <div className="mt-1.5 font-mono text-[9.5px] text-muted-foreground">
              You · sample (buyer kept private)
            </div>
          </div>
          <div className="max-w-[76%] self-start rounded-[13px] rounded-bl-[4px] bg-muted/70 px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-foreground">
            Yes, still available. Happy to split 50/50 if your buyer&apos;s
            serious — shall we set up a viewing?
            <div className="mt-1.5 font-mono text-[9.5px] text-muted-foreground">
              Demo Agency · sample
            </div>
          </div>
        </div>
        <div className="border-t border-border px-5 py-3 text-center font-mono text-[10px] tracking-wide text-muted-foreground">
          {t("agencySplit")}
        </div>
      </div>

      {/* Right: listing summary */}
      <div className="border-t border-border p-5 lg:border-t-0 lg:border-l">
        <div className="mb-3 font-mono text-[9.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          {t("listingHead")}
        </div>
        <SummaryField label={t("property")} value="Orihuela 2-bed villa" />
        <SummaryField label={t("price")} value="€239,000" />
        <SummaryField label={t("agency")} value="Demo Agency" />
        <SummaryField label={t("split")} value={t("splitValue")} />
      </div>
    </div>
  );
}

// ---------- valuation wizard modal ----------

function ValuationWizardModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("inbox.wizard");
  const tLang = useTranslations("settings.languages");
  const langs = [
    { code: "es", label: tLang("name_es"), on: true },
    { code: "en", label: tLang("name_en"), on: true },
    { code: "no", label: tLang("name_no"), on: true },
    { code: "pl", label: tLang("name_pl"), on: true },
    { code: "de", label: tLang("name_de"), on: true },
    { code: "fr", label: tLang("name_fr"), on: false },
  ];

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 px-4 py-12"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-border bg-card shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="flex-1">
            <div className="text-[16px] font-bold text-foreground">
              {t("title")}
            </div>
            <div className="mt-0.5 text-[12.5px] text-muted-foreground">
              {t("subtitle")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex flex-col gap-5 px-5 py-5">
          {/* Step indicators */}
          <div className="flex gap-2">
            <div className="h-1 flex-1 rounded-full bg-brand" />
            <div className="h-1 flex-1 rounded-full bg-brand" />
            <div className="h-1 flex-1 rounded-full bg-border" />
          </div>

          {/* Languages */}
          <div className="flex flex-col gap-2">
            <label className="text-[12.5px] font-semibold text-foreground">
              {t("langLabel")}
            </label>
            <div className="flex flex-wrap gap-2">
              {langs.map((l) => (
                <span
                  key={l.code}
                  className={cn(
                    "rounded-full border px-3 py-1 text-[12px] font-medium",
                    l.on
                      ? "border-brand/30 bg-brand-soft text-brand"
                      : "border-border bg-card text-muted-foreground",
                  )}
                >
                  {l.label}
                </span>
              ))}
            </div>
          </div>

          {/* Areas */}
          <div className="flex flex-col gap-2">
            <label
              htmlFor="wiz-areas"
              className="text-[12.5px] font-semibold text-foreground"
            >
              {t("areasLabel")}
            </label>
            <Input
              id="wiz-areas"
              defaultValue=""
              placeholder={t("areasPlaceholder")}
            />
          </div>

          {/* Branding */}
          <div className="flex flex-col gap-2">
            <label className="text-[12.5px] font-semibold text-foreground">
              {t("brandingLabel")}
            </label>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-foreground text-[15px] font-bold text-brand">
                A
              </div>
              <span className="text-[12.5px] text-muted-foreground">
                {t("brandingNote")}
              </span>
            </div>
          </div>

          {/* Embed snippet */}
          <div className="flex flex-col gap-2">
            <label className="text-[12.5px] font-semibold text-foreground">
              {t("embedLabel")}
            </label>
            <div className="overflow-hidden rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-[11.5px] text-muted-foreground">
              &lt;script src=&quot;https://embed.aivena.es/v.js&quot;
              data-agency=&quot;...&quot;&gt;&lt;/script&gt;
            </div>
            <div className="text-[11px] text-muted-foreground">
              {t("embedNote")}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="button" className="gap-1.5" disabled>
              <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
              {t("activate")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
