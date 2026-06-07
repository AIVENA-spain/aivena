"use client";

import { useState } from "react";
import {
  Bot,
  Building2,
  CalendarCheck,
  CalendarClock,
  Check,
  Globe,
  Inbox,
  LayoutGrid,
  LineChart,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  PhoneIncoming,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  CHANNEL_LABEL,
  DEMO_ACTIVITY,
  DEMO_AGENCY,
  DEMO_KPIS,
  DEMO_LEADS,
  DEMO_MATCHES,
  DEMO_PERF,
  DEMO_PLAN,
  DEMO_PROPERTIES,
  DEMO_RECOVERIES,
  DEMO_SELLER,
  DEMO_STUDIO,
  DEMO_VIEWINGS,
  LANG_LABEL,
  type Channel,
  type ConvoState,
  type DemoLead,
  type Lang,
  type Temp,
} from "./fixtures";

type Section =
  | "overview" | "inbox" | "properties" | "viewings"
  | "performance" | "studio" | "matches" | "settings";

const NAV: Array<{ key: Section; label: string; icon: LucideIcon; badge?: number }> = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "inbox", label: "Inbox", icon: Inbox, badge: 5 },
  { key: "properties", label: "Properties", icon: Building2 },
  { key: "viewings", label: "Viewings", icon: CalendarCheck },
  { key: "performance", label: "Performance", icon: LineChart },
  { key: "studio", label: "Studio", icon: Sparkles },
  { key: "matches", label: "Matches", icon: Users },
  { key: "settings", label: "Settings", icon: Settings },
];

const SECTION_TITLE: Record<Section, string> = {
  overview: "Overview", inbox: "Inbox", properties: "Properties", viewings: "Viewings",
  performance: "Performance", studio: "Studio", matches: "Matches", settings: "Settings",
};

const CHANNEL_ICON: Record<Channel, LucideIcon> = {
  whatsapp: MessageCircle, website: Globe, email: Mail, ads: MessageCircle,
};

function tempDot(t: Temp): string {
  if (t === "super_hot" || t === "hot") return "bg-rose-600";
  if (t === "warm") return "bg-amber-500";
  return "bg-sky-500";
}
function eur(n: number): string {
  return "€" + n.toLocaleString("en-US");
}
function langFlag(l: Lang): string {
  return l.toUpperCase();
}

/**
 * Public, fixture-driven demo of the real dashboard. Forced dark to match the
 * landing. No auth, no Supabase — all data is static fixtures. Nav switches
 * sections in-page; Inbox approve/edit/dismiss are local UI state.
 */
export function DemoClient() {
  const [section, setSection] = useState<Section>("overview");
  const [assistant, setAssistant] = useState(false);

  return (
    <div className="dark flex min-h-screen bg-background text-foreground antialiased">
      {/* Sidebar */}
      <aside className="hidden w-[210px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex items-center gap-2.5 px-4 pt-5 pb-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-[14px] font-bold leading-none text-brand">
            A
          </div>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-[13px] font-bold tracking-[0.02em] text-foreground">AIVENA</span>
            <span className="font-mono text-[9.5px] tracking-[0.02em] text-muted-foreground">AI real estate</span>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
          {NAV.map((item) => {
            const active = section === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSection(item.key)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-[9px] px-3 py-2 text-[13px] font-medium transition-colors",
                  active ? "bg-brand-soft text-brand" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden strokeWidth={1.8} />
                <span className="truncate">{item.label}</span>
                {item.badge ? (
                  <span className={cn(
                    "ml-auto rounded-full px-1.5 py-[1px] text-[10px] font-semibold",
                    active ? "bg-brand text-brand-fg" : "bg-foreground text-background",
                  )}>
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center gap-2.5 border-t border-foreground/10 px-4 py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-semibold text-white">
            {DEMO_AGENCY.initial}
          </span>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[12px] font-semibold text-foreground">{DEMO_AGENCY.name}</span>
            <span className="truncate font-mono text-[9.5px] text-muted-foreground">{DEMO_AGENCY.region}</span>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="flex h-16 items-center gap-3 border-b border-border bg-card px-6">
          <div className="flex min-w-0 flex-col leading-tight">
            <h1 className="text-[19px] font-bold tracking-[-0.02em] text-foreground">{SECTION_TITLE[section]}</h1>
            <p className="truncate text-[12.5px] text-muted-foreground">{DEMO_AGENCY.name} · Costa Blanca</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* Mobile nav (compact) */}
            <select
              value={section}
              onChange={(e) => setSection(e.target.value as Section)}
              className="rounded-lg border border-border bg-card px-2 py-1.5 text-[12px] text-foreground md:hidden"
              aria-label="Section"
            >
              {NAV.map((n) => <option key={n.key} value={n.key}>{n.label}</option>)}
            </select>
            <span className="hidden items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-[12px] text-muted-foreground sm:flex">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden /> 7 Jun
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto w-full max-w-6xl">
            {section === "overview" && <Overview onOpenInbox={() => setSection("inbox")} />}
            {section === "inbox" && <InboxSection />}
            {section === "properties" && <Properties />}
            {section === "viewings" && <Viewings />}
            {section === "performance" && <Performance />}
            {section === "studio" && <Studio />}
            {section === "matches" && <Matches />}
            {section === "settings" && <SettingsSection />}
          </div>
        </main>
      </div>

      {/* AIVENA Assistant widget */}
      <AssistantWidget open={assistant} setOpen={setAssistant} />
    </div>
  );
}

// ───────────────────────── shared bits ─────────────────────────

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl bg-card py-4 text-card-foreground shadow-elevated ring-1 ring-foreground/10", className)}>
      {children}
    </div>
  );
}
function Pill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "brand" | "muted" | "amber" }) {
  const tones = {
    brand: "border-brand/30 bg-brand-soft text-brand",
    muted: "border-border bg-card text-muted-foreground",
    amber: "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-medium", tones[tone])}>
      {children}
    </span>
  );
}
function ChannelTag({ channel }: { channel: Channel }) {
  const Icon = CHANNEL_ICON[channel];
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <Icon className="h-3 w-3" aria-hidden /> {CHANNEL_LABEL[channel]}
    </span>
  );
}

// ───────────────────────── Overview ─────────────────────────

function Overview({ onOpenInbox }: { onOpenInbox: () => void }) {
  const k = DEMO_KPIS;
  const kpis: Array<{ label: string; value: number; delta?: number; icon: LucideIcon; soon?: boolean }> = [
    { label: "New buyers", value: k.newBuyers.value, delta: k.newBuyers.delta, icon: Users },
    { label: "Needs action", value: k.needsAction.value, icon: Inbox },
    { label: "Hot leads", value: k.hotLeads.value, icon: Sparkles },
    { label: "New sellers", value: k.newSellers.value, delta: k.newSellers.delta, icon: Building2 },
    { label: "Follow-ups sent", value: k.followupsSent.value, delta: k.followupsSent.delta, icon: Send },
    { label: "Calls Recovered", value: k.callsRecovered.value, delta: k.callsRecovered.delta, icon: Phone },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-3">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="px-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-brand-soft text-brand">
                <kpi.icon className="h-4 w-4" aria-hidden strokeWidth={1.9} />
              </div>
              <span className="text-[11.5px] font-medium leading-tight text-muted-foreground">{kpi.label}</span>
            </div>
            <div className="font-sans text-[32px] font-bold leading-none tracking-[-0.03em] text-foreground">
              {kpi.value}
            </div>
            {typeof kpi.delta === "number" ? (
              <div className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">▲ {kpi.delta} vs last week</div>
            ) : <div className="font-mono text-[11px] text-muted-foreground">right now</div>}
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Needs you */}
        <Card className="px-0">
          <div className="flex items-baseline justify-between px-4">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Needs you</h2>
            <button type="button" onClick={onOpenInbox} className="text-[12px] font-medium text-brand hover:underline">Open Inbox →</button>
          </div>
          <ul className="flex flex-col">
            {DEMO_LEADS.filter((l) => l.state === "needsYou").map((l) => (
              <li key={l.id} className="flex items-center gap-3 border-t border-border px-4 py-2.5">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tempDot(l.temp))} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-foreground">{l.name}</span>
                    <Pill>{langFlag(l.lang)}</Pill>
                  </div>
                  <div className="truncate text-[11.5px] text-muted-foreground">{l.preview}</div>
                </div>
                <ChannelTag channel={l.channel} />
                <span className="font-mono text-[10.5px] text-muted-foreground">{l.ago}</span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="flex flex-col gap-5">
          {/* Recovery */}
          <Card className="px-4">
            <div className="flex items-center gap-2">
              <PhoneIncoming className="h-4 w-4 text-brand" aria-hidden />
              <h2 className="text-[13px] font-semibold text-foreground">Missed-call → WhatsApp recovery</h2>
            </div>
            <ul className="flex flex-col gap-2">
              {DEMO_RECOVERIES.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-[12px]">
                  <span className="font-mono text-muted-foreground">{r.number}</span>
                  <Pill tone={r.recovered ? "brand" : "muted"}>{langFlag(r.lang)}</Pill>
                  <span className="truncate text-muted-foreground">{r.outcome}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">{r.ago}</span>
                </li>
              ))}
            </ul>
          </Card>

          {/* Activity */}
          <Card className="px-4">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">Recent activity</h2>
            <ul className="flex flex-col gap-2">
              {DEMO_ACTIVITY.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-[12px]">
                  <ChannelTag channel={a.channel} />
                  <span className="truncate text-foreground">{a.name}</span>
                  <span className="truncate text-muted-foreground">· {a.label}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">{a.ago}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Inbox (interactive) ─────────────────────────

type Stream = "buyers" | "sellers";

function InboxSection() {
  const [stream, setStream] = useState<Stream>("buyers");
  const buyers = DEMO_LEADS.filter((l) => l.type === "buyer");
  const [selectedId, setSelectedId] = useState<string>(buyers[0].id);
  // local handled-state overrides per lead id
  const [states, setStates] = useState<Record<string, ConvoState>>({});

  const stateOf = (l: DemoLead): ConvoState => states[l.id] ?? l.state;
  const list = stream === "buyers" ? buyers : [];
  const selected = stream === "buyers" ? buyers.find((l) => l.id === selectedId) ?? buyers[0] : null;

  const needsYou = buyers.filter((l) => stateOf(l) === "needsYou").length;

  return (
    <div className="flex flex-col gap-3.5">
      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <StreamTab label="Buyers" active={stream === "buyers"} badge={needsYou} onClick={() => setStream("buyers")} />
        <StreamTab label="Sellers" active={stream === "sellers"} badge={1} onClick={() => setStream("sellers")} />
      </div>

      {stream === "buyers" ? (
        <div className="grid grid-cols-1 overflow-hidden rounded-xl bg-card shadow-elevated ring-1 ring-foreground/10 lg:grid-cols-[270px_minmax(0,1fr)_240px]">
          {/* list */}
          <ul className="flex max-h-[560px] flex-col overflow-y-auto border-b border-border lg:border-b-0 lg:border-r">
            {list.map((l) => {
              const st = stateOf(l);
              const sel = l.id === selectedId;
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(l.id)}
                    className={cn(
                      "flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left transition-colors",
                      sel ? "border-l-2 border-l-brand bg-brand-soft pl-[14px]" : "hover:bg-muted/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-foreground">{l.name}</span>
                      <div className="ml-auto flex shrink-0 items-center gap-1.5">
                        <StateBadge state={st} />
                        <span className={cn("h-1.5 w-1.5 rounded-full", tempDot(l.temp))} aria-hidden />
                      </div>
                    </div>
                    <div className="truncate text-[11.5px] text-muted-foreground">{l.preview}</div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>{langFlag(l.lang)} · {CHANNEL_LABEL[l.channel]} · {l.ago}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* thread + reply */}
          <div className="flex min-w-0 flex-col">
            {selected ? (
              <ThreadAndReply
                key={selected.id}
                lead={selected}
                state={stateOf(selected)}
                onApprove={() => setStates((s) => ({ ...s, [selected.id]: "replied" }))}
                onDismiss={() => setStates((s) => ({ ...s, [selected.id]: "waiting" }))}
              />
            ) : null}
          </div>

          {/* summary */}
          <div className="hidden flex-col gap-4 border-l border-border p-5 lg:flex">
            {selected ? <LeadSummary lead={selected} /> : null}
          </div>
        </div>
      ) : (
        <SellersTab />
      )}
    </div>
  );
}

function StreamTab({ label, active, badge, onClick }: { label: string; active: boolean; badge?: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold shadow-soft transition-colors",
        active ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {badge ? (
        <span className={cn("rounded-full px-1.5 py-[1px] text-[10px] font-semibold", active ? "bg-brand text-brand-fg" : "bg-brand-soft text-brand")}>{badge}</span>
      ) : null}
    </button>
  );
}

function StateBadge({ state }: { state: ConvoState }) {
  const map: Record<ConvoState, { label: string; cls: string }> = {
    needsYou: { label: "Needs you", cls: "bg-brand-soft text-brand" },
    replied: { label: "Replied", cls: "bg-muted text-foreground" },
    autoHandled: { label: "Auto-handled", cls: "bg-muted text-muted-foreground" },
    waiting: { label: "Waiting", cls: "bg-muted text-muted-foreground" },
  };
  const s = map[state];
  return <span className={cn("shrink-0 rounded-full px-1.5 py-[1px] font-mono text-[9px] font-medium uppercase tracking-[0.03em]", s.cls)}>{s.label}</span>;
}

function ThreadAndReply({
  lead, state, onApprove, onDismiss,
}: {
  lead: DemoLead; state: ConvoState; onApprove: () => void; onDismiss: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(lead.draft ?? "");
  const sent = state === "replied";

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* head */}
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500 text-[12px] font-semibold text-white">
          {lead.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-bold text-foreground">{lead.name}</div>
          <div className="truncate font-mono text-[10.5px] text-muted-foreground">{lead.area} · {LANG_LABEL[lead.lang]} · {CHANNEL_LABEL[lead.channel]}</div>
        </div>
      </div>

      {/* thread */}
      <div className="flex max-h-[300px] flex-1 flex-col gap-2.5 overflow-y-auto p-5">
        {lead.thread.map((m) => (
          <Bubble key={m.id} inbound={m.direction === "inbound"} body={m.body} translated={m.translated} ago={m.ago} />
        ))}
        {sent ? <Bubble inbound={false} body={lead.draft ?? body} translated={lead.draftTranslated} ago="now" /> : null}
      </div>

      {/* reply / draft */}
      {lead.draft && !sent ? (
        <div className="border-t border-border bg-card px-5 py-4">
          <div className="rounded-[13px] border border-brand/20 bg-brand-soft p-3.5">
            <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.05em] text-brand">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" /> AI-suggested reply · {LANG_LABEL[lead.lang]}
            </div>
            {editing ? (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[12.5px] leading-[1.5] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : (
              <>
                <p className="whitespace-pre-wrap text-[12.5px] leading-[1.5] text-foreground">{body}</p>
                {lead.draftTranslated ? (
                  <div className="mt-2 border-t border-brand/20 pt-2">
                    <div className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.05em] text-muted-foreground">Translation (your language)</div>
                    <p className="text-[12px] leading-[1.5] text-muted-foreground">{lead.draftTranslated}</p>
                  </div>
                ) : null}
              </>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={onApprove} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden /> Approve &amp; send
            </button>
            <button type="button" onClick={() => setEditing((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted">
              <Pencil className="h-3.5 w-3.5" aria-hidden /> {editing ? "Done" : "Edit"}
            </button>
            <button type="button" onClick={onDismiss} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-3.5 w-3.5" aria-hidden /> Dismiss
            </button>
          </div>
        </div>
      ) : (
        <div className="border-t border-border px-5 py-4">
          <div className="flex items-center gap-2 rounded-lg border border-brand/20 bg-brand-soft px-3 py-2.5 text-[12px] text-brand">
            <Check className="h-4 w-4" aria-hidden />
            {sent ? "Sent — reply delivered in the buyer's language." : state === "autoHandled" ? "Auto-handled under your rules." : "Replied."}
          </div>
        </div>
      )}
    </div>
  );
}

function Bubble({ inbound, body, translated, ago }: { inbound: boolean; body: string; translated: string | null; ago: string }) {
  return (
    <div className={cn(
      "max-w-[78%] rounded-[13px] px-3.5 py-2.5 text-[12.5px] leading-[1.5]",
      inbound ? "self-start rounded-bl-[4px] bg-muted/70 text-foreground" : "self-end rounded-br-[4px] bg-brand-soft text-foreground",
    )}>
      <div className="whitespace-pre-wrap">{body}</div>
      {translated ? (
        <div className="mt-2 border-t border-foreground/10 pt-2">
          <div className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.05em] text-muted-foreground">Translation (your language)</div>
          <div className="text-muted-foreground">{translated}</div>
        </div>
      ) : null}
      <div className="mt-1.5 font-mono text-[9.5px] text-muted-foreground">{inbound ? "Inbound" : "Outbound"} · {ago}</div>
    </div>
  );
}

function LeadSummary({ lead }: { lead: DemoLead }) {
  const rows = [
    ["Area", lead.area],
    ["Score", `${lead.temp.replace("_", " ")} · ${lead.score}`],
    ["Source", lead.source],
    ["Language", LANG_LABEL[lead.lang]],
    ["Channel", CHANNEL_LABEL[lead.channel]],
  ];
  return (
    <>
      <div className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Lead</div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.05em] text-muted-foreground">{k}</div>
          <div className="text-[12.5px] font-semibold text-foreground">{v}</div>
        </div>
      ))}
      <div className="mt-1 border-t border-border pt-3">
        <div className="mb-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Notes</div>
        <div className="rounded-md border border-border bg-card p-2.5 text-[12px] text-foreground">
          {lead.lang === "de" ? "Budget bis 700k, Meerblick wichtig." : lead.lang === "pl" ? "Budżet do 210k, blisko plaży." : "Beach proximity is the priority."}
          <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand-soft px-1.5 py-[1px] align-middle text-[9px] text-brand">
            <Sparkles className="h-2.5 w-2.5" /> Used by AI
          </span>
        </div>
      </div>
    </>
  );
}

function SellersTab() {
  const s = DEMO_SELLER;
  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-xl bg-card shadow-elevated ring-1 ring-foreground/10 lg:grid-cols-[270px_minmax(0,1fr)_240px]">
      <ul className="border-b border-border lg:border-b-0 lg:border-r">
        <li>
          <div className="flex flex-col gap-1 border-l-2 border-l-brand bg-brand-soft px-4 py-3 pl-[14px]">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-semibold text-foreground">{s.name}</span>
              <span className="ml-auto"><Pill tone="brand">Seller</Pill></span>
            </div>
            <div className="truncate text-[11.5px] text-muted-foreground">{s.preview}</div>
            <div className="text-[10px] text-muted-foreground">{langFlag(s.lang)} · Website chat · {s.ago}</div>
          </div>
        </li>
      </ul>
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-[12px] font-semibold text-white">IS</span>
          <div><div className="text-[14px] font-bold text-foreground">{s.name}</div><div className="font-mono text-[10.5px] text-muted-foreground">{s.area} · Svenska · Valuation lead</div></div>
        </div>
        <div className="flex flex-1 flex-col gap-2.5 p-5">
          {s.thread.map((m) => (
            <Bubble key={m.id} inbound={m.direction === "inbound"} body={m.body} translated={m.translated} ago={m.ago} />
          ))}
        </div>
      </div>
      <div className="hidden flex-col gap-3 border-l border-border p-5 lg:flex">
        <div className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Valuation</div>
        <div className="flex flex-col gap-0.5">
          <div className="font-mono text-[9.5px] uppercase text-muted-foreground">Property</div>
          <div className="text-[12.5px] font-semibold text-foreground">{s.property}</div>
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="font-mono text-[9.5px] uppercase text-muted-foreground">Estimated range</div>
          <div className="font-mono text-[15px] font-semibold text-foreground">{eur(s.rangeLow)}–{eur(s.rangeHigh)}</div>
        </div>
        <div className="rounded-md border border-border bg-card px-2.5 py-2 text-[10.5px] leading-snug text-muted-foreground">
          Automated estimate, not an ECO/805/2003 homologated tasación.
        </div>
        <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Check className="h-3 w-3 text-brand" /> Data-processing consent</span>
          <span className="inline-flex items-center gap-1.5"><Check className="h-3 w-3 text-brand" /> Commercial-comms consent</span>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Properties ─────────────────────────

function Properties() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {DEMO_PROPERTIES.map((p) => (
        <article key={p.id} className="flex flex-col overflow-hidden rounded-xl bg-card shadow-elevated ring-1 ring-foreground/10">
          <div className="relative flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-sky-900/40 to-emerald-900/30">
            <Building2 className="h-8 w-8 text-muted-foreground/40" aria-hidden />
            <div className="absolute right-2 top-2">
              <Pill tone={p.status === "active" ? "brand" : "muted"}>{p.status[0].toUpperCase() + p.status.slice(1)}</Pill>
            </div>
          </div>
          <div className="flex flex-col gap-1 p-4">
            <h3 className="text-[14px] font-semibold text-foreground">{p.title}</h3>
            <div className="font-mono text-[15px] font-semibold text-foreground">{eur(p.price)}</div>
            <div className="text-[12.5px] text-muted-foreground">{p.city}</div>
            <div className="mt-1 font-mono text-[11.5px] text-muted-foreground">{p.beds} bd · {p.baths} ba · {p.m2} m²</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.04em] text-muted-foreground/70">{p.ref}</div>
          </div>
        </article>
      ))}
    </div>
  );
}

// ───────────────────────── Viewings ─────────────────────────

function Viewings() {
  const upcoming = DEMO_VIEWINGS.filter((v) => v.status === "confirmed");
  const past = DEMO_VIEWINGS.filter((v) => v.status !== "confirmed");
  return (
    <div className="flex flex-col gap-6">
      <ViewingGroup heading="Upcoming" rows={upcoming} />
      <ViewingGroup heading="Past" rows={past} muted />
    </div>
  );
}
function ViewingGroup({ heading, rows, muted }: { heading: string; rows: typeof DEMO_VIEWINGS; muted?: boolean }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{heading}</h2>
      <div className="flex flex-col gap-2.5">
        {rows.map((v) => (
          <article key={v.id} className={cn("flex flex-col gap-2 rounded-xl bg-card p-4 shadow-elevated ring-1 ring-foreground/10", muted && "opacity-80")}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <span className="text-[14px] font-semibold text-foreground">{v.lead}</span>
                <span className="text-[12.5px] text-muted-foreground">{v.property}</span>
              </div>
              <Pill tone={v.status === "confirmed" ? "brand" : "muted"}>{v.status[0].toUpperCase() + v.status.slice(1)}</Pill>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 text-foreground"><CalendarClock className="h-3.5 w-3.5" aria-hidden /> {v.when} · {v.duration} min</span>
              <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" aria-hidden /> {v.agent}</span>
              <Pill>{langFlag(v.lang)}</Pill>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// ───────────────────────── Matches ─────────────────────────

function Matches() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">New listings matched against buyers already in your contacts. You decide who to reach out to — nothing is sent automatically.</p>
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
        {DEMO_MATCHES.map((m) => (
          <Card key={m.id} className="px-4">
            <div className="flex items-center justify-between">
              <span className="text-[13.5px] font-bold text-foreground">{m.buyer}</span>
              <Pill tone="brand">{m.fit}% fit</Pill>
            </div>
            <div className="text-[12.5px] text-foreground">{m.property}</div>
            <div className="font-mono text-[13px] font-semibold text-foreground">{eur(m.price)}</div>
            <div className="text-[11.5px] text-muted-foreground">{m.reason}</div>
            <div className="mt-1 flex items-center gap-2">
              <Pill>{langFlag(m.lang)}</Pill>
              <button type="button" className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground">
                <Send className="h-3 w-3" aria-hidden /> Reach out
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────── Performance ─────────────────────────

function Performance() {
  const p = DEMO_PERF;
  const max = Math.max(...p.dailyAnswered);
  const maxLang = Math.max(...p.langBreakdown.map((l) => l.n));
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <PerfKpi icon={Check} label="Leads answered" value={`${p.leadsAnswered.pct}%`} sub={`${p.leadsAnswered.count} of ${p.leadsAnswered.total}`} />
        <PerfKpi icon={Send} label="Avg reply time" value={`${p.avgReplySeconds}s`} sub="median, this week" />
        <PerfKpi icon={Phone} label="Calls recovered" value={`${p.recoveredLeads}`} sub={`${p.missedCallRecoveryPct}% recovery rate`} />
        <PerfKpi icon={Globe} label="Languages seen in leads" value={`${p.languagesSeen}`} sub={p.languageList.map(langFlag).join(" · ")} />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="px-5">
          <h3 className="text-[14px] font-semibold text-foreground">Leads answered · last 7 days</h3>
          <div className="flex h-32 items-end gap-2 pt-2">
            {p.dailyAnswered.map((d, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="w-full rounded-t bg-brand/80" style={{ height: `${(d / max) * 100}%` }} />
                <span className="font-mono text-[9px] text-muted-foreground">{["M", "T", "W", "T", "F", "S", "S"][i]}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="px-5">
          <h3 className="text-[14px] font-semibold text-foreground">Languages handled</h3>
          <div className="flex flex-col gap-2 pt-1">
            {p.langBreakdown.map((l) => (
              <div key={l.lang} className="flex items-center gap-2">
                <span className="w-16 font-mono text-[11px] text-muted-foreground">{LANG_LABEL[l.lang]}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${(l.n / maxLang) * 100}%` }} />
                </div>
                <span className="w-6 text-right font-mono text-[11px] text-foreground">{l.n}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
function PerfKpi({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value: string; sub: string }) {
  return (
    <Card className="px-4">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground"><Icon className="h-[15px] w-[15px] opacity-70" aria-hidden strokeWidth={2} /> {label}</div>
      <div className="font-mono text-[30px] font-semibold leading-none tracking-[-0.02em] text-foreground">{value}</div>
      <div className="font-mono text-[11px] lowercase text-muted-foreground">{sub}</div>
    </Card>
  );
}

// ───────────────────────── Studio ─────────────────────────

function Studio() {
  const tabs = ["Ad creative", "Social post", "Virtual staging", "Library"] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]>("Library");
  return (
    <div className="flex flex-col gap-5">
      <div className="inline-flex w-fit rounded-lg border border-border bg-card p-0.5">
        {tabs.map((tk) => (
          <button key={tk} type="button" onClick={() => setTab(tk)} aria-pressed={tab === tk}
            className={cn("flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors", tab === tk ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            {tk}
          </button>
        ))}
      </div>
      {tab === "Library" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DEMO_STUDIO.map((it) => (
            <article key={it.id} className="flex flex-col overflow-hidden rounded-xl bg-card shadow-elevated ring-1 ring-foreground/10">
              <div className="relative flex aspect-[4/3] items-end p-3" style={{ background: it.gradient }}>
                <span className="absolute right-2 top-2"><Pill tone={it.status === "Published" ? "brand" : "muted"}>{it.status}</Pill></span>
                <span className="rounded-full bg-white/80 px-2 py-[3px] font-mono text-[9.5px] font-medium text-[#10131A]">{it.kind}</span>
              </div>
              <div className="flex flex-col gap-1 p-3.5">
                <h3 className="line-clamp-2 text-[13.5px] font-semibold text-foreground">{it.title}</h3>
                <div className="flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground"><span className="uppercase">{it.kind}</span> · <span>{langFlag(it.lang)}</span></div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Card className="px-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand" aria-hidden />
            <h3 className="text-[14px] font-semibold text-foreground">{tab}</h3>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Pick a property and a target language; AIVENA generates branded {tab.toLowerCase()} with copy in the buyer&apos;s language. Generated items land in your Library.
          </p>
          <div className="flex flex-wrap gap-2">
            {["Sea-view villa · Jávea", "Beachside 2-bed · Orihuela", "Townhouse · Villamartín"].map((opt) => (
              <span key={opt} className="rounded-md border border-border bg-background px-3 py-1.5 text-[12px] text-foreground">{opt}</span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["de", "pl", "no", "sv", "fr", "en"] as Lang[]).map((l) => (
              <span key={l} className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">{LANG_LABEL[l]}</span>
            ))}
          </div>
          <button type="button" className="inline-flex w-fit items-center gap-2 rounded-[10px] bg-primary px-[18px] py-[11px] text-[13px] font-semibold text-primary-foreground">
            Generate
          </button>
        </Card>
      )}
    </div>
  );
}

// ───────────────────────── Settings ─────────────────────────

function SettingsSection() {
  const p = DEMO_PLAN;
  return (
    <div className="flex flex-col gap-5">
      <Card className="px-5">
        <h3 className="text-[14px] font-semibold text-foreground">Plan &amp; usage</h3>
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-[0.08em] text-muted-foreground">Current plan</span>
          <Pill tone="brand">{p.tier}</Pill>
        </div>
        <div className="flex flex-col gap-3 pt-1">
          {p.quotas.map((q) => (
            <div key={q.label} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-foreground">{q.label}</span>
                <span className="font-mono text-[12px] text-muted-foreground">{q.used} of {q.quota} this month</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (q.used / q.quota) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card className="px-5">
        <h3 className="text-[14px] font-semibold text-foreground">Languages</h3>
        <p className="text-[12.5px] text-muted-foreground">Client messages are translated into your language across the agency; the dashboard speaks all 13 supported languages.</p>
        <div className="flex flex-wrap gap-1.5">
          {p.languages.map((l) => (
            <span key={l} className="rounded-full border border-brand/30 bg-brand-soft px-3 py-1 text-[12px] font-medium text-brand">{LANG_LABEL[l]}</span>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ───────────────────────── Assistant widget ─────────────────────────

function AssistantWidget({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open the AIVENA assistant"
        className={cn("fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-brand shadow-elevated transition-transform hover:scale-105", open && "pointer-events-none opacity-0")}
      >
        <Bot className="h-5 w-5" aria-hidden strokeWidth={1.9} />
      </button>
      {open ? <div className="fixed inset-0 z-40 bg-foreground/20" onClick={() => setOpen(false)} aria-hidden /> : null}
      <aside className={cn("fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col border-l border-border bg-card shadow-2xl transition-transform duration-200", open ? "translate-x-0" : "translate-x-full")}>
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-brand"><Bot className="h-4 w-4" aria-hidden /></div>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-[13px] font-semibold text-foreground">AIVENA Assistant</span>
            <span className="text-[11px] text-muted-foreground">Product help &amp; Spanish RE compliance</span>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-4 w-4" aria-hidden /></button>
        </div>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          <div className="flex items-start gap-2 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-brand" aria-hidden />
            <p className="text-[12px] leading-snug text-foreground">You&apos;re chatting with AIVENA&apos;s AI assistant. It can make mistakes — double-check anything important.</p>
          </div>
          <div className="flex flex-col gap-2 rounded-lg bg-muted/40 px-3 py-3">
            <p className="text-[13px] text-foreground">Hi! I can help you use AIVENA and answer questions about Spanish real-estate compliance and best practice.</p>
          </div>
        </div>
        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <input disabled placeholder="Ask me anything…" className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-70" />
            <button type="button" disabled aria-label="Send" className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-primary text-primary-foreground opacity-90"><Send className="h-4 w-4" aria-hidden /></button>
          </div>
        </div>
      </aside>
    </>
  );
}
