"use client";

import { useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import { saveStudioPreferencesAction } from "./wizard-actions";

/**
 * FIND YOUR STYLE — the this-or-that taste game.
 *
 * Christian 2026-08-28, after playing it end to end: more fonts and more colours so it feels
 * specific enough to catch a real agency's taste; the specimens must be dramatic and clearly
 * different; at least ten colour palettes; nothing phrased like fashion ("which would you
 * wear" is not a real-estate question); and — the important one — once he has chosen a colour
 * world, the LATER cards must be painted in HIS colours, not in an arbitrary red he never picked.
 *
 * Three acts: TYPE (real engine specimens) → COLOUR (ten palettes, five duels, one champion)
 * → FEEL (their own palette, then real slides from the styles they'd actually generate).
 */

const ex = (p: string) => withBasePath(`/studio/carousel-examples/${p}`);
const tf = (k: string) => withBasePath(`/studio/taste/${k}.png`);

// ── the ten colour worlds ─────────────────────────────────────────────────────
type Palette = { id: string; label: string; main: string; accent: string; base: string; warm: boolean | null };
const PALETTES: Palette[] = [
  { id: "navy-gold", label: "Deep navy & gold", main: "#1a2b4a", accent: "#c8a24b", base: "#f3efe6", warm: false },
  { id: "terracotta", label: "Terracotta & cream", main: "#b3362b", accent: "#d98e5a", base: "#f7f1e3", warm: true },
  { id: "green-brass", label: "Deep green & brass", main: "#1e3a34", accent: "#b98d4f", base: "#f1eee6", warm: false },
  { id: "noche", label: "Ink black & gold", main: "#17181c", accent: "#c8a24b", base: "#efece4", warm: null },
  { id: "indigo-clay", label: "Indigo & burnt clay", main: "#2c4a6b", accent: "#a86b3c", base: "#f2efe8", warm: false },
  { id: "earth-olive", label: "Earth & olive", main: "#4a4238", accent: "#7d8a6a", base: "#f0ede5", warm: true },
  { id: "aegean", label: "Sea blue & sand", main: "#1f5f6b", accent: "#cbb287", base: "#eef2f1", warm: false },
  { id: "plum", label: "Plum & apricot", main: "#4a2d3f", accent: "#d98e5a", base: "#f5eee9", warm: true },
  { id: "cobalt", label: "Cobalt & sun", main: "#1b4b8f", accent: "#e0a92e", base: "#f2f4f7", warm: false },
  { id: "slate-sand", label: "Slate & sand", main: "#3a4145", accent: "#a68d72", base: "#f2f0eb", warm: false },
];
const P = (id: string) => PALETTES.find((p) => p.id === id)!;
const DUELS: [string, string][] = [
  ["navy-gold", "terracotta"],
  ["green-brass", "noche"],
  ["indigo-clay", "earth-olive"],
  ["aegean", "plum"],
  ["cobalt", "slate-sand"],
];
const DUEL_Q = [
  "Which colour world feels more like your agency?",
  "And between these two?",
  "Which of these two?",
  "Two more — which one?",
  "Last pair — which one?",
];

// muted = the same world with the colour taken out of it, so "quiet" is quiet in THEIR palette
function desat(hex: string, amount = 0.6, lift = 0.12): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const grey = 0.299 * r + 0.587 * g + 0.114 * b;
  r = r + (grey - r) * amount; g = g + (grey - g) * amount; b = b + (grey - b) * amount;
  r += (255 - r) * lift; g += (255 - g) * lift; b += (255 - b) * lift;
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

// ── cards ─────────────────────────────────────────────────────────────────────
function PalCard({ p }: { p: Palette }) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden" style={{ background: p.base }}>
      <div className="relative flex-[7] px-5 pt-6" style={{ background: p.main }}>
        <div className="text-[9px] font-medium tracking-[0.24em]" style={{ color: p.accent }}>GUÍA DEL COMPRADOR</div>
        <div className="mt-3 font-serif text-[19px] leading-tight" style={{ color: p.base }}>The coast<br />in winter</div>
        <div className="absolute bottom-5 left-5 h-[3px] w-9" style={{ background: p.accent }} />
      </div>
      <div className="flex flex-[3] items-center gap-2 px-5">
        <span className="rounded-full px-2.5 py-1 text-[9px] font-semibold" style={{ background: p.accent, color: p.main }}>SAVE THIS</span>
        <span className="h-[2px] flex-1" style={{ background: p.accent, opacity: 0.35 }} />
      </div>
    </div>
  );
}

type MockKind = "dark" | "light" | "bold" | "calm" | "rich" | "muted" | "ornate" | "clean";
function Mock({ kind, pal, serif }: { kind: MockKind; pal: Palette; serif: boolean }) {
  const font = serif ? "Georgia, 'Times New Roman', serif" : "Inter, Arial, sans-serif";
  const dark = kind === "dark";
  const soft = kind === "muted";
  const main = soft ? desat(pal.main) : pal.main;
  const accent = soft ? desat(pal.accent) : pal.accent;
  const ground = kind === "rich" ? main : dark ? main : pal.base;
  const ink = kind === "rich" || dark ? pal.base : main;
  const size = kind === "bold" ? 30 : kind === "calm" ? 17 : 21;
  return (
    <div className="relative h-full w-full overflow-hidden px-5 py-6" style={{ background: ground }}>
      {kind === "ornate" && (
        <>
          <div className="pointer-events-none absolute inset-2 border" style={{ borderColor: `${ink}45` }} />
          <div className="pointer-events-none absolute inset-4 border" style={{ borderColor: `${ink}25` }} />
        </>
      )}
      <div className={kind === "ornate" ? "px-3 pt-2" : ""}>
        <div className="text-[9px] font-medium tracking-[0.24em]" style={{ color: accent }}>GUÍA DEL COMPRADOR</div>
        <div className={`mt-${kind === "calm" ? "6" : "3"}`} style={{ color: ink, fontFamily: font, fontSize: size, fontWeight: serif ? 500 : 700, lineHeight: 1.15 }}>
          The coast in winter
        </div>
        <div className="mt-3 h-[3px] w-9" style={{ background: accent }} />
        <div className="mt-3 space-y-1.5">
          <div className="h-1.5 w-11/12 rounded" style={{ background: ink, opacity: 0.25 }} />
          <div className="h-1.5 w-9/12 rounded" style={{ background: ink, opacity: 0.25 }} />
          {kind !== "calm" && <div className="h-1.5 w-10/12 rounded" style={{ background: ink, opacity: 0.25 }} />}
        </div>
      </div>
      <span className="absolute bottom-5 left-5 rounded-full px-2.5 py-1 text-[9px] font-semibold" style={{ background: accent, color: ground }}>SAVE THIS</span>
    </div>
  );
}

// ── the questions ─────────────────────────────────────────────────────────────
type Opt = { v: string; label: string; img?: string; mock?: MockKind };
type Step =
  | { kind: "duo"; key: string; q: string; a: Opt; b: Opt }
  | { kind: "palette"; key: string; q: string; a: string; b: string }
  | { kind: "champion"; q: string };

const TYPE_STEPS: Step[] = [
  { kind: "duo", key: "font", q: "Which headline feels more like you?", a: { v: "serif", label: "Classic serif", img: tf("playfair") }, b: { v: "sans", label: "Modern sans", img: tf("archivo") } },
  { kind: "duo", key: "serif_face", q: "If a serif — romantic or razor-sharp?", a: { v: "playfair", label: "Romantic, high contrast", img: tf("playfair") }, b: { v: "prata", label: "Sharp & modern", img: tf("prata") } },
  { kind: "duo", key: "serif_flavor", q: "And between these two voices?", a: { v: "fraunces", label: "Soft & warm", img: tf("fraunces") }, b: { v: "caslon", label: "Classic editorial", img: tf("caslon") } },
  { kind: "duo", key: "display_face", q: "For big statements — which one?", a: { v: "anton", label: "Heavy poster type", img: tf("anton") }, b: { v: "italiana", label: "Elegant hairline", img: tf("italiana") } },
  { kind: "duo", key: "sans_face", q: "For the small supporting text?", a: { v: "archivo", label: "Grounded & sturdy", img: tf("archivo") }, b: { v: "jost", label: "Geometric & light", img: tf("jost") } },
];

const FEEL_STEPS: Step[] = [
  { kind: "duo", key: "ground", q: "Dark or light backgrounds?", a: { v: "dark", label: "Deep & dramatic", mock: "dark" }, b: { v: "light", label: "Light & open", mock: "light" } },
  { kind: "duo", key: "scale", q: "How loud should the type be?", a: { v: "bold", label: "Big & bold", mock: "bold" }, b: { v: "calm", label: "Calm & airy", mock: "calm" } },
  { kind: "duo", key: "intensity", q: "Full colour or quiet colour?", a: { v: "rich", label: "Rich & saturated", mock: "rich" }, b: { v: "muted", label: "Muted & soft", mock: "muted" } },
  { kind: "duo", key: "devices", q: "Ornamented or clean pages?", a: { v: "ornamented", label: "Frames & details", mock: "ornate" }, b: { v: "clean", label: "Nothing extra", mock: "clean" } },
  { kind: "duo", key: "artwork", q: "Photography or illustration?", a: { v: "photo", label: "Photographic", img: ex("bodegon/1.jpg") }, b: { v: "illustration", label: "Illustrated", img: ex("acuarela/1.jpg") } },
  { kind: "duo", key: "illo", q: "If illustrated — painted or crafted?", a: { v: "painterly", label: "Painted & loose", img: ex("litoral/1.jpg") }, b: { v: "crafted", label: "Crafted objects", img: ex("arcilla/1.jpg") } },
  { kind: "duo", key: "numerals", q: "How should numbers appear?", a: { v: "big", label: "Huge, as decoration", img: ex("cartel/3.jpg") }, b: { v: "small", label: "Small & discreet", img: ex("sereno/4.jpg") } },
  { kind: "duo", key: "mood", q: "What energy fits your agency?", a: { v: "bold", label: "Bold & striking", img: ex("cartel/1.jpg") }, b: { v: "calm", label: "Calm & premium", img: ex("sereno/1.jpg") } },
  { kind: "duo", key: "density", q: "Full pages or lots of air?", a: { v: "decorated", label: "Layered & full", img: ex("tinta/1.jpg") }, b: { v: "minimal", label: "Space to breathe", img: ex("editorial/2.jpg") } },
];

const STEPS: Step[] = [
  ...TYPE_STEPS,
  ...DUELS.map(([a, b], i) => ({ kind: "palette" as const, key: `duel${i}`, q: DUEL_Q[i], a, b })),
  { kind: "champion", q: "Of the five you picked — which is THE one?" },
  ...FEEL_STEPS,
];

const FACE_NAMES: Record<string, string> = {
  playfair: "Playfair", prata: "Prata", fraunces: "Fraunces", caslon: "Libre Caslon",
  anton: "Anton", italiana: "Italiana", archivo: "Archivo", jost: "Jost",
};

export function TasteGame({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [winners, setWinners] = useState<string[]>([]);
  const [champion, setChampion] = useState<string>("");
  const [likes, setLikes] = useState("");
  const [dislikes, setDislikes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const serif = answers.font !== "sans";
  // every card after the colour act is painted in the world they actually chose
  const pal = champion ? P(champion) : winners.length ? P(winners[winners.length - 1]) : PALETTES[0];

  function answer(key: string, v: string) {
    setAnswers((a) => ({ ...a, [key]: v }));
    setStep((s) => s + 1);
  }
  function pickPalette(i: number, id: string) {
    setWinners((w) => { const n = [...w]; n[i] = id; return n; });
    setStep((s) => s + 1);
  }
  function pickChampion(id: string) {
    setChampion(id);
    setStep((s) => s + 1);
  }
  function back() {
    const prev = step - 1;
    if (prev < 0) return;
    const s = STEPS[prev];
    if (s.kind === "champion") setChampion("");
    setStep(prev);
  }

  async function save() {
    setSaving(true); setErr(null);
    const p = champion ? P(champion) : null;
    const payload: Record<string, string> = {
      ...answers,
      ...(p ? {
        palette: p.id, palette_main: p.main, palette_accent: p.accent, palette_base: p.base,
        // keep the older warm/cool signal alive — several carousel styles are matched on it
        ...(p.warm === true ? { accent: "warm" } : p.warm === false ? { accent: "cool" } : {}),
      } : {}),
      // the serif "voice" signal the style matcher uses, derived from the face they picked
      ...(answers.serif_face ? { serif: answers.serif_face === "playfair" ? "display" : "classic" } : {}),
      likes, dislikes,
    };
    const r = await saveStudioPreferencesAction(payload);
    setSaving(false);
    if (!r.ok) { setErr((r.message as string) ?? "Couldn't save your choices — please try again."); return; }
    setSaved(true);
  }

  // ── saved: show them the style they just built ──────────────────────────────
  if (saved) {
    const headFace = serif ? answers.serif_face : answers.display_face;
    const words = [
      serif ? "Serif headlines" : "Sans headlines",
      headFace ? `in ${FACE_NAMES[headFace] ?? headFace}` : "",
      champion ? `· ${P(champion).label.toLowerCase()}` : "",
      answers.scale === "bold" ? "· big and bold" : answers.scale === "calm" ? "· calm and airy" : "",
      answers.artwork === "photo" ? "· photographic artwork" : answers.artwork === "illustration" ? "· illustrated artwork" : "",
    ].filter(Boolean).join(" ");
    return (
      <div className="mx-auto max-w-xl py-12">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600"><Check className="h-6 w-6 text-white" /></div>
        <h2 className="text-center text-2xl font-bold text-neutral-900 dark:text-neutral-100">This is your style</h2>
        <p className="mt-2 text-center text-sm text-neutral-600 dark:text-neutral-400">{words}</p>

        <div className="mt-7 grid grid-cols-2 gap-4">
          {headFace && (
            <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-700">
              <img src={tf(headFace)} alt="" className="w-full" />
              <div className="p-2.5 text-xs font-medium text-neutral-600 dark:text-neutral-300">Your headlines</div>
            </div>
          )}
          {champion && (
            <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-700">
              <div className="aspect-[4/5]"><PalCard p={P(champion)} /></div>
              <div className="p-2.5 text-xs font-medium text-neutral-600 dark:text-neutral-300">Your colours</div>
            </div>
          )}
        </div>

        <ul className="mt-7 space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
          <li>· Your carousel decks are dressed in these fonts and colours.</li>
          <li>· The looks that match your taste are shown first, badged <b>For your taste</b>.</li>
          <li>· The property templates closest to your style are recommended in Templates.</li>
          <li>· Every piece of artwork is briefed around what you chose{dislikes.trim() ? " — and avoids what you said to avoid" : ""}.</li>
        </ul>
        <button onClick={onDone} className="mt-8 w-full rounded-xl bg-emerald-600 px-6 py-3.5 text-sm font-semibold text-white hover:bg-emerald-700">Back to Studio</button>
      </div>
    );
  }

  // ── the two free-text lines ─────────────────────────────────────────────────
  if (step >= STEPS.length) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">Almost done — anything in your own words?</h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Both optional. The Studio will respect them in every design.</p>
        <label className="mt-6 block text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Things you love</label>
        <input value={likes} onChange={(e) => setLikes(e.target.value)} maxLength={300} placeholder="e.g. bougainvillea, sunset light, hand-drawn feel"
          className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100" />
        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Things to avoid</label>
        <input value={dislikes} onChange={(e) => setDislikes(e.target.value)} maxLength={300} placeholder="e.g. palm trees, anything cluttered"
          className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100" />
        {err && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
        <button onClick={() => void save()} disabled={saving}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Save my style
        </button>
        <button onClick={back} className="mt-4 w-full text-xs text-neutral-400 underline hover:text-neutral-600 dark:hover:text-neutral-300">Back one step</button>
      </div>
    );
  }

  const s = STEPS[step];
  const shell = (title: string, sub: string, body: React.ReactNode) => (
    <div className="mx-auto max-w-2xl py-8">
      <div className="mb-1 text-xs font-medium tracking-wide text-neutral-400">{step + 1} / {STEPS.length}</div>
      <div className="mb-5 flex gap-1">
        {STEPS.map((_, i) => <span key={i} className={`h-1 flex-1 rounded-full ${i < step ? "bg-emerald-500" : i === step ? "bg-emerald-300" : "bg-neutral-200 dark:bg-neutral-800"}`} />)}
      </div>
      <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{title}</h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{sub}</p>
      {body}
      {step > 0 && (
        <button onClick={back} className="mt-5 text-xs text-neutral-400 underline hover:text-neutral-600 dark:hover:text-neutral-300">Back one step</button>
      )}
    </div>
  );

  const card = "group overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition hover:-translate-y-0.5 hover:border-emerald-600 hover:shadow-md dark:border-neutral-700 dark:bg-neutral-900";
  const cardLabel = "p-3 text-sm font-semibold text-neutral-800 group-hover:text-emerald-700 dark:text-neutral-200 dark:group-hover:text-emerald-400";

  if (s.kind === "champion") {
    const picks = [...new Set(winners.filter(Boolean))];
    return shell(s.q, "Your favourite decides the colours your posts are dressed in.", (
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {picks.map((id) => (
          <button key={id} onClick={() => pickChampion(id)} className={card}>
            <div className="aspect-[4/5]"><PalCard p={P(id)} /></div>
            <div className={cardLabel}>{P(id).label}</div>
          </button>
        ))}
      </div>
    ));
  }

  if (s.kind === "palette") {
    const i = Number(s.key.replace("duel", ""));
    return shell(s.q, "Tap the one that feels right — first instinct wins.", (
      <div className="mt-6 grid grid-cols-2 gap-4">
        {[s.a, s.b].map((id) => (
          <button key={id} onClick={() => pickPalette(i, id)} className={card}>
            <div className="aspect-[4/5]"><PalCard p={P(id)} /></div>
            <div className={cardLabel}>{P(id).label}</div>
          </button>
        ))}
      </div>
    ));
  }

  const usesMock = !!(s.a.mock || s.b.mock);
  return shell(s.q, usesMock ? "Shown in the colours you chose — first instinct wins." : "Tap the one that feels right — first instinct wins.", (
    <div className="mt-6 grid grid-cols-2 gap-4">
      {[s.a, s.b].map((opt) => (
        <button key={opt.v} onClick={() => answer(s.key, opt.v)} className={card}>
          <div className="aspect-[4/5]">
            {opt.img
              ? <img src={opt.img} alt={opt.label} className="h-full w-full object-cover object-top" />
              : <Mock kind={opt.mock!} pal={pal} serif={serif} />}
          </div>
          <div className={cardLabel}>{opt.label}</div>
        </button>
      ))}
    </div>
  ));
}
