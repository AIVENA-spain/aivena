"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a force-dynamic server page alive (Christian 2026-08-28: "why am I
 * not getting live updates"): re-renders the RSC tree every `intervalMs` and
 * on window focus, so lists/badges follow reality without a manual reload.
 * Client caches (thread bubbles etc.) survive — router.refresh() only
 * refetches the server payload.
 */
export function AutoRefresh({ intervalMs = 20000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = window.setInterval(tick, intervalMs);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", tick);
    };
  }, [router, intervalMs]);
  return null;
}
