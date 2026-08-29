"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Bot, ChevronDown, UserRound } from "lucide-react";

import {
  getConversationModeAction,
  setConversationModeAction,
  type ConversationMode,
} from "@/app/(app)/approvals/amanda-mode-actions";

/**
 * The per-person automation switch, in the thread header where the decision is
 * actually made (Christian 2026-08-29: "a switch and then it changes mode in a
 * way you can see it").
 *
 * It shows the EFFECTIVE mode — what the engine will do on the next message —
 * not the stored choice. A conversation a human claimed reads "You're handling
 * this" even though no override is set, because that is the truth of it.
 */
type Choice = "inherit" | "off" | "full";

export function ConversationModeSwitch({ conversationId }: { conversationId: string | null }) {
  const t = useTranslations("conversationMode");
  const [state, setState] = useState<ConversationMode | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, startSaving] = useTransition();
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    setState(null);
    setOpen(false);
    if (!conversationId) return;
    void getConversationModeAction(conversationId).then((r) => {
      if (alive) setState(r);
    });
    return () => {
      alive = false;
    };
  }, [conversationId]);

  // Close on outside click — a header popover that traps clicks is worse than none.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!conversationId || !state) return null;

  const live = state.effective !== "off";
  const agencyOff = state.agency_mode === "off";

  function choose(choice: Choice) {
    if (!conversationId || saving) return;
    setOpen(false);
    startSaving(async () => {
      const res = await setConversationModeAction(conversationId, choice);
      if (res.ok) {
        const fresh = await getConversationModeAction(conversationId);
        setState(fresh);
      }
    });
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        disabled={saving || agencyOff}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={agencyOff ? t("agencyOffHint") : undefined}
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
          live
            ? "border-brand/40 bg-brand-soft text-brand"
            : "border-border bg-muted/50 text-muted-foreground"
        } ${saving || agencyOff ? "opacity-60" : "hover:brightness-95"}`}
      >
        {live ? <Bot className="h-3.5 w-3.5" aria-hidden /> : <UserRound className="h-3.5 w-3.5" aria-hidden />}
        <span>{saving ? t("saving") : t(`state_${state.effective}`)}</span>
        {agencyOff ? null : <ChevronDown className="h-3 w-3" aria-hidden />}
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+6px)] z-20 w-64 rounded-lg border border-border bg-card p-1 shadow-elevated">
          <Item
            label={t("optInherit", { mode: t(`state_${state.agency_mode}`) })}
            desc={t("optInheritDesc")}
            active={state.override === null && !state.paused}
            onClick={() => choose("inherit")}
          />
          <Item
            label={t("optFull")}
            desc={t("optFullDesc")}
            active={state.override === "full"}
            onClick={() => choose("full")}
          />
          <Item
            label={t("optOff")}
            desc={t("optOffDesc")}
            active={state.effective === "off"}
            onClick={() => choose("off")}
          />
        </div>
      ) : null}
    </div>
  );
}

function Item({
  label,
  desc,
  active,
  onClick,
}: {
  label: string;
  desc: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors ${
        active ? "bg-brand-soft" : "hover:bg-muted"
      }`}
    >
      <span className={`text-[12.5px] font-medium ${active ? "text-brand" : "text-foreground"}`}>
        {label}
      </span>
      <span className="text-[11px] leading-snug text-muted-foreground">{desc}</span>
    </button>
  );
}
