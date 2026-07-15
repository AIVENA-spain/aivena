"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";
import {
  Home,
  Sparkles,
  Wand2,
  GraduationCap,
  BadgeCheck,
  Rocket,
  Paintbrush,
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
import { PropertyPicker } from "./property-picker";
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

/* ── content types — the spine ───────────────────────────────────────────── */

type ContentType = "listing" | "sold" | "brand" | "educational" | "launch";
type Flow = ContentType | "renovation";

type ContentCfg = {
  key: Flow;
  label: string;
  desc: string;
  icon: typeof Home;
  generation_type: "social_post" | "renovation";
  // property: required | optional | none. Determines the step after content.
  property: "required" | "optional" | "none";
  layouts: string[];
  default: string; // default/Smart layout
  priceLabel?: string; // optional price input → price_text (sold/launch)
};

const CONTENT: Record<Flow, ContentCfg> = {
  listing: {
    key: "listing", label: "Property listing", desc: "Sell one home", icon: Home,
    generation_type: "social_post", property: "required",
    layouts: ["full_bleed", "magazine", "editorial", "postcard", "band", "stat", "price_hero", "bottom_panel", "side_panel", "framed"],
    default: "bottom_panel",
  },
  sold: {
    key: "sold", label: "Just sold", desc: "Celebrate a sale", icon: BadgeCheck,
    generation_type: "social_post", property: "required",
    layouts: ["price_hero", "full_bleed", "band", "stat", "magazine", "bottom_panel"],
    default: "full_bleed", priceLabel: "Sold price",
  },
  brand: {
    key: "brand", label: "Brand / lifestyle", desc: "The agency, no property", icon: Sparkles,
    generation_type: "social_post", property: "none",
    layouts: ["quote", "statement", "postcard", "band", "full_bleed"],
    default: "postcard",
  },
  educational: {
    key: "educational", label: "Educational / tips", desc: "Advice & know-how", icon: GraduationCap,
    generation_type: "social_post", property: "none",
    layouts: ["quote", "statement", "postcard"],
    default: "quote",
  },
  launch: {
    key: "launch", label: "New development", desc: "Launch a project", icon: Rocket,
    generation_type: "social_post", property: "optional",
    layouts: ["launch_hero", "project", "statement", "band", "full_bleed", "price_hero"],
    default: "launch_hero", priceLabel: "From price",
  },
  renovation: {
    key: "renovation", label: "Redesign a room", desc: "Restyle a space", icon: Paintbrush,
    generation_type: "renovation", property: "none", layouts: [], default: "",
  },
};

const CONTENT_DEFAULT_STYLE: Record<ContentType, { font_set: string; color_treatment: string; text_treatment: string; mood: string }> = {
  listing: { font_set: "serif", color_treatment: "photo_only", text_treatment: "on_photo", mood: "sunny_bright" },
  sold: { font_set: "mixed", color_treatment: "photo_only", text_treatment: "scrim", mood: "golden_hour" },
  brand: { font_set: "mixed", color_treatment: "photo_only", text_treatment: "on_photo", mood: "clean_neutral" },
  educational: { font_set: "sans", color_treatment: "accent_line", text_treatment: "on_photo", mood: "clean_neutral" },
  launch: { font_set: "serif", color_treatment: "photo_only", text_treatment: "on_photo", mood: "golden_hour" },
};

const COMPOSITION_LABEL: Record<string, string> = {
  full_bleed: "Full bleed", bottom_panel: "Bottom panel", side_panel: "Side panel",
  framed: "Framed", split: "Split", collage: "Collage",
  magazine: "Magazine", editorial: "Editorial", postcard: "Postcard",
  band: "Color band", quote: "Quote", stat: "Stat card",
  statement: "Statement", project: "Project", price_hero: "Price hero",
  launch_hero: "Launch hero",
};

// Which copy inputs each layout renders (per the v10 layout map).
// `badge` = the gold eyebrow above the headline (launch_hero → copy.badge_text).
type CopyFlags = { headline?: boolean; tagline?: boolean; bullets?: boolean; cta?: boolean; badge?: boolean };
const LAYOUT_FIELDS: Record<string, CopyFlags> = {
  launch_hero: { badge: true, headline: true, tagline: true },
  full_bleed: { headline: true, tagline: true, bullets: true, cta: true },
  bottom_panel: { headline: true, tagline: true, bullets: true, cta: true },
  side_panel: { headline: true, tagline: true, bullets: true, cta: true },
  framed: { headline: true, tagline: true, bullets: true, cta: true },
  postcard: { headline: true, tagline: true, bullets: true, cta: true },
  magazine: { headline: true, cta: true },
  editorial: { headline: true, cta: true },
  band: { headline: true, cta: true },
  stat: { headline: true, cta: true },
  price_hero: { headline: true },
  quote: { headline: true, tagline: true },
  statement: { headline: true, tagline: true, bullets: true, cta: true },
  project: { headline: true, bullets: true, cta: true },
  collage: { headline: true, cta: true },
  split: {},
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
  { key: "on_photo", label: "On photo" }, { key: "scrim", label: "Scrim" }, { key: "negative_space", label: "Negative space" },
];
const COLOR_TREATMENTS = [
  { key: "photo_only", label: "Photo only" }, { key: "accent_line", label: "Accent line" }, { key: "color_block", label: "Color block" },
];
const FONT_SETS = [
  { key: "serif", label: "Serif" }, { key: "sans", label: "Sans" }, { key: "mixed", label: "Mixed" },
];
// ── renovation guided controls (Christian 2026-07-13): style · amount of furniture · lighting · colours,
// plus a free-text box for anything specific. These COMPOSE the prompt sent to the redesign engine, and the
// composed prompt always ends with the structure lock so the room itself is never altered — only the styling.
const RENO_STYLES = [
  "Scandinavian minimal", "Warm modern", "Luxury coastal", "Mediterranean",
  "Contemporary", "Rustic charm", "Bright & airy", "Industrial",
];
const RENO_FURNITURE: { k: string; l: string; p: string }[] = [
  { k: "minimal", l: "Minimal", p: "sparsely furnished with only a few key pieces" },
  { k: "moderate", l: "Moderate", p: "comfortably furnished" },
  { k: "full", l: "Fully furnished", p: "fully furnished and styled" },
];
const RENO_LIGHT: { k: string; l: string; p: string }[] = [
  { k: "daylight", l: "Natural daylight", p: "bright natural daylight" },
  { k: "warm", l: "Warm evening", p: "warm evening lighting" },
  { k: "soft", l: "Soft ambient", p: "soft ambient lighting" },
];
const RENO_COLOURS: { k: string; l: string; p: string }[] = [
  { k: "neutral", l: "Neutral", p: "a neutral colour palette" },
  { k: "warm", l: "Warm earth", p: "warm earthy tones" },
  { k: "cool", l: "Cool tones", p: "cool, calm tones" },
  { k: "bold", l: "Bold accents", p: "a neutral base with bold accent colours" },
  { k: "mono", l: "Monochrome", p: "a monochrome palette" },
];
const STRUCTURE_LOCK =
  " Keep the room's architecture, walls, windows, doors, floor plan and proportions exactly as they are — change only the styling, furniture, decor and lighting.";
function composeReno(style: string, furn: string, light: string, col: string, details: string): string {
  if (!style) return "";
  const bits = [`Restyle this room in a ${style.toLowerCase()} style`];
  const f = RENO_FURNITURE.find((x) => x.k === furn); if (f) bits.push(f.p);
  const l = RENO_LIGHT.find((x) => x.k === light); if (l) bits.push(l.p);
  const c = RENO_COLOURS.find((x) => x.k === col); if (c) bits.push(c.p);
  let s = bits.join(", ") + ".";
  const d = details.trim();
  if (d) s += " " + (/[.!?]$/.test(d) ? d : d + ".");
  return s + STRUCTURE_LOCK;
}

const SUPPORTED_LANGS = new Set(["en", "es", "de", "nl", "fr", "it", "pl", "pt", "ru", "sv", "no", "da", "fi"]);
function efLanguage(locale: string): string {
  const base = locale.toLowerCase().split("-")[0];
  if (base === "nb" || base === "nn") return "no";
  return SUPPORTED_LANGS.has(base) ? base : "en";
}

type PropertyItem = {
  id: string; title: string; location_city: string | null; price: number | null;
  bedrooms: number | null; bathrooms: number | null; area: number | null;
  photo_count: number; thumb_url: string | null;
};
// beds · baths · area — a missing fact is hidden, never invented (data-honesty law).
const propSpecs = (p: PropertyItem) =>
  [p.bedrooms != null ? `${p.bedrooms} bed` : null,
   p.bathrooms != null ? `${p.bathrooms} bath` : null,
   p.area != null ? `${p.area} m²` : null].filter(Boolean).join(" · ");
const propMoney = (n: number | null) => (n == null ? "" : "€" + n.toLocaleString("es-ES"));
type LibraryItem = {
  id: string; image_url: string; generation_type: string; content_type: string | null; created_at: string;
};

type Screen = "fork" | "content" | "property" | "photo" | "renovation" | "look" | "finetune" | "result" | "library";

/* ── top-level wizard ────────────────────────────────────────────────────── */

export function StudioWizard({
  initialLibrary,
  initialFork,
}: {
  initialLibrary: LibraryItem[];
  /** When set, skip the fork screen and enter that mode directly (the Studio home routes here). */
  initialFork?: "wizard" | "smart" | "renovation" | null;
}) {
  const locale = useLocale();
  const language = efLanguage(locale);

  const [screen, setScreen] = useState<Screen>("fork");
  const [mode, setMode] = useState<"wizard" | "smart">("wizard");
  const [flow, setFlow] = useState<Flow | null>(null);

  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [propertyTitle, setPropertyTitle] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);

  const [composition, setComposition] = useState("bottom_panel");
  const [textTreatment, setTextTreatment] = useState("on_photo");
  const [colorTreatment, setColorTreatment] = useState("photo_only");
  const [fontSet, setFontSet] = useState("serif");
  const [format, setFormat] = useState(FORMATS[1]);
  const [mood, setMood] = useState("sunny_bright");

  // Copy — persisted across layout switches (rows hide/show, values stay).
  const [headline, setHeadline] = useState("");
  const [ctaText, setCtaText] = useState("");
  const [tagline, setTagline] = useState("");
  const [bulletsText, setBulletsText] = useState("");
  const [priceText, setPriceText] = useState("");
  const [badgeText, setBadgeText] = useState(""); // eyebrow → copy.badge_text (launch_hero)

  // Renovation
  const [renoPrompt, setRenoPrompt] = useState("");

  const [genId, setGenId] = useState<string | null>(null);
  const [genStatus, setGenStatus] = useState<"idle" | "processing" | "completed" | "failed">("idle");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [revisionsRemaining, setRevisionsRemaining] = useState<number>(2);
  const [isRenovationResult, setIsRenovationResult] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [library, setLibrary] = useState<LibraryItem[]>(initialLibrary);

  const cfg = flow ? CONTENT[flow] : null;
  const isReno = flow === "renovation";

  // Layout set for the current content type (+ split/collage if 2+ photos & the
  // type allows multi — only listing's set is large enough to matter).
  const layoutSet = useMemo(() => {
    if (!cfg || isReno) return [];
    const base = cfg.layouts;
    if (photos.length >= 2) {
      const extra = ["split", "collage"].filter((c) => !base.includes(c));
      return [...base, ...extra];
    }
    return base;
  }, [cfg, isReno, photos.length]);

  const fields = LAYOUT_FIELDS[composition] ?? { headline: true, cta: true };

  const baseChoices = useCallback(
    (overrides?: Partial<DesignChoices>): DesignChoices => {
      const ct = (flow && flow !== "renovation" ? flow : "listing") as ContentType;
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
      if (propertyId && CONTENT[ct].property !== "none") c.source_property_id = propertyId;
      if (photos.length) c.image_urls = photos;
      const f = LAYOUT_FIELDS[overrides?.composition ?? composition] ?? fields;
      if (f.badge && badgeText.trim()) c.badge_text = badgeText.trim();
      if (f.headline && headline.trim()) c.headline = headline.trim();
      if (f.cta && ctaText.trim()) c.cta_text = ctaText.trim();
      if (f.tagline && tagline.trim()) c.tagline = tagline.trim();
      if (f.bullets) {
        const bullets = bulletsText.split("\n").map((b) => b.trim()).filter(Boolean).slice(0, 4);
        if (bullets.length) c.bullets = bullets;
      }
      // Optional price → display-ready string (sold/launch). launch Project/
      // Statement ignore it server-side by design; harmless to send.
      if (CONTENT[ct].priceLabel && priceText.trim()) c.price_text = priceText.trim();
      return { ...c, ...overrides };
    },
    [flow, composition, textTreatment, colorTreatment, fontSet, format, language, mood, propertyId, photos, headline, ctaText, tagline, bulletsText, priceText, badgeText, fields],
  );

  function startFlow(f: Flow, smart: boolean) {
    setFlow(f);
    setMode(smart ? "smart" : "wizard");
    if (f !== "renovation") {
      const ct = f as ContentType;
      const s = CONTENT_DEFAULT_STYLE[ct];
      setComposition(CONTENT[ct].default);
      setFontSet(s.font_set); setColorTreatment(s.color_treatment);
      setTextTreatment(s.text_treatment); setMood(s.mood);
    }
    // Step after content depends on the type.
    if (f === "renovation") setScreen("renovation");
    else if (CONTENT[f].property === "required") setScreen("property");
    else if (CONTENT[f].property === "optional") setScreen("property");
    else setScreen("photo"); // brand / educational — upload-first
  }

  function reset() {
    setScreen("fork"); setMode("wizard"); setFlow(null);
    setPropertyId(null); setPropertyTitle(null); setPhotos([]);
    setHeadline(""); setCtaText(""); setTagline(""); setBulletsText(""); setPriceText(""); setBadgeText(""); setRenoPrompt("");
    setGenId(null); setGenStatus("idle"); setResultUrl(null); setRevisionsRemaining(2);
    setIsRenovationResult(false); setError(null);
  }

  // When the Studio landing routes straight into a mode, consume it once on mount
  // via the exact same handlers the fork buttons use (no new flow logic).
  const forkConsumed = useRef(false);
  useEffect(() => {
    if (forkConsumed.current || !initialFork) return;
    forkConsumed.current = true;
    if (initialFork === "wizard") setScreen("content");
    else if (initialFork === "smart") startFlow("listing", true);
    else if (initialFork === "renovation") startFlow("renovation", false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFork]);

  const pollRef = useRef<number | null>(null);
  function pollUntilDone(id: string) {
    setGenStatus("processing");
    const started = Date.now();
    const tick = async () => {
      const res = await statusAction(id);
      if (!res.ok) { setError(res.message as string); setGenStatus("failed"); return; }
      const st = res.status as string;
      if (st === "completed") {
        setResultUrl(res.image_url as string);
        if (typeof res.revisions_remaining === "number") setRevisionsRemaining(res.revisions_remaining);
        setError(res.last_revision_error === true
          ? "That revision couldn't be applied — your image is unchanged. Try again." : null);
        setGenStatus("completed");
        libraryAction().then((l) => { if (l.ok && Array.isArray(l.items)) setLibrary(l.items as LibraryItem[]); });
        return;
      }
      if (st === "failed") { setError("That image couldn't be generated. Please try again."); setGenStatus("failed"); return; }
      if (Date.now() - started > 120_000) { setError("This is taking longer than expected. Please try again."); setGenStatus("failed"); return; }
      pollRef.current = window.setTimeout(tick, 3000);
    };
    tick();
  }
  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  async function runGenerate() {
    setError(null);
    setIsRenovationResult(false);
    setScreen("result");
    setGenStatus("processing");
    const res = await generateAction(baseChoices());
    if (!res.ok) { setError(res.message as string); setGenStatus("failed"); return; }
    const id = res.generation_id as string;
    setGenId(id);
    pollUntilDone(id);
  }

  async function runRenovation() {
    if (!photos.length || !renoPrompt.trim()) return;
    setError(null);
    setIsRenovationResult(true);
    setScreen("result");
    setGenStatus("processing");
    const res = await generateAction({
      generation_type: "renovation",
      source_image_url: photos[0], // public URL the EF/kie can fetch
      prompt: renoPrompt.trim(),
      template: "none",
      language,
    });
    if (!res.ok) { setError(res.message as string); setGenStatus("failed"); return; }
    setGenId(res.generation_id as string);
    pollUntilDone(res.generation_id as string);
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
    setGenStatus("processing"); setResultUrl(null);
    pollUntilDone(genId);
  }

  const backTo: Partial<Record<Screen, Screen>> = {
    content: "fork", property: "content", photo: "content", renovation: "content",
    look: cfg?.property === "none" ? "photo" : "property", finetune: "look", library: "fork",
  };

  return (
    <div className="flex flex-col gap-5">
      <WizardHeader
        onBack={backTo[screen] ? () => setScreen(backTo[screen]!) : undefined}
        onLibrary={() => setScreen("library")}
        onNew={reset}
        showNew={screen === "result"}
        libraryActive={screen === "library"}
      />

      {screen === "fork" && !initialFork && (
        <ForkStep onWizard={() => setScreen("content")} onSmart={() => startFlow("listing", true)} />
      )}

      {screen === "content" && <ContentStep onPick={(f) => startFlow(f, false)} />}

      {(screen === "property" || screen === "photo") && cfg && (
        <PhotoStep
          cfg={cfg}
          photos={photos}
          setPhotos={setPhotos}
          propertyTitle={propertyTitle}
          onProperty={(id, title) => { setPropertyId(id); setPropertyTitle(title); }}
          onNext={() => (mode === "smart" ? runGenerate() : setScreen("look"))}
          smart={mode === "smart"}
        />
      )}

      {screen === "renovation" && (
        <RenovationStep
          photos={photos}
          setPhotos={setPhotos}
          prompt={renoPrompt}
          setPrompt={setRenoPrompt}
          onGenerate={runRenovation}
        />
      )}

      {screen === "look" && cfg && (
        <LookStep
          compositions={layoutSet}
          choicesFor={(comp) => baseChoices({ composition: comp })}
          selected={composition}
          onPick={(comp) => { setComposition(comp); setScreen("finetune"); }}
        />
      )}

      {screen === "finetune" && cfg && (
        <FineTuneStep
          layoutSet={layoutSet}
          priceLabel={cfg.priceLabel}
          composition={composition} setComposition={setComposition}
          textTreatment={textTreatment} setTextTreatment={setTextTreatment}
          colorTreatment={colorTreatment} setColorTreatment={setColorTreatment}
          fontSet={fontSet} setFontSet={setFontSet}
          format={format} setFormat={setFormat}
          mood={mood} setMood={setMood}
          headline={headline} setHeadline={setHeadline}
          badgeText={badgeText} setBadgeText={setBadgeText}
          ctaText={ctaText} setCtaText={setCtaText}
          tagline={tagline} setTagline={setTagline}
          bulletsText={bulletsText} setBulletsText={setBulletsText}
          priceText={priceText} setPriceText={setPriceText}
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
          allowRevise
          beforeUrl={isRenovationResult ? (photos[0] ?? null) : null}
          onRevise={runRevise}
          onRetry={isReno ? runRenovation : runGenerate}
          onBack={() => setScreen(isReno ? "renovation" : mode === "smart" ? "property" : "finetune")}
        />
      )}

      {screen === "library" && <LibraryGrid items={library} />}
    </div>
  );
}

/* ── header ──────────────────────────────────────────────────────────────── */

function WizardHeader({
  onBack, onLibrary, onNew, showNew, libraryActive,
}: {
  onBack?: () => void; onLibrary: () => void; onNew: () => void; showNew: boolean; libraryActive: boolean;
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
      <Button type="button" size="sm" variant={libraryActive ? "default" : "ghost"} className="gap-1.5" onClick={onLibrary}>
        <LibraryBig className="h-3.5 w-3.5" aria-hidden /> Library
      </Button>
    </div>
  );
}

/* ── fork ────────────────────────────────────────────────────────────────── */

function ForkStep({ onWizard, onSmart }: { onWizard: () => void; onSmart: () => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <button type="button" onClick={onWizard}
        className="flex flex-col items-start gap-2 rounded-2xl border-2 border-brand bg-brand-soft p-6 text-left transition-transform hover:-translate-y-0.5">
        <Wand2 className="h-7 w-7 text-brand" aria-hidden />
        <span className="text-[15px] font-semibold text-foreground">Wizard</span>
        <span className="text-[13px] text-muted-foreground">All content types, choose the look by sight and fine-tune. Recommended.</span>
      </button>
      <button type="button" onClick={onSmart}
        className="flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-6 text-left transition-transform hover:-translate-y-0.5">
        <Sparkles className="h-7 w-7 text-foreground" aria-hidden />
        <span className="text-[15px] font-semibold text-foreground">Smart</span>
        <span className="text-[13px] text-muted-foreground">One tap — pick a property and a photo, AIVENA makes the listing post.</span>
      </button>
    </div>
  );
}

/* ── content type ────────────────────────────────────────────────────────── */

function ContentStep({ onPick }: { onPick: (f: Flow) => void }) {
  const order: Flow[] = ["listing", "sold", "brand", "educational", "launch", "renovation"];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {order.map((k) => {
        const ct = CONTENT[k];
        return (
          <button key={k} type="button" onClick={() => onPick(k)}
            className="flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-5 text-left shadow-elevated transition-transform hover:-translate-y-0.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <ct.icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="text-[14px] font-semibold text-foreground">{ct.label}</span>
            <span className="text-[12.5px] text-muted-foreground">{ct.desc}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── photo / property step ───────────────────────────────────────────────── */

function PhotoStep({
  cfg, photos, setPhotos, propertyTitle, onProperty, onNext, smart,
}: {
  cfg: ContentCfg;
  photos: string[];
  setPhotos: (p: string[]) => void;
  propertyTitle: string | null;
  onProperty: (id: string | null, title: string | null) => void;
  onNext: () => void;
  smart: boolean;
}) {
  const usesProperty = cfg.property !== "none";
  const [props, setProps] = useState<PropertyItem[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [gallery, setGallery] = useState<string[] | null>(null);
  const [loadingGallery, setLoadingGallery] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [showPropertyPicker, setShowPropertyPicker] = useState(usesProperty);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!usesProperty && cfg.property !== "optional") {
      // brand/educational: no property load unless they expand the picker
      return;
    }
    propertiesAction().then((r) => setProps(r.ok && Array.isArray(r.items) ? (r.items as PropertyItem[]) : []));
  }, [usesProperty, cfg.property]);

  async function openProperty(p: PropertyItem) {
    setOpenId(p.id);
    if (usesProperty) onProperty(p.id, p.title); // copy source only when the type uses it
    setPhotos([]); setGallery(null); setLoadingGallery(true);
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
      const { error } = await supabase.storage.from("agency-assets")
        .uploadToSignedUrl(meta.path, meta.token, file, { contentType: file.type });
      if (error) return;
      setGallery((g) => [meta.publicUrl, ...(g ?? [])]);
      setPhotos([...photos, meta.publicUrl]);
    } finally {
      setUploadBusy(false);
    }
  }

  const lazyLoadProps = () => {
    if (props === null) propertiesAction().then((r) => setProps(r.ok && Array.isArray(r.items) ? (r.items as PropertyItem[]) : []));
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {cfg.property === "required"
          ? "Pick the property, then choose one or more photos. The copy comes from the property — Upload only swaps the image."
          : cfg.property === "optional"
            ? "Pick the development (or upload a photo). Two or more photos unlock split & collage."
            : "Upload a photo, or choose one from your properties. Two or more unlock split & collage."}
      </p>

      {/* Upload — always visible, leads for brand/educational */}
      <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-card p-4">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
          onChange={(e) => onUpload(e.target.files?.[0] ?? null)} />
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold text-foreground">Upload your own photo</span>
            <span className="text-[11.5px] text-muted-foreground">PNG, JPG or WebP — large photos compress automatically.</span>
          </div>
          <Button type="button" size="sm" className="gap-1.5" disabled={uploadBusy} onClick={() => fileRef.current?.click()}>
            {uploadBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <UploadCloud className="h-3.5 w-3.5" aria-hidden />}
            Upload
          </Button>
        </div>
        {!usesProperty ? (
          <button type="button"
            onClick={() => { setShowPropertyPicker((v) => !v); lazyLoadProps(); }}
            className="self-start text-[12px] font-medium text-brand hover:underline">
            {showPropertyPicker ? "Hide your properties" : "…or pick a photo from your properties"}
          </button>
        ) : null}
      </div>

      {/* The ONE shared picker: search + bedroom filter, and the photos pop up right here on tap —
          no scrolling to the bottom of the page (Christian: "it should be like this in EVERY different mode"). */}
      {(usesProperty || showPropertyPicker) ? (
        <PropertyPicker onConfirm={(p, chosen) => {
          if (usesProperty) onProperty(p.id, p.title);
          setPhotos(chosen);
        }} />
      ) : null}

      {/* what you picked */}
      {photos.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
          <span className="text-[12px] font-semibold text-foreground">
            {photos.length} photo{photos.length === 1 ? "" : "s"} selected{usesProperty && propertyTitle ? ` · ${propertyTitle}` : ""}
          </span>
          <div className="flex flex-wrap gap-2">
            {photos.map((u) => (
              <span key={u} className="relative block h-16 w-16 overflow-hidden rounded-lg border border-border">
                <Thumb src={u} alt="" />
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <Button type="button" disabled={photos.length === 0} onClick={onNext} className="gap-1.5">
          {smart ? <><Sparkles className="h-4 w-4" aria-hidden /> Generate</> : "Choose the look"}
        </Button>
      </div>
    </div>
  );
}

function PropertyGrid({
  props, openId, onOpen,
}: {
  props: PropertyItem[]; openId: string | null; onOpen: (p: PropertyItem) => void;
}) {
  // Push properties with no thumbnail to the back so dead tiles never lead.
  const ordered = useMemo(
    () => [...props].sort((a, b) => (a.thumb_url ? 0 : 1) - (b.thumb_url ? 0 : 1)),
    [props],
  );
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {ordered.map((p) => (
        <button key={p.id} type="button" onClick={() => onOpen(p)}
          className={cn(
            "flex flex-col overflow-hidden rounded-xl border bg-card text-left transition-transform hover:-translate-y-0.5",
            openId === p.id ? "border-brand ring-2 ring-brand/30" : "border-border",
          )}>
          <div className="relative aspect-[4/3] w-full bg-muted"><Thumb src={p.thumb_url} alt={p.title} /></div>
          <div className="flex flex-col gap-0.5 p-2.5">
            <span className="line-clamp-1 text-[12.5px] font-medium text-foreground">{p.title}</span>
            <span className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="truncate">{p.location_city || "—"}</span>
              <span className="shrink-0 font-medium text-foreground">{propMoney(p.price)}</span>
            </span>
            {propSpecs(p) ? <span className="truncate text-[11px] font-medium text-foreground/80">{propSpecs(p)}</span> : null}
            <span className="font-mono text-[10px] text-muted-foreground">{p.photo_count} photo{p.photo_count === 1 ? "" : "s"}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function PhotoGallery({
  title, photos, gallery, loading, onToggle,
}: {
  title: string | null; photos: string[]; gallery: string[] | null; loading: boolean; onToggle: (u: string) => void;
}) {
  // Failed images sink to the back; never block selection.
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const ordered = useMemo(
    () => [...(gallery ?? [])].sort((a, b) => (failed.has(a) ? 1 : 0) - (failed.has(b) ? 1 : 0)),
    [gallery, failed],
  );
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4">
      <span className="text-[13px] font-semibold text-foreground">
        {title ? `${title} · ` : ""}{photos.length} selected
      </span>
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading photos…
        </div>
      ) : ordered.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">No photos here — upload one above.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {ordered.map((url) => {
            const idx = photos.indexOf(url);
            const sel = idx >= 0;
            return (
              <button key={url} type="button" onClick={() => onToggle(url)}
                className={cn("relative aspect-square overflow-hidden rounded-lg border-2", sel ? "border-brand" : "border-transparent")}>
                <Thumb src={url} alt="" onFail={() => setFailed((s) => new Set(s).add(url))} />
                {sel ? (
                  <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">{idx + 1}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── renovation ──────────────────────────────────────────────────────────── */

function RenovationStep({
  photos, setPhotos, prompt, setPrompt, onGenerate,
}: {
  photos: string[]; setPhotos: (p: string[]) => void; prompt: string; setPrompt: (v: string) => void; onGenerate: () => void;
}) {
  const [props, setProps] = useState<PropertyItem[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [gallery, setGallery] = useState<string[] | null>(null);
  const [loadingGallery, setLoadingGallery] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [showProps, setShowProps] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // guided controls → they compose the prompt the engine receives
  const [style, setStyle] = useState("");
  const [furn, setFurn] = useState("moderate");
  const [light, setLight] = useState("daylight");
  const [col, setCol] = useState("neutral");
  const [details, setDetails] = useState("");
  useEffect(() => {
    setPrompt(composeReno(style, furn, light, col, details));
  }, [style, furn, light, col, details, setPrompt]);

  async function onUpload(file: File | null) {
    if (!file) return;
    setUploadBusy(true);
    try {
      const meta = await createStudioUploadUrlAction(file.type);
      if (!meta.ok) return;
      const supabase = createClient();
      const { error } = await supabase.storage.from("agency-assets")
        .uploadToSignedUrl(meta.path, meta.token, file, { contentType: file.type });
      if (error) return;
      setPhotos([meta.publicUrl]); // single source photo for renovation
    } finally { setUploadBusy(false); }
  }
  async function openProperty(p: PropertyItem) {
    setOpenId(p.id); setGallery(null); setLoadingGallery(true);
    const r = await propertyPhotosAction(p.id);
    setLoadingGallery(false);
    setGallery(r.ok && Array.isArray(r.photos) ? (r.photos as string[]) : []);
  }

  const photo = photos[0] ?? null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Upload a room photo (or pick one), then describe the new look. We keep the room's walls, windows and structure — only the styling changes.
      </p>

      <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-card p-4">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
          onChange={(e) => onUpload(e.target.files?.[0] ?? null)} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-foreground">Room photo</span>
          <Button type="button" size="sm" className="gap-1.5" disabled={uploadBusy} onClick={() => fileRef.current?.click()}>
            {uploadBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <UploadCloud className="h-3.5 w-3.5" aria-hidden />}
            Upload
          </Button>
        </div>
        <button type="button"
          onClick={() => { setShowProps((v) => !v); if (props === null) propertiesAction().then((r) => setProps(r.ok && Array.isArray(r.items) ? (r.items as PropertyItem[]) : [])); }}
          className="self-start text-[12px] font-medium text-brand hover:underline">
          {showProps ? "Hide your properties" : "…or pick a photo from your properties"}
        </button>
      </div>

      {photo ? (
        <div className="relative w-44 overflow-hidden rounded-xl border-2 border-brand">
          <Thumb src={photo} alt="Room to redesign" />
        </div>
      ) : null}

      {/* same shared picker — single-photo mode: tapping a room photo picks it immediately */}
      {showProps ? (
        <PropertyPicker multi={false} onConfirm={(_p, chosen) => { if (chosen[0]) setPhotos([chosen[0]]); }} />
      ) : null}

      {/* guided controls: style · furniture · lighting · colours */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Style</Label>
          <div className="flex flex-wrap gap-1.5">
            {RENO_STYLES.map((s) => (
              <button key={s} type="button" onClick={() => setStyle(s)}
                className={cn("rounded-full border px-3 py-1 text-[12px] transition",
                  style === s ? "border-brand bg-brand-soft font-semibold text-brand" : "border-border bg-card text-muted-foreground hover:border-brand hover:text-brand")}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {([
          { label: "Amount of furniture", opts: RENO_FURNITURE, val: furn, set: setFurn },
          { label: "Lighting", opts: RENO_LIGHT, val: light, set: setLight },
          { label: "Colours", opts: RENO_COLOURS, val: col, set: setCol },
        ] as const).map((row) => (
          <div key={row.label} className="flex flex-col gap-1.5">
            <Label>{row.label}</Label>
            <div className="flex flex-wrap gap-1.5">
              {row.opts.map((o) => (
                <button key={o.k} type="button" onClick={() => row.set(o.k)}
                  className={cn("rounded-full border px-3 py-1 text-[12px] transition",
                    row.val === o.k ? "border-brand bg-brand-soft font-semibold text-brand" : "border-border bg-card text-muted-foreground hover:border-brand hover:text-brand")}>
                  {o.l}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="flex flex-col gap-2">
          <Label htmlFor="reno-details">Anything specific? (optional)</Label>
          <textarea id="reno-details" rows={2} value={details} maxLength={1200}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="e.g. add a reading nook by the window, swap the rug for something softer"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </div>

        {prompt ? (
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What we&apos;ll ask for</p>
            <p className="text-[12px] leading-relaxed text-muted-foreground">{prompt}</p>
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground">Pick a style to continue.</p>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">This is a full generation (uses one credit) — there's no live preview. Takes about a minute.</p>

      <div>
        <Button type="button" disabled={!photo || !prompt.trim()} onClick={onGenerate} className="gap-1.5">
          <Sparkles className="h-4 w-4" aria-hidden /> Redesign the room
        </Button>
      </div>
    </div>
  );
}

/* ── look grid ───────────────────────────────────────────────────────────── */

function LookStep({
  compositions, choicesFor, selected, onPick,
}: {
  compositions: string[]; choicesFor: (comp: string) => DesignChoices; selected: string; onPick: (comp: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Pick a look — tap to fine-tune it.</p>
        <p className="text-[11px] text-muted-foreground">This shows your design. The final image will be professionally enhanced.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {compositions.map((comp) => (
          <LookTile key={comp} label={COMPOSITION_LABEL[comp] ?? comp} choices={choicesFor(comp)}
            highlighted={comp === selected} onClick={() => onPick(comp)} />
        ))}
      </div>
    </div>
  );
}

function LookTile({
  label, choices, highlighted, onClick,
}: {
  label: string; choices: DesignChoices; highlighted: boolean; onClick: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    previewAction(choices).then((r) => {
      if (!live) return;
      if (r.ok && r.signed_url) setUrl(r.signed_url as string); else setFailed(true);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <button type="button" onClick={onClick}
      className={cn("flex flex-col overflow-hidden rounded-xl border-2 bg-card text-left transition-transform hover:-translate-y-0.5", highlighted ? "border-brand" : "border-border")}>
      <div className="relative aspect-[4/5] w-full bg-muted/50">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : failed ? (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/50"><ImageIcon className="h-7 w-7" aria-hidden /></div>
        ) : (
          <div className="flex h-full w-full animate-pulse items-center justify-center bg-muted"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden /></div>
        )}
      </div>
      <span className="px-3 py-2 text-[12.5px] font-medium text-foreground">{label}</span>
    </button>
  );
}

/* ── fine-tune ───────────────────────────────────────────────────────────── */

function FineTuneStep(props: {
  layoutSet: string[];
  priceLabel?: string;
  composition: string; setComposition: (v: string) => void;
  textTreatment: string; setTextTreatment: (v: string) => void;
  colorTreatment: string; setColorTreatment: (v: string) => void;
  fontSet: string; setFontSet: (v: string) => void;
  format: typeof FORMATS[number]; setFormat: (v: typeof FORMATS[number]) => void;
  mood: string; setMood: (v: string) => void;
  headline: string; setHeadline: (v: string) => void;
  badgeText: string; setBadgeText: (v: string) => void;
  ctaText: string; setCtaText: (v: string) => void;
  tagline: string; setTagline: (v: string) => void;
  bulletsText: string; setBulletsText: (v: string) => void;
  priceText: string; setPriceText: (v: string) => void;
  buildChoices: (o?: Partial<DesignChoices>) => DesignChoices;
  onGenerate: () => void;
}) {
  const {
    layoutSet, priceLabel, composition, setComposition, textTreatment, setTextTreatment,
    colorTreatment, setColorTreatment, fontSet, setFontSet, format, setFormat, mood, setMood,
    headline, setHeadline, badgeText, setBadgeText, ctaText, setCtaText, tagline, setTagline,
    bulletsText, setBulletsText, priceText, setPriceText, buildChoices, onGenerate,
  } = props;

  const f = LAYOUT_FIELDS[composition] ?? { headline: true, cta: true };

  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const reqId = useRef(0);
  const debounce = useRef<number | null>(null);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    setBusy(true);
    debounce.current = window.setTimeout(async () => {
      const myId = ++reqId.current;
      const r = await previewAction(buildChoices());
      if (myId !== reqId.current) return;
      if (r.ok && r.signed_url) { setPreview(r.signed_url as string); setToast(null); }
      else setToast(typeof r.message === "string" ? r.message : "Couldn't update the preview.");
      setBusy(false);
    }, 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [buildChoices]);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-2">
        <div className="relative overflow-hidden rounded-xl border border-border bg-muted/40" style={{ aspectRatio: `${format.w}/${format.h}` }}>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Preview" className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden /></div>
          )}
          {busy && preview ? (
            <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-foreground/70 text-background"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /></span>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground">This shows your design. The final image will be professionally enhanced.</p>
        {toast ? <p className="text-[11px] text-amber-600 dark:text-amber-300">{toast}</p> : null}
      </div>

      <div className="flex flex-col gap-4">
        <Picker label="Layout" value={composition} onChange={setComposition}
          options={layoutSet.map((c) => ({ value: c, label: COMPOSITION_LABEL[c] ?? c }))} />
        <Picker label="Format" value={format.key} onChange={(k) => setFormat(FORMATS.find((x) => x.key === k)!)}
          options={FORMATS.map((x) => ({ value: x.key, label: x.label }))} />
        <Picker label="Text" value={textTreatment} onChange={setTextTreatment} options={TEXT_TREATMENTS.map((o) => ({ value: o.key, label: o.label }))} />
        <Picker label="Color" value={colorTreatment} onChange={setColorTreatment} options={COLOR_TREATMENTS.map((o) => ({ value: o.key, label: o.label }))} />
        <Picker label="Font" value={fontSet} onChange={setFontSet} options={FONT_SETS.map((o) => ({ value: o.key, label: o.label }))} />
        <Picker label="Mood (final only)" value={mood} onChange={setMood} options={MOODS.map((o) => ({ value: o.key, label: o.label }))} />

        {/* Copy — only the rows the layout renders; values persist on switch. */}
        {f.badge ? (
          <Field id="ft-badge" label="Eyebrow" value={badgeText} onChange={setBadgeText}
            placeholder="e.g. New development" />
        ) : null}
        {f.headline ? (
          <Field id="ft-headline" label="Headline" value={headline} onChange={setHeadline} placeholder="Leave blank to use the auto headline" />
        ) : null}
        {f.tagline ? (
          <Field id="ft-tagline"
            label={composition === "launch_hero" ? "Subtitle" : "Tagline"}
            value={tagline} onChange={setTagline}
            placeholder={
              composition === "quote" ? "The quote to feature"
                : composition === "launch_hero" ? "One line under the headline"
                  : "2–4 short sentences"
            } />
        ) : null}
        {f.bullets ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ft-bullets">Feature points <span className="font-normal text-muted-foreground">(one per line, up to 4)</span></Label>
            <textarea id="ft-bullets" rows={4} value={bulletsText} onChange={(e) => setBulletsText(e.target.value)}
              placeholder={"Sea views\nPrivate pool\n2 parking"}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>
        ) : null}
        {f.cta ? (
          <Field id="ft-cta" label="Call to action" value={ctaText} onChange={setCtaText} placeholder="e.g. Book a viewing" />
        ) : null}
        {priceLabel ? (
          <Field id="ft-price" label={`${priceLabel} (optional)`} value={priceText} onChange={setPriceText} placeholder="e.g. 450.000 €" />
        ) : null}

        <Button type="button" onClick={onGenerate} className="gap-1.5"><Sparkles className="h-4 w-4" aria-hidden /> Generate</Button>
      </div>
    </div>
  );
}

function Field({
  id, label, value, onChange, placeholder,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function Picker({
  label, value, onChange, options,
}: {
  label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={value === o.value}
            className={cn("rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
              value === o.value ? "border-brand bg-brand-soft text-brand" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── result + revise ─────────────────────────────────────────────────────── */

function ResultStep({
  status, resultUrl, error, revisionsRemaining, allowRevise, beforeUrl, onRevise, onRetry, onBack,
}: {
  status: "idle" | "processing" | "completed" | "failed";
  resultUrl: string | null;
  error: string | null;
  revisionsRemaining: number;
  allowRevise: boolean;
  /** renovation: the original room photo — shows the draggable before/after comparison */
  beforeUrl?: string | null;
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
            {beforeUrl ? (
              <BeforeAfter before={beforeUrl} after={resultUrl} />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={resultUrl} alt="Generated image" className="w-full" />
            )}
            <a href={resultUrl} target="_blank" rel="noopener noreferrer"
              className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-foreground/80 text-background backdrop-blur-sm hover:opacity-90" aria-label="Open full image">
              <Download className="h-4 w-4" aria-hidden />
            </a>
          </>
        ) : status === "failed" ? (
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 px-6 text-center">
            <TriangleAlert className="h-8 w-8 text-amber-600" aria-hidden />
            <p className="text-sm text-foreground">{error ?? "That image couldn't be generated. Please try again."}</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={onRetry} className="gap-1.5"><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Try again</Button>
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
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-brand"><Check className="h-4 w-4" aria-hidden /> Ready</div>
          {allowRevise ? (
            revisionsRemaining > 0 ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rev-note">What would you like to change?</Label>
                <div className="flex gap-2">
                  <Input id="rev-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. warmer evening light" />
                  <Button type="button" disabled={!note.trim()} onClick={() => { onRevise(note); setNote(""); }}>Revise</Button>
                </div>
                <p className="text-[11px] text-muted-foreground">{revisionsRemaining} free revision{revisionsRemaining === 1 ? "" : "s"} left</p>
                {error ? <p className="text-[12px] text-rose-600 dark:text-rose-300">{error}</p> : null}
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">You've used both free revisions. Start a new one anytime.</p>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ── before / after compare (renovation) ─────────────────────────────────── */

// Drag anywhere across the image to sweep between the original room and the redesign
// (Christian: "ideally with a thing you can move back and forward to see the difference").
function BeforeAfter({ before, after }: { before: string; after: string }) {
  const [pos, setPos] = useState(50);
  return (
    <div className="relative select-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={after} alt="After" className="block w-full" draggable={false} />
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={before} alt="Before" className="block h-full w-full object-cover" draggable={false} />
      </div>
      <div className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-white shadow-[0_0_6px_rgba(0,0,0,.5)]" style={{ left: `${pos}%` }} />
      <div className="pointer-events-none absolute flex h-8 w-8 items-center justify-center rounded-full bg-white text-[13px] font-bold text-neutral-700 shadow-md"
        style={{ left: `${pos}%`, top: "50%", transform: "translate(-50%,-50%)" }}>⇄</div>
      <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">BEFORE</span>
      <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">AFTER</span>
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Compare before and after"
        className="absolute inset-0 h-full w-full cursor-ew-resize appearance-none bg-transparent opacity-0" />
    </div>
  );
}

/* ── library ─────────────────────────────────────────────────────────────── */

function LibraryGrid({ items }: { items: LibraryItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground"><LibraryBig className="h-6 w-6" aria-hidden strokeWidth={1.7} /></div>
        <p className="text-sm font-medium text-foreground">No images yet</p>
        <p className="max-w-md text-sm text-muted-foreground">Your finished images appear here.</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((it) => (
        <div key={it.id} className="group relative overflow-hidden rounded-xl border border-border bg-card shadow-elevated">
          <div className="aspect-square w-full bg-muted"><Thumb src={it.image_url} alt={it.content_type ?? "image"} /></div>
          <a href={it.image_url} target="_blank" rel="noopener noreferrer"
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-foreground/80 text-background opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100" aria-label="Open full image">
            <Download className="h-4 w-4" aria-hidden />
          </a>
        </div>
      ))}
    </div>
  );
}

/* ── shared thumbnail (graceful failure) ─────────────────────────────────── */

function Thumb({ src, alt, onFail }: { src: string | null; alt: string; onFail?: () => void }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted">
        <Building2 className="h-7 w-7 text-muted-foreground/40" aria-hidden />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className="h-full w-full object-cover" loading="lazy"
      referrerPolicy="no-referrer" onError={() => { setFailed(true); onFail?.(); }} />
  );
}
