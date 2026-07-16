"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, Download, Images, Lightbulb, Loader2, MessageSquareQuote, Pencil, Save } from "lucide-react";
import { PropertyPicker, downloadImage, type PickerProperty } from "./property-picker";
import { carouselAction, carouselUpdateAction, statusAction, editableSectionsAction, setSectionAction } from "./wizard-actions";

/**
 * CAROUSEL STUDIO (Christian 2026-07-16, Phase 1): three post types —
 *  · Listing: cover + one clean slide per photo + contact card (deterministic) + AI caption.
 *  · Tips & advice: AI writes the tips from a topic, the engine draws brand-themed slides.
 *  · Client quote: the client's words verbatim on elegant quote slides.
 * Tips/quote text stays editable after generation (the engine re-renders in seconds).
 * Honest scope: produces the slide images + caption to post — no Instagram publishing.
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

export function CarouselStudio() {
  const [phase, setPhase] = useState<Phase>("type");
  const [ctype, setCtype] = useState<CarouselType>("listing");
  const [property, setProperty] = useState<PickerProperty | null>(null);
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
  // tips/quote form fields
  const [topic, setTopic] = useState("");
  const [tipCount, setTipCount] = useState(5);
  const [quoteText, setQuoteText] = useState("");
  const [quoteAuthor, setQuoteAuthor] = useState("");
  const [language, setLanguage] = useState("es");
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
    })();
  }, []);

  function showResult(s: Record<string, unknown>) {
    setSlides(Array.isArray(s.slides) ? (s.slides as string[]) : s.image_url ? [s.image_url as string] : []);
    setCaption(typeof s.caption === "string" ? s.caption : "");
    setHashtags(Array.isArray(s.hashtags) ? (s.hashtags as string[]) : []);
    setPlan(s.plan && typeof s.plan === "object" ? (s.plan as Plan) : null);
    setEditing(false); setDraft(null);
    setPhase("result");
  }

  function watch(id: string) {
    const started = Date.now();
    const tick = async () => {
      const s = await statusAction(id);
      const st = s.ok ? (s.status as string) : null;
      if (st === "completed") { showResult(s); return; }
      if (st === "failed") { setErr((s.message as string) ?? "That didn't come out — please try again."); setPhase(ctype === "listing" ? "pick" : "form"); return; }
      if (Date.now() - started > 180_000) { setErr("Still working in the background — check your library in a minute."); setPhase(ctype === "listing" ? "pick" : "form"); return; }
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
    const base = ctype === "listing" ? property?.title || "carousel" : ctype;
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

  const field = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
  const label = "mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400";

  function typeCard(t: CarouselType, icon: React.ReactNode, title: string, desc: string, cost: string) {
    return (
      <button onClick={() => { setCtype(t); setErr(null); setPhase(t === "listing" ? "pick" : "form"); }}
        className="flex flex-col items-start gap-2 rounded-xl border border-neutral-200 bg-white p-4 text-left transition hover:border-neutral-400 hover:shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
        <span className="rounded-lg bg-emerald-50 p-2 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">{icon}</span>
        <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">{desc}</span>
        <span className="text-[11px] text-neutral-400">{cost}</span>
      </button>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {phase === "type" && (
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Carousel</h2>
          <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
            A swipeable multi-slide post in your brand — pick what kind of post you want to make.
          </p>
          {err && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
          <div className="grid gap-3 sm:grid-cols-3">
            {typeCard("listing", <Images className="h-5 w-5" />, "Listing",
              "A property's photos as a swipeable tour: cover with the facts, one clean slide per photo, contact card. Caption written for you.", "Free · ready in seconds")}
            {typeCard("tips", <Lightbulb className="h-5 w-5" />, "Tips & advice",
              "Tell us the topic — the AI writes 3–7 practical tips and draws a slide for each, plus the caption and hashtags.", "1 credit · ~30 seconds")}
            {typeCard("quote", <MessageSquareQuote className="h-5 w-5" />, "Client quote",
              "Paste a happy client's words — they go on elegant quote slides exactly as written, never reworded.", "1 credit · ~30 seconds")}
          </div>
        </div>
      )}

      {phase === "pick" && (
        <div>
          <button onClick={() => setPhase("type")} className="mb-3 flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" /> Post type</button>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Listing carousel</h2>
          <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
            Pick a property and 2–9 photos — cover with the facts, one clean slide per photo, and a contact card to close.
          </p>
          {err && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
          <PropertyPicker multi minPhotos={2} onConfirm={(p, chosen) => {
            setProperty(p);
            void start({ type: "listing", property_id: p.id, photos: chosen.slice(0, 9), language }, "pick");
          }} />
        </div>
      )}

      {phase === "form" && (
        <div className="max-w-xl">
          <button onClick={() => setPhase("type")} className="mb-3 flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" /> Post type</button>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{ctype === "tips" ? "Tips & advice" : "Client quote"}</h2>
          <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
            {ctype === "tips"
              ? "What should the carousel teach? The AI writes the tips (general advice only — it never invents prices or statistics)."
              : "Paste the client's words — they appear on the slides exactly as written."}
          </p>
          {err && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

          <div className="flex flex-col gap-4">
            {ctype === "tips" ? (
              <>
                <div>
                  <label className={label}>Topic</label>
                  <input value={topic} onChange={(e) => setTopic(e.target.value)} className={field}
                    placeholder="e.g. mistakes to avoid when buying on the coast" maxLength={300} />
                </div>
                <div>
                  <label className={label}>Number of tips</label>
                  <div className="flex gap-2">
                    {[3, 4, 5, 6, 7].map((n) => (
                      <button key={n} onClick={() => setTipCount(n)}
                        className={`h-9 w-9 rounded-lg border text-sm font-medium ${tipCount === n ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900" : "border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className={label}>The client&apos;s words</label>
                  <textarea value={quoteText} onChange={(e) => setQuoteText(e.target.value)} className={`${field} min-h-28`}
                    placeholder="e.g. Vendimos nuestra casa en dos meses. Nos acompañaron en cada paso…" maxLength={700} />
                </div>
                <div>
                  <label className={label}>Who said it (shown under the quote)</label>
                  <input value={quoteAuthor} onChange={(e) => setQuoteAuthor(e.target.value)} className={field}
                    placeholder="e.g. María G., Altea" maxLength={80} />
                </div>
              </>
            )}
            <div>
              <label className={label}>Language of the post</label>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className={field}>
                {LANGS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </div>
            <button
              onClick={() => void start(
                ctype === "tips"
                  ? { type: "tips", topic: topic.trim(), slide_count: tipCount, language }
                  : { type: "quote", quote_text: quoteText.trim(), quote_author: quoteAuthor.trim(), language },
                "form")}
              disabled={ctype === "tips" ? topic.trim().length < 3 : quoteText.trim().length < 10}
              className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900">
              Create carousel
            </button>
          </div>
        </div>
      )}

      {phase === "working" && (
        <div className="flex flex-col items-center gap-3 py-24 text-neutral-500">
          <Loader2 className="h-7 w-7 animate-spin" />
          <p className="text-sm">{ctype === "listing" ? "Building your carousel — a few seconds…" : "Writing and drawing your carousel — about half a minute…"}</p>
        </div>
      )}

      {phase === "result" && (
        <div>
          <button onClick={() => { setPhase("type"); setSlides([]); setPlan(null); setCaption(""); }}
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
            <button onClick={() => { setDraft(JSON.parse(JSON.stringify(plan)) as Plan); setEditing(true); }}
              className="mt-1 flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300">
              <Pencil className="h-4 w-4" /> Edit the text on the slides
            </button>
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
    </div>
  );
}
