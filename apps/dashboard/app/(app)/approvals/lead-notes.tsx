"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Pencil,
  Trash2,
  MoreHorizontal,
  StickyNote,
  Check,
  ChevronDown,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { RelativeTime } from "@/components/ui/relative-time";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { LeadNoteRow } from "@/lib/api/types";
import {
  listLeadNotesAction,
  addLeadNoteAction,
  updateLeadNoteAction,
  deleteLeadNoteAction,
  toggleNoteAiContextAction,
} from "./lead-notes-actions";

/**
 * Resolve a note's author_user_id to a human label via the team map (user_id →
 * email). We never render the raw uuid: a known author shows the email's
 * local-part (before the @); an author we can't resolve shows a calm "Teammate".
 */
function authorLabel(
  authorUserId: string | null,
  authors: Record<string, string> | undefined,
  fallback: string,
): string | null {
  if (!authorUserId) return null;
  const email = authors?.[authorUserId];
  if (!email) return fallback;
  const local = email.split("@")[0];
  return local || email;
}

/**
 * Lead notes — free-text notes an agent records on a lead, optionally fed to
 * the AI when drafting replies. Reads via a direct (RLS-scoped) SELECT; writes
 * via SECURITY DEFINER RPCs. After every mutation we refetch for correctness.
 * Errors are friendly (the API already mapped any DB RAISE code).
 *
 * `authors` maps author_user_id → email (from the team read-contract) so notes
 * show who wrote them; the raw uuid is never rendered.
 */
export function LeadNotes({
  leadId,
  authors,
}: {
  leadId: string;
  authors?: Record<string, string>;
}) {
  const t = useTranslations("inbox.notes");

  const [notes, setNotes] = useState<LeadNoteRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
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

  // Summary view shows only the latest note's state (count + AI toggle + ⋯);
  // the body text is intentionally not rendered here to keep the panel compact.
  const latest = notes && notes.length > 0 ? notes[0] : null;

  return (
    <div className="flex flex-col gap-2.5 border-t border-border pt-3">
      <h3 className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.01em] text-foreground">
        <StickyNote className="h-4 w-4 text-muted-foreground" aria-hidden />
        {t("heading")}
      </h3>

      {/* Composer — single-line input + inline Add, kept compact for the panel. */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void onAdd();
            }
          }}
          placeholder={t("placeholder")}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          type="button"
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={busy || !draft.trim()}
          onClick={onAdd}
        >
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
      ) : !latest ? (
        <p className="text-[11px] text-muted-foreground">{t("empty")}</p>
      ) : editingId === latest.id ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2">
          <textarea
            rows={2}
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-2 text-[12px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex gap-1.5">
            <Button type="button" size="xs" disabled={busy || !editDraft.trim()} onClick={() => onSaveEdit(latest.id)}>
              {busy ? t("saving") : t("save")}
            </Button>
            <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => setEditingId(null)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : confirmDeleteId === latest.id ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/40 p-2">
          <span className="text-[11px] text-foreground">{t("deleteConfirm")}</span>
          <div className="flex gap-1.5">
            <Button type="button" size="xs" variant="destructive" disabled={busy} onClick={() => onDelete(latest.id)}>
              {t("deleteConfirmYes")}
            </Button>
            <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => setConfirmDeleteId(null)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        /* Compact status row — count + AI toggle + ⋯. Click the count to expand
           and reveal the note body + author + timestamp (read-only); edit/delete
           stay in the ⋯ menu. Collapsed by default to keep the panel compact. */
        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 px-2.5 py-2">
            <button
              type="button"
              onClick={() =>
                setExpandedId((id) => (id === latest.id ? null : latest.id))
              }
              aria-expanded={expandedId === latest.id}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-[11.5px] font-medium text-foreground"
            >
              <Check className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
              <span className="truncate">{t("notesSaved", { count: notes.length })}</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                  expandedId === latest.id && "rotate-180",
                )}
                aria-hidden
              />
            </button>
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5" title={t("usedByAiHint")}>
              <Switch
                checked={latest.context_for_ai}
                onCheckedChange={(next) =>
                  void run(() => toggleNoteAiContextAction(latest.id, next))
                }
                disabled={busy}
                aria-label={t("usedByAiHint")}
              />
              <span
                className={cn(
                  "text-[10px] font-medium",
                  latest.context_for_ai ? "text-brand" : "text-muted-foreground",
                )}
              >
                {t("usedByAi")}
              </span>
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t("moreActions")}
                disabled={busy}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-28">
                <DropdownMenuItem
                  onClick={() => {
                    setEditingId(latest.id);
                    setEditDraft(latest.body);
                    setConfirmDeleteId(null);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                  {t("edit")}
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => setConfirmDeleteId(latest.id)}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  {t("delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {expandedId === latest.id ? (
            <div className="flex flex-col gap-1 border-t border-border px-2.5 py-2">
              <p className="whitespace-pre-wrap text-[12px] leading-snug text-foreground">
                {latest.body}
              </p>
              <div className="flex items-center gap-1.5 font-mono text-[9.5px] text-muted-foreground">
                {authorLabel(latest.author_user_id, authors, t("teammate")) ? (
                  <span>{authorLabel(latest.author_user_id, authors, t("teammate"))}</span>
                ) : null}
                <span aria-hidden>·</span>
                <RelativeTime iso={latest.created_at} />
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
