"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Download, Loader2, Search, X } from "lucide-react";
import {
  propertiesAction,
  propertyPhotosAction,
  editableTemplatesAction,
  editableDefaultsAction,
  editablePreviewAction,
} from "./wizard-actions";

// ── types mirroring the /api/studio/editable-* envelopes ──────────────────────
type PropertyCard = {
  id: string; title: string; location_city: string | null;
  price: number | null; bedrooms: number | null; bathrooms: number | null;
  photo_count: number; thumb_url: string | null;
};
type ColourScheme = { id: string; name: string; brand: { navy: string; gold: string; cream: string; text: string } };
type TemplateMeta = {
  id: string; photo_count: number; palette_locked: boolean;
  editable_slots: { id: string; label: string; role: string; source: string; default_text: string }[];
  colour_layers: { role: string; label: string; default: string; locked: boolean }[];
};
type Defaults = Omit<TemplateMeta, "editable_slots" | "colour_layers"> & {
  editable_slots: (TemplateMeta["editable_slots"][number] & { value: string })[];
  colour_layers: (TemplateMeta["colour_layers"][number] & { value: string })[];
  photos: string[];
};

const LANGS = [
  { code: "en", label: "English" }, { code: "es", label: "Español" }, { code: "de", label: "Deutsch" },
  { code: "nl", label: "Nederlands" }, { code: "fr", label: "Français" }, { code: "no", label: "Norsk" },
  { code: "sv", label: "Svenska" }, { code: "pl", label: "Polski" },
];

const money = (n: number | null) => (n == null ? "" : "€" + n.toLocaleString("es-ES"));

export function EditableWizard() {
  const [step, setStep] = useState<"property" | "template" | "edit">("property");

  // property step
  const [query, setQuery] = useState("");
  const [properties, setProperties] = useState<PropertyCard[]>([]);
  const [loadingProps, setLoadingProps] = useState(true);
  const [modalProp, setModalProp] = useState<PropertyCard | null>(null);
  const [modalPhotos, setModalPhotos] = useState<string[]>([]);
  const [modalChosen, setModalChosen] = useState<string[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  // chosen
  const [property, setProperty] = useState<PropertyCard | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);

  // template step
  const [catalogue, setCatalogue] = useState<TemplateMeta[]>([]);
  const [schemes, setSchemes] = useState<ColourScheme[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});

  // edit step
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [colours, setColours] = useState<Record<string, string>>({});
  const [language, setLanguage] = useState("en");
  const [preview, setPreview] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ── property list (search) ──────────────────────────────────────────────────
  const runSearch = useCallback(async (q: string) => {
    setLoadingProps(true);
    const res = await propertiesAction(q);
    setProperties(res.ok && Array.isArray(res.items) ? (res.items as PropertyCard[]) : []);
    setLoadingProps(false);
  }, []);
  useEffect(() => { void runSearch(""); }, [runSearch]);
  useEffect(() => {
    const t = setTimeout(() => void runSearch(query), 300);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  // ── open a property → photo modal ─────────────────────────────────────────────
  async function openProperty(p: PropertyCard) {
    setModalProp(p); setModalChosen([]); setModalPhotos([]); setLoadingPhotos(true);
    const res = await propertyPhotosAction(p.id);
    setModalPhotos(res.ok && Array.isArray(res.photos) ? (res.photos as string[]) : []);
    setLoadingPhotos(false);
  }
  function toggleChosen(url: string) {
    setModalChosen((c) => (c.includes(url) ? c.filter((u) => u !== url) : [...c, url]));
  }
  function confirmPhotos() {
    if (!modalProp || modalChosen.length === 0) return;
    setProperty(modalProp); setPhotos(modalChosen); setModalProp(null);
    void enterTemplateStep(modalProp, modalChosen);
  }

  // ── template step: load catalogue, render live thumbnails of THIS listing ──────
  async function enterTemplateStep(p: PropertyCard, chosen: string[]) {
    setStep("template");
    let cat = catalogue;
    if (cat.length === 0) {
      const res = await editableTemplatesAction();
      cat = res.ok && Array.isArray(res.templates) ? (res.templates as TemplateMeta[]) : [];
      setCatalogue(cat);
      setSchemes(res.ok && Array.isArray(res.colour_schemes) ? (res.colour_schemes as ColourScheme[]) : []);
    }
    const eligible = cat.filter((t) => t.photo_count === chosen.length);
    setThumbs(Object.fromEntries(eligible.map((t) => [t.id, undefined as unknown as string])));
    // render each eligible template with the listing's real facts + chosen photos (defaults), in parallel
    eligible.forEach(async (t) => {
      const res = await editablePreviewAction({ template_id: t.id, property_id: p.id, photos: chosen });
      setThumbs((prev) => ({ ...prev, [t.id]: res.ok ? (res.image_url as string) : null }));
    });
  }

  const eligibleTemplates = useMemo(
    () => catalogue.filter((t) => t.photo_count === photos.length),
    [catalogue, photos.length],
  );

  // ── pick a template → load its editable defaults → edit step ──────────────────
  async function pickTemplate(t: TemplateMeta) {
    if (!property) return;
    setTemplateId(t.id); setStep("edit"); setPreview(thumbs[t.id] ?? null); setErr(null);
    const res = await editableDefaultsAction(t.id, property.id);
    if (!res.ok) { setErr(res.message as string); return; }
    const d = res as unknown as Defaults;
    setDefaults(d);
    setText(Object.fromEntries(d.editable_slots.map((s) => [s.id, s.value])));
    setColours(Object.fromEntries(d.colour_layers.map((c) => [c.role, c.value])));
  }

  // ── live preview (debounced) on any text/colour edit ──────────────────────────
  const renderSeq = useRef(0);
  const rerender = useCallback(async (t: Record<string, string>, cols: Record<string, string>) => {
    if (!templateId || !property) return;
    const seq = ++renderSeq.current;
    setRendering(true);
    const res = await editablePreviewAction({
      template_id: templateId, property_id: property.id, photos,
      text_overrides: t, manual_colours: cols,
    });
    if (seq !== renderSeq.current) return; // a newer edit superseded this render
    if (res.ok) { setPreview(res.image_url as string); setErr(null); }
    else setErr(res.message as string);
    setRendering(false);
  }, [templateId, property, photos]);

  const editDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  function scheduleRender(t: Record<string, string>, cols: Record<string, string>) {
    if (editDebounce.current) clearTimeout(editDebounce.current);
    editDebounce.current = setTimeout(() => void rerender(t, cols), 400);
  }
  function editText(id: string, v: string) {
    const next = { ...text, [id]: v }; setText(next); scheduleRender(next, colours);
  }
  function editColour(role: string, v: string) {
    const next = { ...colours, [role]: v }; setColours(next); scheduleRender(text, next);
  }

  function reset() {
    setStep("property"); setProperty(null); setPhotos([]); setTemplateId(null);
    setDefaults(null); setText({}); setColours({}); setPreview(null); setThumbs({});
  }

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* stepper */}
      <div className="mb-6 flex items-center gap-2 text-sm">
        {(["property", "template", "edit"] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
              step === s ? "bg-neutral-900 text-white" : i < ["property", "template", "edit"].indexOf(step) ? "bg-emerald-500 text-white" : "bg-neutral-200 text-neutral-500"
            }`}>{i + 1}</span>
            <span className={step === s ? "font-medium text-neutral-900" : "text-neutral-500"}>
              {s === "property" ? "Property" : s === "template" ? "Template" : "Edit"}
            </span>
            {i < 2 && <span className="mx-1 text-neutral-300">→</span>}
          </div>
        ))}
      </div>

      {/* ── STEP 1: PROPERTY ─────────────────────────────────────────────────── */}
      {step === "property" && (
        <div>
          <div className="relative mb-4 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a property or area (e.g. Torrevieja)"
              className="w-full rounded-lg border border-neutral-300 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-neutral-900"
            />
          </div>
          {loadingProps ? (
            <div className="flex items-center gap-2 py-16 text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading properties…</div>
          ) : properties.length === 0 ? (
            <div className="py-16 text-center text-neutral-500">No properties found{query ? ` for “${query}”` : ""}.</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {properties.map((p) => (
                <button key={p.id} onClick={() => openProperty(p)}
                  className="group overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition hover:border-neutral-900 hover:shadow-md">
                  <div className="aspect-[4/3] bg-neutral-100">
                    {p.thumb_url ? <img src={p.thumb_url} alt="" className="h-full w-full object-cover" /> : null}
                  </div>
                  <div className="p-2.5">
                    <div className="truncate text-sm font-medium text-neutral-900">{p.title || "Untitled"}</div>
                    <div className="mt-0.5 flex items-center justify-between text-xs text-neutral-500">
                      <span className="truncate">{p.location_city || "—"}</span>
                      <span className="font-medium text-neutral-700">{money(p.price)}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-neutral-400">{p.photo_count} photo{p.photo_count === 1 ? "" : "s"}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── PHOTO MODAL ──────────────────────────────────────────────────────── */}
      {modalProp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModalProp(null)}>
          <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3">
              <div>
                <div className="text-sm font-semibold text-neutral-900">{modalProp.title || "Property"}</div>
                <div className="text-xs text-neutral-500">Choose one or more photos</div>
              </div>
              <button onClick={() => setModalProp(null)} className="rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-4">
              {loadingPhotos ? (
                <div className="flex items-center gap-2 py-12 text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading photos…</div>
              ) : modalPhotos.length === 0 ? (
                <div className="py-12 text-center text-neutral-500">This property has no photos.</div>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {modalPhotos.map((u) => {
                    const on = modalChosen.includes(u);
                    return (
                      <button key={u} onClick={() => toggleChosen(u)}
                        className={`relative aspect-square overflow-hidden rounded-lg border-2 ${on ? "border-neutral-900" : "border-transparent"}`}>
                        <img src={u} alt="" className="h-full w-full object-cover" />
                        {on && <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-white"><Check className="h-3 w-3" /></span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-neutral-200 px-5 py-3">
              <span className="text-xs text-neutral-500">{modalChosen.length} selected</span>
              <button disabled={modalChosen.length === 0} onClick={confirmPhotos}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                Use {modalChosen.length || ""} photo{modalChosen.length === 1 ? "" : "s"} →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 2: TEMPLATE PICKER (filtered by photo count) ─────────────────── */}
      {step === "template" && (
        <div>
          <button onClick={() => setStep("property")} className="mb-4 flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" /> Property</button>
          <div className="mb-4 text-sm text-neutral-600">
            {eligibleTemplates.length} template{eligibleTemplates.length === 1 ? "" : "s"} for <strong>{photos.length} photo{photos.length === 1 ? "" : "s"}</strong> — showing your listing in each.
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {eligibleTemplates.map((t) => (
              <button key={t.id} onClick={() => pickTemplate(t)}
                className="group overflow-hidden rounded-xl border border-neutral-200 bg-white transition hover:border-neutral-900 hover:shadow-md">
                <div className="aspect-[4/5] bg-neutral-100">
                  {thumbs[t.id] === undefined ? (
                    <div className="flex h-full items-center justify-center text-neutral-300"><Loader2 className="h-5 w-5 animate-spin" /></div>
                  ) : thumbs[t.id] ? (
                    <img src={thumbs[t.id]!} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-neutral-400">preview failed</div>
                  )}
                </div>
                <div className="p-2 text-center text-xs font-medium text-neutral-600">Template {t.id}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── STEP 3: EDIT ─────────────────────────────────────────────────────── */}
      {step === "edit" && defaults && (
        <div>
          <button onClick={() => setStep("template")} className="mb-4 flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" /> Templates</button>
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            {/* live preview */}
            <div className="relative">
              <div className="sticky top-4 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
                {preview ? <img src={preview} alt="Preview" className="w-full" /> : <div className="flex aspect-[4/5] items-center justify-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>}
                {rendering && <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-xs text-neutral-600 shadow"><Loader2 className="h-3 w-3 animate-spin" /> updating…</div>}
              </div>
              {err && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
            </div>

            {/* controls */}
            <div className="space-y-6">
              {/* language */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">Post language</label>
                <select value={language} onChange={(e) => setLanguage(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900">
                  {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
              </div>

              {/* text layers */}
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Text</div>
                <div className="space-y-3">
                  {defaults.editable_slots.map((s) => (
                    <div key={s.id}>
                      <label className="mb-1 block text-xs text-neutral-500">{s.label}</label>
                      <textarea rows={(text[s.id] || "").includes("\n") ? 2 : 1}
                        value={text[s.id] ?? ""} onChange={(e) => editText(s.id, e.target.value)}
                        className="w-full resize-none rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-900" />
                    </div>
                  ))}
                </div>
              </div>

              {/* colour layers — a wheel per layer */}
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Colours {defaults.palette_locked && <span className="ml-1 font-normal normal-case text-neutral-400">(locked for this template)</span>}</div>
                {!defaults.palette_locked && (
                  <div className="grid grid-cols-2 gap-2">
                    {defaults.colour_layers.map((cl) => (
                      <label key={cl.role} className="flex items-center gap-2 rounded-lg border border-neutral-200 px-2.5 py-2">
                        <input type="color" value={colours[cl.role] ?? cl.value}
                          onChange={(e) => editColour(cl.role, e.target.value)}
                          className="h-6 w-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
                        <span className="truncate text-xs text-neutral-600">{cl.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* download */}
              <a href={preview ?? undefined} download={`${property?.title || "post"}-${templateId}.png`}
                className={`flex items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white ${preview ? "" : "pointer-events-none opacity-40"}`}>
                <Download className="h-4 w-4" /> Download image
              </a>
              <button onClick={reset} className="w-full text-center text-xs text-neutral-400 hover:text-neutral-600">Start over</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
