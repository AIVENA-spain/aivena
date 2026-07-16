"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Download, Images, Loader2, Save } from "lucide-react";
import { PropertyPicker, downloadImage, type PickerProperty } from "./property-picker";
import { carouselAction, statusAction, editableSectionsAction, setSectionAction } from "./wizard-actions";

/**
 * CAROUSEL (Christian 2026-07-16): a swipeable multi-slide post from one listing — cover with the facts,
 * one clean full-bleed slide per photo, and a closing contact card, all drawn by the deterministic engine
 * in the agency's brand. Produces the slide images ready to post; publishing to Instagram stays with the
 * agent (honest scope — no scheduling/publishing integration).
 */

type Phase = "pick" | "working" | "result";

export function CarouselStudio() {
  const [phase, setPhase] = useState<Phase>("pick");
  const [property, setProperty] = useState<PickerProperty | null>(null);
  const [slides, setSlides] = useState<string[]>([]);
  const [genId, setGenId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sections, setSections] = useState<string[]>([]);
  const [section, setSection] = useState("");
  const [saved, setSaved] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (poll.current) clearTimeout(poll.current); }, []);
  useEffect(() => {
    (async () => {
      const r = await editableSectionsAction();
      if (r.ok && Array.isArray(r.sections)) setSections(r.sections as string[]);
    })();
  }, []);

  function watch(id: string) {
    const started = Date.now();
    const tick = async () => {
      const s = await statusAction(id);
      const st = s.ok ? (s.status as string) : null;
      if (st === "completed") {
        setSlides(Array.isArray(s.slides) ? (s.slides as string[]) : s.image_url ? [s.image_url as string] : []);
        setPhase("result");
        return;
      }
      if (st === "failed") { setErr((s.message as string) ?? "That didn't come out — please try again."); setPhase("pick"); return; }
      if (Date.now() - started > 120_000) { setErr("Still working — check your library in a minute."); setPhase("pick"); return; }
      poll.current = setTimeout(tick, 2500);
    };
    poll.current = setTimeout(tick, 2000);
  }

  async function generate(p: PickerProperty, chosen: string[]) {
    setProperty(p); setErr(null); setSaved(false); setSection("");
    setPhase("working");
    const res = await carouselAction({ property_id: p.id, photos: chosen.slice(0, 9) });
    if (!res.ok || !res.generation_id) {
      setErr((res.message as string) ?? "Couldn't start the carousel. Please try again.");
      setPhase("pick"); return;
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
    for (let i = 0; i < slides.length; i++) {
      await downloadImage(slides[i], `${property?.title || "carousel"}-slide-${i + 1}.png`);
    }
    setDownloading(false);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {phase === "pick" && (
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Carousel</h2>
          <p className="mb-1 text-sm text-neutral-500 dark:text-neutral-400">
            Pick a property and 2–9 photos — you get a swipeable post: a cover with the facts, one clean slide per photo, and a contact card to close.
          </p>
          <p className="mb-4 text-xs text-neutral-400">Free · ready in seconds · you download the slides and post them as an Instagram carousel.</p>
          {err && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
          <PropertyPicker multi minPhotos={2} onConfirm={(p, chosen) => void generate(p, chosen)} />
        </div>
      )}

      {phase === "working" && (
        <div className="flex flex-col items-center gap-3 py-24 text-neutral-500">
          <Loader2 className="h-7 w-7 animate-spin" />
          <p className="text-sm">Building your carousel — a few seconds…</p>
        </div>
      )}

      {phase === "result" && (
        <div>
          <button onClick={() => { setPhase("pick"); setSlides([]); }} className="mb-4 flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" /> New carousel</button>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-emerald-700"><Check className="h-4 w-4" /> {slides.length} slides ready — swipe order left to right</div>

          <div className="flex gap-3 overflow-x-auto pb-3">
            {slides.map((u, i) => (
              <div key={u} className="w-56 shrink-0">
                <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100">
                  <img src={u} alt={`Slide ${i + 1}`} className="w-full" referrerPolicy="no-referrer" />
                </div>
                <button onClick={() => void downloadImage(u, `${property?.title || "carousel"}-slide-${i + 1}.png`)}
                  className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50">
                  <Download className="h-3.5 w-3.5" /> Slide {i + 1}
                </button>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <button onClick={() => void downloadAll()} disabled={downloading}
              className="flex items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Images className="h-4 w-4" />}
              {downloading ? "Downloading…" : `Download all ${slides.length} slides`}
            </button>
            <div className="flex gap-2">
              <input list="studio-sections" value={section} onChange={(e) => { setSection(e.target.value); setSaved(false); }}
                placeholder="File in a section (optional)"
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900" />
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
