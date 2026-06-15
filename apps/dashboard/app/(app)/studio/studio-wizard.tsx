"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import {
  Home,
  Sparkles,
  Wand2,
  GraduationCap,
  BadgeCheck,
  Rocket,
  Building2,
  ChevronLeft,
  Loader2,
  Check,
  Download,
  TriangleAlert,
  ImageIcon,
  RefreshCw,
  LibraryBig,
  UploadCloud,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { createStudioUploadUrlAction } from "./studio-actions";
import {
  generateAction,
  libraryAction,
  previewAction,
  propertiesAction,
  propertyPhotosAction,
  reviseAction,
  statusAction,
  type DesignChoices,
} from "./wizard-actions";

/* ── static config (mirrors Vega's enums + §5/§6 defaults) ───────────────── */

type ContentType = "listing" | "brand" | "educational" | "sold" | "launch";

const CONTENT_TYPES: Array<{
  key: ContentType;
  label: string;
  desc: string;
  icon: typeof Home;
  needsProperty: boolean;
}> = [
  { key: "listing", label: "Property listing", desc: "Sell one home", icon: Home, needsProperty: true },
  { key: "brand", label: "Brand / lifestyle", desc: "The agency, no property", icon: Sparkles, needsProperty: false },
  { key: "educational", label: "Educational / tips", desc: "Advice & know-how", icon: GraduationCap, needsProperty: false },
  { key: "sold", label: "Just sold", desc: "Celebrate a sale", icon: BadgeCheck, needsProperty: true },
  { key: "launch", label: "New development", desc: "Launch a project", icon: Rocket, needsProperty: false },
];

const DEFAULT_LOOK: Record<
  ContentType,
  { composition: string; font_set: string; color_treatment: string; text_treatment: string; mood: string }
> = {
  listing: { composition: "bottom_panel", font_set: "serif", color_treatment: "photo_only", text_treatment: "on_photo", mood: "sunny_bright" },
  brand: { composition: "side_panel", font_set: "mixed", color_treatment: "photo_only", text_treatment: "on_photo", mood: "clean_neutral" },
  educational: { composition: "bottom_panel", font_set: "sans", color_treatment: "accent_line", text_treatment: "on_photo", mood: "clean_neutral" },
  sold: { composition: "full_bleed", font_set: "mixed", color_treatment: "photo_only", text_treatment: "scrim", mood: "golden_hour" },
  launch: { composition: "full_bleed", font_set: "serif", color_treatment: "photo_only", text_treatment: "on_photo", mood: "golden_hour" },
};

const COMPOSITIONS_SINGLE = ["full_bleed", "bottom_panel", "side_panel", "framed"];
const COMPOSITIONS_MULTI = [...COMPOSITIONS_SINGLE, "split", "collage"];
const COMPOSITION_LABEL: Record<string, string> = {
  full_bleed: "Full bleed", bottom_panel: "Bottom panel", side_panel: "Side panel",
  framed: "Framed", split: "Split", collage: "Collage",
};

const FORMATS = [
  { key: "square", label: "Square", w: 1080, h: 1080 },
  { key: "portrait", label: "Portrait", w: 1080, h: 1350 },
  { key: "story", label: "Story", w: 1080, h: 1920 },
];
const MOODS = [
  { key: "sunny_bright", label: "Sunny & bright" },
  { key: "golden_hour", label: "Golden hour" },
  { key: "cozy_evening", label: "Cozy evening" },
  { key: "clean_neutral", label: "Clean & neutral" },
];
const TEXT_TREATMENTS = [
  { key: "on_photo", label: "On photo" },
  { key: "scrim", label: "Scrim" },
  { key: "negative_space", label: "Negative space" },
];
const COLOR_TREATMENTS = [
  { key: "photo_only", label: "Photo only" },
  { key: "accent_line", label: "Accent line" },
  { key: "color_block", label: "Color block" },
];
const FONT_SETS = [
  { key: "serif", label: "Serif" },
  { key: "sans", label: "Sans" },
  { key: "mixed", label: "Mixed" },
];

const SUPPORTED_LANGS = new Set([
  "en", "es", "de", "nl", "fr", "it", "pl", "pt", "ru", "sv", "no", "da", "fi",
]);
function efLanguage(locale: string): string {
  const base = locale.toLowerCase().split("-")[0];
  if (base === "nb" || base === "nn") return "no";
  return SUPPORTED_LANGS.has(base) ? base : "en";
}

type PropertyItem = {
  id: string;
  title: string;
  location_city: string | null;
  price: number | null;
  bedrooms: number | null;
  photo_count: number;
  thumb_url: string | null;
};
type LibraryItem = {
  id: string;
  image_url: string;
  generation_type: string;
  content_type: string | null;
  created_at: string;
};

type Screen = "fork" | "content" | "subject" | "look" | "finetune" | "result" | "library";

/* ── top-level wizard ────────────────────────────────────────────────────── */

export function StudioWizard({ initialLibrary }: { initialLibrary: LibraryItem[] }) {
  const locale = useLocale();
  const language = efLanguage(locale);

  const [screen, setScreen] = useState<Screen>("fork");
  const [mode, setMode] = useState<"wizard" | "smart">("wizard");
  const [contentType, setContentType] = useState<ContentType | null>(null);

  // Subject
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [propertyTitle, setPropertyTitle] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]); // selected photo URLs

  // Design (initialised from the content-type default at content step)
  const [composition, setComposition] = useState("bottom_panel");
  const [textTreatment, setTextTreatment] = useState("on_photo");
  const [colorTreatment, setColorTreatment] = useState("photo_only");
  const [fontSet, setFontSet] = useState("serif");
  const [format, setFormat] = useState(FORMATS[1]); // portrait
  const [mood, setMood] = useState("sunny_bright");

  // Copy overrides
  const [headline, setHeadline] = useState("");
  const [ctaText, setCtaText] = useState("");

  // Generation
  const [genId, setGenId] = useState<string | null>(null);
  const [genStatus, setGenStatus] = useState<"idle" | "processing" | "completed" | "failed">("idle");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [revisionsRemaining, setRevisionsRemaining] = useState<number>(2);
  const [error, setError] = useState<string | null>(null);

  const [library, setLibrary] = useState<LibraryItem[]>(initialLibrary);

  const compositions = photos.length >= 2 ? COMPOSITIONS_MULTI : COMPOSITIONS_SINGLE;

  // The choices object the EF needs (minus composition, set per-call).
  const baseChoices = useCallback(
    (overrides?: Partial<DesignChoices>): DesignChoices => {
      const ct = contentType ?? "listing";
      const c: DesignChoices = {
        generation_type: "social_post",
        content_type: ct,
        composition,
        text_treatment: textTreatment,
        color_treatment: colorTreatment,
        font_set: fontSet,
        width: format.w,
        height: format.h,
        language,
        mood,
      };
      if (propertyId && (ct === "listing" || ct === "sold")) c.source_property_id = propertyId;
      if (photos.length) c.image_urls = photos;
      if (headline.trim()) c.headline = headline.trim();
      if (ctaText.trim()) c.cta_text = ctaText.trim();
      return { ...c, ...overrides };
    },
    [contentType, composition, textTreatment, colorTreatment, fontSet, format, language, mood, propertyId, photos, headline, ctaText],
  );

  function applyDefaultLook(ct: ContentType) {
    const d = DEFAULT_LOOK[ct];
    setComposition(d.composition);
    setFontSet(d.font_set);
    setColorTreatment(d.color_treatment);
    setTextTreatment(d.text_treatment);
    setMood(d.mood);
  }

  function reset() {
    setScreen("fork");
    setMode("wizard");
    setContentType(null);
    setPropertyId(null);
    setPropertyTitle(null);
    setPhotos([]);
    setHeadline("");
    setCtaText("");
    setGenId(null);
    setGenStatus("idle");
    setResultUrl(null);
    setRevisionsRemaining(2);
    setError(null);
  }

  /* ── poll a generation to completion ── */
  const pollRef = useRef<number | null>(null);
  function pollUntilDone(id: string) {
    setGenStatus("processing");
    const started = Date.now();
    const tick = async () => {
      const res = await statusAction(id);
      if (!res.ok) {
        setError(res.message as string);
        setGenStatus("failed");
        return;
      }
      const st = res.status as string;
      if (st === "completed") {
        setResultUrl(res.image_url as string);
        if (typeof res.revisions_remaining === "number") setRevisionsRemaining(res.revisions_remaining);
        setGenStatus("completed");
        libraryAction().then((l) => {
          if (l.ok && Array.isArray(l.items)) setLibrary(l.items as LibraryItem[]);
        });
        return;
      }
      if (st === "failed") {
        setError("That image couldn't be generated. Please try again.");
        setGenStatus("failed");
        return;
      }
      if (Date.now() - started > 120_000) {
        setError("This is taking longer than expected. Please try again.");
        setGenStatus("failed");
        return;
      }
      pollRef.current = window.setTimeout(tick, 3000);
    };
    tick();
  }
  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  async function runGenerate() {
    setError(null);
    setScreen("result");
    setGenStatus("processing");
    const res = await generateAction(baseChoices());
    if (!res.ok) {
      setError(res.message as string);
      setGenStatus("failed");
      // quota → keep the design so they don't lose work; result screen shows the message + back.
      return;
    }
    const id = res.generation_id as string;
    setGenId(id);
    pollUntilDone(id);
  }

  async function runRevise(note: string) {
    if (!genId) return;
    setError(null);
    const res = await reviseAction(genId, note);
    if (!res.ok) {
      setError(res.message as string);
      if (res.error === "revision_limit_reached") setRevisionsRemaining(0);
      return;
    }
    if (typeof res.revisions_remaining === "number") setRevisionsRemaining(res.revisions_remaining);
    setGenStatus("processing");
    setResultUrl(null);
    pollUntilDone(genId);
  }

  /* ── render by screen ── */
  return (
    <div className="flex flex-col gap-5">
      <WizardHeader
        screen={screen}
        onBack={
          screen === "content" ? () => setScreen("fork")
          : screen === "subject" ? () => setScreen("content")
          : screen === "look" ? () => setScreen("subject")
          : screen === "finetune" ? () => setScreen("look")
          : screen === "library" ? () => setScreen("fork")
          : undefined
        }
        onLibrary={() => setScreen("library")}
        onNew={reset}
        showNew={screen === "result"}
      />

      {screen === "fork" && (
        <ForkStep
          onWizard={() => { setMode("wizard"); setScreen("content"); }}
          onSmart={() => { setMode("smart"); setScreen("content"); }}
        />
      )}

      {screen === "content" && (
        <ContentStep
          onPick={(ct) => {
            setContentType(ct);
            applyDefaultLook(ct);
            setScreen("subject");
          }}
        />
      )}

      {screen === "subject" && contentType && (
        <SubjectStep
          contentType={contentType}
          photos={photos}
          setPhotos={setPhotos}
          onProperty={(id, title) => { setPropertyId(id); setPropertyTitle(title); }}
          propertyTitle={propertyTitle}
          onNext={() => {
            if (mode === "smart") runGenerate();
            else setScreen("look");
          }}
          smart={mode === "smart"}
        />
      )}

      {screen === "look" && contentType && (
        <LookStep
          compositions={compositions}
          choicesFor={(comp) => baseChoices({ composition: comp })}
          selected={composition}
          onPick={(comp) => { setComposition(comp); setScreen("finetune"); }}
        />
      )}

      {screen === "finetune" && contentType && (
        <FineTuneStep
          contentType={contentType}
          compositions={compositions}
          composition={composition} setComposition={setComposition}
          textTreatment={textTreatment} setTextTreatment={setTextTreatment}
          colorTreatment={colorTreatment} setColorTreatment={setColorTreatment}
          fontSet={fontSet} setFontSet={setFontSet}
          format={format} setFormat={setFormat}
          mood={mood} setMood={setMood}
          headline={headline} setHeadline={setHeadline}
          ctaText={ctaText} setCtaText={setCtaText}
          buildChoices={baseChoices}
          onGenerate={runGenerate}
        />
      )}

      {screen === "result" && (
        <ResultStep
          status={genStatus}
          resultUrl={resultUrl}
          error={error}
          revisionsRemaining={revisionsRemaining}
          onRevise={runRevise}
          onRetry={runGenerate}
          onBack={() => setScreen(mode === "smart" ? "subject" : "finetune")}
        />
      )}

      {screen === "library" && <LibraryGrid items={library} />}
    </div>
  );
}

/* ── header ──────────────────────────────────────────────────────────────── */

function WizardHeader({
  screen, onBack, onLibrary, onNew, showNew,
}: {
  screen: Screen;
  onBack?: () => void;
  onLibrary: () => void;
  onNew: () => void;
  showNew: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {onBack ? (
          <Button type="button" size="sm" variant="ghost" className="gap-1.5" onClick={onBack}>
            <ChevronLeft className="h-4 w-4" aria-hidden /> Back
          </Button>
        ) : null}
        {showNew ? (
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onNew}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> New image
          </Button>
        ) : null}
      </div>
      <Button
        type="button"
        size="sm"
        variant={screen === "library" ? "default" : "ghost"}
        className="gap-1.5"
        onClick={onLibrary}
      >
        <LibraryBig className="h-3.5 w-3.5" aria-hidden /> Library
      </Button>
    </div>
  );
}

/* ── step 0: fork ────────────────────────────────────────────────────────── */

function ForkStep({ onWizard, onSmart }: { onWizard: () => void; onSmart: () => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <button
        type="button"
        onClick={onWizard}
        className="flex flex-col items-start gap-2 rounded-2xl border-2 border-brand bg-brand-soft p-6 text-left transition-transform hover:-translate-y-0.5"
      >
        <Wand2 className="h-7 w-7 text-brand" aria-hidden />
        <span className="text-[15px] font-semibold text-foreground">Wizard</span>
        <span className="text-[13px] text-muted-foreground">
          Choose the look by sight and fine-tune every detail. Recommended.
        </span>
      </button>
      <button
        type="button"
        onClick={onSmart}
        className="flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-6 text-left transition-transform hover:-translate-y-0.5"
      >
        <Sparkles className="h-7 w-7 text-foreground" aria-hidden />
        <span className="text-[15px] font-semibold text-foreground">Smart</span>
        <span className="text-[13px] text-muted-foreground">
          One tap — pick what and which photo, AIVENA does the rest.
        </span>
      </button>
    </div>
  );
}

/* ── step 1: content type ────────────────────────────────────────────────── */

function ContentStep({ onPick }: { onPick: (ct: ContentType) => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {CONTENT_TYPES.map((ct) => (
        <button
          key={ct.key}
          type="button"
          onClick={() => onPick(ct.key)}
          className="flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-5 text-left shadow-elevated transition-transform hover:-translate-y-0.5"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <ct.icon className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-[14px] font-semibold text-foreground">{ct.label}</span>
          <span className="text-[12.5px] text-muted-foreground">{ct.desc}</span>
        </button>
      ))}
    </div>
  );
}

/* ── step 2: subject (property + photo gallery, multi-select) ────────────── */

function SubjectStep({
  contentType, photos, setPhotos, onProperty, propertyTitle, onNext, smart,
}: {
  contentType: ContentType;
  photos: string[];
  setPhotos: (p: string[]) => void;
  onProperty: (id: string | null, title: string | null) => void;
  propertyTitle: string | null;
  onNext: () => void;
  smart: boolean;
}) {
  const [props, setProps] = useState<PropertyItem[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [gallery, setGallery] = useState<string[] | null>(null);
  const [loadingGallery, setLoadingGallery] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    propertiesAction().then((r) => {
      if (r.ok && Array.isArray(r.items)) setProps(r.items as PropertyItem[]);
      else setProps([]);
    });
  }, []);

  async function openProperty(p: PropertyItem) {
    setOpenId(p.id);
    onProperty(p.id, p.title);
    setPhotos([]);
    setGallery(null);
    setLoadingGallery(true);
    const r = await propertyPhotosAction(p.id);
    setLoadingGallery(false);
    setGallery(r.ok && Array.isArray(r.photos) ? (r.photos as string[]) : []);
  }

  function togglePhoto(url: string) {
    setPhotos(photos.includes(url) ? photos.filter((u) => u !== url) : [...photos, url]);
  }

  async function onUpload(file: File | null) {
    if (!file) return;
    setUploadBusy(true);
    try {
      const meta = await createStudioUploadUrlAction(file.type);
      if (!meta.ok) return;
      const supabase = createClient();
      const { error } = await supabase.storage
        .from("agency-assets")
        .uploadToSignedUrl(meta.path, meta.token, file, { contentType: file.type });
      if (error) return;
      setGallery((g) => [meta.publicUrl, ...(g ?? [])]);
      setPhotos([...photos, meta.publicUrl]);
    } finally {
      setUploadBusy(false);
    }
  }

  const canNext = photos.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {contentType === "listing" || contentType === "sold"
          ? "Pick the property, then choose one or more photos. Two or more unlocks split & collage layouts."
          : "Choose a photo (from a property or upload your own)."}
      </p>

      {props === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading properties…
        </div>
      ) : props.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          No properties yet — import your catalog in Settings → Properties, or upload a photo below.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {props.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => openProperty(p)}
              className={cn(
                "flex flex-col overflow-hidden rounded-xl border bg-card text-left transition-transform hover:-translate-y-0.5",
                openId === p.id ? "border-brand ring-2 ring-brand/30" : "border-border",
              )}
            >
              <div className="relative aspect-[4/3] w-full bg-muted">
                <Thumb src={p.thumb_url} alt={p.title} />
              </div>
              <div className="flex flex-col gap-0.5 p-2.5">
                <span className="line-clamp-1 text-[12.5px] font-medium text-foreground">{p.title}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {p.photo_count} photo{p.photo_count === 1 ? "" : "s"}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Photo gallery for the chosen property */}
      {openId ? (
        <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-foreground">
              {propertyTitle ?? "Photos"} · {photos.length} selected
            </span>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
              onChange={(e) => onUpload(e.target.files?.[0] ?? null)} />
            <Button type="button" size="sm" variant="outline" className="gap-1.5"
              disabled={uploadBusy} onClick={() => fileRef.current?.click()}>
              {uploadBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <UploadCloud className="h-3.5 w-3.5" aria-hidden />}
              Upload
            </Button>
          </div>
          {loadingGallery ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading photos…
            </div>
          ) : (gallery ?? []).length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No photos on this property — upload one above.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {(gallery ?? []).map((url) => {
                const idx = photos.indexOf(url);
                const sel = idx >= 0;
                return (
                  <button
                    key={url}
                    type="button"
                    onClick={() => togglePhoto(url)}
                    className={cn(
                      "relative aspect-square overflow-hidden rounded-lg border-2",
                      sel ? "border-brand" : "border-transparent",
                    )}
                  >
                    <Thumb src={url} alt="" />
                    {sel ? (
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
                        {idx + 1}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      <div>
        <Button type="button" disabled={!canNext} onClick={onNext} className="gap-1.5">
          {smart ? <><Sparkles className="h-4 w-4" aria-hidden /> Generate</> : <>Choose the look</>}
        </Button>
      </div>
    </div>
  );
}

/* ── step 3: look grid (parallel previews) ───────────────────────────────── */

function LookStep({
  compositions, choicesFor, selected, onPick,
}: {
  compositions: string[];
  choicesFor: (comp: string) => DesignChoices;
  selected: string;
  onPick: (comp: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Pick a look — tap to fine-tune it.</p>
        <p className="text-[11px] text-muted-foreground">This shows your design. The final image will be professionally enhanced.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {compositions.map((comp) => (
          <LookTile
            key={comp}
            label={COMPOSITION_LABEL[comp] ?? comp}
            choices={choicesFor(comp)}
            highlighted={comp === selected}
            onClick={() => onPick(comp)}
          />
        ))}
      </div>
    </div>
  );
}

function LookTile({
  label, choices, highlighted, onClick,
}: {
  label: string;
  choices: DesignChoices;
  highlighted: boolean;
  onClick: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    previewAction(choices).then((r) => {
      if (!live) return;
      if (r.ok && r.signed_url) setUrl(r.signed_url as string);
      else setFailed(true);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border-2 bg-card text-left transition-transform hover:-translate-y-0.5",
        highlighted ? "border-brand" : "border-border",
      )}
    >
      <div className="relative aspect-[4/5] w-full bg-muted/50">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : failed ? (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/50">
            <ImageIcon className="h-7 w-7" aria-hidden />
          </div>
        ) : (
          <div className="flex h-full w-full animate-pulse items-center justify-center bg-muted">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        )}
      </div>
      <span className="px-3 py-2 text-[12.5px] font-medium text-foreground">{label}</span>
    </button>
  );
}

/* ── step 4: fine-tune (live, debounced preview) ─────────────────────────── */

function FineTuneStep(props: {
  contentType: ContentType;
  compositions: string[];
  composition: string; setComposition: (v: string) => void;
  textTreatment: string; setTextTreatment: (v: string) => void;
  colorTreatment: string; setColorTreatment: (v: string) => void;
  fontSet: string; setFontSet: (v: string) => void;
  format: typeof FORMATS[number]; setFormat: (v: typeof FORMATS[number]) => void;
  mood: string; setMood: (v: string) => void;
  headline: string; setHeadline: (v: string) => void;
  ctaText: string; setCtaText: (v: string) => void;
  buildChoices: (o?: Partial<DesignChoices>) => DesignChoices;
  onGenerate: () => void;
}) {
  const {
    compositions, composition, setComposition, textTreatment, setTextTreatment,
    colorTreatment, setColorTreatment, fontSet, setFontSet, format, setFormat,
    mood, setMood, headline, setHeadline, ctaText, setCtaText, buildChoices, onGenerate,
  } = props;

  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const reqId = useRef(0);
  const debounce = useRef<number | null>(null);

  // Re-preview whenever any design choice changes (debounced + cancellable).
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    setBusy(true);
    debounce.current = window.setTimeout(async () => {
      const myId = ++reqId.current;
      const r = await previewAction(buildChoices());
      if (myId !== reqId.current) return; // a newer change superseded this one
      if (r.ok && r.signed_url) {
        setPreview(r.signed_url as string);
        setToast(null);
      } else {
        setToast("Couldn't update the preview."); // keep the last good image
      }
      setBusy(false);
    }, 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [buildChoices]);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* Live preview */}
      <div className="flex flex-col gap-2">
        <div className="relative overflow-hidden rounded-xl border border-border bg-muted/40" style={{ aspectRatio: `${format.w}/${format.h}` }}>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Preview" className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
            </div>
          )}
          {busy && preview ? (
            <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-foreground/70 text-background">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            </span>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground">
          This shows your design. The final image will be professionally enhanced.
        </p>
        {toast ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-300">{toast}</p>
        ) : null}
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-4">
        <Picker label="Layout" value={composition} onChange={setComposition}
          options={compositions.map((c) => ({ value: c, label: COMPOSITION_LABEL[c] ?? c }))} />
        <Picker label="Format" value={format.key} onChange={(k) => setFormat(FORMATS.find((f) => f.key === k)!)}
          options={FORMATS.map((f) => ({ value: f.key, label: f.label }))} />
        <Picker label="Text" value={textTreatment} onChange={setTextTreatment} options={TEXT_TREATMENTS.map((o) => ({ value: o.key, label: o.label }))} />
        <Picker label="Color" value={colorTreatment} onChange={setColorTreatment} options={COLOR_TREATMENTS.map((o) => ({ value: o.key, label: o.label }))} />
        <Picker label="Font" value={fontSet} onChange={setFontSet} options={FONT_SETS.map((o) => ({ value: o.key, label: o.label }))} />
        <Picker label="Mood (final only)" value={mood} onChange={setMood} options={MOODS.map((o) => ({ value: o.key, label: o.label }))} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ft-headline">Headline</Label>
          <Input id="ft-headline" value={headline} onChange={(e) => setHeadline(e.target.value)}
            placeholder="Leave blank to use the listing's own" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ft-cta">Call to action</Label>
          <Input id="ft-cta" value={ctaText} onChange={(e) => setCtaText(e.target.value)}
            placeholder="e.g. Book a viewing" />
        </div>

        <Button type="button" onClick={onGenerate} className="gap-1.5">
          <Sparkles className="h-4 w-4" aria-hidden /> Generate
        </Button>
      </div>
    </div>
  );
}

function Picker({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={cn(
              "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
              value === o.value
                ? "border-brand bg-brand-soft text-brand"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── step 5/6: result + revise ───────────────────────────────────────────── */

function ResultStep({
  status, resultUrl, error, revisionsRemaining, onRevise, onRetry, onBack,
}: {
  status: "idle" | "processing" | "completed" | "failed";
  resultUrl: string | null;
  error: string | null;
  revisionsRemaining: number;
  onRevise: (note: string) => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-muted/40">
        {status === "completed" && resultUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resultUrl} alt="Generated image" className="w-full" />
            <a href={resultUrl} target="_blank" rel="noopener noreferrer"
              className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-foreground/80 text-background backdrop-blur-sm hover:opacity-90"
              aria-label="Open full image">
              <Download className="h-4 w-4" aria-hidden />
            </a>
          </>
        ) : status === "failed" ? (
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 px-6 text-center">
            <TriangleAlert className="h-8 w-8 text-amber-600" aria-hidden />
            <p className="text-sm text-foreground">{error ?? "That image couldn't be generated. Please try again."}</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={onRetry} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Try again
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={onBack}>Back</Button>
            </div>
          </div>
        ) : (
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin" aria-hidden />
            <p className="text-sm">Creating your image — about 30–60 seconds.</p>
          </div>
        )}
      </div>

      {status === "completed" ? (
        <div className="flex w-full max-w-md flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-brand">
            <Check className="h-4 w-4" aria-hidden /> Ready
          </div>
          {revisionsRemaining > 0 ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rev-note">What would you like to change?</Label>
              <div className="flex gap-2">
                <Input id="rev-note" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. warmer evening light" />
                <Button type="button" disabled={!note.trim()} onClick={() => { onRevise(note); setNote(""); }}>
                  Revise
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">{revisionsRemaining} free revision{revisionsRemaining === 1 ? "" : "s"} left</p>
              {error ? <p className="text-[12px] text-rose-600 dark:text-rose-300">{error}</p> : null}
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              You've used both free revisions. Start a new one anytime.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ── library ─────────────────────────────────────────────────────────────── */

function LibraryGrid({ items }: { items: LibraryItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <LibraryBig className="h-6 w-6" aria-hidden strokeWidth={1.7} />
        </div>
        <p className="text-sm font-medium text-foreground">No images yet</p>
        <p className="max-w-md text-sm text-muted-foreground">Your finished images appear here.</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((it) => (
        <div key={it.id} className="group relative overflow-hidden rounded-xl border border-border bg-card shadow-elevated">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={it.image_url} alt={it.content_type ?? "image"} className="aspect-square w-full object-cover" loading="lazy" />
          <a href={it.image_url} target="_blank" rel="noopener noreferrer"
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-foreground/80 text-background opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
            aria-label="Open full image">
            <Download className="h-4 w-4" aria-hidden />
          </a>
        </div>
      ))}
    </div>
  );
}

/* ── shared thumbnail (graceful failure) ─────────────────────────────────── */

function Thumb({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Building2 className="h-7 w-7 text-muted-foreground/40" aria-hidden />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className="h-full w-full object-cover" loading="lazy"
      referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  );
}
