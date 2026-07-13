"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles, Wand2, LayoutTemplate, ArrowLeft, ChevronRight, MoreHorizontal, ImageIcon } from "lucide-react";
import { EditableWizard } from "./editable-wizard";
import { StudioWizard } from "./studio-wizard";

type LibraryItem = {
  id: string; image_url: string; generation_type: string;
  content_type: string | null; created_at: string;
};
type Quota = { used?: number; quota?: number | null; remaining?: number | null; plan_tier?: string; unlimited?: boolean } | null;

// ── helpers ───────────────────────────────────────────────────────────────────
const TYPE_LABEL: Record<string, string> = {
  social_post: "Social post", ad_creative: "Ad creative", renovation: "Renovation",
  listing: "Listing image", sold: "Just sold", brand: "Brand", educational: "Educational", launch: "New development",
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

// ── entry cards ───────────────────────────────────────────────────────────────
function EntryCard({
  icon, tint, title, desc, recommended, onClick,
}: { icon: React.ReactNode; tint: string; title: string; desc: string; recommended?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="group flex flex-col rounded-2xl border border-neutral-200 bg-white p-5 text-left transition hover:border-neutral-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900">
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
  const [view, setView] = useState<"home" | "templates" | "wizard" | "smart">("home");

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
  if (view === "wizard" || view === "smart") {
    return (
      <div>
        <div className="mx-auto max-w-6xl px-4 pt-6">
          <button onClick={() => setView("home")} className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"><ArrowLeft className="h-4 w-4" /> Studio home</button>
        </div>
        <StudioWizard initialLibrary={initialLibrary} initialFork={view} />
      </div>
    );
  }

  const recent = initialLibrary.slice(0, 4);
  const unlimited = quota?.unlimited || quota?.plan_tier === "unlimited";
  const used = quota?.used ?? 0;
  const limit = quota?.quota ?? null;
  const pct = unlimited || !limit ? 100 : Math.min(100, Math.round((used / limit) * 100));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">What would you like to create today?</h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Choose a way to get started or browse templates.</p>

      {/* entry cards + credits */}
      <div className="mt-5 grid gap-4 lg:grid-cols-4">
        <EntryCard recommended tint="bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300"
          icon={<Wand2 className="h-6 w-6" />} title="Wizard"
          desc="Pick a property, choose the look by sight and fine-tune every detail." onClick={() => setView("wizard")} />
        <EntryCard tint="bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300"
          icon={<Sparkles className="h-6 w-6" />} title="Smart"
          desc="One tap — pick a property and a photo and AIVENA makes the post." onClick={() => setView("smart")} />
        <EntryCard tint="bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300"
          icon={<LayoutTemplate className="h-6 w-6" />} title="Templates"
          desc="Start from a proven template and edit the text and colours yourself." onClick={() => setView("templates")} />

        {/* credits */}
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

      {/* recent creations */}
      <div className="mt-8 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">Recent creations</h3>
          {recent.length > 0 && <button onClick={() => setView("wizard")} className="text-sm font-medium text-emerald-600 hover:underline">Open Studio</button>}
        </div>
        {recent.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-neutral-400">
            <ImageIcon className="h-8 w-8" />
            Nothing yet — create your first post and it'll show up here.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {recent.map((it) => (
              <div key={it.id} className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
                <div className="relative aspect-video bg-neutral-100 dark:bg-neutral-800">
                  {it.image_url ? <img src={it.image_url} alt="" className="h-full w-full object-cover" /> : null}
                  <span className="absolute right-2 top-2 rounded-md bg-white/90 px-2 py-0.5 text-[11px] font-medium text-neutral-700 shadow">{labelFor(it)}</span>
                </div>
                <div className="flex items-center justify-between p-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">{labelFor(it)}</div>
                    <div className="text-xs text-neutral-400">{ago(it.created_at)}</div>
                  </div>
                  <MoreHorizontal className="h-4 w-4 shrink-0 text-neutral-300" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* your library */}
      {initialLibrary.length > 0 && (
        <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">Your library</h3>
            <button onClick={() => setView("wizard")} className="text-sm font-medium text-emerald-600 hover:underline">Open Studio</button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {initialLibrary.slice(0, 8).map((it) => (
              <div key={it.id} className="h-28 w-40 shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-800">
                {it.image_url ? <img src={it.image_url} alt="" className="h-full w-full object-cover" /> : null}
              </div>
            ))}
          </div>
          <div className="mt-2 text-xs text-neutral-400">{initialLibrary.length} item{initialLibrary.length === 1 ? "" : "s"}</div>
        </div>
      )}
    </div>
  );
}
