"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CalendarDays } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  getCalendarConnectUrlAction,
  disconnectCalendarAction,
} from "../section-actions";
import type { CalendarStatusResponse } from "@/lib/api/types";

/**
 * Google Calendar connect (Packet 2 · L2 dashboard slice) — the first provider
 * with a live agency-facing connect path. Status is server-fetched in page.tsx
 * from GET /api/v1/calendar/status (soft-fail → null, never blocks Settings);
 * Connect fetches the Google consent URL via a server action and navigates the
 * browser there; Disconnect is a two-step inline confirm (house style — no
 * browser dialogs) onto POST /api/v1/calendar/google/disconnect. Honest by
 * construction: an unconfigured API (`configured: false`) or an unreadable
 * status says exactly that — no dead Connect button, no fake "connected".
 */
export function CalendarSection({ status }: { status: CalendarStatusResponse | null }) {
  const t = useTranslations("settings.calendar");

  const [connecting, startConnecting] = useTransition();
  const [disconnecting, startDisconnecting] = useTransition();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnectedAt, setDisconnectedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onConnect = useCallback(() => {
    setError(null);
    startConnecting(async () => {
      const res = await getCalendarConnectUrlAction();
      if (res.ok) {
        // Google's consent screen redirects back to /settings?calendar=… via
        // the API callback — a full navigation, not a popup.
        window.location.href = res.data.url;
      } else {
        setError(res.error);
      }
    });
  }, []);

  const onDisconnect = useCallback(() => {
    setError(null);
    startDisconnecting(async () => {
      const res = await disconnectCalendarAction();
      if (res.ok) {
        setConfirmingDisconnect(false);
        setDisconnectedAt(Date.now());
      } else {
        setError(res.error);
      }
    });
  }, []);

  const connected = Boolean(status?.connected);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 p-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/12 text-blue-600 dark:text-blue-300"
        >
          <CalendarDays className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-foreground">{t("title")}</h3>
          <p className="truncate text-[11.5px] text-muted-foreground">{t("subtitle")}</p>
        </div>
        {status ? (
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-[10.5px] font-semibold ${
              connected ? "bg-brand-soft text-brand" : "bg-muted text-muted-foreground"
            }`}
          >
            {connected ? t("pillConnected") : t("pillNotConnected")}
          </span>
        ) : null}
      </div>

      {status === null ? (
        // Status endpoint unreadable (e.g. pre-deploy 404) — say so, offer nothing.
        <p className="text-[12px] text-muted-foreground">{t("statusUnavailable")}</p>
      ) : !status.configured ? (
        // API has no Google OAuth config yet — connect would only 503.
        <p className="text-[12px] text-muted-foreground">{t("notConfigured")}</p>
      ) : connected ? (
        <div className="flex flex-col gap-2.5">
          <p className="text-[12px] text-muted-foreground">
            {status.accountEmail
              ? t("connectedAs", { email: status.accountEmail })
              : t("connectedNoEmail")}
          </p>
          {confirmingDisconnect ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[12px] text-foreground">{t("disconnectConfirmText")}</p>
              <Button type="button" size="sm" variant="destructive" onClick={onDisconnect} disabled={disconnecting}>
                {disconnecting ? t("disconnectingBtn") : t("disconnectConfirmBtn")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setConfirmingDisconnect(false)}
                disabled={disconnecting}
              >
                {t("disconnectCancelBtn")}
              </Button>
            </div>
          ) : (
            <div>
              <Button type="button" size="sm" variant="outline" onClick={() => setConfirmingDisconnect(true)}>
                {t("disconnectBtn")}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" onClick={onConnect} disabled={connecting}>
            {connecting ? t("connectingBtn") : t("connectBtn")}
          </Button>
          {disconnectedAt ? (
            <p className="text-[12px] text-muted-foreground" aria-live="polite">{t("disconnectedNote")}</p>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="text-xs text-red-600 dark:text-red-300" role="alert">{error}</p>
      ) : null}
    </div>
  );
}

/**
 * One-shot result banner for the OAuth round-trip: the API callback redirects
 * to /settings?calendar=connected|error. Rendered by page.tsx from the server
 * searchParams, then the query param is scrubbed client-side so a refresh or a
 * shared link doesn't replay the banner.
 */
export function CalendarResultBanner({ result }: { result: "connected" | "error" }) {
  const t = useTranslations("settings.calendar");

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("calendar")) {
      url.searchParams.delete("calendar");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, []);

  const good = result === "connected";
  return (
    <div
      role={good ? "status" : "alert"}
      className={
        good
          ? "rounded-lg border border-brand/30 bg-brand-soft px-3.5 py-2.5 text-[12.5px] text-brand"
          : "rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-[12.5px] text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
      }
    >
      {good ? t("bannerConnected") : t("bannerError")}
    </div>
  );
}
