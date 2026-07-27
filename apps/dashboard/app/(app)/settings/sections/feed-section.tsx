"use client";

import { useCallback, useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { saveFeedConfigAction, type FeedConfig } from "../section-actions";

/**
 * Property feed (catalogue import) — P3-A. Lets an agency paste its property-feed URL (Kyero XML)
 * so AIVENA imports its listings and keeps them up to date on a schedule (the pg_cron
 * property-feed-sync tick → property-sync EF). CATALOGUE data only — this never messages portal
 * leads. Copy is English for now (the settings-onboarding localization pass, D9, is pending for the
 * whole readiness/onboarding surface). Mirrors the branding-section save idiom (useTransition +
 * inline error/saved), server-validated by POST /api/v1/settings/feed.
 */
const URL_HTTPS = /^https?:\/\/\S+\.\S+$/i;

export function FeedSection({ feed }: { feed: FeedConfig | null }) {
  const urlId = useId();
  const intId = useId();

  const [feedUrl, setFeedUrl] = useState(feed?.feed_url ?? "");
  const [syncEnabled, setSyncEnabled] = useState(feed?.sync_enabled ?? true);
  const [intervalHours, setIntervalHours] = useState<number>(feed?.sync_interval_hours ?? 6);

  const [saving, startSaving] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSave = useCallback(() => {
    setError(null);
    const url = feedUrl.trim();
    if (!URL_HTTPS.test(url)) {
      setError("Enter a valid feed URL starting with https://");
      return;
    }
    startSaving(async () => {
      const res = await saveFeedConfigAction({
        feed_url: url,
        sync_enabled: syncEnabled,
        sync_interval_hours: intervalHours,
      });
      if (res.ok) setSavedAt(Date.now());
      else setError(res.error);
    });
  }, [feedUrl, syncEnabled, intervalHours]);

  // Stable, locale-free timestamp display (avoids a client/server hydration mismatch).
  const lastSync = feed?.last_synced_at ? String(feed.last_synced_at).replace("T", " ").slice(0, 16) : null;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border/60 p-4">
      <div>
        <h3 className="text-[13px] font-semibold text-foreground">Automatic property feed</h3>
        <p className="text-[11.5px] leading-snug text-muted-foreground">
          Paste your property feed URL (Kyero XML from your portal or CRM). AIVENA imports your listings
          and keeps them up to date on a schedule — no manual uploads. This imports your catalogue only; it
          does not message portal leads.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={urlId}>Feed URL</Label>
        <Input
          id={urlId}
          value={feedUrl}
          onChange={(e) => setFeedUrl(e.target.value)}
          placeholder="https://feeds.example.com/your-agency.xml"
          inputMode="url"
          spellCheck={false}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-[13px] text-foreground">
          <input
            type="checkbox"
            checked={syncEnabled}
            onChange={(e) => setSyncEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Keep my catalogue synced automatically
        </label>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={intId}>Check for updates every</Label>
          <select
            id={intId}
            value={intervalHours}
            onChange={(e) => setIntervalHours(Number(e.target.value))}
            className="h-9 rounded-md border border-border bg-background px-2 text-[13px] text-foreground"
          >
            <option value={6}>6 hours</option>
            <option value={12}>12 hours</option>
            <option value={24}>24 hours</option>
          </select>
        </div>
      </div>

      {lastSync ? (
        <p className="text-[11px] text-muted-foreground">
          Last checked: {lastSync} · {feed?.last_sync_status ?? "—"}
          {typeof feed?.properties_found_last_run === "number" ? ` · ${feed.properties_found_last_run} properties` : ""}
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">No sync yet — save a feed URL to start automatic imports.</p>
      )}

      <div className="flex items-center gap-3 border-t border-border/60 pt-3">
        <Button type="button" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save feed"}
        </Button>
        {error ? (
          <p className="text-xs text-red-600 dark:text-red-300" role="alert">{error}</p>
        ) : savedAt ? (
          <p className="text-xs text-brand" aria-live="polite">Saved</p>
        ) : null}
      </div>
    </div>
  );
}
