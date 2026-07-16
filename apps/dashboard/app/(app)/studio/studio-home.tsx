"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Sparkles, LayoutTemplate, Home as HomeIcon, ArrowLeft, ChevronRight, ImageIcon, Loader2 } from "lucide-react";
import { EditableWizard } from "./editable-wizard";
import { StudioWizard } from "./studio-wizard";
import { SmartStudio } from "./smart-studio";
import { editableGalleryAction, editablePreviewAction } from "./wizard-actions";

type LibraryItem = {
  id: string; image_url: string; generation_type: string;
  content_type: string | null; created_at: string; section?: string | null;
};
type Quota = { used?: number; quota?: number | null; remaining?: number | null; plan_tier?: string; unlimited?: boolean } | null;
type GalleryItem = {
  template_id: string; number?: number; property_id: string; property_title: string | null;
  photos: string[]; brand: { navy: string; gold: string; cream: string; text: string };
  colour_overrides: Record<string, string>;
};

// ── helpers ───────────────────────────────────────────────────────────────────
const TYPE_LABEL: Record<string, string> = {
  social_post: "Social post", ad_creative: "Ad creative", renovation: "Redesigned room",
  listing: "Listing image", sold: "Just sold", brand: "Brand", educational: "Educational",
  launch: "New development", template: "Template",
};
function labelFor(it: LibraryItem): string {
  return TYPE_LABEL[it.content_type ?? ""] ?? TYPE_LABEL[it.generation_type] ?? "Creation";
}
function ago(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return `${d}d ago`;
}

function EntryCard({
  icon, tint, title, desc, recommended, onClick,
}: { icon: React.ReactNode; tint: string; title: string; desc: string; recommended?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="group flex flex-col rounded-2xl border border-neutral-200 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-4 flex items-start justify-between">
        <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${tint}`}>{icon}</span>
        {recommended && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Recommended</span>}
      </div>
      <div className="mb-1 text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</div>
      <div className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">{desc}</div>
      <ChevronRight className="mt-4 h-4 w-4 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-neutral-500" />
    </button>
  );
}

export function StudioHome({ initialLibrary, quota }: { initialLibrary: LibraryItem[]; quota: Quota }) {
  const [view, setView] = useState<"home" | "templates" | "smart" | "renovation">("home");

  // live templates showcase — the real gallery plan (top listings, neutral + shifting accent), rendered cached
  const [showcase, setShowcase] = useState<GalleryItem[]>([]);
  const [shots, setShots] = useState<Record<string, string | null | undefined>>({});

  useEffect(() => {
    if (view !== "home") return;
    let cancelled = false;
    (async () => {
      const res = await editableGalleryAction();
      if (cancelled || !res.ok || !Array.isArray(res.templates)) return;
      const items = (res.templates as GalleryItem[]).slice(0, 4);
      setShowcase(items);
      setShots(Object.fromEntries(items.map((t) => [t.template_id, undefined])));
      for (const item of items) {
        const r = await editablePreviewAction({
          template_id: item.template_id, property_id: item.property_id,
          photos: item.photos, brand: item.brand, colour_overrides: item.colour_overrides,
        });
        if (cancelled) return;
        setShots((p) => ({ ...p, [item.template_id]: r.ok ? (r.image_url as string) : null }));
      }
    })();
    return () => { cancelled = true; };
  }, [view]);

  // ── one sectioned library (Recent + Library merged, grouped by your sections) ──
  const sections = useMemo(() => {
    const s = new Set<string>();
    for (const it of initialLibrary) if (it.section) s.add(it.section);
    return [...s].sort();
  }, [initialLibrary]);
  const [activeSection, setActiveSection] = useState<string>("all");
  const libraryItems = useMemo(() => {
    if (activeSection === "all") return initialLibrary;
    if (activeSection === "__unfiled") return initialLibrary.filter((i) => !i.section);
    return initialLibrary.filter((i) => i.section === activeSection);
  }, [initialLibrary, activeSection]);

  const renovations = useMemo(() => initialLibrary.filter((i) => i.generation_type === "renovation").slice(0, 3), [initialLibrary]);

  if (view === "templates") {
    return (
      <div>
        <div className="mx-auto max-w-6xl px-4 pt-6">
          <button onClick={() => setView("home")} className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"><ArrowLeft className="h-4 w-4" /> Studio home</button>
        </div>
        <EditableWizard />
      </div>
    );
  }
  // Smart is the ONE place AI designs the whole post itself (layout + text, full creative freedom).
  if (view === "smart") {
    return (
      <div>
        <div className="mx-auto max-w-6xl px-4 pt-6">
          <button onClick={() => setView("home")} className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"><ArrowLeft className="h-4 w-4" /> Studio home</button>
        </div>
        <SmartStudio />
      </div>
    );
  }
  if (view === "renovation") {
    return (
      <div>
        <div className="mx-auto max-w-6xl px-4 pt-6">
          <button onClick={() => setView("home")} className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"><ArrowLeft className="h-4 w-4" /> Studio home</button>
        </div>
        <StudioWizard initialLibrary={initialLibrary} initialFork="renovation" />
      </div>
    );
  }

  const unlimited = quota?.unlimited || quota?.plan_tier === "unlimited";
  const used = quota?.used ?? 0;
  const limit = quota?.quota ?? null;
  const pct = unlimited || !limit ? 100 : Math.min(100, Math.round((used / limit) * 100));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">What would you like to create today?</h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Three ways to make something — or browse your templates below.</p>

      {/* ways to create + credits */}
      <div className="mt-5 grid gap-4 lg:grid-cols-4">
        <EntryCard recommended tint="bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300"
          icon={<LayoutTemplate className="h-6 w-6" />} title="Templates"
          desc="Start from a proven template and edit the text, colours and layout yourself." onClick={() => setView("templates")} />
        <EntryCard tint="bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300"
          icon={<Sparkles className="h-6 w-6" />} title="Smart"
          desc="Pick a property and photos — AIVENA designs the whole post itself." onClick={() => setView("smart")} />
        <EntryCard tint="bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300"
          icon={<HomeIcon className="h-6 w-6" />} title="Renovation"
          desc="Upload or pick a room, choose the style — AIVENA redesigns the space." onClick={() => setView("renovation")} />

        <div className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-400">Credits</div>
          <div className="mt-1 text-3xl font-semibold text-neutral-900 dark:text-neutral-100">
            {unlimited ? "Unlimited" : <>{Math.max(0, (limit ?? 0) - used)}<span className="text-lg text-neutral-400"> / {limit ?? 0}</span></>}
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            <div className={`h-full rounded-full ${unlimited ? "bg-emerald-500" : pct > 85 ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${unlimited ? 100 : Math.max(4, 100 - pct)}%` }} />
          </div>
          <div className="mt-2 text-xs capitalize text-neutral-400">{quota?.plan_tier ? `${quota.plan_tier} plan` : "Resets monthly"}</div>
          <Link href="/settings" className="mt-auto rounded-lg border border-neutral-300 px-3 py-2 text-center text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200">Manage plan</Link>
        </div>
      </div>

      {/* templates showcase — your real templates on your best listings */}
      <div className="mt-9 flex items-end justify-between">
        <div>
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">Your templates, on your best listings</h3>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Shown in a neutral style — pick one to customise in your colours.</p>
        </div>
        <button onClick={() => setView("templates")} className="text-sm font-medium text-emerald-600 hover:underline">Browse all →</button>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2 sm:gap-4">
        {showcase.length === 0
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex aspect-[4/5] items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-300 dark:border-neutral-800 dark:bg-neutral-900">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ))
          : showcase.map((t) => (
              <button key={t.template_id} onClick={() => setView("templates")}
                className="group overflow-hidden rounded-xl border border-neutral-200 bg-white transition hover:-translate-y-0.5 hover:border-neutral-900 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900">
                <div className="aspect-[4/5] bg-neutral-100 dark:bg-neutral-800">
                  {shots[t.template_id] === undefined ? (
                    <div className="flex h-full items-center justify-center text-neutral-300"><Loader2 className="h-5 w-5 animate-spin" /></div>
                  ) : shots[t.template_id] ? (
                    <img src={shots[t.template_id]!} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-neutral-400">preview unavailable</div>
                  )}
                </div>
                <div className="flex items-center justify-between p-2 text-xs">
                  <span className="font-medium text-neutral-600 dark:text-neutral-300">Template {t.number ?? t.template_id}</span>
                  <span className="truncate pl-2 text-neutral-400">{t.property_title ?? ""}</span>
                </div>
              </button>
            ))}
      </div>

      {/* renovation showcase — real renovations you've made, or how it works */}
      <div className="mt-9 flex items-end justify-between">
        <div>
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">Redesign a room</h3>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Upload or pick a room, choose the style — AIVENA restyles the space.</p>
        </div>
        <button onClick={() => setView("renovation")} className="text-sm font-medium text-emerald-600 hover:underline">Try renovation →</button>
      </div>
      {renovations.length > 0 ? (
        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
          {renovations.map((r) => (
            <button key={r.id} onClick={() => setView("renovation")} className="overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition hover:-translate-y-0.5 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900">
              <div className="aspect-video bg-neutral-100 dark:bg-neutral-800">
                {r.image_url ? <img src={r.image_url} alt="" className="h-full w-full object-cover" /> : null}
              </div>
              <div className="flex items-center justify-between p-2.5 text-xs">
                <span className="font-medium text-neutral-700 dark:text-neutral-300">Redesigned room</span>
                <span className="text-neutral-400">{ago(r.created_at)}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <button onClick={() => setView("renovation")}
          className="mt-4 flex w-full items-center gap-4 rounded-2xl border border-dashed border-neutral-300 bg-white p-5 text-left transition hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300"><HomeIcon className="h-6 w-6" /></span>
          <span className="text-sm text-neutral-600 dark:text-neutral-400">
            <span className="block font-semibold text-neutral-900 dark:text-neutral-100">You haven&apos;t redesigned a room yet</span>
            Upload a room photo or pick one from a listing, choose the style, amount of furniture, lighting and colours — and AIVENA restyles it.
          </span>
        </button>
      )}

      {/* one library — grouped by your sections */}
      <div className="mt-9 rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h3 className="mr-2 font-semibold text-neutral-900 dark:text-neutral-100">Your library</h3>
          {[{ k: "all", l: "All" }, ...sections.map((s) => ({ k: s, l: s })), ...(initialLibrary.some((i) => !i.section) && sections.length ? [{ k: "__unfiled", l: "Unfiled" }] : [])].map((t) => (
            <button key={t.k} onClick={() => setActiveSection(t.k)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${activeSection === t.k ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900" : "border-neutral-200 text-neutral-500 hover:text-neutral-900 dark:border-neutral-700"}`}>
              {t.l}
            </button>
          ))}
          <span className="ml-auto text-xs text-neutral-400">{libraryItems.length} item{libraryItems.length === 1 ? "" : "s"}</span>
        </div>

        {libraryItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-sm text-neutral-400">
            <ImageIcon className="h-8 w-8" />
            {initialLibrary.length === 0 ? "Nothing yet — create your first post and it'll show up here." : "Nothing filed under this section yet."}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-5">
            {libraryItems.map((it) => (
              <div key={it.id} className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
                <div className="relative aspect-[4/5] bg-neutral-100 dark:bg-neutral-800">
                  {it.image_url ? <img src={it.image_url} alt="" className="h-full w-full object-cover" /> : null}
                  {it.section && <span className="absolute right-2 top-2 max-w-[80%] truncate rounded-md bg-white/90 px-2 py-0.5 text-[11px] font-medium text-neutral-700 shadow">{it.section}</span>}
                </div>
                <div className="p-2.5">
                  <div className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">{labelFor(it)}</div>
                  <div className="text-xs text-neutral-400">{ago(it.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
