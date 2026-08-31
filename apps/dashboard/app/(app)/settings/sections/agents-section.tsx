"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Users, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { saveAgentAction, removeAgentAction, type AgentRow } from "../section-actions";
import { AgentHoursEditor } from "@/components/amanda/agent-hours-editor";

// The 13 languages AIVENA speaks — an agent's languages decide who Amanda pings
// for a given buyer, so this list mirrors the engine's supported set exactly.
const LANGS = ["en", "es", "de", "nl", "fr", "it", "pt", "pl", "sv", "nb", "da", "fi", "ru"] as const;

/** Two-letter codes are unreadable to the person filling this in — "NB" and
 *  "NL" and "DA" mean nothing at a glance (Christian 2026-08-31: "its a little
 *  hard to know which language is what here when its just 2 letters"). The
 *  browser knows every language name in the reader's own language, so we ask
 *  it rather than shipping 13 x 13 hand-written labels. */
function languageName(code: string, locale: string): string {
  try {
    const dn = new Intl.DisplayNames([locale], { type: "language" });
    const name = dn.of(code === "nb" ? "nb" : code);
    if (name && name.toLowerCase() !== code) return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    /* fall through to the code */
  }
  return code.toUpperCase();
}

const EMPTY = { id: "", full_name: "", whatsapp_e164: "", email: "", office: "", languages: [] as string[] };

/**
 * The agent roster (Christian 2026-08-28): "the agency needs to have a place
 * for managing their real estate agents… so that amanda can ping the agent
 * that is correct for the client". Names, numbers and languages first — work
 * hours reuse the availability editor in a following slice.
 */
export function AgentsSection({ agents: initial }: { agents: AgentRow[] }) {
  const t = useTranslations("settings.agents");
  const locale = useLocale();
  const [agents, setAgents] = useState<AgentRow[]>(initial);
  const [editHours, setEditHours] = useState<string | null>(null);
  const [draft, setDraft] = useState({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);
  const [busy, startSave] = useTransition();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  function toggleLang(code: string) {
    setDraft((d) => ({
      ...d,
      languages: d.languages.includes(code) ? d.languages.filter((l) => l !== code) : [...d.languages, code],
    }));
  }

  function onSave() {
    if (busy || !draft.full_name.trim() || !draft.whatsapp_e164.trim()) return;
    setError(null);
    startSave(async () => {
      const res = await saveAgentAction({
        id: draft.id || undefined,
        full_name: draft.full_name,
        whatsapp_e164: draft.whatsapp_e164,
        email: draft.email || undefined,
        office: draft.office || undefined,
        languages: draft.languages,
      });
      if (!res.ok) { setError(res.error); return; }
      const previous = agents.find((a) => a.id === res.data.id);
      const saved: AgentRow = {
        // Hours are edited in their own panel and are NOT part of this form, so
        // keep whatever the agent already had rather than blanking the row.
        work_hours: previous?.work_hours ?? null,
        unavailable_dates: previous?.unavailable_dates ?? null,
        id: res.data.id, full_name: draft.full_name.trim(), whatsapp_e164: draft.whatsapp_e164.trim(),
        email: draft.email || null, office: draft.office || null, languages: draft.languages,
        receives_pings: true, last_checkin_at: null, status: "active",
      };
      setAgents((prev) => [...prev.filter((a) => a.id !== saved.id), saved].sort((a, b) => a.full_name.localeCompare(b.full_name)));
      setDraft({ ...EMPTY });
    });
  }

  function onRemove(id: string) {
    startSave(async () => {
      const res = await removeAgentAction(id);
      if (res.ok) { setAgents((prev) => prev.filter((a) => a.id !== id)); setConfirmRemove(null); }
      else setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border/60 p-4">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
          <Users className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-foreground">{t("title")}</h3>
          <p className="text-[11.5px] text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      {agents.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {agents.map((a) => (
            <li key={a.id} className="flex flex-col gap-2">
            <div className={`flex flex-wrap items-center gap-2 rounded-md px-2.5 py-2 text-[12.5px] ${
              draft.id === a.id ? "bg-brand-soft ring-1 ring-brand/30" : "bg-muted/50"
            }`}>
              <span className="font-medium text-foreground">{a.full_name}</span>
              <span className="font-mono tabular-nums text-muted-foreground">{a.whatsapp_e164}</span>
              {a.languages.length > 0 ? (
                <span className="flex gap-1">
                  {a.languages.map((l) => (
                    <span key={l} className="rounded bg-brand-soft px-1.5 py-px text-[10.5px] font-semibold text-brand">{languageName(l, locale)}</span>
                  ))}
                </span>
              ) : null}
              {a.office ? <span className="text-muted-foreground">· {a.office}</span> : null}
              <span className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEditHours(editHours === a.id ? null : a.id)}
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium text-brand hover:bg-brand-soft"
                >
                  {summariseHours(a.work_hours, locale) ?? t("setHours")}
                </button>
                {/* Christian 2026-08-31: "i should have been shown there as a
                    added agent with a edit button". He was shown — but with no
                    way to change anything, so retyping into the add form was
                    the only move available, and that failed as a duplicate. */}
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setEditHours(null);
                    setDraft({
                      id: a.id,
                      full_name: a.full_name,
                      whatsapp_e164: a.whatsapp_e164,
                      email: a.email ?? "",
                      office: a.office ?? "",
                      languages: [...a.languages],
                    });
                  }}
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {t("edit")}
                </button>
                {confirmRemove === a.id ? (
                  <>
                    <button type="button" onClick={() => onRemove(a.id)} disabled={busy}
                      className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-destructive hover:bg-destructive/10">
                      {t("confirmRemove")}
                    </button>
                    <button type="button" onClick={() => setConfirmRemove(null)}
                      className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted">{t("cancel")}</button>
                  </>
                ) : (
                  <button type="button" aria-label={t("remove")} onClick={() => setConfirmRemove(a.id)}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            </div>
            {editHours === a.id ? (
              <AgentHoursEditor
                agent={a}
                onClose={() => setEditHours(null)}
                onSaved={(hours) =>
                  setAgents((prev) => prev.map((x) => (x.id === a.id ? { ...x, work_hours: hours } : x)))
                }
              />
            ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-muted-foreground">{t("empty")}</p>
      )}

      <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
        <div className="flex flex-wrap gap-2">
          <input value={draft.full_name} onChange={(e) => setDraft((d) => ({ ...d, full_name: e.target.value }))}
            placeholder={t("namePlaceholder")} maxLength={120}
            className="h-9 min-w-[150px] flex-1 rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand/40" />
          <input value={draft.whatsapp_e164} onChange={(e) => setDraft((d) => ({ ...d, whatsapp_e164: e.target.value }))}
            placeholder="+34 600 111 222" maxLength={24} inputMode="tel"
            className="h-9 min-w-[150px] flex-1 rounded-md border border-border bg-background px-2.5 text-[13px] tabular-nums text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand/40" />
        </div>
        <div className="flex flex-wrap gap-2">
          <input value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
            placeholder={t("emailPlaceholder")} maxLength={160} type="email"
            className="h-9 min-w-[150px] flex-1 rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand/40" />
          <input value={draft.office} onChange={(e) => setDraft((d) => ({ ...d, office: e.target.value }))}
            placeholder={t("officePlaceholder")} maxLength={80}
            className="h-9 min-w-[150px] flex-1 rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand/40" />
        </div>
        <div>
          <p className="mb-1.5 text-[11.5px] text-muted-foreground">{t("languagesHint")}</p>
          <div className="flex flex-wrap gap-1">
            {LANGS.map((l) => {
              const on = draft.languages.includes(l);
              return (
                <button key={l} type="button" aria-pressed={on} title={languageName(l, locale)} onClick={() => toggleLang(l)}
                  className={on
                    ? "rounded-md bg-brand px-2.5 py-1 text-[11.5px] font-semibold text-white"
                    : "rounded-md bg-muted/60 px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground hover:bg-muted"}>
                  {languageName(l, locale)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={onSave} disabled={busy || !draft.full_name.trim() || !draft.whatsapp_e164.trim()}>
            {busy ? t("saving") : draft.id ? t("saveChanges") : t("add")}
          </Button>
          {draft.id ? (
            <button
              type="button"
              onClick={() => { setDraft({ ...EMPTY }); setError(null); }}
              className="text-[11.5px] text-muted-foreground hover:text-foreground"
            >
              {t("cancelEdit")}
            </button>
          ) : null}
          <span className="text-[11.5px] text-muted-foreground">{t("numberHint")}</span>
        </div>
        {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}

/**
 * "Mon–Fri · 09:00–18:00" — the DAYS, not a count. It used to read "7d ·
 * 09:00–18:00", which hid the thing worth checking: Christian set Monday to
 * Friday and it had saved all seven days, and the summary gave him no way to
 * see that (2026-08-31). Consecutive days collapse to a range; anything else
 * lists out. Shows what is actually stored, never a friendly guess.
 */
function summariseHours(wh: Record<string, number[]> | null, locale: string): string | null {
  if (!wh) return null;
  const openDays = Object.entries(wh)
    .filter(([, hs]) => Array.isArray(hs) && hs.length > 0)
    .map(([d]) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (openDays.length === 0) return null;

  // Agency week order: Mon..Sat, Sun — the same order the editor shows.
  const ORDER = [1, 2, 3, 4, 5, 6, 0];
  const shown = ORDER.filter((d) => openDays.includes(d));
  const name = (d: number) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" })
      .format(new Date(Date.UTC(2026, 7, 23 + d)));

  // Collapse runs that are consecutive in the agency week order.
  const parts: string[] = [];
  let runStart = 0;
  for (let i = 1; i <= shown.length; i++) {
    const contiguous =
      i < shown.length && ORDER.indexOf(shown[i]) === ORDER.indexOf(shown[i - 1]) + 1;
    if (!contiguous) {
      const a = shown[runStart];
      const b = shown[i - 1];
      parts.push(a === b ? name(a) : `${name(a)}–${name(b)}`);
      runStart = i;
    }
  }

  const all = Object.values(wh).flat();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.join(", ")} · ${pad(Math.min(...all))}:00–${pad(Math.max(...all) + 1)}:00`;
}
