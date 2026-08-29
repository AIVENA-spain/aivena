"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AmandaSettingsResponse } from "@/lib/api/types";
import {
  addAmandaKnowledgeAction,
  removeAmandaKnowledgeAction,
} from "../section-actions";

/**
 * Amanda auto-mode card (design §6 "smallest lovable settings"): the mode is
 * READ-ONLY (the dial is promoted by evidence, never self-served), two viewing
 * numbers are editable, and "Things Amanda should know" is the screened
 * knowledge box — every save passes the §5 scrubber and a rejection shows its
 * honest reason, never a silent drop. Ships dark: pre-migration the API says
 * configured:false and the card renders one honest line.
 */
export function AmandaSection({ data }: { data: AmandaSettingsResponse | null }) {
  const t = useTranslations("settings.amanda");


  const [entries, setEntries] = useState(data?.knowledge ?? []);
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, startAdding] = useTransition();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removing, startRemoving] = useTransition();

  if (!data || !data.configured) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border/60 p-4">
        <Header t={t} mode={null} />
        <p className="text-[12px] text-muted-foreground">{t("notSetUp")}</p>
      </div>
    );
  }

  function onAdd() {
    const content = draft.trim();
    if (!content || adding) return;
    setAddError(null);
    startAdding(async () => {
      const res = await addAmandaKnowledgeAction(content);
      if (res.ok) {
        setEntries((prev) => [...prev, { id: res.data.id, content: res.data.content, status: "active", createdAt: res.data.createdAt }]);
        setDraft("");
      } else if ("reason" in res) {
        // Scrubber verdict → honest, specific copy (never a silent drop).
        setAddError(t(`rejected_${res.reason}` as never));
      } else {
        setAddError(res.error);
      }
    });
  }

  function onRemove(id: string) {
    startRemoving(async () => {
      const res = await removeAmandaKnowledgeAction(id);
      if (res.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
        setConfirmRemove(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border/60 p-4">
      <Header t={t} mode={data.mode ?? "off"} />

      {/* Calendar rules live in the CALENDAR (Christian 2026-08-29: "is this
          section not useless now, since its in the calendar section already?").
          Viewing length, notice, hours, breaks and blocked days were a second,
          degraded copy of the Viewings drawer — it could not even edit hour
          blocks. One editor, one home; this is the signpost to it. */}
      <p className="rounded-md bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground">
        {t("calendarMoved")}{" "}
        <Link href="/viewings" className="font-medium text-brand underline underline-offset-2">
          {t("calendarMovedLink")}
        </Link>
      </p>

      {/* Things Amanda should know — screened at save (design §5). */}
      <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
        <div>
          <h4 className="text-[12.5px] font-semibold text-foreground">{t("knowledgeTitle")}</h4>
          <p className="text-[11.5px] text-muted-foreground">{t("knowledgeHint")}</p>
        </div>
        {entries.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex items-start justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-[12.5px] text-foreground"
              >
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{e.content}</span>
                {confirmRemove === e.id ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onRemove(e.id)}
                      disabled={removing}
                      className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-destructive hover:bg-destructive/10"
                    >
                      {t("confirmRemove")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(null)}
                      className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                    >
                      {t("cancel")}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={t("remove")}
                    onClick={() => setConfirmRemove(e.id)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onAdd();
            }}
            placeholder={t("knowledgePlaceholder")}
            maxLength={800}
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
          <Button size="sm" variant="outline" onClick={onAdd} disabled={adding || !draft.trim()}>
            {adding ? t("adding") : t("add")}
          </Button>
        </div>
        {addError ? <p className="text-[12px] text-destructive">{addError}</p> : null}
      </div>
    </div>
  );
}

function Header({
  t,
  mode,
}: {
  t: ReturnType<typeof useTranslations<"settings.amanda">>;
  mode: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"
      >
        <Sparkles className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[13px] font-semibold text-foreground">{t("title")}</h3>
        <p className="truncate text-[11.5px] text-muted-foreground">{t("subtitle")}</p>
      </div>
      {mode ? (
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-[10.5px] font-semibold ${
            mode === "off" ? "bg-muted text-muted-foreground" : "bg-brand-soft text-brand"
          }`}
        >
          {t(`mode_${mode}` as never)}
        </span>
      ) : null}
    </div>
  );
}
