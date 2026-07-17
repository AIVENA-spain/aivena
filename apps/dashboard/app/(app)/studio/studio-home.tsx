"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Download, ExternalLink, FolderOpen, Hammer, Home as HomeIcon,
  ImageIcon, MoreVertical, Palette, Sparkles, SquarePen,
} from "lucide-react";
import { EditableWizard } from "./editable-wizard";
import { StudioWizard } from "./studio-wizard";
import { SmartStudio } from "./smart-studio";
import { CarouselStudio } from "./carousel-studio";
import { downloadImage } from "./property-picker";

type LibraryItem = {
  id: string; image_url: string; generation_type: string;
  content_type: string | null; created_at: string; section?: string | null;
};
type Quota = { used?: number; quota?: number | null; remaining?: number | null; plan_tier?: string; unlimited?: boolean } | null;
type View = "home" | "templates" | "smart" | "renovation" | "carousel" | "library";

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
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d === 1) return "yesterday";
  return `${d} days ago`;
}

// ── the "Studio home" back-link shell used by every sub-view ───────────────────
function SubViewShell({ onBack, crumb, children }: { onBack: () => void; crumb?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mx-auto flex max-w-[1600px] items-center gap-1.5 px-6 pt-6 text-sm text-neutral-500 lg:px-8">
        <button onClick={onBack} className="flex items-center gap-1.5 hover:text-neutral-900 dark:hover:text-neutral-100"><ArrowLeft className="h-4 w-4" /> Studio home</button>
        {crumb && <><span className="text-neutral-300 dark:text-neutral-600">/</span><span className="text-neutral-700 dark:text-neutral-300">{crumb}</span></>}
      </div>
      {children}
    </div>
  );
}

// ── section header with a right-side link ──────────────────────────────────────
function SectionHead({ title, link, onLink }: { title: string; link: string; onLink: () => void }) {
  return (
    <div className="mb-4 mt-10 flex items-center justify-between">
      <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
      <button onClick={onLink} className="flex items-center gap-1 text-sm font-medium text-emerald-600 hover:underline dark:text-emerald-400">
        {link} <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── the three big entry cards ──────────────────────────────────────────────────
function HeroCard({ img, icon, tint, title, desc, onClick }: {
  img: string; icon: React.ReactNode; tint: string; title: string; desc: string; onClick: () => void;
}) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white transition hover:-translate-y-0.5 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900">
      <div className="aspect-[16/9] w-full overflow-hidden bg-neutral-100 dark:bg-neutral-800">
        <img src={img} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
      </div>
      <div className="relative flex flex-1 flex-col p-5">
        <span className={`absolute -top-6 left-5 flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-neutral-100 dark:bg-neutral-900 dark:ring-neutral-800 ${tint}`}>{icon}</span>
        <div className="mt-5 text-[17px] font-semibold text-neutral-900 dark:text-neutral-100">{title}</div>
        <div className="mt-1 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">{desc}</div>
        <button onClick={onClick}
          className="mt-4 inline-flex items-center gap-1.5 self-start rounded-lg border border-neutral-200 px-3.5 py-2 text-sm font-medium text-emerald-700 transition hover:border-emerald-600 dark:border-neutral-700 dark:text-emerald-400">
          Start <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── a "suggested for today" card ───────────────────────────────────────────────
function SuggestCard({ img, icon, title, sub, cta, onClick }: {
  img: string; icon: React.ReactNode; title: string; sub: string; cta: string; onClick: () => void;
}) {
  return (
    <div className="relative flex gap-3 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <img src={img} alt="" className="h-[72px] w-[72px] shrink-0 rounded-lg object-cover" />
      <div className="min-w-0 flex-1 pr-5">
        <div className="line-clamp-2 text-sm font-semibold leading-snug text-neutral-900 dark:text-neutral-100">{title}</div>
        <div className="mt-0.5 text-xs text-neutral-400">{sub}</div>
        <button onClick={onClick}
          className="mt-2 inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-emerald-700 transition hover:border-emerald-600 dark:border-neutral-700 dark:text-emerald-400">
          {cta} <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <span className="absolute right-3 top-3 text-neutral-300 dark:text-neutral-600">{icon}</span>
    </div>
  );
}

// ── a "choose a style" card ────────────────────────────────────────────────────
function StyleCard({ img, name, desc, swatches, onClick }: {
  img: string; name: string; desc: string; swatches: string[]; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="flex gap-4 rounded-xl border border-neutral-200 bg-white p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900">
      <div className="shrink-0">
        <img src={img} alt="" className="h-[86px] w-[120px] rounded-lg object-cover" />
        <div className="mt-2 flex gap-1.5">
          {swatches.map((c, i) => <span key={i} className="h-4 w-4 rounded ring-1 ring-black/5" style={{ background: c }} />)}
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{name}</div>
        <div className="mt-1 text-xs leading-snug text-neutral-500 dark:text-neutral-400">{desc}</div>
      </div>
    </button>
  );
}

export function StudioHome({
  initialLibrary, quota: _quota, firstName, agencyName, greeting,
}: {
  initialLibrary: LibraryItem[]; quota: Quota; firstName: string; agencyName: string; greeting: string;
}) {
  const [view, setView] = useState<View>("home");
  const [menuId, setMenuId] = useState<string | null>(null);

  // ── the full library grid (its own sub-view), grouped by your sections ──
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

  if (view === "templates") return <SubViewShell onBack={() => setView("home")}><EditableWizard /></SubViewShell>;
  if (view === "smart") return <SubViewShell onBack={() => setView("home")}><SmartStudio /></SubViewShell>;
  if (view === "carousel") return <SubViewShell onBack={() => setView("home")} crumb="Tips carousel"><CarouselStudio /></SubViewShell>;
  if (view === "renovation") return <SubViewShell onBack={() => setView("home")}><StudioWizard initialLibrary={initialLibrary} initialFork="renovation" /></SubViewShell>;

  if (view === "library") {
    return (
      <SubViewShell onBack={() => setView("home")} crumb="Library">
        <div className="mx-auto max-w-6xl px-6 py-6 lg:px-8">
          <div className="rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
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
      </SubViewShell>
    );
  }

  // ── HOME ──────────────────────────────────────────────────────────────────────
  const recent = initialLibrary.slice(0, 4);

  const STYLES: { img: string; name: string; desc: string; swatches: string[] }[] = [
    { img: "/studio/style-minimal.jpg", name: "Minimal Luxury", desc: "Clean, elegant and high-end aesthetic.", swatches: ["#F2EEE6", "#C9B79C", "#6B6B6B", "#1A1A1A"] },
    { img: "/studio/style-mediterranean.jpg", name: "Mediterranean Editorial", desc: "Warm, natural and timeless storytelling.", swatches: ["#D8C3A5", "#8A9A7B", "#2D6E8E", "#B5623C"] },
    { img: "/studio/style-poster.jpg", name: "Bold Spanish Poster", desc: "Strong typography and vibrant Mediterranean energy.", swatches: ["#E07A3E", "#F4E9D8", "#14294B", "#1A1A1A"] },
    { img: "/studio/style-brochure.jpg", name: "Clean Property Brochure", desc: "Refined layouts for listings and brochures.", swatches: ["#B8BFC2", "#D8C3A5", "#4A6B4E", "#14294B"] },
  ];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 lg:px-8" onClick={() => menuId && setMenuId(null)}>
      {/* ── header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight text-neutral-900 dark:text-neutral-100">Studio</h1>
          <p className="mt-1 text-[15px] text-neutral-500 dark:text-neutral-400">Create beautiful real estate content for your agency.</p>
          <p className="mt-1 text-sm text-neutral-400">
            {greeting}, {firstName || "there"} 👋{agencyName ? ` — ${agencyName}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/settings" className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 transition hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
            <Palette className="h-4 w-4" /> Brand kit
          </Link>
          <button onClick={() => setView("library")} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 transition hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
            <FolderOpen className="h-4 w-4" /> View library
          </button>
        </div>
      </div>

      {/* ── three entry cards ── */}
      <div className="mt-8 grid gap-5 md:grid-cols-3">
        <HeroCard img="/studio/hero-property.jpg" tint="text-emerald-600 dark:text-emerald-400"
          icon={<HomeIcon className="h-5 w-5" />} title="Create from a property"
          desc="Turn a listing into posts, carousels and brochures." onClick={() => setView("templates")} />
        <HeroCard img="/studio/hero-advice.jpg" tint="text-violet-600 dark:text-violet-400"
          icon={<SquarePen className="h-5 w-5" />} title="Create advice content"
          desc="Generate buyer tips, seller advice and market posts." onClick={() => setView("carousel")} />
        <HeroCard img="/studio/hero-room.jpg" tint="text-amber-600 dark:text-amber-400"
          icon={<Hammer className="h-5 w-5" />} title="Transform a room"
          desc="Create renovation concepts and before/after content." onClick={() => setView("renovation")} />
      </div>

      {/* ── suggested for today ── */}
      <SectionHead title="Suggested for today" link="View all suggestions" onLink={() => setView("templates")} />
      <div className="grid gap-4 md:grid-cols-3">
        <SuggestCard img="/studio/style-poster.jpg" icon={<Sparkles className="h-4 w-4" />}
          title="5 buyer mistakes on the Costa Blanca" sub="Carousel · Spanish · 5 slides" cta="Create carousel" onClick={() => setView("carousel")} />
        <SuggestCard img="/studio/hero-property.jpg" icon={<HomeIcon className="h-4 w-4" />}
          title="Turn a listing into a luxury post" sub="Listing post" cta="Create post" onClick={() => setView("smart")} />
        <SuggestCard img="/studio/hero-room.jpg" icon={<Hammer className="h-4 w-4" />}
          title="Kitchen before/after inspiration" sub="Renovation" cta="Create concept" onClick={() => setView("renovation")} />
      </div>

      {/* ── choose a style ── */}
      <SectionHead title="Choose a style" link="Browse all styles" onLink={() => setView("templates")} />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {STYLES.map((s) => <StyleCard key={s.name} {...s} onClick={() => setView("templates")} />)}
      </div>

      {/* ── recent work ── */}
      <SectionHead title="Recent work" link="View all" onLink={() => setView("library")} />
      {recent.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 py-14 text-center text-sm text-neutral-400 dark:border-neutral-700">
          <ImageIcon className="h-7 w-7" />
          Nothing yet — create your first post and it&rsquo;ll show up here.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {recent.map((it) => (
            <div key={it.id} className="relative flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800">
                {it.image_url ? <img src={it.image_url} alt="" className="h-full w-full object-cover" /> : null}
              </div>
              <div className="min-w-0 flex-1 pr-5">
                <div className="line-clamp-2 text-sm font-semibold leading-snug text-neutral-900 dark:text-neutral-100">{labelFor(it)}</div>
                <div className="mt-0.5 text-xs text-neutral-400">Edited {ago(it.created_at)}</div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); setMenuId(menuId === it.id ? null : it.id); }}
                className="absolute right-2 top-2 rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800">
                <MoreVertical className="h-4 w-4" />
              </button>
              {menuId === it.id && (
                <div className="absolute right-2 top-9 z-10 w-40 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => { window.open(it.image_url, "_blank", "noopener"); setMenuId(null); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-800">
                    <ExternalLink className="h-4 w-4" /> Open image
                  </button>
                  <button onClick={() => { void downloadImage(it.image_url, `${labelFor(it).toLowerCase().replace(/\s+/g, "-")}.png`); setMenuId(null); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-800">
                    <Download className="h-4 w-4" /> Download
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
