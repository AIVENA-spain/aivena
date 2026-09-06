"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, Check, AlertCircle, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { activeGenerationAction } from "@/app/(app)/studio/wizard-actions";

type Active = {
  id: string;
  status: "processing" | "completed" | "failed";
  topic: string;
  started_at: string;
  finished_at: string | null;
};

/**
 * The one thing that tells you a carousel is being made, wherever you are in Aivena.
 *
 * It reads the generation record from the server rather than holding React state, so navigating
 * away, reloading, or closing the tab and coming back all show the same job. The Studio used to
 * trap you on "Writing your carousel — about a minute…" for five minutes; now you press Generate
 * and carry on working.
 */
export function GenerationWidget() {
  const [active, setActive] = useState<Active | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await activeGenerationAction();
        if (!alive) return;
        const a = (r?.ok ? (r.active as Active | null) : null) ?? null;
        setActive(a);
        // While something is running, look often. When nothing is, look rarely — this widget is
        // mounted on every page and must never be a load on the API.
        timer.current = setTimeout(tick, a?.status === "processing" ? 4000 : 20000);
      } catch {
        if (alive) timer.current = setTimeout(tick, 30000);
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!active || dismissed === active.id) return null;

  const running = active.status === "processing";
  const failed = active.status === "failed";
  const subject = active.topic.replace(/^Tips carousel · /, "").trim();

  return (
    <div
      className={cn(
        "fixed bottom-4 left-4 z-50 flex max-w-[22rem] items-start gap-3 rounded-xl border px-4 py-3 shadow-lg",
        "bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        failed ? "border-destructive/40" : "border-border",
      )}
      role="status"
      aria-live="polite"
    >
      <span className={cn("mt-0.5 shrink-0", running && "animate-pulse")}>
        {running ? <Sparkles className="h-4 w-4 text-primary" />
          : failed ? <AlertCircle className="h-4 w-4 text-destructive" />
          : <Check className="h-4 w-4 text-emerald-600" />}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">
          {running ? "Creating your carousel"
            : failed ? "Couldn't finish your carousel"
            : "Your carousel is ready"}
        </p>
        {subject ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={subject}>{subject}</p>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground">
          {running ? "You can keep working — we'll show it here when it's done."
            : failed ? "Nothing was lost. Try it again when you're ready."
            : null}
        </p>
        {!running ? (
          <Link
            href={`/studio?generation=${encodeURIComponent(active.id)}`}
            className="mt-2 inline-block text-xs font-medium text-primary underline underline-offset-2"
            onClick={() => setDismissed(active.id)}
          >
            {failed ? "Try again" : "View it"}
          </Link>
        ) : null}
      </div>

      {!running ? (
        <button
          type="button"
          onClick={() => setDismissed(active.id)}
          aria-label="Dismiss"
          className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
