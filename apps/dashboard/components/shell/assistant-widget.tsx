"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Bot, X, Send, ShieldCheck, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { getOperationsSummaryAction } from "@/app/(app)/assistant-actions";
import { looksLikeAttentionAsk } from "@/lib/assistant/operations-summary";

type ChatMessage = { id: number; role: "user" | "assistant"; text: string };

/**
 * AIVENA Assistant (WAA). Floating bottom-right launcher → right side panel,
 * session-only chat. The EU AI Act Article 50 disclosure renders BEFORE the
 * user types. The composer is interactive; until the Anthropic DPA gate opens,
 * sending stubs out with the "being activated" reply.
 *
 * The 6 read RPCs are wired and typed in `useWAA` (lib/api/waa.ts), ready for
 * the LLM layer. They are NOT called from here yet: they currently require the
 * `app.current_agency_id` / `app.current_user_id` session GUCs that the Hono
 * backend sets per-request, so a browser-direct call raises insufficient_privilege.
 * Wiring the live read path is blocked on that (see CC handoff note) — the LLM
 * call + RPC orchestration will run behind Hono where the GUCs are set.
 */
export function AssistantWidget() {
  const t = useTranslations("assistant");

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const idRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages]);

  /**
   * The one thing the assistant can answer WITHOUT the LLM: a read-only
   * operational "what needs your attention" summary from /api/v1/operations
   * (the same aggregate the Command Center shows). No provider call, no gate.
   */
  async function runSummary(userText: string) {
    if (busy) return;
    const userId = (idRef.current += 1);
    const loadingId = (idRef.current += 1);
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", text: userText },
      { id: loadingId, role: "assistant", text: t("summaryLoading") },
    ]);
    setBusy(true);
    const res = await getOperationsSummaryAction();
    const reply = res.ok ? res.summary : res.error;
    setMessages((prev) => prev.map((m) => (m.id === loadingId ? { ...m, text: reply } : m)));
    setBusy(false);
  }

  function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    // Operational/status asks → the live no-LLM summary. Everything else
    // honestly waits for the Anthropic-DPA gate (free-form chat reply, N2).
    if (looksLikeAttentionAsk(text)) {
      void runSummary(text);
      return;
    }
    const userId = (idRef.current += 1);
    const botId = (idRef.current += 1);
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", text },
      { id: botId, role: "assistant", text: t("chatGated") },
    ]);
  }

  return (
    <>
      {/* Launcher */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("open")}
        className={cn(
          "fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-brand shadow-elevated transition-transform hover:scale-105",
          open && "pointer-events-none opacity-0",
        )}
      >
        <Bot className="h-5 w-5" aria-hidden strokeWidth={1.9} />
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-[1px]"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Side panel */}
      <aside
        role="dialog"
        aria-label={t("title")}
        aria-hidden={!open}
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col border-l border-border bg-card shadow-2xl transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-brand">
            <Bot className="h-4 w-4" aria-hidden />
          </div>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-[13px] font-semibold text-foreground">{t("title")}</span>
            <span className="text-[11px] text-muted-foreground">{t("subtitle")}</span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("close")}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div ref={bodyRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          {/* EU AI Act Article 50 disclosure — shown BEFORE the user types. */}
          <div className="flex items-start gap-2 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-brand" aria-hidden />
            <p className="text-[12px] leading-snug text-foreground">{t("aiDisclosure")}</p>
          </div>

          <div className="flex flex-col gap-2 rounded-lg bg-muted/40 px-3 py-3">
            <p className="text-[13px] text-foreground">{t("greeting")}</p>
            <p className="text-[12px] text-muted-foreground">{t("capabilities")}</p>
            <button
              type="button"
              onClick={() => void runSummary(t("summarizeAction"))}
              disabled={busy}
              className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-brand/30 bg-brand-soft px-3 py-1.5 text-[12px] font-medium text-brand transition-colors hover:bg-brand/10 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              {t("summarizeAction")}
            </button>
          </div>

          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-[13px] leading-snug",
                m.role === "user"
                  ? "ml-auto rounded-tr-sm bg-primary text-primary-foreground"
                  : "mr-auto rounded-tl-sm bg-muted text-foreground",
              )}
            >
              {m.text}
            </div>
          ))}
        </div>

        {/* Composer */}
        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={t("inputPlaceholder")}
              disabled={busy}
              className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={busy || input.trim().length === 0}
              aria-label={t("send")}
              className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="mt-2 flex items-center justify-end">
            <span className="text-[10px] text-muted-foreground">{t("sessionOnly")}</span>
          </div>
        </div>
      </aside>
    </>
  );
}
