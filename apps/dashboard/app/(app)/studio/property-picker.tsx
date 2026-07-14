"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import { propertiesAction, propertyPhotosAction } from "./wizard-actions";

/**
 * The ONE property picker, used by every Studio mode (Templates, Smart, Renovation).
 *
 * Christian 2026-07-14: "when you choose a property there needs to be a place to search or filter, and when you
 * select a property the images needs to pop up right there on the screen, no scrolling to the botton to select.
 * it should be like this in EVERY different mode."
 *
 * So: search by area/title + a bedrooms filter, every card shows beds · baths · area, and tapping a property
 * opens its photos in a modal right where you are — never a jump to the bottom of the page.
 */

export type PickerProperty = {
  id: string; title: string; location_city: string | null;
  price: number | null; bedrooms: number | null; bathrooms: number | null;
  area: number | null; photo_count: number; thumb_url: string | null;
};

const money = (n: number | null) => (n == null ? "" : "€" + n.toLocaleString("es-ES"));
// a missing fact is hidden, never invented (data-honesty law)
const specsOf = (p: PickerProperty) =>
  [p.bedrooms != null ? `${p.bedrooms} bed` : null,
   p.bathrooms != null ? `${p.bathrooms} bath` : null,
   p.area != null ? `${p.area} m²` : null].filter(Boolean).join(" · ");

const BED_FILTERS = [0, 1, 2, 3, 4];

export function PropertyPicker({
  multi = true,
  minPhotos = 1,
  onConfirm,
}: {
  /** multi=false → picking one photo (renovation): the modal confirms on the first tap. */
  multi?: boolean;
  /** hide properties with fewer usable photos than this */
  minPhotos?: number;
  onConfirm: (property: PickerProperty, photos: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [beds, setBeds] = useState(0);
  const [items, setItems] = useState<PickerProperty[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalProp, setModalProp] = useState<PickerProperty | null>(null);
  const [modalPhotos, setModalPhotos] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  const runSearch = useCallback(async (q: string) => {
    setLoading(true);
    const res = await propertiesAction(q);
    setItems(res.ok && Array.isArray(res.items) ? (res.items as PickerProperty[]) : []);
    setLoading(false);
  }, []);
  useEffect(() => { void runSearch(""); }, [runSearch]);
  useEffect(() => {
    const t = setTimeout(() => void runSearch(query), 300);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  // Only listings we can actually use: enough photos (dead portal hotlinks are already filtered server-side).
  const shown = useMemo(
    () => items.filter((p) => p.photo_count >= minPhotos && (beds === 0 || (p.bedrooms ?? 0) >= beds)),
    [items, minPhotos, beds],
  );

  async function open(p: PickerProperty) {
    setModalProp(p); setChosen([]); setModalPhotos([]); setLoadingPhotos(true);
    const res = await propertyPhotosAction(p.id);
    setModalPhotos(res.ok && Array.isArray(res.photos) ? (res.photos as string[]) : []);
    setLoadingPhotos(false);
  }
  function toggle(u: string) {
    if (!multi) { if (modalProp) { onConfirm(modalProp, [u]); setModalProp(null); } return; }
    setChosen((c) => (c.includes(u) ? c.filter((x) => x !== u) : [...c, u]));
  }
  function confirm() {
    if (!modalProp || chosen.length === 0) return;
    onConfirm(modalProp, chosen);
    setModalProp(null);
  }

  return (
    <div>
      {/* search + filter */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a property or area (e.g. Torrevieja)"
            className="w-full rounded-lg border border-neutral-300 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-neutral-900" />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1">
          {BED_FILTERS.map((b) => (
            <button key={b} onClick={() => setBeds(b)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${beds === b ? "bg-neutral-900 text-white" : "text-neutral-500 hover:text-neutral-900"}`}>
              {b === 0 ? "Any beds" : `${b}+`}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-16 text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading properties…</div>
      ) : shown.length === 0 ? (
        <div className="py-16 text-center text-sm text-neutral-500">
          No properties found{query ? ` for “${query}”` : ""}{beds ? ` with ${beds}+ bedrooms` : ""}
          {minPhotos > 1 ? ` that have ${minPhotos}+ usable photos` : ""}.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((p) => (
            <button key={p.id} onClick={() => open(p)}
              className="group overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition hover:-translate-y-0.5 hover:border-neutral-900 hover:shadow-md">
              <div className="aspect-[4/3] bg-neutral-100">
                {p.thumb_url ? <img src={p.thumb_url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : null}
              </div>
              <div className="p-2.5">
                <div className="truncate text-sm font-medium text-neutral-900">{p.title || "Untitled"}</div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-neutral-500">
                  <span className="truncate">{p.location_city || "—"}</span>
                  <span className="shrink-0 font-medium text-neutral-700">{money(p.price)}</span>
                </div>
                {specsOf(p) && <div className="mt-1 truncate text-[11px] font-medium text-neutral-600">{specsOf(p)}</div>}
                <div className="mt-0.5 text-[11px] text-neutral-400">{p.photo_count} photo{p.photo_count === 1 ? "" : "s"}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* photos pop up RIGHT HERE — never a scroll to the bottom */}
      {modalProp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModalProp(null)}>
          <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-neutral-900">{modalProp.title || "Property"}</div>
                <div className="text-xs text-neutral-500">
                  {specsOf(modalProp) ? `${specsOf(modalProp)} · ` : ""}{multi ? "Choose one or more photos" : "Choose a room photo"}
                </div>
              </div>
              <button onClick={() => setModalProp(null)} className="rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-4">
              {loadingPhotos ? (
                <div className="flex items-center gap-2 py-12 text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading photos…</div>
              ) : modalPhotos.length === 0 ? (
                <div className="py-12 text-center text-sm text-neutral-500">This property has no usable photos.</div>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {modalPhotos.map((u) => {
                    const on = chosen.includes(u);
                    return (
                      <button key={u} onClick={() => toggle(u)}
                        className={`relative aspect-square overflow-hidden rounded-lg border-2 transition ${on ? "border-neutral-900" : "border-transparent hover:border-neutral-300"}`}>
                        <img src={u} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                        {on && <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-white"><Check className="h-3 w-3" /></span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {multi && (
              <div className="flex items-center justify-between border-t border-neutral-200 px-5 py-3">
                <span className="text-xs text-neutral-500">{chosen.length} selected</span>
                <button disabled={chosen.length === 0} onClick={confirm}
                  className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                  Use {chosen.length || ""} photo{chosen.length === 1 ? "" : "s"} →
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
