"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Hand, Loader2, MessageSquare, PhoneCall, Undo2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { sendFreeformAction } from "./composer-actions";
import { setConversationModeAction } from "./amanda-mode-actions";
import {
  getHandoffQueueAction,
  claimHandoffAction,
  releaseHandoffAction,
  type HandoffRow,
} from "./handoff-actions";

/**
 * Amanda Live L1 — the "Needs a human" queue. A website visitor asked to speak
 * with a person: their lead is AI-muted (the assistant stands down) until an
 * agent claims + handles it, or releases it back to the assistant.
 *
 * VISIBILITY IS THE POINT: the moment a handoff lands, every open dashboard gets
 * a realtime broadcast on the agency's private channel → this panel appears
 * instantly at the top of the Inbox with a chime + a desktop notification.
 * A 60s poll is the belt-and-suspenders fallback so a realtime hiccup can never
 * hide a waiting client. Renders nothing when the queue is empty.
 *
 * Claiming is first-click-wins (any available agent). Release = hand the
 * conversation back to the assistant. No message is sent from here — the agent
 * contacts the client via WhatsApp/phone/email (send paths gated elsewhere).
 */
export function HandoffQueue({ agencyId }: { agencyId: string }) {
  const [answering, setAnswering] = useState<string | null>(null);
  const router = useRouter();
  const t = useTranslations("handoffs");
  const [rows, setRows] = useState<HandoffRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const knownIds = useRef<Set<string>>(new Set());
  const audioCtx = useRef<AudioContext | null>(null);

  // Two-tone chime via WebAudio — no asset, quiet enough for an office.
  const chime = useCallback(() => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx.current = audioCtx.current ?? new Ctx();
      const ctx = audioCtx.current;
      const t0 = ctx.currentTime;
      for (const [freq, at] of [[880, 0], [1174.7, 0.16]] as const) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = freq;
        o.type = "sine";
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime(0.12, t0 + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.3);
        o.connect(g).connect(ctx.destination);
        o.start(t0 + at);
        o.stop(t0 + at + 0.32);
      }
    } catch {
      /* sound is best-effort */
    }
  }, []);

  const notify = useCallback(
    (row: HandoffRow) => {
      try {
        if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
        const n = new Notification(t("notifTitle", { name: row.full_name || t("unknownVisitor") }), {
          body: row.last_message || t("notifBody"),
          tag: `handoff-${row.lead_id}`,
        });
        n.onclick = () => window.focus();
      } catch {
        /* notifications are best-effort */
      }
    },
    [t],
  );

  const refresh = useCallback(
    async (announce: boolean) => {
      const res = await getHandoffQueueAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setRows(res.data);
      if (announce) {
        for (const row of res.data) {
          if (!knownIds.current.has(row.lead_id) && !row.human_claimed_by) {
            chime();
            notify(row);
          }
        }
      }
      knownIds.current = new Set(res.data.map((r) => r.lead_id));
    },
    [chime, notify],
  );

  useEffect(() => {
    void refresh(false);
    // Ask once for desktop-notification permission (no-op if already decided).
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission();
      }
    } catch {
      /* best-effort */
    }

    // Realtime: the agency's private handoff channel (authorized via
    // realtime.messages RLS + user_agencies). Poll fallback every 60s.
    const supabase = createClient();
    let disposed = false;
    const channel = supabase.channel(`agency:${agencyId}:handoffs`, { config: { private: true } });
    void supabase.realtime.setAuth().then(() => {
      if (disposed) return;
      channel
        .on("broadcast", { event: "handoff_requested" }, () => void refresh(true))
        // An office question is NOT a handoff — Amanda keeps the conversation,
        // she just needs one fact. It has no row in this queue, so it gets its
        // own chime and notification pointing at Tasks. Before this it filed
        // silently and the agent only found it by wandering onto that page
        // (Christian 2026-08-30: "i havent gotten anything notification").
        .on("broadcast", { event: "question_filed" }, (msg) => {
          const p = (msg?.payload ?? {}) as { lead_name?: string; question?: string };
          chime();
          try {
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              const n = new Notification(
                t("questionNotifTitle", { name: p.lead_name || t("unknownVisitor") }),
                { body: p.question || t("questionNotifBody"), tag: "amanda-question" },
              );
              n.onclick = () => {
                window.focus();
                router.push("/tasks");
              };
            }
          } catch {
            /* notifications are best-effort */
          }
          router.refresh();   // repaint the Tasks badge in the sidebar
        })
        .subscribe();
    });
    const poll = setInterval(() => void refresh(true), 60_000);
    return () => {
      disposed = true;
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [agencyId, refresh]);

  // Answer-and-done (Christian 2026-08-29: "i would rather just answer fast a
  // spesific question and finished"). Sending the answer ALSO hands the
  // conversation back to Amanda — the escalation muted her, and leaving her
  // muted after the question is answered would silently end the conversation.
  async function onAnswer(row: HandoffRow, text: string) {
    const body = text.trim();
    if (!body) return;
    setBusy(row.lead_id);
    const sent = await sendFreeformAction(row.lead_id, body, null, "whatsapp");
    if (!sent.ok) {
      setError(sent.error);
      setBusy(null);
      return;
    }
    if (row.conversation_id) {
      await setConversationModeAction(row.conversation_id, "inherit");
    }
    setAnswering(null);
    setBusy(null);
    await refresh(true);
  }

  async function onClaim(leadId: string) {
    setBusy(leadId);
    const res = await claimHandoffAction(leadId);
    if (!res.ok) setError(res.error);
    await refresh(false);
    setBusy(null);
  }

  async function onRelease(leadId: string) {
    setBusy(leadId);
    const res = await releaseHandoffAction(leadId);
    if (!res.ok) setError(res.error);
    await refresh(false);
    setBusy(null);
  }

  if (rows.length === 0 && !error) return null;

  return (
    <section
      aria-label={t("title")}
      className="mb-4 rounded-xl border border-red-200 bg-red-50/70 p-3 dark:border-red-900/50 dark:bg-red-950/30"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
        </span>
        <h2 className="text-[13.5px] font-semibold text-red-900 dark:text-red-200">
          {t("title")} {rows.length > 0 ? `(${rows.length})` : ""}
        </h2>
      </div>

      {error ? <p className="mb-2 text-[12px] text-red-800 dark:text-red-300">{error}</p> : null}

      <ul className="flex flex-col gap-2">
        {rows.map((r) => {
          const claimed = Boolean(r.human_claimed_by);
          return (
            <li
              key={r.lead_id}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-card px-3 py-2",
                claimed ? "border-border" : "border-red-300 dark:border-red-800",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] font-semibold text-foreground">
                    {r.full_name || t("unknownVisitor")}
                  </span>
                  {r.phone ? (
                    <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
                      <PhoneCall className="h-3 w-3" aria-hidden /> {r.phone}
                    </span>
                  ) : null}
                  {r.email ? <span className="text-[11.5px] text-muted-foreground">{r.email}</span> : null}
                  <span className="text-[11px] text-muted-foreground">
                    {t("waiting")} <RelativeTime iso={r.needs_human_since} />
                  </span>
                </div>
                {r.last_message ? (
                  <p className="mt-0.5 text-[12px] leading-snug text-foreground">“{r.last_message}”</p>
                ) : null}
                {r.property_refs && r.property_refs.length > 0 ? (
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {t("aboutRefs", { refs: r.property_refs.join(", ") })}
                  </p>
                ) : null}
                {r.blocked_draft ? (
                  <div className={`mt-1.5 rounded-md border-l-2 px-2.5 py-1.5 ${
                    r.draft_failed_fact_check
                      ? "border-amber-500/60 bg-amber-500/10"
                      : "border-brand/50 bg-brand-soft/40"
                  }`}>
                    <p className={`text-[10.5px] font-semibold uppercase tracking-wide ${
                      r.draft_failed_fact_check ? "text-amber-700 dark:text-amber-400" : "text-brand"
                    }`}>
                      {r.draft_failed_fact_check ? t("draftFailedCheck") : t("amandaWanted")}
                    </p>
                    <p className="mt-0.5 text-[12px] leading-snug text-foreground">{r.blocked_draft}</p>
                    {r.draft_failed_fact_check ? (
                      <p className="mt-1 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                        {t("draftFailedHint")}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {claimed ? (
                  <p className="mt-0.5 text-[11.5px] font-medium text-emerald-700 dark:text-emerald-400">
                    {t("claimedBy", { agent: r.human_claimed_by ?? "" })}
                  </p>
                ) : null}
              </div>

              {claimed ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy === r.lead_id}
                  onClick={() => void onRelease(r.lead_id)}
                >
                  {busy === r.lead_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Undo2 className="h-3.5 w-3.5" aria-hidden />}
                  {t("release")}
                </Button>
              ) : (
                <span className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    variant={answering === r.lead_id ? "outline" : "default"}
                    disabled={busy === r.lead_id}
                    onClick={() => setAnswering(answering === r.lead_id ? null : r.lead_id)}
                  >
                    <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                    {t("answerIt")}
                  </Button>
                  <Button variant="outline" size="sm" disabled={busy === r.lead_id} onClick={() => void onClaim(r.lead_id)}>
                    {busy === r.lead_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Hand className="h-3.5 w-3.5" aria-hidden />}
                    {t("claim")}
                  </Button>
                </span>
              )}
              {answering === r.lead_id && !claimed ? (
                <AnswerBox
                  row={r}
                  busy={busy === r.lead_id}
                  onCancel={() => setAnswering(null)}
                  onSend={(text) => void onAnswer(r, text)}
                />
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-[11px] leading-snug text-red-800/80 dark:text-red-300/80">{t("aiMutedNote")}</p>
    </section>
  );
}

/**
 * Answer-and-done. The buyer's question is already on the card above; this is
 * just the reply. Sending it hands the conversation back to Amanda, so one
 * answered question does not quietly become a conversation nobody owns.
 */
function AnswerBox({
  row,
  busy,
  onCancel,
  onSend,
}: {
  row: HandoffRow;
  busy: boolean;
  onCancel: () => void;
  onSend: (text: string) => void;
}) {
  const t = useTranslations("handoffs");
  // Pre-filled with the reply Amanda already wrote: the agent's job is to
  // approve or correct it, not to research the answer from scratch.
  // Pre-fill ONLY a draft that was stopped for its SHAPE. One stopped by the
  // fact check is wrong by definition, so the box starts empty and the draft
  // stays visible above as something to correct, never something to send.
  const [text, setText] = useState(row.draft_failed_fact_check ? "" : (row.blocked_draft ?? ""));
  return (
    <div className="mt-2 flex w-full flex-col gap-2 rounded-md border border-border bg-card p-2.5">
      <textarea
        autoFocus
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("answerPlaceholder", { name: row.full_name ?? "" })}
        className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy || text.trim().length === 0} onClick={() => onSend(text)}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          {t("sendAnswer")}
        </Button>
        <button type="button" onClick={onCancel} className="text-[11.5px] text-muted-foreground hover:text-foreground">
          {t("cancel")}
        </button>
        <span className="ml-auto text-[11px] text-muted-foreground">{t("answerHandsBack")}</span>
      </div>
    </div>
  );
}
