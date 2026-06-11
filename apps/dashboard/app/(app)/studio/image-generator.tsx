"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ImageIcon,
  Megaphone,
  Wand2,
  UploadCloud,
  X,
  Loader2,
  TriangleAlert,
  Download,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { intlLocaleFor } from "@/lib/i18n/date-locale";
import { createClient } from "@/lib/supabase/client";
import type { ImageGeneration, ImageGenType, PlanTier } from "@/lib/api/types";
import {
  createStudioUploadUrlAction,
  generateImageAction,
  getGenerationAction,
  getImageQuotaAction,
  listGenerationsAction,
  type GenerateImageInput,
} from "./studio-actions";

const UPLOAD_ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const PROMPT_MAX = 4000;
const POLL_MS = 4000;

type Size = { label: string; w: number | null; h: number | null };

const TYPE_KEYS: Array<{ key: ImageGenType; icon: LucideIcon }> = [
  { key: "ad_creative", icon: Megaphone },
  { key: "social_post", icon: ImageIcon },
  { key: "renovation", icon: Wand2 },
];

const SIZES: Record<ImageGenType, Size[]> = {
  ad_creative: [
    { label: "Default", w: null, h: null },
    { label: "Portrait · 1080×1350", w: 1080, h: 1350 },
    { label: "Story · 1080×1920", w: 1080, h: 1920 },
    { label: "Landscape · 1200×628", w: 1200, h: 628 },
  ],
  social_post: [
    { label: "Default", w: null, h: null },
    { label: "Square · 1080×1080", w: 1080, h: 1080 },
    { label: "Story · 1080×1920", w: 1080, h: 1920 },
    { label: "Landscape · 1200×630", w: 1200, h: 630 },
  ],
  renovation: [
    { label: "Default", w: null, h: null },
    { label: "Square · 1024×1024", w: 1024, h: 1024 },
  ],
};

function isActive(status: string): boolean {
  return status === "pending" || status === "processing";
}

export function ImageGenerator({ planTier }: { planTier: PlanTier }) {
  const t = useTranslations("studio.gen");
  const locale = useLocale();
  const df = new Intl.DateTimeFormat(intlLocaleFor(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const TYPE_LABEL: Record<ImageGenType, string> = {
    ad_creative: t("typeAd"),
    social_post: t("typeSocial"),
    renovation: t("typeRenovation"),
  };
  const TYPE_DESC: Record<ImageGenType, string> = {
    ad_creative: t("descAd"),
    social_post: t("descSocial"),
    renovation: t("descRenovation"),
  };
  const TYPE_HINT: Record<ImageGenType, string> = {
    ad_creative: t("hintAd"),
    social_post: t("hintSocial"),
    renovation: t("hintRenovation"),
  };

  const [type, setType] = useState<ImageGenType>("ad_creative");
  const [prompt, setPrompt] = useState("");
  const [sizeIdx, setSizeIdx] = useState(0);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quota, setQuota] = useState<{
    used: number;
    quota: number | null;
    remaining: number | null;
    unlimited: boolean;
  } | null>(null);

  const [generations, setGenerations] = useState<ImageGeneration[]>([]);
  const genRef = useRef<ImageGeneration[]>([]);
  genRef.current = generations;

  const renovationLocked = type === "renovation" && planTier !== "unlimited";

  useEffect(() => {
    let live = true;
    listGenerationsAction().then((res) => {
      if (live && res.ok) setGenerations(res.data);
    });
    return () => {
      live = false;
    };
  }, []);

  const refreshQuota = useCallback((tp: ImageGenType) => {
    getImageQuotaAction(tp).then(setQuota);
  }, []);
  useEffect(() => {
    setQuota(null);
    refreshQuota(type);
  }, [type, refreshQuota]);

  const hasActive = generations.some((g) => isActive(g.status));
  useEffect(() => {
    if (!hasActive) return;
    const iv = setInterval(async () => {
      const active = genRef.current.filter((g) => isActive(g.status));
      if (active.length === 0) return;
      for (const g of active) {
        const res = await getGenerationAction(g.id);
        if (res.ok) {
          setGenerations((prev) =>
            prev.map((x) => (x.id === g.id ? res.data : x)),
          );
        }
      }
    }, POLL_MS);
    return () => clearInterval(iv);
  }, [hasActive]);

  async function onUpload(file: File | null) {
    if (!file) return;
    setUploadError(null);
    if (!UPLOAD_ACCEPT.includes(file.type)) {
      setUploadError(t("errUploadType"));
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      setUploadError(t("errUploadSize"));
      return;
    }
    setUploading(true);
    try {
      const meta = await createStudioUploadUrlAction(file.type);
      if (!meta.ok) {
        setUploadError(meta.error);
        return;
      }
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from("agency-assets")
        .uploadToSignedUrl(meta.path, meta.token, file, {
          contentType: file.type,
        });
      if (upErr) {
        console.error("[image-gen upload]", upErr);
        setUploadError(t("errUploadFailed"));
        return;
      }
      setSourceUrl(meta.publicUrl);
    } catch (err) {
      console.error("[image-gen upload] unexpected", err);
      setUploadError(t("errUploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  async function onGenerate() {
    setError(null);
    const trimmed = prompt.trim();
    if (!trimmed) {
      setError(t("errPrompt"));
      return;
    }
    if (trimmed.length > PROMPT_MAX) {
      setError(t("errPromptLong"));
      return;
    }
    if (type === "renovation" && !sourceUrl) {
      setError(t("errSource"));
      return;
    }
    const size = SIZES[type][sizeIdx] ?? SIZES[type][0];
    const input: GenerateImageInput = {
      generationType: type,
      prompt: trimmed,
      sourceImageUrl: type === "renovation" ? sourceUrl : undefined,
      width: size.w ?? undefined,
      height: size.h ?? undefined,
    };
    setGenerating(true);
    const res = await generateImageAction(input);
    setGenerating(false);
    if (!res.ok) {
      setError(res.error);
      refreshQuota(type);
      return;
    }
    const placeholder: ImageGeneration = {
      id: res.data.generationId,
      generationType: type,
      status: res.data.status || "processing",
      prompt: trimmed,
      sourceImageUrl: input.sourceImageUrl ?? null,
      resultImageUrl: null,
      failureReason: null,
      width: size.w,
      height: size.h,
      createdAt: new Date().toISOString(),
    };
    setGenerations((prev) => [
      placeholder,
      ...prev.filter((g) => g.id !== placeholder.id),
    ]);
    setPrompt("");
    setSourceUrl(null);
    refreshQuota(type);
  }

  const galleryItems = generations.filter((g) => g.generationType === type);

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {/* Type toggle */}
          <div className="flex flex-wrap gap-2">
            {TYPE_KEYS.map((tp) => {
              const on = tp.key === type;
              return (
                <button
                  key={tp.key}
                  type="button"
                  onClick={() => setType(tp.key)}
                  aria-pressed={on}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[13px] font-medium transition-colors",
                    on
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  <tp.icon className="h-3.5 w-3.5" aria-hidden />
                  {TYPE_LABEL[tp.key]}
                </button>
              );
            })}
            <div className="ml-auto flex items-center text-[12px] text-muted-foreground">
              {quota
                ? quota.unlimited
                  ? t("unlimited")
                  : t("remaining", {
                      remaining: quota.remaining ?? 0,
                      quota: quota.quota ?? 0,
                    })
                : ""}
            </div>
          </div>
          <p className="-mt-2 text-[12.5px] text-muted-foreground">
            {TYPE_DESC[type]}
          </p>

          {renovationLocked ? (
            <div className="rounded-lg border border-amber-300/40 bg-amber-50/50 px-3.5 py-3 text-[13px] text-amber-900 dark:border-amber-200/20 dark:bg-amber-200/10 dark:text-amber-200">
              {t("renovationLocked")}
            </div>
          ) : null}

          {type === "renovation" && !renovationLocked ? (
            <SourceUploader
              sourceUrl={sourceUrl}
              uploading={uploading}
              error={uploadError}
              onPick={onUpload}
              onClear={() => {
                setSourceUrl(null);
                setUploadError(null);
              }}
            />
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gen-prompt">{t("description")}</Label>
            <textarea
              id="gen-prompt"
              rows={4}
              value={prompt}
              maxLength={PROMPT_MAX}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={TYPE_HINT[type]}
              disabled={renovationLocked}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            />
            <span className="self-end font-mono text-[10.5px] text-muted-foreground">
              {prompt.length}/{PROMPT_MAX}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gen-size">{t("size")}</Label>
            <select
              id="gen-size"
              value={sizeIdx}
              onChange={(e) => setSizeIdx(Number(e.target.value))}
              disabled={renovationLocked}
              className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
            >
              {SIZES[type].map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label === "Default" ? t("sizeDefault") : s.label}
                </option>
              ))}
            </select>
          </div>

          {error ? (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-300"
            >
              <TriangleAlert className="h-4 w-4 flex-none" aria-hidden />
              {error}
            </div>
          ) : null}

          <div>
            <Button
              type="button"
              onClick={onGenerate}
              disabled={generating || uploading || renovationLocked}
              className="gap-1.5"
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden />
              )}
              {generating ? t("starting") : t("generate")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Gallery items={galleryItems} df={df} />
    </div>
  );
}

function SourceUploader({
  sourceUrl,
  uploading,
  error,
  onPick,
  onClear,
}: {
  sourceUrl: string | null;
  uploading: boolean;
  error: string | null;
  onPick: (f: File | null) => void;
  onClear: () => void;
}) {
  const t = useTranslations("studio.gen");
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{t("roomPhoto")}</Label>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      {sourceUrl ? (
        <div className="relative w-40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sourceUrl}
            alt={t("roomPhoto")}
            className="aspect-square w-40 rounded-lg border border-border object-cover"
          />
          <button
            type="button"
            onClick={onClear}
            aria-label={t("removeImage")}
            className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-soft hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex w-full max-w-xs flex-col items-center gap-1.5 rounded-xl border border-dashed border-border bg-card px-4 py-6 text-center transition-colors hover:bg-muted disabled:opacity-60"
        >
          <UploadCloud className="h-5 w-5 text-muted-foreground" aria-hidden />
          <span className="text-[12.5px] font-medium text-foreground">
            {uploading ? t("uploading") : t("uploadRoom")}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {t("uploadHint")}
          </span>
        </button>
      )}
      {error ? (
        <p className="text-xs text-rose-600 dark:text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Gallery({
  items,
  df,
}: {
  items: ImageGeneration[];
  df: Intl.DateTimeFormat;
}) {
  const t = useTranslations("studio.gen");
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <ImageIcon className="h-6 w-6" aria-hidden strokeWidth={1.7} />
        </div>
        <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
        <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((g) => (
        <GalleryCard key={g.id} gen={g} df={df} />
      ))}
    </div>
  );
}

function GalleryCard({
  gen,
  df,
}: {
  gen: ImageGeneration;
  df: Intl.DateTimeFormat;
}) {
  const t = useTranslations("studio.gen");
  const active = isActive(gen.status);
  const failed = gen.status === "failed";
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-elevated">
      <div className="relative flex aspect-square w-full items-center justify-center bg-muted/40">
        {gen.resultImageUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={gen.resultImageUrl}
              alt={gen.prompt}
              className="h-full w-full object-cover"
              loading="lazy"
            />
            <a
              href={gen.resultImageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-foreground/80 text-background backdrop-blur-sm transition-opacity hover:opacity-90"
              aria-label={t("openFull")}
              title={t("openFull")}
            >
              <Download className="h-4 w-4" aria-hidden />
            </a>
          </>
        ) : active ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
            <span className="text-[12px]">{t("generating")}</span>
          </div>
        ) : failed ? (
          <div className="flex flex-col items-center gap-2 px-4 text-center text-muted-foreground">
            <TriangleAlert className="h-6 w-6 text-amber-600" aria-hidden />
            <span className="text-[12px]">{t("genFailed")}</span>
          </div>
        ) : (
          <ImageIcon className="h-8 w-8 text-muted-foreground/40" aria-hidden />
        )}
      </div>
      <div className="flex flex-col gap-1 p-3.5">
        <p className="line-clamp-2 text-[12.5px] text-foreground">{gen.prompt}</p>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {df.format(new Date(gen.createdAt))}
        </span>
      </div>
    </div>
  );
}
