"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { saveAmandaModeAction } from "../section-actions";

/**
 * Automation level — the five REAL modes, in the order they hand over control.
 *
 * Christian 2026-08-29: "there should be more options, some in betweens ... ofc
 * it needs to be truthful." The in-betweens already existed: the engine's tool
 * layer (amanda-engine/modes.ts dispatchDecision) has enforced off → shadow →
 * approval → assisted → full since it was built. Settings just never showed
 * them, and instead rendered a LOCKED "approval first" card while this agency
 * was running 'full' — the page was contradicting the engine on his screen.
 *
 * Every description below is the literal behaviour of dispatchDecision for that
 * mode. Nothing here is aspirational; if a tier is not enforced, it is not offered.
 */
const MODES = ["off", "shadow", "approval", "assisted", "full"] as const;
type Mode = (typeof MODES)[number];

export function AutomationLevel({ mode }: { mode: Mode }) {
  const t = useTranslations("settings.automation");
  const [current, setCurrent] = useState<Mode>(mode);
  const [pending, setPending] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function choose(next: Mode) {
    if (next === current || saving) return;
    setError(null);
    setPending(next);
    startSaving(async () => {
      const res = await saveAmandaModeAction(next);
      if (res.ok) setCurrent(next);
      else setError(res.error);
      setPending(null);
    });
  }

  return (
    <fieldset className="flex flex-col gap-2.5 border-t border-border pt-4">
      <legend className="text-[13px] font-semibold text-foreground">{t("title")}</legend>
      <p className="text-[11.5px] text-muted-foreground">{t("help")}</p>
      <div className="mt-1 flex flex-col gap-1">
        {MODES.map((m) => {
          const active = current === m;
          const busy = pending === m;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={saving}
              onClick={() => choose(m)}
              className={`flex items-start gap-3 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors ${
                active
                  ? "border-brand bg-brand-soft"
                  : "border-border bg-background hover:bg-muted/50"
              } ${saving && !busy ? "opacity-60" : ""}`}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                  active ? "border-brand" : "border-muted-foreground/40"
                }`}
              >
                {active ? <span className="h-2 w-2 rounded-full bg-brand" /> : null}
              </span>
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{t(`${m}Label`)}</span>
                  {active ? (
                    <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand">
                      {t("activeBadge")}
                    </span>
                  ) : null}
                  {busy ? <span className="text-[10.5px] text-muted-foreground">{t("saving")}</span> : null}
                </span>
                <span className="text-[11.5px] text-muted-foreground">{t(`${m}Desc`)}</span>
              </span>
            </button>
          );
        })}
      </div>
      {error ? <p className="text-[11.5px] text-destructive">{error}</p> : null}
      <p className="text-[11px] text-muted-foreground">{t("handoffNote")}</p>
    </fieldset>
  );
}
