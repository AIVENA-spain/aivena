"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Trash2, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import type { LeadNoteRow } from "@/lib/api/types";
import {
  listLeadNotesAction,
  addLeadNoteAction,
  updateLeadNoteAction,
  deleteLeadNoteAction,
  toggleNoteAiContextAction,
} from "./lead-notes-actions";

/**
 * Lead notes — free-text notes an agent records on a lead, optionally fed to
 * the AI when drafting replies. Reads via a direct (RLS-scoped) SELECT; writes
 * via SECURITY DEFINER RPCs. After every mutation we refetch for correctness.
 * Errors are friendly (the API already mapped any DB RAISE code).
 */
export function LeadNotes({ leadId }: { leadId: string }) {
  const t = useTranslations("inbox.notes");

  const [notes, setNotes] = useState<LeadNoteRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [, startLoad] = useTransition();

  const load = useCallback(async () => {
    const res = await listLeadNotesAction(leadId);
    if (res.ok) {
      setNotes(res.data);
      setLoadError(null);
    } else {
      setNotes([]);
      setLoadError(res.error);
    }
  }, [leadId]);

  // The parent keys this component by leadId, so a different lead remounts it
  // with fresh state. The effect kicks off the initial load inside a transition
  // (matches the inbox thread-load pattern) so no setState runs synchronously
  // in the effect body.
  useEffect(() => {
    startLoad(() => {
      void load();
    });
  }, [load]);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setActionError(null);
    const res = await fn();
    if (!res.ok) setActionError(res.error ?? "");
    else await load();
    setBusy(false);
    return res.ok;
  }

  async function onAdd() {
    if (!draft.trim()) return;
    const ok = await run(() => addLeadNoteAction(leadId, draft.trim()));
    if (ok) setDraft("");
  }

  async function onSaveEdit(noteId: string) {
    if (!editDraft.trim()) return;
    const ok = await run(() => updateLeadNoteAction(noteId, editDraft.trim()));
    if (ok) setEditingId(null);
  }

  async function onDelete(noteId: string) {
    const ok = await run(() => deleteLeadNoteAction(noteId));
    if (ok) setConfirmDeleteId(null);
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {t("heading")}
      </div>

      {/* Composer */}
      <div className="flex flex-col gap-1.5">
        <textarea
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("placeholder")}
          className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-[12px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          type="button"
          size="sm"
          className="gap-1.5 self-start"
          disabled={busy || !draft.trim()}
          onClick={onAdd}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
          {busy ? t("adding") : t("addButton")}
        </Button>
      </div>

      {actionError ? (
        <p className="text-[11px] text-red-600 dark:text-red-300" role="alert">
          {actionError}
        </p>
      ) : null}

      {/* List */}
      {notes === null ? (
        <p className="text-[11px] text-muted-foreground">{t("loading")}</p>
      ) : loadError ? (
        <p className="text-[11px] text-muted-foreground">{loadError}</p>
      ) : notes.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {notes.map((n) => (
            <li
              key={n.id}
              className="rounded-md border border-border bg-card p-2.5"
            >
              {editingId === n.id ? (
                <div className="flex flex-col gap-1.5">
                  <textarea
                    rows={2}
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-[12px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <div className="flex gap-1.5">
                    <Button
                      type="button"
                      size="xs"
                      disabled={busy || !editDraft.trim()}
                      onClick={() => onSaveEdit(n.id)}
                    >
                      {busy ? t("saving") : t("save")}
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setEditingId(null)}
                    >
                      {t("cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-[12px] leading-snug text-foreground">
                    {n.body}
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <RelativeTime
                      iso={n.created_at}
                      className="font-mono text-[9.5px] text-muted-foreground"
                    />
                    <div className="ml-auto flex items-center gap-0.5">
                      <button
                        type="button"
                        title={t("usedByAiHint")}
                        aria-pressed={n.context_for_ai}
                        disabled={busy}
                        onClick={() =>
                          run(() =>
                            toggleNoteAiContextAction(n.id, !n.context_for_ai),
                          )
                        }
                        className={cn(
                          "flex items-center gap-1 rounded-full border px-1.5 py-[1px] text-[9px] font-medium transition-colors disabled:opacity-50",
                          n.context_for_ai
                            ? "border-brand/40 bg-brand-soft text-brand"
                            : "border-border bg-card text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Sparkles className="h-2.5 w-2.5" aria-hidden />
                        {t("usedByAi")}
                      </button>
                      <button
                        type="button"
                        aria-label={t("edit")}
                        disabled={busy}
                        onClick={() => {
                          setEditingId(n.id);
                          setEditDraft(n.body);
                          setConfirmDeleteId(null);
                        }}
                        className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                      >
                        <Pencil className="h-3 w-3" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={t("delete")}
                        disabled={busy}
                        onClick={() => setConfirmDeleteId(n.id)}
                        className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden />
                      </button>
                    </div>
                  </div>

                  {confirmDeleteId === n.id ? (
                    <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-border bg-muted/40 p-2">
                      <span className="text-[11px] text-foreground">
                        {t("deleteConfirm")}
                      </span>
                      <div className="flex gap-1.5">
                        <Button
                          type="button"
                          size="xs"
                          variant="destructive"
                          disabled={busy}
                          onClick={() => onDelete(n.id)}
                        >
                          {t("deleteConfirmYes")}
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          {t("cancel")}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
