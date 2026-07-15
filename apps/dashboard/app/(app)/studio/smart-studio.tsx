"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Download, Loader2, Save, Sparkles } from "lucide-react";
import { PropertyPicker, downloadImage, type PickerProperty } from "./property-picker";
import {
  smartDesignAction, smartReviseAction, statusAction, editableSectionsAction, setSectionAction,
} from "./wizard-actions";

/**
 * SMART — the one mode where AI has full creative freedom (Christian 2026-07-14):
 * "i want it to make its own template, just whatever he thinks looks best based in what has been selected and
 *  written... in this smart section kie needs to be the one to handle text and everything, but he has creative
 *  freedom so he can do however he wants here."
 *
 * So Smart hands KIE every selected photo + the property's REAL facts + your direction, and KIE composes the
 * whole post itself — layout, typography, text. The facts are passed verbatim with an instruction to reproduce
 * them exactly and add nothing, so creative freedom never turns into invented data. Templates/Renovation keep
 * the deterministic rule (KIE = photos only).
 */

// KIE's real aspect enum, each labelled with what it's actually FOR (Christian: "with (post type) next to the
// size so they understand for what the size is"). No custom dimensions exist — these 9 are the options.
const SIZES: { key: string; label: string; use: string }[] = [
  { key: "square_hd", label: "Square 1:1", use: "Instagram / Facebook post" },
  { key: "portrait_4_3", label: "Portrait 3:4", use: "Instagram portrait" },
  { key: "portrait_16_9", label: "Tall 9:16", use: "Story / Reel / TikTok" },
  { key: "portrait_3_2", label: "Portrait 2:3", use: "Pinterest / printed flyer" },
  { key: "landscape_4_3", label: "Landscape 4:3", use: "Facebook / website" },
  { key: "landscape_16_9", label: "Wide 16:9", use: "YouTube / email banner" },
  { key: "landscape_3_2", label: "Landscape 3:2", use: "Portal listing photo" },
  { key: "landscape_21_9", label: "Ultra-wide 21:9", use: "Website hero banner" },
  { key: "square", label: "Square (small)", use: "Quick social post" },
];

type Phase = "pick" | "brief" | "working" | "result";

export function SmartStudio() {
  const [phase, setPhase] = useState<Phase>("pick");
  const [property, setProperty] = useState<PickerProperty | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [brief, setBrief] = useState("");
  const [size, setSize] = useState("square_hd");
  const [cleanFirst, setCleanFirst] = useState(true);

  const [genId, setGenId] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [revisionsLeft, setRevisionsLeft] = useState(2);
  const [editNote, setEditNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busyMsg, setBusyMsg] = useState<string | null>(null);

  const [sections, setSections] = useState<string[]>([]);
  const [section, setSection] = useState("");
  const [saved, setSaved] = useState(false);

  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (poll.current) clearTimeout(poll.current); }, []);
  useEffect(() => {
    (async () => {
      const r = await editableSectionsAction();
      if (r.ok && Array.isArray(r.sections)) setSections(r.sections as string[]);
    })();
  }, []);

  async function watch(id: string) {
    const started = Date.now();
    const tick = async () => {
      const s = await statusAction(id);
      const st = s.ok ? (s.status as string) : null;
      if (st === "completed") {
        setImage((s.image_url as string) ?? null);
        if (typeof s.revisions_remaining === "number") setRevisionsLeft(s.revisions_remaining as number);
        setBusyMsg(null); setPhase("result"); return;
      }
      if (st === "failed") {
        setErr((s.message as string) ?? "That didn't come out — please try again.");
        setBusyMsg(null); setPhase("brief"); return;
      }
      if (Date.now() - started > 5 * 60 * 1000) {
        setErr("This is taking longer than expected. Check your library in a minute.");
        setBusyMsg(null); setPhase("brief"); return;
      }
      poll.current = setTimeout(tick, 4000);
    };
    poll.current = setTimeout(tick, 3000);
  }

  async function generate() {
    if (!property || photos.length === 0) return;
    setPhase("working"); setErr(null); setSaved(false);
    setBusyMsg(cleanFirst
      ? `Removing watermarks from your ${photos.length} photo${photos.length === 1 ? "" : "s"}, then designing your post…`
      : `AIVENA is designing your post around your ${photos.length} photo${photos.length === 1 ? "" : "s"}…`);
    const res = await smartDesignAction({
      property_id: property.id,
      photos,                        // ALL of them — each gets its own frame in the design
      size,
      brief: brief.trim() || undefined,
      clean_photos: cleanFirst,
    });
    if (!res.ok || !res.generation_id) {
      setErr((res.message as string) ?? "Couldn't start that. Please try again.");
      setBusyMsg(null); setPhase("brief"); return;
    }
    setGenId(res.generation_id as string);
    void watch(res.generation_id as string);
  }

  async function revise() {
    if (!genId || !editNote.trim()) return;
    setPhase("working"); setErr(null);
    setBusyMsg("Applying your change…");
    const res = await smartReviseAction(genId, editNote.trim());
    if (!res.ok) {
      setErr((res.message as string) ?? "Couldn't apply that change.");
      setBusyMsg(null); setPhase("result"); return;
    }
    setEditNote("");
    void watch(genId);
  }

  async function save() {
    if (!genId) return;
    const r = await setSectionAction(genId, section.trim() || null);
    if (r.ok) {
      setSaved(true);
      const s = section.trim();
      if (s && !sections.includes(s)) setSections((prev) => [...prev, s].sort());
    } else setErr(r.message as string);
  }

  function startOver() {
    setPhase("pick"); setProperty(null); setPhotos([]); setBrief("");
    setGenId(null); setImage(null); setRevisionsLeft(2); setEditNote("");
    setErr(null); setBusyMsg(null); setSaved(false); setSection("");
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* ── PICK ──────────────────────────────────────────────────────────── */}
      {phase === "pick" && (
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Smart</h2>
          <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
            Pick a property and the photos you want — AIVENA designs the whole post itself.
          </p>
          <PropertyPicker onConfirm={(p, chosen) => { setProperty(p); setPhotos(chosen); setPhase("brief"); }} />
        </div>
      )}

      {/* ── BRIEF ─────────────────────────────────────────────────────────── */}
      {phase === "brief" && property && (
        <div className="max-w-2xl">
          <button onClick={() => setPhase("pick")} className="mb-4 flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" /> Property</button>

          <div className="mb-5 flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3">
            <div className="flex -space-x-2">
              {photos.slice(0, 5).map((u) => (
                <img key={u} src={u} alt="" referrerPolicy="no-referrer"
                  className="h-11 w-11 rounded-lg border-2 border-white object-cover" />
              ))}
            </div>
            <div className="min-w-0 text-sm">
              <div className="truncate font-medium text-neutral-900">{property.title || "Property"}</div>
              <div className="text-xs text-neutral-500">{photos.length} photo{photos.length === 1 ? "" : "s"} — all of them will be used</div>
            </div>
          </div>

          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">What should it say or look like? (optional)</label>
          <textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={2000}
            placeholder="e.g. bold luxury feel, lead with the sea view, mention the private pool"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900" />
          <p className="mt-1 text-[11px] text-neutral-400">
            AIVENA designs a brand-new layout around your photos. The price, rooms and location come straight from your listing — they can never be wrong.
          </p>

          <label className="mt-5 flex cursor-pointer items-start gap-2.5 rounded-lg border border-neutral-200 p-3">
            <input type="checkbox" checked={cleanFirst} onChange={(e) => setCleanFirst(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-neutral-900" />
            <span className="text-sm text-neutral-700">
              <span className="font-medium">Remove watermarks from the photos first</span> (recommended)
              <span className="block text-[11px] text-neutral-400">Uses a credit per photo the first time — already-cleaned photos are reused free.</span>
            </span>
          </label>

          <label className="mb-1.5 mt-5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">Post size</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SIZES.map((s) => (
              <button key={s.key} onClick={() => setSize(s.key)}
                className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition ${size === s.key ? "border-neutral-900 bg-neutral-50 ring-1 ring-neutral-900" : "border-neutral-200 hover:border-neutral-400"}`}>
                <span className="font-medium text-neutral-800">{s.label}</span>
                <span className="ml-2 truncate text-xs text-neutral-500">({s.use})</span>
              </button>
            ))}
          </div>

          {err && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}

          <button onClick={() => void generate()} disabled={photos.length === 0}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">
            <Sparkles className="h-4 w-4" /> Design my post
          </button>
          <p className="mt-2 text-center text-[11px] text-neutral-400">{cleanFirst ? "Takes 1-3 minutes (photo clean-up + design)" : "Takes ~30 seconds"} · you get 2 free changes after</p>
        </div>
      )}

      {/* ── WORKING ───────────────────────────────────────────────────────── */}
      {phase === "working" && (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <Loader2 className="h-7 w-7 animate-spin text-neutral-400" />
          <p className="text-sm font-medium text-neutral-700">{busyMsg}</p>
          <p className="text-xs text-neutral-400">{cleanFirst ? "Cleaning the photos, then designing — up to a few minutes." : "Designing the layout and placing your photos — under a minute."}</p>
        </div>
      )}

      {/* ── RESULT ────────────────────────────────────────────────────────── */}
      {phase === "result" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
            {image ? <img src={image} alt="Your post" className="w-full" referrerPolicy="no-referrer" /> : null}
          </div>
          <div className="space-y-4">
            <div className="rounded-xl border border-neutral-200 p-3">
              <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Change something ({revisionsLeft} free change{revisionsLeft === 1 ? "" : "s"} left)
              </label>
              <textarea rows={2} value={editNote} onChange={(e) => setEditNote(e.target.value)} maxLength={1000}
                disabled={revisionsLeft <= 0}
                placeholder="e.g. make the price bigger, use the pool photo as the main one"
                className="mt-2 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 disabled:opacity-50" />
              <button onClick={() => void revise()} disabled={revisionsLeft <= 0 || !editNote.trim()}
                className="mt-2 w-full rounded-lg border border-neutral-900 px-4 py-2 text-sm font-medium text-neutral-900 disabled:border-neutral-200 disabled:text-neutral-400">
                Apply change
              </button>
            </div>

            <div className="space-y-2 rounded-xl border border-neutral-200 p-3">
              <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">File it in a section</label>
              <input list="smart-sections" value={section} onChange={(e) => { setSection(e.target.value); setSaved(false); }}
                placeholder="e.g. Just listed (optional)"
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900" />
              <datalist id="smart-sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
              <button onClick={() => void save()}
                className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white ${saved ? "bg-emerald-600" : "bg-neutral-900"}`}>
                {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}{saved ? "Filed ✓" : "File in section"}
              </button>
              <p className="text-[11px] text-neutral-400">Your post is saved to the library automatically — this only chooses which section it lives in.</p>
            </div>

            <button type="button" disabled={!image}
              onClick={() => image && void downloadImage(image, `${property?.title || "post"}.png`)}
              className={`flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700 ${image ? "hover:bg-neutral-50" : "opacity-40"}`}>
              <Download className="h-4 w-4" /> Download image
            </button>
            {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
            <button onClick={startOver} className="w-full text-center text-xs text-neutral-400 hover:text-neutral-600">Start over</button>
          </div>
        </div>
      )}
    </div>
  );
}
