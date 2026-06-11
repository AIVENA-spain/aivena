"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ImageIcon, LibraryBig, Sparkles, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { intlLocaleFor } from "@/lib/i18n/date-locale";
import type { ContentItemRow, PlanTier } from "@/lib/api/types";
import { ImageGenerator } from "./image-generator";

type TabKey = "create" | "library";

export function StudioTabs({
  planTier,
  library,
}: {
  planTier: PlanTier;
  library: ContentItemRow[];
}) {
  const t = useTranslations("studio");
  const [tab, setTab] = useState<TabKey>("create");

  const TABS: Array<{ key: TabKey; label: string; icon: typeof ImageIcon }> = [
    { key: "create", label: t("create"), icon: Sparkles },
    { key: "library", label: t("tabLibrary"), icon: LibraryBig },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Tab bar */}
      <div className="inline-flex w-fit rounded-lg border border-border bg-card p-0.5">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              tab === key
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {tab === "create" && <ImageGenerator planTier={planTier} />}
      {tab === "library" && <LibraryTab items={library} />}
    </div>
  );
}

// ───────────────────────── Library (content_items) ─────────────────────────

function LibraryTab({ items }: { items: ContentItemRow[] }) {
  const t = useTranslations("studio.library");
  const locale = useLocale();
  const df = new Intl.DateTimeFormat(intlLocaleFor(locale), { dateStyle: "medium" });
  const [openId, setOpenId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <LibraryBig className="h-6 w-6" aria-hidden strokeWidth={1.7} />
        </div>
        <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
        <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
      </div>
    );
  }

  const open = items.find((i) => i.id === openId) ?? null;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <LibraryCard
            key={item.id}
            item={item}
            df={df}
            t={t}
            onOpen={() => setOpenId(item.id)}
          />
        ))}
      </div>
      {open ? (
        <LibraryReadModal item={open} df={df} t={t} onClose={() => setOpenId(null)} />
      ) : null}
    </>
  );
}

function LibraryCard({
  item,
  df,
  t,
  onOpen,
}: {
  item: ContentItemRow;
  df: Intl.DateTimeFormat;
  t: ReturnType<typeof useTranslations<"studio.library">>;
  onOpen: () => void;
}) {
  const thumb =
    Array.isArray(item.media_urls) && item.media_urls.length > 0
      ? item.media_urls[0]
      : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-elevated transition-transform hover:-translate-y-0.5"
    >
      <div className="relative aspect-[4/3] w-full bg-muted">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground/40" aria-hidden />
          </div>
        )}
        <div className="absolute right-2 top-2">
          <StatusPill status={item.status} t={t} />
        </div>
      </div>
      <div className="flex flex-col gap-1 p-3.5">
        <h3 className="line-clamp-2 text-[13.5px] font-semibold text-foreground">
          {item.title}
        </h3>
        <div className="flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
          <span className="uppercase tracking-[0.04em]">{item.content_type}</span>
          <span aria-hidden>·</span>
          <span>{df.format(new Date(item.created_at))}</span>
        </div>
      </div>
    </button>
  );
}

function LibraryReadModal({
  item,
  df,
  t,
  onClose,
}: {
  item: ContentItemRow;
  df: Intl.DateTimeFormat;
  t: ReturnType<typeof useTranslations<"studio.library">>;
  onClose: () => void;
}) {
  const thumb =
    Array.isArray(item.media_urls) && item.media_urls.length > 0
      ? item.media_urls[0]
      : null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 px-4 py-12"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-foreground">{item.title}</div>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
              <span className="uppercase tracking-[0.04em]">{item.content_type}</span>
              <span aria-hidden>·</span>
              <span>{df.format(new Date(item.created_at))}</span>
              <StatusPill status={item.status} t={t} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="flex flex-col gap-4 px-5 py-5">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt={item.title} className="w-full rounded-lg border border-border" />
          ) : null}
          {item.body ? (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
              {item.body}
            </p>
          ) : null}
          {item.hashtags && item.hashtags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {item.hashtags.map((h) => (
                <span
                  key={h}
                  className="rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                >
                  {h.startsWith("#") ? h : `#${h}`}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StatusPill({
  status,
  t,
}: {
  status: string;
  t: ReturnType<typeof useTranslations<"studio.library">>;
}) {
  const known = [
    "draft",
    "pending_approval",
    "approved",
    "rejected",
    "scheduled",
    "published",
    "archived",
    "failed",
  ].includes(status);
  const tone =
    status === "published" || status === "approved"
      ? "border-brand/30 bg-brand-soft text-brand"
      : "border-border bg-card text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium shadow-soft backdrop-blur-sm",
        tone,
      )}
    >
      {known ? t(("status_" + status) as StatusLibKey) : status}
    </span>
  );
}

type StatusLibKey =
  | "status_draft"
  | "status_pending_approval"
  | "status_approved"
  | "status_rejected"
  | "status_scheduled"
  | "status_published"
  | "status_archived"
  | "status_failed";
