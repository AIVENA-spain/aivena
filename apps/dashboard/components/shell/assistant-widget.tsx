"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Bot, X, Send, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { GatePill } from "./launch-gate";

/**
 * AIVENA Assistant (WAA) — v1.14.3. Floating bottom-right button → right side
 * panel with a session-only chat UI. SHELL stage: the panel, the EU AI Act
 * disclosure badge (shown BEFORE the user types, per Article 50), and the
 * composer all render; sending is gated until Vega ships the assistant backend
 * endpoint. No persistence, no audit table at Pilot 1.
 */
export function AssistantWidget() {
  const t = useTranslations("assistant");
  const [open, setOpen] = useState(false);

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
            <span className="text-[13px] font-semibold text-foreground">
              {t("title")}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {t("subtitle")}
            </span>
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
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          {/* EU AI Act Article 50 disclosure — shown BEFORE the user types. */}
          <div className="flex items-start gap-2 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-brand" aria-hidden />
            <p className="text-[12px] leading-snug text-foreground">
              {t("aiDisclosure")}
            </p>
          </div>

          <div className="flex flex-col gap-2 rounded-lg bg-muted/40 px-3 py-3">
            <p className="text-[13px] text-foreground">{t("greeting")}</p>
            <p className="text-[12px] text-muted-foreground">{t("capabilities")}</p>
          </div>
        </div>

        {/* Composer — gated */}
        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <textarea
              rows={1}
              disabled
              placeholder={t("inputPlaceholder")}
              className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-70"
            />
            <button
              type="button"
              disabled
              aria-disabled
              aria-label={t("send")}
              className="flex h-9 w-9 flex-none cursor-not-allowed items-center justify-center rounded-lg bg-primary text-primary-foreground opacity-90"
            >
              <Send className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <GatePill />
            <span className="text-[10px] text-muted-foreground">{t("sessionOnly")}</span>
          </div>
        </div>
      </aside>
    </>
  );
}
