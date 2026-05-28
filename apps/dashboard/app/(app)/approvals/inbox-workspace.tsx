"use client";

import {
  Fragment,
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Building2,
  Globe,
  Home,
  Inbox as InboxIcon,
  LayoutGrid,
  Lock,
  Mail,
  MessageCircle,
  MessageSquare,
  Pencil,
  Phone,
  Send,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RelativeTime } from "@/components/ui/relative-time";
import {
  approveTaskAction,
  dismissTaskAction,
} from "@/app/(app)/approvals/[taskId]/actions";
import { loadTaskDetailAction } from "./inbox-actions";
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

function languageLabel(code: string | null): string {
  if (!code) return "—";
  return code.toUpperCase();
}

function scoreTemperatureLine(
  score: number | null,
  temperature: string | null,
): string {
  const t = temperature ? temperature.replace("_", " ") : null;
  if (typeof score === "number" && t) return `${t} · score ${score}`;
  if (typeof score === "number") return `score ${score}`;
  if (t) return t;
  return "";
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
}: {
  locale: string;
  rows: InboxRow[];
  initialTaskId?: string;
}) {
  const t = useTranslations("inbox");

  // dashboard_inbox spans every bucket, so a conversation stays in the list
  // after Approve & Send (its badge flips needs_you → Replied/Auto-handled)
  // instead of vanishing. We show all buckets and let the per-row state badge
  // carry the meaning.
  const buyers = useMemo(() => rows.filter((r) => !isSeller(r)), [rows]);
  const sellers = useMemo(() => rows.filter((r) => isSeller(r)), [rows]);

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
    if (initialTaskId && buyers.some((r) => r.taskId === initialTaskId))
      return "buyers";
    if (initialTaskId && sellers.some((r) => r.taskId === initialTaskId))
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
    initialTaskId &&
    [...buyers, ...sellers].some((r) => r.taskId === initialTaskId)
      ? initialTaskId
      : (buyers[0]?.taskId ?? sellers[0]?.taskId ?? null);
  const [selectedBuyerId, setSelectedBuyerId] = useState<string | null>(
    isSeller(rows.find((r) => r.taskId === initialSelected) ?? ({} as InboxRow))
      ? (buyers[0]?.taskId ?? null)
      : initialSelected,
  );
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(
    sellers[0]?.taskId ?? null,
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

  useEffect(() => {
    if (selectedId && view === "convo") loadThread(selectedId);
  }, [selectedId, view, loadThread]);

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
            }}
            selected={
              selected && !isSeller(selected) ? selected : null
            }
            threadEntry={
              selectedBuyerId ? threadCache[selectedBuyerId] : undefined
            }
            locale={locale}
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
              }}
              selected={
                selected && isSeller(selected) ? selected : null
              }
              threadEntry={
                selectedSellerId ? threadCache[selectedSellerId] : undefined
              }
              locale={locale}
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
  locale,
}: {
  rows: InboxRow[];
  /** Present only for the buyers stream (item D). Undefined = no dedup/badge. */
  groupInfo?: ConvoGroupInfo;
  selectedId: string | null;
  onSelect: (id: string) => void;
  selected: InboxRow | null;
  threadEntry?: { status: "loading" | "ok" | "failed"; data?: TaskDetailResponse };
  locale: string;
}) {
  const t = useTranslations("inbox");

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

  // Rows arrive needs-you-first; the divider marks where handled rows begin.
  // Only shown when both groups are non-empty (index > 0 ⇒ ≥1 needs-you above).
  const firstHandledIdx = groupInfo
    ? rows.findIndex((r) => groupInfo.get(r.taskId)?.state !== "needsYou")
    : -1;

  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-card shadow-elevated lg:grid-cols-[270px_minmax(0,1fr)_240px]">
      {/* Left: convo list */}
      <ul className="flex max-h-[640px] flex-col overflow-y-auto border-b border-border lg:border-b-0 lg:border-r">
        {rows.map((r, i) => {
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

      {/* Middle: thread + reply */}
      <div className="flex min-w-0 flex-col">
        {selected ? (
          <ThreadAndReply
            lead={selected}
            threadEntry={threadEntry}
            locale={locale}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
            {t("buyers.emptyConvo")}
          </div>
        )}
      </div>

      {/* Right: summary */}
      <div className="border-t border-border p-5 lg:border-t-0 lg:border-l">
        {selected ? <LeadSummary lead={selected} /> : null}
      </div>
    </div>
  );
}

// ---------- thread + reply zone ----------

function ThreadAndReply({
  lead,
  threadEntry,
  locale,
}: {
  lead: InboxRow;
  threadEntry?: { status: "loading" | "ok" | "failed"; data?: TaskDetailResponse };
  locale: string;
}) {
  const t = useTranslations("inbox");
  const tThread = useTranslations("inbox.thread");
  const tErr = useTranslations("errors");

  const headSubline = `${lead.area ?? "—"} · ${languageLabel(lead.language)}`;

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
      </div>

      {/* Body */}
      <div className="flex max-h-[420px] flex-1 flex-col gap-2.5 overflow-y-auto p-5">
        {threadEntry?.status === "loading" || threadEntry === undefined ? (
          <ThreadSkeleton />
        ) : threadEntry.status === "failed" ? (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-[12px] text-muted-foreground">
            {tErr("pageLoad")}
          </div>
        ) : threadEntry.data && threadEntry.data.thread.length > 0 ? (
          threadEntry.data.thread.map((m) => (
            <ThreadBubble key={m.id} msg={m} locale={locale} t={tThread} />
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
                  createdAt: lead.taskCreatedAt,
                }}
                locale={locale}
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

      {/* Reply zone */}
      <ReplyZone
        taskId={lead.taskId}
        initialSubject={lead.aiReplySubject ?? ""}
        initialBody={lead.aiReplyBody ?? ""}
      />
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

function ThreadBubble({
  msg,
  locale,
  t,
}: {
  msg: ThreadMessage;
  locale: string;
  t: ReturnType<typeof useTranslations<"inbox.thread">>;
}) {
  const inbound = msg.direction === "inbound";
  // Inbound bodies carry the buyer's quote chain / footer in `content`;
  // `bodyClean` is the server-stripped version. Outbound is composed in the
  // dashboard and never quoted, so it renders raw `content`.
  const body = inbound ? (msg.bodyClean ?? msg.content) : msg.content;
  return (
    <div
      className={cn(
        "max-w-[76%] rounded-[13px] px-3.5 py-2.5 text-[12.5px] leading-[1.5]",
        inbound
          ? "self-start rounded-bl-[4px] bg-muted/70 text-foreground"
          : "self-end rounded-br-[4px] bg-brand-soft text-foreground",
      )}
    >
      <div className="whitespace-pre-wrap">
        {body ?? <span className="italic opacity-70">(empty)</span>}
      </div>
      <div className="mt-1.5 font-mono text-[9.5px] text-muted-foreground">
        {inbound ? t("inbound") : t("outbound")} ·{" "}
        <RelativeTime iso={msg.createdAt} />
      </div>
    </div>
  );
}

// ---------- reply zone (Send / Edit / Dismiss) ----------

function ReplyZone({
  taskId,
  initialSubject,
  initialBody,
}: {
  taskId: string;
  initialSubject: string;
  initialBody: string;
}) {
  const t = useTranslations("inbox.reply");

  // Send / approve action — reuses the existing wired path.
  const [sendState, sendAction, sending] = useActionState(approveTaskAction, {});
  const [dismissState, dismissAction, dismissing] = useActionState(
    dismissTaskAction,
    {},
  );

  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [dismissOpen, setDismissOpen] = useState(false);

  // Reset local state when the selected task changes.
  useEffect(() => {
    setSubject(initialSubject);
    setBody(initialBody);
    setEditing(false);
    setDismissOpen(false);
  }, [taskId, initialSubject, initialBody]);

  return (
    <div className="border-t border-border bg-card px-5 py-4">
      <div className="rounded-[13px] border border-brand/20 bg-brand-soft p-3.5">
        <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.05em] text-brand">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          {t("aiSuggested")}
        </div>

        {editing ? (
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`subj-${taskId}`}
                className="font-mono text-[9.5px] uppercase tracking-wide text-muted-foreground"
              >
                {t("subjectLabel")}
              </label>
              <Input
                id={`subj-${taskId}`}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`body-${taskId}`}
                className="font-mono text-[9.5px] uppercase tracking-wide text-muted-foreground"
              >
                {t("bodyLabel")}
              </label>
              <textarea
                id={`body-${taskId}`}
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-[12.5px] leading-[1.5] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
        ) : (
          <>
            {subject ? (
              <div className="text-[11.5px] font-semibold text-foreground">
                {subject}
              </div>
            ) : null}
            <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-[1.5] text-foreground">
              {body}
            </p>
          </>
        )}
      </div>

      {sendState.error ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-700 dark:text-rose-300"
        >
          {sendState.error}
        </div>
      ) : null}

      {/* Action row — Send / Edit / Dismiss (existing wired actions) */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={sendAction}>
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="subject" value={subject} />
          <input type="hidden" name="body" value={body} />
          <Button
            type="submit"
            className="gap-1.5"
            disabled={sending || dismissing || !body}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
            {sending ? t("sending") : t("send")}
          </Button>
        </form>

        <Button
          type="button"
          variant="outline"
          className="gap-1.5"
          onClick={() => setEditing((v) => !v)}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          {editing ? t("editing") : t("edit")}
        </Button>

        <Button
          type="button"
          variant="ghost"
          className="gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => setDismissOpen((v) => !v)}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          {t("dismiss")}
        </Button>
      </div>

      {dismissOpen ? (
        <form
          action={dismissAction}
          className="mt-3 flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3"
        >
          <input type="hidden" name="taskId" value={taskId} />
          <label className="font-mono text-[9.5px] uppercase tracking-wide text-muted-foreground">
            {t("dismissReasonLabel")}
          </label>
          <Input
            name="reason"
            placeholder={t("dismissReasonPlaceholder")}
            required
          />
          {dismissState.error ? (
            <div
              role="alert"
              className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-700 dark:text-rose-300"
            >
              {dismissState.error}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" variant="outline" disabled={dismissing}>
              {dismissing ? t("dismissing") : t("confirmDismiss")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDismissOpen(false)}
              disabled={dismissing}
            >
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

// ---------- summary pane ----------

function LeadSummary({ lead }: { lead: InboxRow }) {
  const t = useTranslations("inbox.summary");
  const scoreLine = scoreTemperatureLine(lead.score, lead.temperature);
  return (
    <div className="flex flex-col gap-3">
      <div className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {t("h")}
      </div>
      <SummaryField label={t("area")} value={lead.area ?? "—"} />
      <SummaryField
        label={t("score")}
        value={scoreLine || "—"}
      />
      <SummaryField label={t("source")} value={lead.source ?? "—"} />
      <SummaryField
        label={t("language")}
        value={languageLabel(lead.language)}
      />
      <SummaryField
        label={t("channel")}
        value={lead.channel ?? "—"}
      />
    </div>
  );
}

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
          <CardKV label="Area" value={r.area ?? "—"} />
          <CardKV label="Source" value={r.source ?? "—"} />
          <CardKV label="Language" value={languageLabel(r.language)} />
          <CardKV label="Channel" value={r.channel ?? "—"} />
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
  const langs = [
    { code: "es", label: "Español", on: true },
    { code: "en", label: "English", on: true },
    { code: "nb", label: "Norsk", on: true },
    { code: "pl", label: "Polski", on: true },
    { code: "de", label: "Deutsch", on: true },
    { code: "fr", label: "Français", on: false },
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
