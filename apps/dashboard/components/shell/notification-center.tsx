"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { createClient } from "@/lib/supabase/client";

/**
 * App-wide notifications (Christian 2026-08-30: "i think we should start
 * closing the proper app-wide notifications build gap now too").
 *
 * Until now the ONLY live listener lived inside the Inbox's handoff queue, so
 * an agent standing on Properties, Studio or Settings was told nothing at all —
 * a buyer could be waiting and the screen stayed silent. This mounts once in
 * the app shell, so every page hears the same events: a chime, a desktop
 * notification, and a badge on the topbar bell that used to be a dead control.
 *
 * Deliberately additive: it never mutates state, never claims or pauses
 * anything. It listens, tells you, and routes you to the page that can act.
 */
export type ShellNotice = {
  id: string;
  kind: "handoff" | "question";
  name: string;
  detail: string;
  at: number;
  href: string;
};

const MAX_KEPT = 20;
const STORAGE_KEY = "aivena.notices.v1";

export function NotificationCenter({
  agencyId,
  onNotices,
}: {
  agencyId: string;
  onNotices: (notices: ShellNotice[]) => void;
}) {
  const t = useTranslations("notifications");
  const router = useRouter();
  const [notices, setNotices] = useState<ShellNotice[]>([]);
  const seen = useRef<Set<string>>(new Set());

  // Restore what arrived while the tab was closed — a notification you missed
  // because you were in another app is exactly the one that mattered.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ShellNotice[];
      if (Array.isArray(parsed)) {
        setNotices(parsed.slice(0, MAX_KEPT));
        parsed.forEach((n) => seen.current.add(n.id));
      }
    } catch {
      /* a corrupt cache must never break the shell */
    }
  }, []);

  useEffect(() => {
    onNotices(notices);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notices.slice(0, MAX_KEPT)));
    } catch {
      /* storage is best-effort */
    }
  }, [notices, onNotices]);

  const chime = useCallback(() => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const t0 = ctx.currentTime;
      // Two soft notes — audible in an office, not startling.
      for (const [at, hz] of [[0, 880], [0.16, 1174]] as const) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = hz;
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

  const push = useCallback(
    (n: ShellNotice) => {
      if (seen.current.has(n.id)) return;   // realtime can redeliver
      seen.current.add(n.id);
      setNotices((prev) => [n, ...prev].slice(0, MAX_KEPT));
      chime();
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          const note = new Notification(n.name, { body: n.detail, tag: n.id });
          note.onclick = () => {
            window.focus();
            router.push(n.href);
          };
        }
      } catch {
        /* notifications are best-effort */
      }
      router.refresh();   // repaint the sidebar counts
    },
    [chime, router],
  );

  useEffect(() => {
    if (!agencyId) return;
    const supabase = createClient();
    let disposed = false;
    const channel = supabase.channel(`agency:${agencyId}:handoffs`, { config: { private: true } });
    void supabase.realtime.setAuth().then(() => {
      if (disposed) return;
      channel
        .on("broadcast", { event: "handoff_requested" }, (msg) => {
          const p = (msg?.payload ?? {}) as { lead_id?: string; at?: string };
          push({
            id: `handoff:${p.lead_id ?? ""}:${p.at ?? ""}`,
            kind: "handoff",
            name: t("handoffTitle"),
            detail: t("handoffBody"),
            at: Date.now(),
            href: "/approvals",
          });
        })
        .on("broadcast", { event: "question_filed" }, (msg) => {
          const p = (msg?.payload ?? {}) as { lead_name?: string; question?: string; at?: string };
          push({
            id: `question:${p.lead_name ?? ""}:${p.at ?? ""}`,
            kind: "question",
            name: t("questionTitle", { name: p.lead_name || t("someone") }),
            detail: p.question || t("questionBody"),
            at: Date.now(),
            href: "/tasks",
          });
        })
        .subscribe();
    });
    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
    };
  }, [agencyId, push, t]);

  return null;   // headless: the bell renders the list
}
