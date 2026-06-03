"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ImageIcon,
  Megaphone,
  Wand2,
  UploadCloud,
  LibraryBig,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  GatedActionButton,
  GateNote,
  GatePill,
} from "@/components/shell/launch-gate";
import { intlLocaleFor } from "@/lib/i18n/date-locale";
import type { ContentItemRow, PlanTier, PropertyRow } from "@/lib/api/types";
import { uploadStudioImageAction } from "./studio-actions";

const UPLOAD_ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024; // 10MB

const LANG_CODES = [
  "es", "en", "no", "sv", "da", "de", "nl", "fr", "it", "pt", "ru", "pl", "fi",
] as const;

type TabKey = "ad" | "social" | "renovation" | "library";

export function StudioTabs({
  properties,
  planTier,
  library,
}: {
  properties: PropertyRow[];
  planTier: PlanTier;
  library: ContentItemRow[];
}) {
  const t = useTranslations("studio");
  const [tab, setTab] = useState<TabKey>("ad");

  const TABS: Array<{ key: TabKey; label: string; icon: typeof ImageIcon }> = [
    { key: "ad", label: t("tabAd"), icon: Megaphone },
    { key: "social", label: t("tabSocial"), icon: ImageIcon },
    { key: "renovation", label: t("tabRenovation"), icon: Wand2 },
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

      {tab === "ad" && <AdCreativeTab properties={properties} />}
      {tab === "social" && <SocialPostTab properties={properties} />}
      {tab === "renovation" && <RenovationTab planTier={planTier} />}
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

// ───────────────────────── Ad Creative (W13a) ─────────────────────────

function AdCreativeTab({ properties }: { properties: PropertyRow[] }) {
  const t = useTranslations("studio.ad");
  const [mode, setMode] = useState<"property" | "brand">("property");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ModeToggle
          options={[
            { value: "property", label: t("modeProperty") },
            { value: "brand", label: t("modeBrand") },
          ]}
          value={mode}
          onChange={(v) => setMode(v as "property" | "brand")}
        />

        {mode === "property" && <PropertyPicker properties={properties} />}

        <ImageUpload />

        <FormatSelect
          label={t("formatLabel")}
          options={[
            { value: "instagram_square_1080x1350", label: "Instagram 1080×1350" },
            { value: "stories_1080x1920", label: "Stories 1080×1920" },
            { value: "facebook_feed_1200x628", label: "Facebook 1200×628" },
          ]}
        />

        <LanguageSelect label={t("languageLabel")} />

        <PreviewPane label={t("previewLabel")} />

        <div className="flex flex-col gap-2">
          <GatedActionButton label={t("generate")} />
          <GateNote />
        </div>
      </CardContent>
    </Card>
  );
}

// ───────────────────────── Social Post (W13b) ─────────────────────────

function SocialPostTab({ properties }: { properties: PropertyRow[] }) {
  const t = useTranslations("studio.social");
  const [mode, setMode] = useState<"property" | "free">("property");

  const ANGLES = [
    "new_listing", "open_house", "price_reduced", "sold", "milestone", "seasonal",
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ModeToggle
          options={[
            { value: "property", label: t("modeProperty") },
            { value: "free", label: t("modeFree") },
          ]}
          value={mode}
          onChange={(v) => setMode(v as "property" | "free")}
        />

        {mode === "property" ? (
          <>
            <PropertyPicker properties={properties} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="post-angle">{t("angleLabel")}</Label>
              <select
                id="post-angle"
                className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                {ANGLES.map((a) => (
                  <option key={a} value={a}>
                    {t(("angle_" + a) as AngleKey)}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="free-prompt">{t("freePromptLabel")}</Label>
            <textarea
              id="free-prompt"
              rows={3}
              placeholder={t("freePromptPlaceholder")}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>
        )}

        <ImageUpload />

        <FormatSelect
          label={t("formatLabel")}
          options={[
            { value: "instagram_square_1080x1080", label: "Instagram 1080×1080" },
            { value: "instagram_story_1080x1920", label: "Story 1080×1920" },
            { value: "instagram_carousel", label: t("formatCarousel") },
            { value: "facebook_post_1200x630", label: "Facebook 1200×630" },
          ]}
        />

        <LanguageSelect label={t("languageLabel")} />

        <PreviewPane label={t("previewLabel")} caption={t("captionPreview")} />

        <div className="flex flex-col gap-2">
          <GatedActionButton label={t("generate")} />
          <GateNote />
        </div>
      </CardContent>
    </Card>
  );
}

// ───────────────────────── Renovation (W13c) ─────────────────────────

function RenovationTab({ planTier }: { planTier: PlanTier }) {
  const t = useTranslations("studio.renovation");
  const [attested, setAttested] = useState(false);

  const STYLES = [
    "modern_minimalist", "traditional_spanish", "scandinavian", "mediterranean",
    "contemporary_luxury", "boho", "industrial", "classic", "coastal",
  ] as const;
  const FURNISHING = ["empty", "lightly_staged", "fully_furnished"] as const;
  const FEATURES = [
    "plants", "warm_lighting", "natural_light", "open_curtains",
    "neutral_palette", "vibrant_accents",
  ] as const;

  const tierLocked = planTier !== "unlimited";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>{t("title")}</CardTitle>
          {tierLocked && <GatePill variant="tier" />}
        </div>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {/* Uploader */}
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card px-6 py-8 text-center">
          <UploadCloud className="h-6 w-6 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium text-foreground">{t("uploadPrompt")}</span>
          <span className="text-xs text-muted-foreground">{t("uploadHint")}</span>
        </div>

        {/* Rights attestation — generate stays disabled until ticked */}
        <label className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3">
          <input
            type="checkbox"
            checked={attested}
            onChange={(e) => setAttested(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
          />
          <span className="text-[13px] leading-snug text-foreground">
            {t("attestation")}
          </span>
        </label>

        <SelectBlock label={t("styleLabel")}>
          {STYLES.map((s) => (
            <option key={s} value={s}>{t(("style_" + s) as StyleKey)}</option>
          ))}
        </SelectBlock>

        <SelectBlock label={t("furnishingLabel")}>
          {FURNISHING.map((f) => (
            <option key={f} value={f}>{t(("furnishing_" + f) as FurnishingKey)}</option>
          ))}
        </SelectBlock>

        {/* Optional features */}
        <div className="flex flex-col gap-2">
          <Label>{t("featuresLabel")}</Label>
          <div className="flex flex-wrap gap-2">
            {FEATURES.map((f) => (
              <FeatureChip key={f} label={t(("feature_" + f) as FeatureKey)} />
            ))}
          </div>
        </div>

        {/* Before/after viewer placeholder */}
        <div className="grid grid-cols-2 gap-3">
          <BeforeAfterPane label={t("beforeLabel")} />
          <BeforeAfterPane label={t("afterLabel")} />
        </div>

        {/* Visualization-only disclaimer */}
        <p className="rounded-lg border border-amber-300/40 bg-amber-50/50 px-3 py-2 text-xs text-amber-900 dark:border-amber-200/20 dark:bg-amber-200/10 dark:text-amber-200">
          {t("disclaimer")}
        </p>

        <div className="flex flex-col gap-2">
          {/* Gated regardless; tier gate when not unlimited. The attestation
              checkbox is a real precondition surfaced in the note. */}
          <GatedActionButton
            label={t("generate")}
            variant={tierLocked ? "tier" : "launch"}
          />
          {tierLocked ? <GateNote variant="tier" /> : <GateNote />}
          {!attested && (
            <p className="text-xs text-muted-foreground">{t("attestationRequired")}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ───────────────────────── shared sub-controls ─────────────────────────

function ModeToggle({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex w-fit rounded-md border border-border bg-card p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "rounded-sm px-3 py-1.5 text-[12px] font-medium transition-colors",
            value === o.value
              ? "bg-brand-soft text-brand"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Upload-your-own reference image (Phase 6). Upload-only: stores the image in
 * agency-assets and holds the public URL in local state for the eventual
 * generation payload. No generation call exists yet (the generators are gated).
 */
function ImageUpload() {
  const t = useTranslations("studio.upload");
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | null) {
    if (!file) return;
    setError(null);
    if (!UPLOAD_ACCEPT.includes(file.type)) {
      setError(t("badType"));
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      setError(t("tooLarge"));
      return;
    }
    setBusy(true);
    const fd = new FormData();
    fd.set("file", file);
    const res = await uploadStudioImageAction(fd);
    if (res.ok) setUrl(res.url);
    else setError(res.error);
    setBusy(false);
  }

  function clear() {
    setUrl(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>{t("label")}</Label>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      {url ? (
        <div className="relative w-40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={t("label")}
            className="aspect-square w-40 rounded-lg border border-border object-cover"
          />
          <button
            type="button"
            onClick={clear}
            aria-label={t("remove")}
            className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-soft hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex w-full max-w-xs flex-col items-center gap-1.5 rounded-xl border border-dashed border-border bg-card px-4 py-6 text-center transition-colors hover:bg-muted disabled:opacity-60"
        >
          <UploadCloud className="h-5 w-5 text-muted-foreground" aria-hidden />
          <span className="text-[12.5px] font-medium text-foreground">
            {busy ? t("uploading") : t("prompt")}
          </span>
          <span className="text-[11px] text-muted-foreground">{t("hint")}</span>
        </button>
      )}
      {error ? (
        <p className="text-xs text-red-600 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PropertyPicker({ properties }: { properties: PropertyRow[] }) {
  const t = useTranslations("studio");
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="property-pick">{t("propertyLabel")}</Label>
      {properties.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("propertyEmpty")}</p>
      ) : (
        <select
          id="property-pick"
          className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.external_id} — {p.title}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function LanguageSelect({ label }: { label: string }) {
  const tl = useTranslations("settings.languages");
  return (
    <SelectBlock label={label}>
      {LANG_CODES.map((code) => (
        <option key={code} value={code}>
          {tl(("name_" + code) as LangNameKey)}
        </option>
      ))}
    </SelectBlock>
  );
}

function FormatSelect({
  label,
  options,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <SelectBlock label={label}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </SelectBlock>
  );
}

function SelectBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const id = label.replace(/\s+/g, "-").toLowerCase();
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
      >
        {children}
      </select>
    </div>
  );
}

function FeatureChip({ label }: { label: string }) {
  const [on, setOn] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setOn((v) => !v)}
      aria-pressed={on}
      className={cn(
        "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
        on
          ? "border-brand/40 bg-brand-soft text-brand"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function PreviewPane({ label, caption }: { label: string; caption?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <div className="flex aspect-[4/3] max-w-md items-center justify-center rounded-xl border border-dashed border-border bg-muted/30">
        <ImageIcon className="h-8 w-8 text-muted-foreground/50" aria-hidden />
      </div>
      {caption && (
        <div className="max-w-md rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          {caption}
        </div>
      )}
    </div>
  );
}

function BeforeAfterPane({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-border bg-muted/30">
        <ImageIcon className="h-6 w-6 text-muted-foreground/50" aria-hidden />
      </div>
    </div>
  );
}

type LangNameKey =
  | "name_es" | "name_en" | "name_no" | "name_sv" | "name_da"
  | "name_de" | "name_nl" | "name_fr" | "name_it" | "name_pt"
  | "name_ru" | "name_pl" | "name_fi";
type AngleKey =
  | "angle_new_listing" | "angle_open_house" | "angle_price_reduced"
  | "angle_sold" | "angle_milestone" | "angle_seasonal";
type StyleKey =
  | "style_modern_minimalist" | "style_traditional_spanish" | "style_scandinavian"
  | "style_mediterranean" | "style_contemporary_luxury" | "style_boho"
  | "style_industrial" | "style_classic" | "style_coastal";
type FurnishingKey =
  | "furnishing_empty" | "furnishing_lightly_staged" | "furnishing_fully_furnished";
type FeatureKey =
  | "feature_plants" | "feature_warm_lighting" | "feature_natural_light"
  | "feature_open_curtains" | "feature_neutral_palette" | "feature_vibrant_accents";
