"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ImageIcon,
  Megaphone,
  Wand2,
  UploadCloud,
  LibraryBig,
  X,
  Loader2,
  TriangleAlert,
  Download,
  Sparkles,
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
import { GatePill } from "@/components/shell/launch-gate";
import { intlLocaleFor } from "@/lib/i18n/date-locale";
import { createClient } from "@/lib/supabase/client";
import type {
  ContentItemRow,
  ImageGeneration,
  ImageGenType,
  PlanTier,
  PropertyRow,
} from "@/lib/api/types";
import {
  createStudioUploadUrlAction,
  generateImageAction,
  getGenerationAction,
  getImageQuotaAction,
  listGenerationsAction,
} from "./studio-actions";

const UPLOAD_ACCEPT = ["image/png", "image/jpeg", "image/webp"];
// Hard reject only at 40MB; anything large gets downscaled client-side first
// (modern phone photos are 12-48MP — staging never needs that), so the user
// basically never sees a size error.
const UPLOAD_HARD_MAX_BYTES = 40 * 1024 * 1024;
const UPLOAD_PASSTHROUGH_BYTES = 2 * 1024 * 1024;
const UPLOAD_MAX_EDGE = 4096;

/**
 * Downscale + re-encode a photo before upload: max 4096px long edge, JPEG
 * q0.85. createImageBitmap with imageOrientation:"from-image" bakes the EXIF
 * rotation into the pixels, so portrait phone photos stay upright after
 * re-encode. Small files (≤2MB) pass through untouched.
 */
async function prepareImageForUpload(
  file: File,
): Promise<{ blob: Blob; contentType: string }> {
  if (file.size <= UPLOAD_PASSTHROUGH_BYTES) {
    return { blob: file, contentType: file.type };
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, UPLOAD_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { blob: file, contentType: file.type };
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob) return { blob: file, contentType: file.type };
    return { blob, contentType: "image/jpeg" };
  } finally {
    bitmap.close();
  }
}
const PROMPT_MAX = 4000;
const POLL_MS = 4000;

const LANG_CODES = [
  "es", "en", "no", "sv", "da", "de", "nl", "fr", "it", "pt", "ru", "pl", "fi",
] as const;

// English language names for prompt composition (the image model reads the
// prompt in English; the UI label stays localized via settings.languages).
const LANG_NAME_EN: Record<(typeof LANG_CODES)[number], string> = {
  es: "Spanish", en: "English", no: "Norwegian", sv: "Swedish", da: "Danish",
  de: "German", nl: "Dutch", fr: "French", it: "Italian", pt: "Portuguese",
  ru: "Russian", pl: "Polish", fi: "Finnish",
};

type TabKey = "ad" | "social" | "renovation" | "library";

function isActive(status: string): boolean {
  return status === "pending" || status === "processing";
}

/**
 * Shared generation state: initial list, 4s polling while anything is
 * in-flight, optimistic insert on create. One instance lives in StudioTabs so
 * switching tabs never drops in-flight work.
 */
function useGenerations() {
  const [generations, setGenerations] = useState<ImageGeneration[]>([]);
  const genRef = useRef<ImageGeneration[]>([]);
  genRef.current = generations;

  useEffect(() => {
    let live = true;
    listGenerationsAction().then((res) => {
      if (live && res.ok) setGenerations(res.data);
    });
    return () => {
      live = false;
    };
  }, []);

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

  const add = useCallback((g: ImageGeneration) => {
    setGenerations((prev) => [g, ...prev.filter((x) => x.id !== g.id)]);
  }, []);

  return { generations, add };
}

type Gens = ReturnType<typeof useGenerations>;

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
  const gens = useGenerations();

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

      {tab === "ad" && <AdCreativeTab properties={properties} gens={gens} />}
      {tab === "social" && <SocialPostTab properties={properties} gens={gens} />}
      {tab === "renovation" && <RenovationTab planTier={planTier} gens={gens} />}
      {tab === "library" && <LibraryTab items={library} />}
    </div>
  );
}

/* ───────────────────────── generation plumbing ───────────────────────── */

function useGenerate(type: ImageGenType, gens: Gens) {
  const tGen = useTranslations("studio.gen");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quota, setQuota] = useState<{
    quota: number | null;
    remaining: number | null;
    unlimited: boolean;
  } | null>(null);

  const refreshQuota = useCallback(() => {
    getImageQuotaAction(type).then((q) =>
      setQuota(
        q
          ? { quota: q.quota, remaining: q.remaining, unlimited: q.unlimited }
          : null,
      ),
    );
  }, [type]);
  useEffect(() => {
    refreshQuota();
  }, [refreshQuota]);

  const quotaLine = quota
    ? quota.unlimited
      ? tGen("unlimited")
      : tGen("remaining", {
          remaining: quota.remaining ?? 0,
          quota: quota.quota ?? 0,
        })
    : "";

  const run = useCallback(
    async (opts: {
      prompt: string;
      sourceImageUrl?: string | null;
      sourcePropertyId?: string;
      width?: number | null;
      height?: number | null;
    }) => {
      setError(null);
      const trimmed = opts.prompt.trim().slice(0, PROMPT_MAX);
      setGenerating(true);
      const res = await generateImageAction({
        generationType: type,
        prompt: trimmed,
        sourceImageUrl: opts.sourceImageUrl ?? undefined,
        sourcePropertyId: opts.sourcePropertyId,
        width: opts.width ?? undefined,
        height: opts.height ?? undefined,
      });
      setGenerating(false);
      if (!res.ok) {
        setError(res.error);
        refreshQuota();
        return;
      }
      gens.add({
        id: res.data.generationId,
        generationType: type,
        status: res.data.status || "processing",
        prompt: trimmed,
        sourceImageUrl: opts.sourceImageUrl ?? null,
        resultImageUrl: null,
        failureReason: null,
        width: opts.width ?? null,
        height: opts.height ?? null,
        createdAt: new Date().toISOString(),
      });
      refreshQuota();
    },
    [type, gens, refreshQuota],
  );

  return { generating, error, setError, quotaLine, run };
}

function propertyLine(p: PropertyRow): string {
  const bits = [
    p.title,
    p.property_type ?? "property",
    p.location_city ? `in ${p.location_city}` : "on the Costa Blanca",
  ];
  if (p.bedrooms) bits.push(`${p.bedrooms} bedrooms`);
  if (p.area_sqm) bits.push(`${p.area_sqm} m²`);
  if (p.price) {
    bits.push(`price ${p.price.toLocaleString("en-IE")} ${p.price_currency || "EUR"}`);
  }
  return bits.join(", ");
}

function dateFmt(locale: string) {
  return new Intl.DateTimeFormat(intlLocaleFor(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/* ───────────────────────── Ad Creative (W13a) ───────────────────────── */

const AD_FORMATS = [
  { value: "instagram_square_1080x1350", label: "Instagram 1080×1350", w: 1080, h: 1350 },
  { value: "stories_1080x1920", label: "Stories 1080×1920", w: 1080, h: 1920 },
  { value: "facebook_feed_1200x628", label: "Facebook 1200×628", w: 1200, h: 628 },
];

function AdCreativeTab({
  properties,
  gens,
}: {
  properties: PropertyRow[];
  gens: Gens;
}) {
  const t = useTranslations("studio.ad");
  const tGen = useTranslations("studio.gen");
  const tStudio = useTranslations("studio");
  const locale = useLocale();
  const df = dateFmt(locale);

  const [mode, setMode] = useState<"property" | "brand">("property");
  const [propertyId, setPropertyId] = useState<string>(properties[0]?.id ?? "");
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  const [format, setFormat] = useState(AD_FORMATS[0].value);
  const [lang, setLang] = useState<(typeof LANG_CODES)[number]>("en");
  const [details, setDetails] = useState("");

  const gen = useGenerate("ad_creative", gens);
  const selected = properties.find((p) => p.id === propertyId) ?? null;

  async function onGenerate() {
    const fmt = AD_FORMATS.find((f) => f.value === format) ?? AD_FORMATS[0];
    const extra = details.trim();
    if (mode === "brand" && !extra) {
      gen.setError(tGen("errPrompt"));
      return;
    }
    if (mode === "property" && !selected) {
      gen.setError(tStudio("propertyEmpty"));
      return;
    }
    const prompt =
      mode === "property" && selected
        ? `Professional real-estate ad creative for Meta/Facebook. Property: ${propertyLine(selected)}. ` +
          `Photorealistic, warm and inviting, leave clean space for a short ad headline. ` +
          `Any visible text in ${LANG_NAME_EN[lang]}.${extra ? ` ${extra}` : ""}`
        : `Branded real-estate ad creative for Meta/Facebook for a Costa Blanca agency. ${extra} ` +
          `Photorealistic, warm and inviting, leave clean space for a short ad headline. ` +
          `Any visible text in ${LANG_NAME_EN[lang]}.`;
    // The agent's uploaded reference wins; otherwise the listing's own photo.
    const sourceUrl =
      uploadUrl ??
      (mode === "property" && selected?.images?.[0] ? selected.images[0] : null);
    await gen.run({
      prompt,
      sourceImageUrl: sourceUrl,
      sourcePropertyId: mode === "property" ? selected?.id : undefined,
      width: fmt.w,
      height: fmt.h,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <ModeToggle
              options={[
                { value: "property", label: t("modeProperty") },
                { value: "brand", label: t("modeBrand") },
              ]}
              value={mode}
              onChange={(v) => setMode(v as "property" | "brand")}
            />
            <span className="ml-auto text-[12px] text-muted-foreground">
              {gen.quotaLine}
            </span>
          </div>

          {mode === "property" && (
            <PropertyPicker
              properties={properties}
              value={propertyId}
              onChange={setPropertyId}
            />
          )}

          <ImageUpload url={uploadUrl} onChange={setUploadUrl} />

          <FormatSelect
            label={t("formatLabel")}
            options={AD_FORMATS}
            value={format}
            onChange={setFormat}
          />

          <LanguageSelect label={t("languageLabel")} value={lang} onChange={setLang} />

          <DetailsField
            value={details}
            onChange={setDetails}
            placeholder={tGen("hintAd")}
            required={mode === "brand"}
          />

          <GenerateFooter
            generating={gen.generating}
            error={gen.error}
            onGenerate={onGenerate}
          />
        </CardContent>
      </Card>

      <Gallery
        items={gens.generations.filter((g) => g.generationType === "ad_creative")}
        df={df}
      />
    </div>
  );
}

/* ───────────────────────── Social Post (W13b) ───────────────────────── */

const SOCIAL_FORMATS = [
  { value: "instagram_square_1080x1080", label: "Instagram 1080×1080", w: 1080, h: 1080 },
  { value: "instagram_story_1080x1920", label: "Story 1080×1920", w: 1080, h: 1920 },
  { value: "facebook_post_1200x630", label: "Facebook 1200×630", w: 1200, h: 630 },
];

const ANGLES = [
  "new_listing", "open_house", "price_reduced", "sold", "milestone", "seasonal",
] as const;

const ANGLE_PROMPT: Record<(typeof ANGLES)[number], string> = {
  new_listing: "a 'new listing' announcement",
  open_house: "an 'open house' invitation",
  price_reduced: "a 'price reduced' announcement",
  sold: "a celebratory 'just sold' post",
  milestone: "an agency milestone celebration",
  seasonal: "a seasonal greeting from the agency",
};

function SocialPostTab({
  properties,
  gens,
}: {
  properties: PropertyRow[];
  gens: Gens;
}) {
  const t = useTranslations("studio.social");
  const tGen = useTranslations("studio.gen");
  const tStudio = useTranslations("studio");
  const locale = useLocale();
  const df = dateFmt(locale);

  const [mode, setMode] = useState<"property" | "free">("property");
  const [propertyId, setPropertyId] = useState<string>(properties[0]?.id ?? "");
  const [angle, setAngle] = useState<(typeof ANGLES)[number]>("new_listing");
  const [freeText, setFreeText] = useState("");
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  const [format, setFormat] = useState(SOCIAL_FORMATS[0].value);
  const [lang, setLang] = useState<(typeof LANG_CODES)[number]>("en");

  const gen = useGenerate("social_post", gens);
  const selected = properties.find((p) => p.id === propertyId) ?? null;

  async function onGenerate() {
    const fmt = SOCIAL_FORMATS.find((f) => f.value === format) ?? SOCIAL_FORMATS[0];
    if (mode === "free" && !freeText.trim()) {
      gen.setError(tGen("errPrompt"));
      return;
    }
    if (mode === "property" && !selected) {
      gen.setError(tStudio("propertyEmpty"));
      return;
    }
    const prompt =
      mode === "property" && selected
        ? `Instagram-ready real-estate social post image: ${ANGLE_PROMPT[angle]} for ${propertyLine(selected)}. ` +
          `Bright, engaging, professional. Any visible text in ${LANG_NAME_EN[lang]}.`
        : `Instagram-ready real-estate social post image. ${freeText.trim()} ` +
          `Bright, engaging, professional. Any visible text in ${LANG_NAME_EN[lang]}.`;
    const sourceUrl =
      uploadUrl ??
      (mode === "property" && selected?.images?.[0] ? selected.images[0] : null);
    await gen.run({
      prompt,
      sourceImageUrl: sourceUrl,
      sourcePropertyId: mode === "property" ? selected?.id : undefined,
      width: fmt.w,
      height: fmt.h,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <ModeToggle
              options={[
                { value: "property", label: t("modeProperty") },
                { value: "free", label: t("modeFree") },
              ]}
              value={mode}
              onChange={(v) => setMode(v as "property" | "free")}
            />
            <span className="ml-auto text-[12px] text-muted-foreground">
              {gen.quotaLine}
            </span>
          </div>

          {mode === "property" ? (
            <>
              <PropertyPicker
                properties={properties}
                value={propertyId}
                onChange={setPropertyId}
              />
              <div className="flex flex-col gap-2">
                <Label htmlFor="post-angle">{t("angleLabel")}</Label>
                <select
                  id="post-angle"
                  value={angle}
                  onChange={(e) =>
                    setAngle(e.target.value as (typeof ANGLES)[number])
                  }
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
                value={freeText}
                maxLength={PROMPT_MAX}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder={t("freePromptPlaceholder")}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
          )}

          <ImageUpload url={uploadUrl} onChange={setUploadUrl} />

          <FormatSelect
            label={t("formatLabel")}
            options={SOCIAL_FORMATS}
            value={format}
            onChange={setFormat}
          />

          <LanguageSelect label={t("languageLabel")} value={lang} onChange={setLang} />

          <GenerateFooter
            generating={gen.generating}
            error={gen.error}
            onGenerate={onGenerate}
          />
        </CardContent>
      </Card>

      <Gallery
        items={gens.generations.filter((g) => g.generationType === "social_post")}
        df={df}
      />
    </div>
  );
}

/* ───────────────────────── Renovation (W13c) ───────────────────────── */

const STYLES = [
  "modern_minimalist", "traditional_spanish", "scandinavian", "mediterranean",
  "contemporary_luxury", "boho", "industrial", "classic", "coastal",
] as const;
const FURNISHING = ["empty", "lightly_staged", "fully_furnished"] as const;
const FEATURES = [
  "plants", "warm_lighting", "natural_light", "open_curtains",
  "neutral_palette", "vibrant_accents",
] as const;

const STYLE_PROMPT: Record<(typeof STYLES)[number], string> = {
  modern_minimalist: "modern minimalist",
  traditional_spanish: "traditional Spanish",
  scandinavian: "Scandinavian",
  mediterranean: "warm Mediterranean",
  contemporary_luxury: "contemporary luxury",
  boho: "bohemian",
  industrial: "industrial",
  classic: "classic",
  coastal: "coastal",
};
const FURNISHING_PROMPT: Record<(typeof FURNISHING)[number], string> = {
  empty: "left unfurnished and clean",
  lightly_staged: "lightly staged with a few key pieces",
  fully_furnished: "fully furnished",
};
const FEATURE_PROMPT: Record<(typeof FEATURES)[number], string> = {
  plants: "indoor plants",
  warm_lighting: "warm lighting",
  natural_light: "plenty of natural light",
  open_curtains: "open curtains",
  neutral_palette: "a neutral colour palette",
  vibrant_accents: "vibrant accent colours",
};

function RenovationTab({
  planTier,
  gens,
}: {
  planTier: PlanTier;
  gens: Gens;
}) {
  const t = useTranslations("studio.renovation");
  const tGen = useTranslations("studio.gen");
  const locale = useLocale();
  const df = dateFmt(locale);

  const [attested, setAttested] = useState(false);
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  const [style, setStyle] = useState<(typeof STYLES)[number]>("mediterranean");
  const [furnishing, setFurnishing] =
    useState<(typeof FURNISHING)[number]>("lightly_staged");
  const [features, setFeatures] = useState<Set<string>>(new Set());

  const gen = useGenerate("renovation", gens);
  const tierLocked = planTier !== "unlimited";

  function toggleFeature(f: string) {
    setFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }

  async function onGenerate() {
    if (!uploadUrl) {
      gen.setError(tGen("errSource"));
      return;
    }
    const featureBits = FEATURES.filter((f) => features.has(f)).map(
      (f) => FEATURE_PROMPT[f],
    );
    const prompt =
      `Restyle this room in a ${STYLE_PROMPT[style]} style, ${FURNISHING_PROMPT[furnishing]}` +
      (featureBits.length ? `, with ${featureBits.join(", ")}` : "") +
      `. Keep the room's structure, walls, windows and viewpoint unchanged. Photorealistic.`;
    await gen.run({ prompt, sourceImageUrl: uploadUrl, width: null, height: null });
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>{t("title")}</CardTitle>
            {tierLocked && <GatePill variant="tier" />}
          </div>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {tierLocked ? (
            <div className="rounded-lg border border-amber-300/40 bg-amber-50/50 px-3.5 py-3 text-[13px] text-amber-900 dark:border-amber-200/20 dark:bg-amber-200/10 dark:text-amber-200">
              {tGen("renovationLocked")}
            </div>
          ) : null}

          <div className="flex flex-wrap items-start gap-3">
            <ImageUpload
              url={uploadUrl}
              onChange={setUploadUrl}
              labelOverride={t("uploadPrompt")}
              hintOverride={t("uploadHint")}
              disabled={tierLocked}
            />
            <span className="ml-auto text-[12px] text-muted-foreground">
              {gen.quotaLine}
            </span>
          </div>

          {/* Rights attestation — generate stays disabled until ticked */}
          <label className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
              disabled={tierLocked}
              className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
            />
            <span className="text-[13px] leading-snug text-foreground">
              {t("attestation")}
            </span>
          </label>

          <SelectBlock
            label={t("styleLabel")}
            value={style}
            onChange={(v) => setStyle(v as (typeof STYLES)[number])}
            disabled={tierLocked}
          >
            {STYLES.map((s) => (
              <option key={s} value={s}>
                {t(("style_" + s) as StyleKey)}
              </option>
            ))}
          </SelectBlock>

          <SelectBlock
            label={t("furnishingLabel")}
            value={furnishing}
            onChange={(v) => setFurnishing(v as (typeof FURNISHING)[number])}
            disabled={tierLocked}
          >
            {FURNISHING.map((f) => (
              <option key={f} value={f}>
                {t(("furnishing_" + f) as FurnishingKey)}
              </option>
            ))}
          </SelectBlock>

          <div className="flex flex-col gap-2">
            <Label>{t("featuresLabel")}</Label>
            <div className="flex flex-wrap gap-2">
              {FEATURES.map((f) => (
                <FeatureChip
                  key={f}
                  label={t(("feature_" + f) as FeatureKey)}
                  on={features.has(f)}
                  onToggle={() => toggleFeature(f)}
                  disabled={tierLocked}
                />
              ))}
            </div>
          </div>

          {/* Visualization-only disclaimer */}
          <p className="rounded-lg border border-amber-300/40 bg-amber-50/50 px-3 py-2 text-xs text-amber-900 dark:border-amber-200/20 dark:bg-amber-200/10 dark:text-amber-200">
            {t("disclaimer")}
          </p>

          <GenerateFooter
            generating={gen.generating}
            error={gen.error}
            onGenerate={onGenerate}
            disabled={tierLocked || !attested || !uploadUrl}
            note={!attested && !tierLocked ? t("attestationRequired") : undefined}
          />
        </CardContent>
      </Card>

      <Gallery
        items={gens.generations.filter((g) => g.generationType === "renovation")}
        df={df}
        beforeAfter
        beforeLabel={t("beforeLabel")}
        afterLabel={t("afterLabel")}
      />
    </div>
  );
}

/* ───────────────────────── shared sub-controls ───────────────────────── */

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
 * Upload-your-own reference image. Uploads client-direct to agency-assets via
 * a signed URL and reports the public URL up — the generators send it to the
 * create endpoint as source_image_url.
 */
function ImageUpload({
  url,
  onChange,
  labelOverride,
  hintOverride,
  disabled,
}: {
  url: string | null;
  onChange: (url: string | null) => void;
  labelOverride?: string;
  hintOverride?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("studio.upload");
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | null) {
    if (!file) return;
    setError(null);
    if (!UPLOAD_ACCEPT.includes(file.type)) {
      setError(t("badType"));
      return;
    }
    if (file.size > UPLOAD_HARD_MAX_BYTES) {
      setError(t("tooLarge"));
      return;
    }
    setBusy(true);
    try {
      let prepared: { blob: Blob; contentType: string };
      try {
        prepared = await prepareImageForUpload(file);
      } catch (err) {
        console.error("[studio upload] downscale failed, sending original:", err);
        prepared = { blob: file, contentType: file.type };
      }
      const meta = await createStudioUploadUrlAction(prepared.contentType);
      if (!meta.ok) {
        setError(meta.error);
        return;
      }
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("agency-assets")
        .uploadToSignedUrl(meta.path, meta.token, prepared.blob, {
          contentType: prepared.contentType,
        });
      if (uploadError) {
        console.error("[studio upload] uploadToSignedUrl failed:", uploadError);
        setError(t("uploadFailed"));
        return;
      }
      onChange(meta.publicUrl);
    } catch (err) {
      console.error("[studio upload] unexpected:", err);
      setError(t("uploadFailed"));
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    onChange(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>{labelOverride ?? t("label")}</Label>
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
            alt={labelOverride ?? t("label")}
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
          disabled={busy || disabled}
          className="flex w-full max-w-xs flex-col items-center gap-1.5 rounded-xl border border-dashed border-border bg-card px-4 py-6 text-center transition-colors hover:bg-muted disabled:opacity-60"
        >
          <UploadCloud className="h-5 w-5 text-muted-foreground" aria-hidden />
          <span className="text-[12.5px] font-medium text-foreground">
            {busy ? t("compressing") : (labelOverride ?? t("prompt"))}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {hintOverride ?? t("hint")}
          </span>
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

function PropertyPicker({
  properties,
  value,
  onChange,
}: {
  properties: PropertyRow[];
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useTranslations("studio");
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="property-pick">{t("propertyLabel")}</Label>
      {properties.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("propertyEmpty")}</p>
      ) : (
        <select
          id="property-pick"
          value={value}
          onChange={(e) => onChange(e.target.value)}
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

function LanguageSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: (typeof LANG_CODES)[number];
  onChange: (v: (typeof LANG_CODES)[number]) => void;
}) {
  const tl = useTranslations("settings.languages");
  return (
    <SelectBlock
      label={label}
      value={value}
      onChange={(v) => onChange(v as (typeof LANG_CODES)[number])}
    >
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
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <SelectBlock label={label} value={value} onChange={onChange}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </SelectBlock>
  );
}

function SelectBlock({
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const id = label.replace(/\s+/g, "-").toLowerCase();
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
      >
        {children}
      </select>
    </div>
  );
}

function FeatureChip({
  label,
  on,
  onToggle,
  disabled,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={on}
      className={cn(
        "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors disabled:opacity-60",
        on
          ? "border-brand/40 bg-brand-soft text-brand"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function DetailsField({
  value,
  onChange,
  placeholder,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  required?: boolean;
}) {
  const tGen = useTranslations("studio.gen");
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="gen-details">{tGen("description")}</Label>
      <textarea
        id="gen-details"
        rows={3}
        value={value}
        maxLength={PROMPT_MAX}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-required={required}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}

function GenerateFooter({
  generating,
  error,
  onGenerate,
  disabled,
  note,
}: {
  generating: boolean;
  error: string | null;
  onGenerate: () => void;
  disabled?: boolean;
  note?: string;
}) {
  const tGen = useTranslations("studio.gen");
  return (
    <div className="flex flex-col gap-2">
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
          disabled={generating || disabled}
          className="gap-1.5"
        >
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-4 w-4" aria-hidden />
          )}
          {generating ? tGen("starting") : tGen("generate")}
        </Button>
      </div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/* ───────────────────────── results gallery ───────────────────────── */

function Gallery({
  items,
  df,
  beforeAfter,
  beforeLabel,
  afterLabel,
}: {
  items: ImageGeneration[];
  df: Intl.DateTimeFormat;
  beforeAfter?: boolean;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const tGen = useTranslations("studio.gen");
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <ImageIcon className="h-6 w-6" aria-hidden strokeWidth={1.7} />
        </div>
        <p className="text-sm font-medium text-foreground">{tGen("emptyTitle")}</p>
        <p className="max-w-md text-sm text-muted-foreground">{tGen("emptyBody")}</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((g) => (
        <GalleryCard
          key={g.id}
          gen={g}
          df={df}
          beforeAfter={beforeAfter}
          beforeLabel={beforeLabel}
          afterLabel={afterLabel}
        />
      ))}
    </div>
  );
}

function GalleryCard({
  gen,
  df,
  beforeAfter,
  beforeLabel,
  afterLabel,
}: {
  gen: ImageGeneration;
  df: Intl.DateTimeFormat;
  beforeAfter?: boolean;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const tGen = useTranslations("studio.gen");
  const active = isActive(gen.status);
  const failed = gen.status === "failed";
  const twoUp = Boolean(beforeAfter && gen.sourceImageUrl && gen.resultImageUrl);

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-elevated">
      {twoUp ? (
        <div className="grid grid-cols-2">
          <figure className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={gen.sourceImageUrl as string}
              alt={beforeLabel}
              className="aspect-square h-full w-full object-cover"
              loading="lazy"
            />
            <figcaption className="absolute left-1.5 top-1.5 rounded-full bg-foreground/75 px-2 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.05em] text-background">
              {beforeLabel}
            </figcaption>
          </figure>
          <figure className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={gen.resultImageUrl as string}
              alt={afterLabel}
              className="aspect-square h-full w-full object-cover"
              loading="lazy"
            />
            <figcaption className="absolute left-1.5 top-1.5 rounded-full bg-brand px-2 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.05em] text-white">
              {afterLabel}
            </figcaption>
            <a
              href={gen.resultImageUrl as string}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute right-2 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-foreground/80 text-background backdrop-blur-sm transition-opacity hover:opacity-90"
              aria-label={tGen("openFull")}
              title={tGen("openFull")}
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
            </a>
          </figure>
        </div>
      ) : (
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
                aria-label={tGen("openFull")}
                title={tGen("openFull")}
              >
                <Download className="h-4 w-4" aria-hidden />
              </a>
            </>
          ) : active ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
              <span className="text-[12px]">{tGen("generating")}</span>
            </div>
          ) : failed ? (
            <div className="flex flex-col items-center gap-2 px-4 text-center text-muted-foreground">
              <TriangleAlert className="h-6 w-6 text-amber-600" aria-hidden />
              <span className="text-[12px]">{tGen("genFailed")}</span>
            </div>
          ) : (
            <ImageIcon className="h-8 w-8 text-muted-foreground/40" aria-hidden />
          )}
        </div>
      )}
      <div className="flex flex-col gap-1 p-3.5">
        <p className="line-clamp-2 text-[12.5px] text-foreground">{gen.prompt}</p>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {df.format(new Date(gen.createdAt))}
        </span>
      </div>
    </div>
  );
}

/* ───────────────────────── Library (content_items) ───────────────────────── */

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
