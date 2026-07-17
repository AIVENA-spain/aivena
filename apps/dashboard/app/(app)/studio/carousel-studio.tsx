"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, Globe, Images, Info, Loader2, Pencil, PlayCircle, RefreshCw, Save, Sparkles, X } from "lucide-react";
import { downloadImage } from "./property-picker";
import { carouselAction, carouselRemixAction, carouselTopicIdeasAction, carouselUpdateAction, carouselStyleExamplesAction, statusAction, editableSectionsAction, setSectionAction } from "./wizard-actions";

/**
 * CAROUSEL STUDIO — tips & advice only (Christian 2026-07-17: property carousels REMOVED from the
 * UI after three grammars failed his bar; the raw portal photos cap the ceiling. Server routes and
 * engine styles stay parked for a possible post-pilot return; properties post via the single-image
 * Studio). The AI writes the tips from a topic, the engine draws brand-themed slides; text stays
 * editable after generation. Honest scope: slide images + caption to post — no IG publishing.
 */

type CarouselType = "listing" | "tips" | "quote";
type Phase = "type" | "pick" | "form" | "working" | "result";

interface Plan {
  type: "tips" | "quote";
  eyebrow: string;
  hook_title: string;
  slide2_title: string;
  slide2_body: string;
  tips: { title: string; body: string; teaser: string }[];
  recap_title: string;
  save_line: string;
  quote_parts: string[];
  quote_hook: string;
  quote_context: string;
  attribution: string;
  cta_heading: string;
  cta_action: string;
  cta_keyword: string;
  swipe_cue: string;
  caption: string;
  hashtags: string[];
}

const LANGS: [string, string][] = [
  ["es", "Español"], ["en", "English"], ["de", "Deutsch"], ["fr", "Français"], ["nl", "Nederlands"],
  ["sv", "Svenska"], ["no", "Norsk"], ["da", "Dansk"], ["fi", "Suomi"], ["pl", "Polski"],
  ["ru", "Русский"], ["it", "Italiano"], ["pt", "Português"],
];

// the approved visual styles, per post type (server validates too)
const STYLES: Record<CarouselType, [string, string, string][]> = {
  listing: [
    ["vibra", "Vibra ✦ Recommended", "The story engine — AI reads your photos, writes a line for each, adds matched artwork"],
    ["editorial", "Editorial", "Clean and calm — the classic look"],
    ["horizonte", "Horizonte", "One panorama flowing across the first slides (needs a wide, high-quality photo)"],
    ["cartel", "Cartel", "Bold Spanish poster type, black & white photos"],
    ["encalada", "Encalada", "Mediterranean — arch crops, terracotta and olive"],
    ["sereno", "Sereno", "Quiet luxury — fine lines and lots of air"],
    ["plano", "Plano", "The blueprint — giant numbers, technical annotations"],
    ["portada", "Portada", "Your listing as a magazine cover"],
    ["recorte", "Recorte", "Scrapbook — taped photos, handwritten touch"],
    ["marea", "Marea", "The type wall — huge letters, maximum impact"],
    ["cuarteto", "Cuarteto", "Giant serif words woven between the photos"],
    ["brisa", "Brisa", "Hand-drawn line-work — rings, waves, marker strokes"],
    ["riviera", "Riviera", "Diagonal poster cuts with the blue price medallion"],
    ["ventana", "Ventana", "The illustrated window — shutters, plants and the cat"],
  ],
  tips: [
    ["editorial", "Editorial", "Clean and calm — the classic look"],
    ["cartel", "Cartel", "Bold Spanish poster type, giant numbers"],
    ["encalada", "Encalada", "Mediterranean — limewash, terracotta and olive"],
    ["sereno", "Sereno", "Quiet luxury — fine lines and lots of air"],
    ["bodegon", "Bodegón", "AI imagery — sculptural objects on turquoise water"],
    ["litoral", "Litoral", "AI imagery — Mediterranean travel-poster illustration"],
    ["tinta", "Tinta", "AI imagery — two-ink print posters, the riso sun"],
    ["salitre", "Salitre", "AI imagery — grainy 35mm coastal film photography"],
    ["papel", "Papel", "AI imagery — layered paper-cut scenes"],
    ["arcilla", "Arcilla", "AI imagery — the handmade clay miniature world"],
    ["acuarela", "Acuarela", "AI imagery — watercolour and ink sketches"],
    ["bordado", "Bordado", "AI imagery — embroidered thread on linen"],
  ],
  quote: [
    ["editorial", "Editorial", "Clean and calm — the classic look"],
    ["sereno", "Sereno", "Quiet luxury — the words framed like a gallery piece"],
    ["encalada", "Encalada", "Mediterranean warmth around the client's words"],
  ],
};

export function CarouselStudio({ initialTopic = "", initialLanguage }: { initialTopic?: string; initialLanguage?: string } = {}) {
  const [phase, setPhase] = useState<Phase>("form");   // tips-only: land straight on the form
  const [ctype] = useState<CarouselType>("tips");
  const [slides, setSlides] = useState<string[]>([]);
  const [genId, setGenId] = useState<string | null>(null);
  const [caption, setCaption] = useState<string>("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sections, setSections] = useState<string[]>([]);
  const [section, setSection] = useState("");
  const [saved, setSaved] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  // tips/quote form fields — a suggestion from the Studio home can pre-fill the topic + language
  const [topic, setTopic] = useState(initialTopic);
  const [ideas, setIdeas] = useState<string[]>([
    "First-time buyer mistakes", "How to prepare your home for viewings", "Questions to ask before you make an offer",
  ]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [showHow, setShowHow] = useState(false);
  const [seenIdeas, setSeenIdeas] = useState<string[]>([]);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [slideTotal, setSlideTotal] = useState(7);
  const [examples, setExamples] = useState<Record<string, string[]>>({});
  const [exampleStyle, setExampleStyle] = useState<string | null>(null);
  const [quoteText, setQuoteText] = useState("");
  const [quoteAuthor, setQuoteAuthor] = useState("");
  const [language, setLanguage] = useState(initialLanguage ?? "es");
  const [style, setStyle] = useState("editorial");
  const [scheme, setScheme] = useState("clasico");
  // otra vuelta (one-axis remix)
  const [resultStyle, setResultStyle] = useState<string>("editorial");
  const [resultPerSlideArt, setResultPerSlideArt] = useState(false);
  const [remixing, setRemixing] = useState<"" | "hook" | "style" | "layout">("");
  const [remixed, setRemixed] = useState(false);
  // text editing
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Plan | null>(null);
  const [applying, setApplying] = useState(false);

  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (poll.current) clearTimeout(poll.current); }, []);
  useEffect(() => {
    (async () => {
      const r = await editableSectionsAction();
      if (r.ok && Array.isArray(r.sections)) setSections(r.sections as string[]);
      const e = await carouselStyleExamplesAction();
      if (e.ok && e.examples && typeof e.examples === "object") setExamples(e.examples as Record<string, string[]>);
    })();
  }, []);

  function showResult(s: Record<string, unknown>) {
    setSlides(Array.isArray(s.slides) ? (s.slides as string[]) : s.image_url ? [s.image_url as string] : []);
    setCaption(typeof s.caption === "string" ? s.caption : "");
    setHashtags(Array.isArray(s.hashtags) ? (s.hashtags as string[]) : []);
    setPlan(s.plan && typeof s.plan === "object" ? (s.plan as Plan) : null);
    if (typeof s.carousel_style === "string") setResultStyle(s.carousel_style);
    setResultPerSlideArt(s.per_slide_art === true);
    setEditing(false); setDraft(null); setRemixed(false);
    setPhase("result");
  }

  function watch(id: string) {
    const started = Date.now();
    const tick = async () => {
      const s = await statusAction(id);
      const st = s.ok ? (s.status as string) : null;
      if (st === "completed") { showResult(s); return; }
      if (st === "failed") { setErr((s.message as string) ?? "That didn't come out — please try again."); setPhase(ctype === "listing" ? "pick" : "form"); return; }
      if (Date.now() - started > 300_000) { setErr("Still working in the background — check your library in a minute."); setPhase(ctype === "listing" ? "pick" : "form"); return; }
      poll.current = setTimeout(tick, 2500);
    };
    poll.current = setTimeout(tick, 2000);
  }

  async function start(body: Parameters<typeof carouselAction>[0], backTo: Phase) {
    setErr(null); setSaved(false); setSection("");
    setPhase("working");
    const res = await carouselAction(body);
    if (!res.ok || !res.generation_id) {
      setErr((res.message as string) ?? "Couldn't start the carousel. Please try again.");
      setPhase(backTo); return;
    }
    setGenId(res.generation_id as string);
    watch(res.generation_id as string);
  }

  async function file() {
    if (!genId) return;
    const r = await setSectionAction(genId, section.trim() || null);
    if (r.ok) {
      setSaved(true);
      const sec = section.trim();
      if (sec && !sections.includes(sec)) setSections((prev) => [...prev, sec].sort());
    } else setErr(r.message as string);
  }

  async function downloadAll() {
    setDownloading(true);
    const base = ctype;
    for (let i = 0; i < slides.length; i++) {
      await downloadImage(slides[i], `${base}-slide-${i + 1}.png`);
    }
    setDownloading(false);
  }

  async function copyCaption() {
    const tags = hashtags.length ? "\n\n" + hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ") : "";
    await navigator.clipboard.writeText(caption + tags);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  async function applyEdits() {
    if (!genId || !draft) return;
    setApplying(true); setErr(null);
    const r = await carouselUpdateAction(genId, draft);
    setApplying(false);
    if (!r.ok) { setErr((r.message as string) ?? "Couldn't apply the changes — please try again."); return; }
    // bust caches: the URLs change (fresh signed tokens), so the strip refreshes itself
    setSlides(Array.isArray(r.slides) ? (r.slides as string[]) : slides);
    setPlan((r.plan as Plan) ?? draft);
    setCaption(typeof r.caption === "string" ? r.caption : draft.caption);
    setHashtags(Array.isArray(r.hashtags) ? (r.hashtags as string[]) : draft.hashtags);
    setEditing(false); setDraft(null); setSaved(false);
  }

  async function inspire() {
    if (ideasLoading) return;
    setIdeasLoading(true); setErr(null);
    const r = await carouselTopicIdeasAction(language, seenIdeas);
    setIdeasLoading(false);
    if (!r.ok || !Array.isArray(r.topics)) { setErr((r.message as string) ?? "Couldn't think of ideas right now — please try again."); return; }
    const fresh = r.topics as string[];
    setIdeas(fresh);
    setSeenIdeas((prev) => [...prev, ...fresh].slice(-24));
  }

  async function remix(axis: "hook" | "style" | "layout") {
    if (!genId || remixing) return;
    setRemixing(axis); setErr(null);
    const r = await carouselRemixAction(genId, axis);
    setRemixing("");
    if (!r.ok) { setErr((r.message as string) ?? "Couldn't remix — please try again."); return; }
    setGenId((r.generation_id as string) ?? genId);
    setSlides(Array.isArray(r.slides) ? (r.slides as string[]) : slides);
    setPlan((r.plan as Plan) ?? plan);
    setCaption(typeof r.caption === "string" ? r.caption : caption);
    setHashtags(Array.isArray(r.hashtags) ? (r.hashtags as string[]) : hashtags);
    if (typeof r.carousel_style === "string") setResultStyle(r.carousel_style);
    setResultPerSlideArt(r.per_slide_art === true);
    setEditing(false); setDraft(null); setSaved(false); setSection(""); setRemixed(true);
  }

  const field = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
  const label = "mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400";

  function stylePicker() {
    const options = STYLES[ctype];
    const active = options.some(([k]) => k === style) ? style : "editorial";
    return (
      <div>
        <label className={label}>Look &amp; feel</label>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map(([key, name, desc]) => (
            <div key={key} className={`rounded-lg border transition ${active === key
                ? "border-neutral-900 bg-neutral-50 dark:border-neutral-100 dark:bg-neutral-800"
                : "border-neutral-200 hover:border-neutral-400 dark:border-neutral-700"}`}>
              <button type="button" onClick={() => setStyle(key)} className="w-full px-3 pt-2 text-left">
                <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">{name}</span>
                <span className="block text-xs text-neutral-500 dark:text-neutral-400">{desc}</span>
              </button>
              {examples[key]?.length ? (
                <button type="button" onClick={() => setExampleStyle(key)}
                  className="px-3 pb-2 pt-1 text-[11px] font-medium text-emerald-700 hover:underline dark:text-emerald-400">
                  See example →
                </button>
              ) : <span className="block pb-2" />}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`mx-auto ${phase === "form" ? "max-w-[1600px] px-6 lg:px-8" : "max-w-6xl px-4"} py-6`}>
      {phase === "form" && (
        <div className="flex gap-8">
          {/* ── the form column ─────────────────────────────────────────── */}
          <div className="min-w-0 flex-1">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h1 className="text-[28px] leading-tight font-bold tracking-tight text-neutral-900 dark:text-neutral-100">Tips &amp; advice carousel</h1>
                <p className="mt-1 max-w-md text-sm text-neutral-500 dark:text-neutral-400">
                  Create engaging Instagram carousels packed with useful tips your audience will love to save and share.
                </p>
              </div>
              <button type="button" onClick={() => setShowHow(true)}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                <PlayCircle className="h-4 w-4" /> How it works
              </button>
            </div>
            {err && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

            <div className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">1. What&rsquo;s your topic?</div>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Sparkles className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={300}
                  placeholder="e.g. mistakes to avoid when buying on the coast"
                  className="w-full rounded-xl border border-neutral-200 bg-white py-3.5 pl-10 pr-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-neutral-100" />
              </div>
              <button type="button" onClick={() => void inspire()} disabled={ideasLoading}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-4 text-sm font-medium text-emerald-700 hover:border-emerald-600 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-emerald-400">
                {ideasLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Get inspired
              </button>
            </div>
            <div className="mt-3 text-xs font-medium text-neutral-400">Popular ideas</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {ideas.map((t) => (
                <button key={t} type="button" onClick={() => setTopic(t)}
                  className={`rounded-lg border px-3.5 py-2 text-xs font-medium transition ${topic === t
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-neutral-200 bg-white text-emerald-800 hover:border-emerald-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-emerald-400"}`}>
                  {t}
                </button>
              ))}
              <button type="button" onClick={() => void inspire()} disabled={ideasLoading} title="More ideas"
                className="rounded-lg border border-neutral-200 bg-white p-2 text-neutral-400 hover:text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:text-neutral-200">
                {ideasLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </button>
            </div>

            <div className="mb-2 mt-7 text-sm font-semibold text-neutral-900 dark:text-neutral-100">2. How many slides?</div>
            <div className="flex flex-wrap gap-2">
              {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <button key={n} onClick={() => setSlideTotal(n)}
                  className={`h-11 w-12 rounded-lg border text-sm font-medium transition ${slideTotal === n
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"}`}>
                  {n}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
              {(() => {
                const ctx = slideTotal >= 5, rec = slideTotal >= 7;
                const tips = Math.min(7, Math.max(1, slideTotal - 2 - (ctx ? 1 : 0) - (rec ? 1 : 0)));
                const parts = ["1 cover", ...(ctx ? ["1 intro"] : []), `${tips} tip${tips > 1 ? "s" : ""}`, ...(rec ? ["1 summary"] : []), "1 closing slide"];
                return parts.map((part, i) => (
                  <span key={part} className="flex items-center gap-2">{i > 0 && <span>+</span>}<span>{part}</span></span>
                ));
              })()}
            </div>

            <div className="mb-2 mt-7 text-sm font-semibold text-neutral-900 dark:text-neutral-100">3. Choose a look &amp; feel</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {STYLES.tips.map(([key, name, desc]) => (
                <button key={key} type="button" onClick={() => { setStyle(key); setPreviewIdx(0); }}
                  className={`relative rounded-xl border text-left transition ${style === key
                    ? "border-emerald-600 ring-1 ring-emerald-600"
                    : "border-neutral-200 bg-white hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"}`}>
                  {examples[key]?.[0]
                    ? <img src={examples[key][0]} alt={name} referrerPolicy="no-referrer" className="aspect-square w-full rounded-t-xl object-cover object-top" />
                    : <div className="aspect-square w-full rounded-t-xl bg-gradient-to-br from-neutral-100 to-neutral-200 dark:from-neutral-800 dark:to-neutral-700" />}
                  <div className="p-2.5">
                    <div className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{name.replace(" ✦ Recommended", "")}</div>
                    <div className="mt-0.5 text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">{desc.replace(/^AI imagery — /, "")}</div>
                  </div>
                  {style === key && (
                    <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600">
                      <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                    </span>
                  )}
                </button>
              ))}
            </div>

            {["bodegon", "litoral", "tinta", "salitre", "papel", "arcilla", "acuarela", "bordado"].includes(style) && (
              <>
                <div className="mb-2 mt-7 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Colour mood <span className="font-normal text-neutral-400">(the artwork is generated fresh for your topic)</span></div>
                <div className="flex flex-wrap gap-2">
                  {[["clasico", "Clásico — navy & gold"], ["atardecer", "Atardecer — sunset terracotta"], ["oliva", "Oliva — olive & sage"], ["mar", "Mar — sea & foam"]].map(([key, name]) => (
                    <button key={key} type="button" onClick={() => setScheme(key)}
                      className={`rounded-lg border px-3.5 py-2 text-xs font-medium transition ${scheme === key
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"}`}>
                      {name}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="mb-2 mt-7 text-sm font-semibold text-neutral-900 dark:text-neutral-100">4. Language of the post</div>
            <div className="relative">
              <Globe className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <select value={language} onChange={(e) => setLanguage(e.target.value)}
                className="w-full appearance-none rounded-xl border border-neutral-200 bg-white py-3.5 pl-10 pr-8 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100">
                {LANGS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            </div>

            <button
              onClick={() => void start({ type: "tips", topic: topic.trim(), slides: slideTotal, language, style, scheme }, "form")}
              disabled={topic.trim().length < 3}
              className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-4 text-[15px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40">
              <Sparkles className="h-4 w-4" /> Create carousel
            </button>
          </div>

          {/* ── live preview rail ───────────────────────────────────────── */}
          <div className="hidden w-[380px] shrink-0 xl:block">
            <div className="sticky top-6 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-700 dark:bg-neutral-900">
              <div className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Live preview</div>
              <div className="mt-3 flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Cover preview
                <span title="Example slides in this look — your own carousel is written and drawn fresh for your topic."><Info className="h-3.5 w-3.5 text-neutral-300" /></span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-500">
                  <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" /></svg>
                </span>
                Instagram · 1080 × 1350
              </div>
              {examples[style]?.length ? (
                <img src={examples[style][previewIdx % examples[style].length]} alt="Style example" referrerPolicy="no-referrer"
                  className="mt-3 aspect-[4/5] w-full rounded-xl object-cover shadow-md" />
              ) : (
                <div className="mt-3 aspect-[4/5] w-full rounded-xl bg-gradient-to-b from-neutral-100 to-neutral-200 shadow-md dark:from-neutral-800 dark:to-neutral-700" />
              )}
              {(examples[style]?.length ?? 0) > 1 && (
                <div className="mt-3 flex items-center justify-between">
                  <button type="button" onClick={() => setPreviewIdx((i) => (i - 1 + examples[style].length) % examples[style].length)}
                    className="rounded-full border border-neutral-200 p-2 text-neutral-500 hover:border-neutral-400 dark:border-neutral-700"><ChevronLeft className="h-4 w-4" /></button>
                  <div className="flex gap-1.5">
                    {examples[style].map((_, i) => (
                      <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === previewIdx % examples[style].length ? "bg-emerald-600" : "bg-neutral-200 dark:bg-neutral-700"}`} />
                    ))}
                  </div>
                  <button type="button" onClick={() => setPreviewIdx((i) => (i + 1) % examples[style].length)}
                    className="rounded-full border border-neutral-200 p-2 text-neutral-500 hover:border-neutral-400 dark:border-neutral-700"><ChevronRight className="h-4 w-4" /></button>
                </div>
              )}
              <div className="mt-4 rounded-xl bg-emerald-50 p-4 dark:bg-emerald-950">
                <div className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">What&rsquo;s included</div>
                <div className="mt-2 flex flex-col gap-1.5 text-[13px] text-neutral-600 dark:text-neutral-300">
                  {(() => {
                    const ctx = slideTotal >= 5, rec = slideTotal >= 7;
                    const tips = Math.min(7, Math.max(1, slideTotal - 2 - (ctx ? 1 : 0) - (rec ? 1 : 0)));
                    return [
                      "Cover slide with strong hook",
                      ...(ctx ? ["Intro slide that sets the scene"] : []),
                      `${tips} practical tip slide${tips > 1 ? "s" : ""}`,
                      ...(rec ? ["Summary slide worth saving"] : []),
                      "Closing slide with takeaway",
                    ].map((line) => (
                      <div key={line} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />{line}</div>
                    ));
                  })()}
                </div>
              </div>
              <div className="mt-3 flex items-start gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div className="min-w-0 text-[13px]">
                  <div className="font-semibold text-neutral-900 dark:text-neutral-100">Tip</div>
                  <div className="mt-0.5 text-neutral-500 dark:text-neutral-400">Great topics solve a problem, teach something actionable or spark curiosity.</div>
                </div>
                {examples[style]?.length ? (
                  <button type="button" onClick={() => setExampleStyle(style)}
                    className="shrink-0 self-center rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:border-emerald-600 dark:border-neutral-700 dark:text-emerald-400">
                    See examples
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {/* ── how it works ────────────────────────────────────────────── */}
          {showHow && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowHow(false)}>
              <div className="w-full max-w-md rounded-2xl bg-white p-6 dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">How it works</h3>
                  <button onClick={() => setShowHow(false)} className="rounded-lg p-1 text-neutral-400 hover:text-neutral-700"><X className="h-5 w-5" /></button>
                </div>
                <ol className="mt-4 flex flex-col gap-3 text-sm text-neutral-600 dark:text-neutral-300">
                  {[
                    ["Pick a topic", "Type your own or tap Get inspired for fresh ideas."],
                    ["The AI writes the tips", "Practical, honest advice — it never invents prices or statistics."],
                    ["The engine paints the slides", "Artwork is generated fresh for your topic in the look you chose — no two posts are ever the same."],
                    ["Review, tweak, post", "Edit any text, remix with Otra vuelta, then download the slides and caption."],
                  ].map(([t, d], i) => (
                    <li key={t} className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">{i + 1}</span>
                      <span><span className="font-medium text-neutral-900 dark:text-neutral-100">{t}.</span> {d}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </div>
      )}

      {phase === "working" && (
        <div className="flex flex-col items-center gap-3 py-24 text-neutral-500">
          <Loader2 className="h-7 w-7 animate-spin" />
          <p className="text-sm">{["bodegon", "litoral", "tinta", "salitre", "papel", "arcilla", "acuarela", "bordado"].includes(style) || style === "vibra"
            ? "Writing the copy and painting the artwork — this takes a few minutes. Worth it."
            : ctype === "listing" ? "Building your carousel — under a minute…" : "Writing your carousel — about a minute…"}</p>
        </div>
      )}

      {phase === "result" && (
        <div>
          <button onClick={() => { setPhase("form"); setSlides([]); setPlan(null); setCaption(""); }}
            className="mb-4 flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" /> New carousel</button>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-emerald-700"><Check className="h-4 w-4" /> {slides.length} slides ready — swipe order left to right</div>

          <div className="flex gap-3 overflow-x-auto pb-3">
            {slides.map((u, i) => (
              <div key={u} className="w-56 shrink-0">
                <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100">
                  <img src={u} alt={`Slide ${i + 1}`} className="w-full" referrerPolicy="no-referrer" />
                </div>
                <button onClick={() => void downloadImage(u, `${ctype}-slide-${i + 1}.png`)}
                  className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50">
                  <Download className="h-3.5 w-3.5" /> Slide {i + 1}
                </button>
              </div>
            ))}
          </div>

          {plan && !editing && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <button onClick={() => { setDraft(JSON.parse(JSON.stringify(plan)) as Plan); setEditing(true); }}
                className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300">
                <Pencil className="h-4 w-4" /> Edit the text on the slides
              </button>
              {plan.type === "tips" && ([
                ["hook", "Otra vuelta · new hook", "The AI reframes the cover from a different angle"],
                ["style", "Otra vuelta · new look", "Same words and artwork, next look"],
                ...(resultPerSlideArt && ["bodegon", "litoral", "tinta", "salitre", "papel", "arcilla", "acuarela", "bordado"].includes(resultStyle)
                  ? [["layout", "Otra vuelta · recompose", "Same everything, slides rearranged"]] : []),
              ] as [typeof remixing, string, string][]).map(([axis, title2, tip]) => (
                <button key={axis} title={tip} disabled={!!remixing} onClick={() => void remix(axis as "hook" | "style" | "layout")}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300">
                  {remixing === axis ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {title2}
                </button>
              ))}
              {remixed && <span className="text-xs text-neutral-400">Free — the original is still in your library.</span>}
            </div>
          )}

          {editing && draft && (
            <div className="mt-3 flex max-w-2xl flex-col gap-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-900">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Edit the words — the slides redraw in seconds.</p>
              <div>
                <label className={label}>Cover — small line above the title</label>
                <input value={draft.eyebrow} onChange={(e) => setDraft({ ...draft, eyebrow: e.target.value })} className={field} maxLength={44} />
              </div>
              <div>
                <label className={label}>Cover — title</label>
                <textarea value={draft.hook_title} onChange={(e) => setDraft({ ...draft, hook_title: e.target.value })} className={field} maxLength={90} />
              </div>
              {draft.type === "quote" && (
                <div>
                  <label className={label}>Cover — the quote fragment shown (must be words from the quote)</label>
                  <textarea value={draft.quote_hook} onChange={(e) => setDraft({ ...draft, quote_hook: e.target.value })} className={field} maxLength={120} />
                </div>
              )}
              <div>
                <label className={label}>Slide 2 — headline (works on its own — some people see this slide first)</label>
                <input value={draft.slide2_title} onChange={(e) => setDraft({ ...draft, slide2_title: e.target.value })} className={field} maxLength={80} />
              </div>
              <div>
                <label className={label}>Slide 2 — supporting line</label>
                <textarea value={draft.type === "quote" ? draft.quote_context : draft.slide2_body}
                  onChange={(e) => setDraft(draft.type === "quote" ? { ...draft, quote_context: e.target.value } : { ...draft, slide2_body: e.target.value })}
                  className={field} maxLength={220} />
              </div>
              {draft.type === "tips" && draft.tips.map((t, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
                  <span className="text-xs font-semibold text-neutral-400">Point {i + 1}</span>
                  <input value={t.title} maxLength={62} className={field}
                    onChange={(e) => setDraft({ ...draft, tips: draft.tips.map((x, j) => j === i ? { ...x, title: e.target.value } : x) })} />
                  <textarea value={t.body} maxLength={250} className={`${field} min-h-20`}
                    onChange={(e) => setDraft({ ...draft, tips: draft.tips.map((x, j) => j === i ? { ...x, body: e.target.value } : x) })} />
                  <input value={t.teaser} maxLength={70} className={field} placeholder="Teaser for the next slide (optional)"
                    onChange={(e) => setDraft({ ...draft, tips: draft.tips.map((x, j) => j === i ? { ...x, teaser: e.target.value } : x) })} />
                </div>
              ))}
              {draft.type === "tips" && (
                <>
                  <div>
                    <label className={label}>Recap slide — heading</label>
                    <input value={draft.recap_title} onChange={(e) => setDraft({ ...draft, recap_title: e.target.value })} className={field} maxLength={60} />
                  </div>
                  <div>
                    <label className={label}>Recap slide — save line</label>
                    <input value={draft.save_line} onChange={(e) => setDraft({ ...draft, save_line: e.target.value })} className={field} maxLength={70} />
                  </div>
                </>
              )}
              {draft.type === "quote" && (
                <>
                  {draft.quote_parts.map((q, i) => (
                    <div key={i}>
                      <label className={label}>Quote {draft.quote_parts.length > 1 ? `— part ${i + 1}` : ""}</label>
                      <textarea value={q} maxLength={250} className={`${field} min-h-20`}
                        onChange={(e) => setDraft({ ...draft, quote_parts: draft.quote_parts.map((x, j) => j === i ? e.target.value : x) })} />
                    </div>
                  ))}
                  <div>
                    <label className={label}>Who said it</label>
                    <input value={draft.attribution} onChange={(e) => setDraft({ ...draft, attribution: e.target.value })} className={field} maxLength={62} />
                  </div>
                </>
              )}
              <div>
                <label className={label}>Closing slide — headline</label>
                <input value={draft.cta_heading} onChange={(e) => setDraft({ ...draft, cta_heading: e.target.value })} className={field} maxLength={78} />
              </div>
              <div>
                <label className={label}>Closing slide — what you ask people to do</label>
                <input value={draft.cta_action} onChange={(e) => setDraft({ ...draft, cta_action: e.target.value })} className={field} maxLength={140} />
              </div>
              <div>
                <label className={label}>Closing slide — DM keyword button</label>
                <input value={draft.cta_keyword} onChange={(e) => setDraft({ ...draft, cta_keyword: e.target.value })} className={field} maxLength={34} />
              </div>
              <div>
                <label className={label}>Caption</label>
                <textarea value={draft.caption} onChange={(e) => setDraft({ ...draft, caption: e.target.value })} className={`${field} min-h-28`} maxLength={1600} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => void applyEdits()} disabled={applying}
                  className="flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900">
                  {applying && <Loader2 className="h-4 w-4 animate-spin" />}{applying ? "Redrawing…" : "Apply changes"}
                </button>
                <button onClick={() => { setEditing(false); setDraft(null); }} disabled={applying}
                  className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">Cancel</button>
              </div>
            </div>
          )}

          {caption && (
            <div className="mt-4 max-w-2xl rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Caption — ready to paste</span>
                <button onClick={() => void copyCaption()}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${copied ? "bg-emerald-600 text-white" : "border border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"}`}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">{caption}</p>
              {hashtags.length > 0 && (
                <p className="mt-2 text-xs text-neutral-400">{hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}</p>
              )}
            </div>
          )}

          <div className="mt-4 grid max-w-2xl gap-4 sm:grid-cols-2">
            <button onClick={() => void downloadAll()} disabled={downloading}
              className="flex items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900">
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Images className="h-4 w-4" />}
              {downloading ? "Downloading…" : `Download all ${slides.length} slides`}
            </button>
            <div className="flex gap-2">
              <input list="studio-sections" value={section} onChange={(e) => { setSection(e.target.value); setSaved(false); }}
                placeholder="File in a section (optional)"
                className={field} />
              <datalist id="studio-sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
              <button onClick={() => void file()}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white ${saved ? "bg-emerald-600" : "bg-neutral-700"}`}>
                {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}{saved ? "Filed" : "File"}
              </button>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-neutral-400">Saved to your library automatically. Post the slides in order as an Instagram carousel.</p>
          {err && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
        </div>
      )}
      {exampleStyle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setExampleStyle(null)}>
          <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-4 dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold capitalize text-neutral-900 dark:text-neutral-100">{exampleStyle} — example slides</span>
              <button onClick={() => setExampleStyle(null)} className="rounded-lg border border-neutral-300 px-3 py-1 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">Close</button>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {(examples[exampleStyle] ?? []).map((u) => (
                <img key={u} src={u} alt="example slide" className="w-56 shrink-0 rounded-lg border border-neutral-200 dark:border-neutral-700" referrerPolicy="no-referrer" />
              ))}
            </div>
            <p className="mt-2 text-[11px] text-neutral-400">Your post will follow this look — with fresh artwork generated for your topic.</p>
          </div>
        </div>
      )}
    </div>
  );
}
