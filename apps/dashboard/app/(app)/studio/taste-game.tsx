"use client";

import { useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import { saveStudioPreferencesAction } from "./wizard-actions";

/**
 * FIND YOUR STYLE — the this-or-that taste game (Christian 2026-08-28: "give them at least 10
 * this or that choices to find out what they like — font wise, color wise, size wise — and then
 * base the templates on that for this specific agency"; expanded same day: "more fonts to choose
 * from and colors so they actually feel it's specific enough — it will decide for the property
 * post templates too"). Nineteen visual either/or picks — including real-font specimen duels and
 * colour-world duels — + two optional free-text lines, saved to the agency's taste profile. The
 * Studio then recommends carousel looks AND property templates, matches editions/fonts, and
 * briefs the art director from it.
 */

const ex = (p: string) => withBasePath(`/studio/carousel-examples/${p}`);
const tf = (k: string) => withBasePath(`/studio/taste/${k}.png`);

type Card = { kind: "mock"; bg: string; ink: string; accent: string; serif: boolean; big: boolean; ornament?: boolean }
          | { kind: "img"; src: string }
          | { kind: "pal"; main: string; accent: string; base: string };
type Pair = { key: string; q: string; a: { v: string; label: string; card: Card }; b: { v: string; label: string; card: Card } };

const PAIRS: Pair[] = [
  { key: "font", q: "Which headline feels more like you?",
    a: { v: "serif", label: "Classic serif", card: { kind: "mock", bg: "#f4f1ea", ink: "#1a2b4a", accent: "#c8a24b", serif: true, big: false } },
    b: { v: "sans", label: "Modern sans", card: { kind: "mock", bg: "#f4f1ea", ink: "#17181c", accent: "#c8a24b", serif: false, big: false } } },
  { key: "serif_face", q: "If a serif — romantic or razor-sharp?",
    a: { v: "playfair", label: "Romantic, high contrast", card: { kind: "img", src: tf("playfair") } },
    b: { v: "prata", label: "Sharp & modern", card: { kind: "img", src: tf("prata") } } },
  { key: "serif_flavor", q: "And between these two voices?",
    a: { v: "fraunces", label: "Soft & warm", card: { kind: "img", src: tf("fraunces") } },
    b: { v: "caslon", label: "Classic editorial", card: { kind: "img", src: tf("caslon") } } },
  { key: "display_face", q: "For big statements — which one?",
    a: { v: "anton", label: "Heavy poster type", card: { kind: "img", src: tf("anton") } },
    b: { v: "italiana", label: "Elegant hairline", card: { kind: "img", src: tf("italiana") } } },
  { key: "sans_face", q: "For the small supporting text?",
    a: { v: "archivo", label: "Grounded & sturdy", card: { kind: "img", src: tf("archivo") } },
    b: { v: "jost", label: "Geometric & light", card: { kind: "img", src: tf("jost") } } },
  { key: "scale", q: "How loud should the type be?",
    a: { v: "bold", label: "Big & bold", card: { kind: "mock", bg: "#f4f1ea", ink: "#1a2b4a", accent: "#c8a24b", serif: true, big: true } },
    b: { v: "calm", label: "Calm & airy", card: { kind: "mock", bg: "#f7f5f0", ink: "#3a4145", accent: "#a68d72", serif: true, big: false } } },
  { key: "ground", q: "Dark or light backgrounds?",
    a: { v: "dark", label: "Deep & dramatic", card: { kind: "mock", bg: "#1a2b4a", ink: "#f4f1ea", accent: "#c8a24b", serif: true, big: false } },
    b: { v: "light", label: "Light & open", card: { kind: "mock", bg: "#f4f1ea", ink: "#1a2b4a", accent: "#c8a24b", serif: true, big: false } } },
  { key: "accent", q: "Which colour family pulls you in?",
    a: { v: "warm", label: "Warm — terracotta & gold", card: { kind: "mock", bg: "#f7f1e3", ink: "#8a4a2b", accent: "#c96a4a", serif: true, big: false } },
    b: { v: "cool", label: "Cool — olive & sea", card: { kind: "mock", bg: "#eff2ef", ink: "#33424e", accent: "#5a6b4e", serif: true, big: false } } },
  { key: "palette_classic", q: "Which pair would you wear?",
    a: { v: "navy-gold", label: "Deep navy & gold", card: { kind: "pal", main: "#1a2b4a", accent: "#c8a24b", base: "#f3efe6" } },
    b: { v: "terracotta", label: "Spanish red & cream", card: { kind: "pal", main: "#b3362b", accent: "#c96a4a", base: "#f7f1e3" } } },
  { key: "palette_depth", q: "And of these two?",
    a: { v: "green-brass", label: "Deep green & brass", card: { kind: "pal", main: "#1e3a34", accent: "#b98d4f", base: "#f1eee6" } },
    b: { v: "noche", label: "Ink black & gold", card: { kind: "pal", main: "#17181c", accent: "#c8a24b", base: "#efece4" } } },
  { key: "palette_soft", q: "One more colour world?",
    a: { v: "indigo-clay", label: "Indigo & burnt clay", card: { kind: "pal", main: "#2c4a6b", accent: "#a86b3c", base: "#f2efe8" } },
    b: { v: "earth-olive", label: "Earth & olive", card: { kind: "pal", main: "#4a4238", accent: "#7d8a6a", base: "#f0ede5" } } },
  { key: "intensity", q: "Rich colour or quiet colour?",
    a: { v: "rich", label: "Rich & saturated", card: { kind: "mock", bg: "#b3362b", ink: "#f7f1e3", accent: "#f2e6c9", serif: false, big: true } },
    b: { v: "muted", label: "Muted & soft", card: { kind: "mock", bg: "#efece6", ink: "#6b6f66", accent: "#a6a08d", serif: true, big: false } } },
  { key: "devices", q: "Ornamented or clean pages?",
    a: { v: "ornamented", label: "Frames & details", card: { kind: "mock", bg: "#f6f3ec", ink: "#1a2b4a", accent: "#c8a24b", serif: true, big: false, ornament: true } },
    b: { v: "clean", label: "Nothing extra", card: { kind: "mock", bg: "#f6f3ec", ink: "#1a2b4a", accent: "#c8a24b", serif: true, big: false } } },
  { key: "artwork", q: "Photography or illustration?",
    a: { v: "photo", label: "Photographic", card: { kind: "img", src: ex("salitre/1.jpg") } },
    b: { v: "illustration", label: "Illustrated", card: { kind: "img", src: ex("acuarela/1.jpg") } } },
  { key: "illo", q: "If illustrated — painted or crafted?",
    a: { v: "painterly", label: "Painted & loose", card: { kind: "img", src: ex("litoral/1.jpg") } },
    b: { v: "crafted", label: "Crafted objects", card: { kind: "img", src: ex("arcilla/1.jpg") } } },
  { key: "numerals", q: "How should numbers appear?",
    a: { v: "big", label: "Huge, as decoration", card: { kind: "img", src: ex("cartel/3.jpg") } },
    b: { v: "small", label: "Small & discreet", card: { kind: "img", src: ex("sereno/4.jpg") } } },
  { key: "mood", q: "What energy fits your agency?",
    a: { v: "bold", label: "Bold & striking", card: { kind: "img", src: ex("cartel/1.jpg") } },
    b: { v: "calm", label: "Calm & premium", card: { kind: "img", src: ex("sereno/1.jpg") } } },
  { key: "density", q: "Full pages or lots of air?",
    a: { v: "decorated", label: "Layered & full", card: { kind: "img", src: ex("tinta/1.jpg") } },
    b: { v: "minimal", label: "Space to breathe", card: { kind: "img", src: ex("editorial/2.jpg") } } },
  { key: "serif", q: "One last one — which serif voice?",
    a: { v: "display", label: "Elegant & sharp", card: { kind: "img", src: ex("sereno/2.jpg") } },
    b: { v: "classic", label: "Warm & bookish", card: { kind: "img", src: ex("editorial/1.jpg") } } },
];

function PalCard({ c }: { c: Extract<Card, { kind: "pal" }> }) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg" style={{ background: c.base }}>
      <div className="flex-[3]" style={{ background: c.main }} />
      <div className="flex-1" style={{ background: c.accent }} />
      <div className="flex flex-[2] items-center px-4">
        <div>
          <div className="text-[15px] font-semibold" style={{ color: c.main }}>The coast in winter</div>
          <div className="mt-1.5 h-1 w-10 rounded" style={{ background: c.accent }} />
        </div>
      </div>
    </div>
  );
}

function MockCard({ c }: { c: Extract<Card, { kind: "mock" }> }) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg p-4" style={{ background: c.bg }}>
      {c.ornament && <div className="pointer-events-none absolute inset-2 rounded border" style={{ borderColor: `${c.ink}55` }} />}
      <div className="mb-2 h-1 w-8" style={{ background: c.accent }} />
      <div style={{
        color: c.ink, fontFamily: c.serif ? "Georgia, 'Times New Roman', serif" : "Inter, Arial, sans-serif",
        fontWeight: c.serif ? 500 : 800, fontSize: c.big ? 30 : 19, lineHeight: 1.12, letterSpacing: c.serif ? 0 : -0.5,
      }}>
        The coast in winter
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="h-1.5 w-11/12 rounded" style={{ background: `${c.ink}44` }} />
        <div className="h-1.5 w-8/12 rounded" style={{ background: `${c.ink}44` }} />
      </div>
      <div className="absolute bottom-3 left-4 rounded-full px-2 py-0.5 text-[9px] font-semibold" style={{ background: c.accent, color: c.bg }}>
        SAVE THIS
      </div>
    </div>
  );
}

export function TasteGame({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [likes, setLikes] = useState("");
  const [dislikes, setDislikes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pick = (key: string, v: string) => {
    setAnswers((a) => ({ ...a, [key]: v }));
    setStep((s) => s + 1);
  };

  async function save() {
    setSaving(true); setErr(null);
    const r = await saveStudioPreferencesAction({ ...answers, likes, dislikes });
    setSaving(false);
    if (!r.ok) { setErr((r.message as string) ?? "Couldn't save your choices — please try again."); return; }
    setSaved(true);
  }

  if (saved) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600"><Check className="h-6 w-6 text-white" /></div>
        <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">Your style is saved</h2>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          The Studio now recommends looks that match your taste, dresses the text styles in your
          preferred colour worlds, and briefs the artwork around what you chose.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-1.5">
          {Object.entries(answers).map(([k, v]) => (
            <span key={k} className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{v}</span>
          ))}
        </div>
        <button onClick={onDone} className="mt-8 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-700">Back to Studio</button>
      </div>
    );
  }

  if (step >= PAIRS.length) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">Almost done — anything in your own words?</h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Both optional. The Studio will respect them in every design.</p>
        <label className="mt-6 block text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Things you love</label>
        <input value={likes} onChange={(e) => setLikes(e.target.value)} maxLength={300} placeholder="e.g. bougainvillea, sunset light, hand-drawn feel"
          className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100" />
        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Things to avoid</label>
        <input value={dislikes} onChange={(e) => setDislikes(e.target.value)} maxLength={300} placeholder="e.g. red, palm trees, anything cluttered"
          className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100" />
        {err && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
        <button onClick={() => void save()} disabled={saving}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Save my style
        </button>
      </div>
    );
  }

  const p = PAIRS[step];
  return (
    <div className="mx-auto max-w-2xl py-8">
      <div className="mb-1 text-xs font-medium tracking-wide text-neutral-400">{step + 1} / {PAIRS.length}</div>
      <div className="mb-5 flex gap-1">
        {PAIRS.map((_, i) => <span key={i} className={`h-1 flex-1 rounded-full ${i < step ? "bg-emerald-500" : i === step ? "bg-emerald-300" : "bg-neutral-200 dark:bg-neutral-800"}`} />)}
      </div>
      <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{p.q}</h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Tap the one that feels right — first instinct wins.</p>
      <div className="mt-6 grid grid-cols-2 gap-4">
        {([p.a, p.b] as const).map((opt) => (
          <button key={opt.v} onClick={() => pick(p.key, opt.v)}
            className="group overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition hover:-translate-y-0.5 hover:border-emerald-600 hover:shadow-md dark:border-neutral-700 dark:bg-neutral-900">
            <div className="aspect-[4/5]">
              {opt.card.kind === "img"
                ? <img src={opt.card.src} alt={opt.label} className="h-full w-full object-cover object-top" />
                : opt.card.kind === "pal"
                ? <PalCard c={opt.card} />
                : <MockCard c={opt.card} />}
            </div>
            <div className="p-3 text-sm font-semibold text-neutral-800 group-hover:text-emerald-700 dark:text-neutral-200 dark:group-hover:text-emerald-400">{opt.label}</div>
          </button>
        ))}
      </div>
      {step > 0 && (
        <button onClick={() => setStep((s) => s - 1)} className="mt-5 text-xs text-neutral-400 underline hover:text-neutral-600 dark:hover:text-neutral-300">Back one step</button>
      )}
    </div>
  );
}
