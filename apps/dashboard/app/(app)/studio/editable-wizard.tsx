"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, Check, Download, Loader2, Minus, Plus, Save, Search, Sparkles, X } from "lucide-react";
import {
  propertiesAction,
  propertyPhotosAction,
  editableTemplatesAction,
  editableDefaultsAction,
  editablePreviewAction,
  editableGalleryAction,
  editableGenerateAction,
  editableSectionsAction,
  translateSlotsAction,
  editableFinishAction,
  statusAction,
  type FinishJob,
} from "./wizard-actions";

// ── types mirroring the /api/studio/editable-* envelopes ──────────────────────
type PropertyCard = {
  id: string; title: string; location_city: string | null;
  price: number | null; bedrooms: number | null; bathrooms: number | null;
  area: number | null; photo_count: number; thumb_url: string | null;
};
type Brand = { navy: string; gold: string; cream: string; text: string };
type ColourScheme = { id: string; name: string; brand: Brand };
type EditSlot = {
  id: string; label: string; role: string; source: string; default_text: string;
  bbox: number[]; align: string; valign: string; size: number | null; rotate: number;
};
type TemplateMeta = {
  id: string; photo_count: number; palette_locked: boolean;
  canvas: { width: number; height: number };
  editable_slots: EditSlot[];
  colour_layers: { role: string; label: string; default: string; locked: boolean }[];
};
type Defaults = Omit<TemplateMeta, "editable_slots" | "colour_layers"> & {
  editable_slots: (TemplateMeta["editable_slots"][number] & { value: string })[];
  colour_layers: (TemplateMeta["colour_layers"][number] & { value: string })[];
  photos: string[];
};
// the Templates gallery render PLAN (one entry per template)
type GalleryItem = {
  template_id: string; property_id: string; property_title: string | null;
  photos: string[]; palette_locked: boolean; brand: Brand; colour_overrides: Record<string, string>;
};

const LANGS = [
  { code: "en", label: "English" }, { code: "es", label: "Español" }, { code: "de", label: "Deutsch" },
  { code: "nl", label: "Nederlands" }, { code: "fr", label: "Français" }, { code: "no", label: "Norsk" },
  { code: "sv", label: "Svenska" }, { code: "pl", label: "Polski" },
];

const money = (n: number | null) => (n == null ? "" : "€" + n.toLocaleString("es-ES"));
// beds · baths · area — a missing fact is hidden, never invented (data-honesty law).
const specsOf = (p: PropertyCard) =>
  [p.bedrooms != null ? `${p.bedrooms} bed` : null,
   p.bathrooms != null ? `${p.bathrooms} bath` : null,
   p.area != null ? `${p.area} m²` : null].filter(Boolean).join(" · ");

// tiny concurrency limiter so a fresh gallery doesn't fire 17 heavy renders at once.
async function runLimited<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let idx = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; await fn(items[i], i); }
  });
  await Promise.all(workers);
}

export function EditableWizard() {
  const [step, setStep] = useState<"gallery" | "property" | "template" | "edit">("gallery");
  const [editFrom, setEditFrom] = useState<"gallery" | "template">("gallery");

  // gallery step
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [galleryThumbs, setGalleryThumbs] = useState<Record<string, string | null | undefined>>({});
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [hasListings, setHasListings] = useState(true);

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

  // save-to-library
  const [sections, setSections] = useState<string[]>([]);
  const [section, setSection] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [translating, setTranslating] = useState(false);

  // KIE finishing pass — cleaned photos go back into the template (KIE never touches text/layout)
  const [cleanedIds, setCleanedIds] = useState<string[]>([]);
  const [finishNote, setFinishNote] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [finishMsg, setFinishMsg] = useState<string | null>(null);

  // interactive editor — move / resize / selection on the live image
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [dispW, setDispW] = useState(0);
  const [guide, setGuide] = useState<{ v: number | null; h: number | null }>({ v: null, h: null });
  const imgRef = useRef<HTMLImageElement | null>(null);
  const editStateRef = useRef({ text, colours, positions, sizes, cleanedIds });
  editStateRef.current = { text, colours, positions, sizes, cleanedIds };

  // ── gallery: fetch the plan, render each tile (cached, concurrency-limited) ────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setGalleryLoading(true);
      const res = await editableGalleryAction();
      if (cancelled) return;
      const items = res.ok && Array.isArray(res.templates) ? (res.templates as GalleryItem[]) : [];
      setHasListings(res.ok ? res.has_listings !== false : true);
      setGallery(items);
      setGalleryThumbs(Object.fromEntries(items.map((t) => [t.template_id, undefined])));
      setGalleryLoading(false);
      await runLimited(items, 4, async (item) => {
        const r = await editablePreviewAction({
          template_id: item.template_id, property_id: item.property_id,
          photos: item.photos, brand: item.brand, colour_overrides: item.colour_overrides,
        });
        if (cancelled) return;
        setGalleryThumbs((prev) => ({ ...prev, [item.template_id]: r.ok ? (r.image_url as string) : null }));
      });
    })();
    return () => { cancelled = true; };
  }, []);

  // ── sections (the agency's own buckets), loaded once ──────────────────────────
  useEffect(() => {
    (async () => {
      const r = await editableSectionsAction();
      if (r.ok && Array.isArray(r.sections)) setSections(r.sections as string[]);
    })();
  }, []);

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
    eligible.forEach(async (t) => {
      const res = await editablePreviewAction({ template_id: t.id, property_id: p.id, photos: chosen });
      setThumbs((prev) => ({ ...prev, [t.id]: res.ok ? (res.image_url as string) : null }));
    });
  }

  const eligibleTemplates = useMemo(
    () => catalogue.filter((t) => t.photo_count === photos.length),
    [catalogue, photos.length],
  );

  // load an editable template's defaults into the edit state (shared by both entry paths).
  async function loadEdit(tId: string, propId: string): Promise<Defaults | null> {
    const res = await editableDefaultsAction(tId, propId);
    if (!res.ok) { setErr(res.message as string); return null; }
    const d = res as unknown as Defaults;
    setDefaults(d);
    setText(Object.fromEntries(d.editable_slots.map((s) => [s.id, s.value])));
    setColours(Object.fromEntries(d.colour_layers.map((c) => [c.role, c.value])));
    setPositions({}); setSizes({}); setSelected(null);
    setCleanedIds([]); setFinishMsg(null); setFinishNote("");
    return d;
  }

  // ── property-first: pick a template → edit ────────────────────────────────────
  async function pickTemplate(t: TemplateMeta) {
    if (!property) return;
    setEditFrom("template"); setTemplateId(t.id); setStep("edit");
    setPreview(thumbs[t.id] ?? null); setErr(null); setSaved(false); setSection("");
    await loadEdit(t.id, property.id);
  }

  // ── gallery-first: use a template → edit (preview shown in the agency's brand) ──
  async function useGalleryTemplate(item: GalleryItem) {
    const p: PropertyCard = {
      id: item.property_id, title: item.property_title ?? "", location_city: null,
      price: null, bedrooms: null, bathrooms: null, area: null,
      photo_count: item.photos.length, thumb_url: null,
    };
    setProperty(p); setPhotos(item.photos); setEditFrom("gallery");
    setTemplateId(item.template_id); setStep("edit"); setErr(null); setSaved(false); setSection("");
    setPreview(galleryThumbs[item.template_id] ?? null); setRendering(true);
    const d = await loadEdit(item.template_id, p.id);
    if (!d) { setRendering(false); return; }
    // Render once in the agency's brand so the preview equals what a save will produce (WYSIWYG).
    const t0 = Object.fromEntries(d.editable_slots.map((s) => [s.id, s.value]));
    const c0 = Object.fromEntries(d.colour_layers.map((c) => [c.role, c.value]));
    const pr = await editablePreviewAction({ template_id: item.template_id, property_id: p.id, photos: item.photos, text_overrides: t0, manual_colours: c0 });
    setPreview(pr.ok ? (pr.image_url as string) : (galleryThumbs[item.template_id] ?? null));
    setRendering(false);
  }

  // ── live preview (debounced) — reads the latest edit snapshot from a ref (never stale) ──
  const renderSeq = useRef(0);
  const doRender = useCallback(async () => {
    if (!templateId || !property) return;
    const s = editStateRef.current;
    const seq = ++renderSeq.current;
    setRendering(true);
    const res = await editablePreviewAction({
      template_id: templateId, property_id: property.id, photos,
      text_overrides: s.text, manual_colours: s.colours,
      position_overrides: Object.keys(s.positions).length ? s.positions : undefined,
      size_overrides: Object.keys(s.sizes).length ? s.sizes : undefined,
      cleaned_generation_ids: s.cleanedIds.length ? s.cleanedIds : undefined,
    });
    if (seq !== renderSeq.current) return; // a newer edit superseded this render
    if (res.ok) { setPreview(res.image_url as string); setErr(null); }
    else setErr(res.message as string);
    setRendering(false);
  }, [templateId, property, photos]);
  const editDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRender = useCallback(() => {
    if (editDebounce.current) clearTimeout(editDebounce.current);
    editDebounce.current = setTimeout(() => void doRender(), 400);
  }, [doRender]);
  function editText(id: string, v: string) { setText((t) => ({ ...t, [id]: v })); setSaved(false); scheduleRender(); }
  function editColour(role: string, v: string) { setColours((c) => ({ ...c, [role]: v })); setSaved(false); scheduleRender(); }

  // ── post language: translate the TYPED copy into the chosen language (facts localise in the engine) ──
  async function changeLanguage(lang: string) {
    setLanguage(lang);
    if (!defaults) return;
    setTranslating(true); setErr(null);
    const res = await translateSlotsAction(editStateRef.current.text, lang);
    setTranslating(false);
    if (res.ok && res.texts) {
      setText(res.texts as Record<string, string>); setSaved(false); scheduleRender();
    } else if (!res.ok) {
      setErr(res.message as string);
    }
  }

  // ── canvas geometry + move/resize helpers ─────────────────────────────────────
  const canvas = defaults?.canvas ?? { width: 1080, height: 1350 };
  const scale = dispW && canvas.width ? dispW / canvas.width : 0;
  const selectedSlot = selected && defaults ? defaults.editable_slots.find((x) => x.id === selected) ?? null : null;
  function slotBox(s: EditSlot) {
    const [x0, y0, x1, y1] = s.bbox; const w = x1 - x0, h = y1 - y0;
    const p = positions[s.id];
    return { x: p?.x ?? x0, y: p?.y ?? y0, w, h };
  }
  function baselineSize(s: EditSlot) {
    if (sizes[s.id]) return sizes[s.id];
    if (s.size) return s.size;
    const lines = Math.max(1, (text[s.id] ?? s.default_text ?? "").split("\n").length);
    return Math.round(Math.max(8, ((s.bbox[3] - s.bbox[1]) / lines) * 0.78));
  }
  function resizeSel(delta: number) {
    if (!selectedSlot) return;
    const next = Math.max(8, Math.min(240, baselineSize(selectedSlot) + delta));
    setSizes((z) => ({ ...z, [selectedSlot.id]: next })); setSaved(false); scheduleRender();
  }
  function onSlotDown(e: ReactPointerEvent, s: EditSlot) {
    if (s.rotate || !scale) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY, base = slotBox(s), cw = canvas.width, ch = canvas.height;
    let moved = false;
    function mv(ev: PointerEvent) {
      const dx = (ev.clientX - startX) / scale, dy = (ev.clientY - startY) / scale;
      if (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3) moved = true;
      let nx = base.x + dx, ny = base.y + dy; let gv: number | null = null, gh: number | null = null;
      const ccx = nx + base.w / 2, ccy = ny + base.h / 2;
      if (Math.abs(ccx - cw / 2) < 14) { nx = cw / 2 - base.w / 2; gv = cw / 2; }
      else if (Math.abs(nx - cw * 0.06) < 14) { nx = cw * 0.06; gv = nx; }
      if (Math.abs(ccy - ch / 2) < 14) { ny = ch / 2 - base.h / 2; gh = ch / 2; }
      nx = Math.max(0, Math.min(cw - base.w, nx)); ny = Math.max(0, Math.min(ch - base.h, ny));
      setPositions((p) => ({ ...p, [s.id]: { x: nx, y: ny } })); setGuide({ v: gv, h: gh });
    }
    function up() {
      window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up);
      setGuide({ v: null, h: null });
      if (!moved) setSelected(s.id); else { setSaved(false); scheduleRender(); }
    }
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  }
  // keep the display scale in sync with the rendered image size
  useEffect(() => {
    function m() { setDispW(imgRef.current?.clientWidth ?? 0); }
    m(); window.addEventListener("resize", m);
    return () => window.removeEventListener("resize", m);
  }, [preview, step]);

  // ── KIE finishing pass: clean the photos, then put them back in this same template ──────────
  // KIE only ever touches the images (watermark removal + the aesthetic/lighting changes asked for). The
  // template and every fact stay exactly as they are — the engine re-renders them over the cleaned photos.
  async function runFinish() {
    if (!property || !templateId) return;
    setFinishing(true); setErr(null); setFinishMsg("Sending your photos for clean-up…");
    try {
      const res = await editableFinishAction(property.id, photos, finishNote);
      if (!res.ok) { setErr(res.message as string); setFinishing(false); setFinishMsg(null); return; }
      const jobs = (res.jobs as FinishJob[]).filter((j) => j.generation_id);
      if (!jobs.length) { setErr("The photo clean-up couldn't be started."); setFinishing(false); setFinishMsg(null); return; }

      // poll each job until it lands (KIE takes ~1 min per photo)
      const done: string[] = [];
      const failed: string[] = [];
      const deadline = Date.now() + 4 * 60 * 1000;
      const pending = new Map(jobs.map((j) => [j.generation_id as string, true]));
      while (pending.size > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        for (const id of [...pending.keys()]) {
          const s = await statusAction(id);
          const st = s.ok ? (s.status as string) : null;
          if (st === "completed") { pending.delete(id); done.push(id); }
          else if (st === "failed") { pending.delete(id); failed.push(id); }
        }
        setFinishMsg(`Cleaning your photos… ${done.length}/${jobs.length} done`);
      }
      if (!done.length) {
        setErr(pending.size ? "The photo clean-up is taking longer than expected. Please try again shortly." : "The photos couldn't be cleaned up.");
        setFinishing(false); setFinishMsg(null); return;
      }
      // Order the cleaned photos the way the template expects them (job order = chosen photo order).
      const ordered = jobs.map((j) => j.generation_id as string).filter((id) => done.includes(id));
      setCleanedIds(ordered); setSaved(false);
      setFinishMsg(failed.length
        ? `Photos cleaned (${failed.length} couldn't be done — the originals are used for those).`
        : "Photos cleaned and placed back in your template.");
      scheduleRender();
    } catch {
      setErr("The photo clean-up couldn't be finished. Please try again.");
      setFinishMsg(null);
    } finally {
      setFinishing(false);
    }
  }

  // ── save to library (records a row; optional section) ─────────────────────────
  async function saveToLibrary() {
    if (!templateId || !property) return;
    setSaving(true); setErr(null);
    const res = await editableGenerateAction({
      template_id: templateId, property_id: property.id, photos,
      text_overrides: text, manual_colours: colours,
      position_overrides: Object.keys(positions).length ? positions : undefined,
      size_overrides: Object.keys(sizes).length ? sizes : undefined,
      cleaned_generation_ids: cleanedIds.length ? cleanedIds : undefined,
      section: section.trim() || null,
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      if (res.image_url) setPreview(res.image_url as string);
      const s = section.trim();
      if (s && !sections.includes(s)) setSections((prev) => [...prev, s].sort());
    } else {
      setErr(res.message as string);
    }
  }

  function reset() {
    setStep("gallery"); setProperty(null); setPhotos([]); setTemplateId(null);
    setDefaults(null); setText({}); setColours({}); setPreview(null); setThumbs({});
    setSection(""); setSaved(false); setErr(null);
    setPositions({}); setSizes({}); setSelected(null);
    setCleanedIds([]); setFinishMsg(null); setFinishNote("");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* ── GALLERY (default landing): every template shown against your top listings ─ */}
      {step === "gallery" && (
        <div>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Templates</h2>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Shown with your best listings in a neutral style — pick one to customise in your colours.
              </p>
            </div>
            <button onClick={() => setStep("property")}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200">
              Start from a property
            </button>
          </div>

          {galleryLoading ? (
            <div className="flex items-center gap-2 py-16 text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading templates…</div>
          ) : gallery.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500">
              {hasListings
                ? "No templates could be previewed yet."
                : "Add a property with photos to see your templates come to life."}
              <div className="mt-3">
                <button onClick={() => setStep("property")} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white">Start from a property</button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {gallery.map((item) => (
                <button key={item.template_id} onClick={() => useGalleryTemplate(item)}
                  className="group overflow-hidden rounded-xl border border-neutral-200 bg-white transition hover:border-neutral-900 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="aspect-[4/5] bg-neutral-100 dark:bg-neutral-800">
                    {galleryThumbs[item.template_id] === undefined ? (
                      <div className="flex h-full items-center justify-center text-neutral-300"><Loader2 className="h-5 w-5 animate-spin" /></div>
                    ) : galleryThumbs[item.template_id] ? (
                      <img src={galleryThumbs[item.template_id]!} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-neutral-400">preview failed</div>
                    )}
                  </div>
                  <div className="flex items-center justify-between p-2 text-xs">
                    <span className="font-medium text-neutral-600 dark:text-neutral-300">Template {item.template_id}</span>
                    <span className="text-neutral-400 opacity-0 transition group-hover:opacity-100">Customise →</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* stepper (property-first flow only) */}
      {step !== "gallery" && (
        <div className="mb-6 flex items-center gap-2 text-sm">
          {(["property", "template", "edit"] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                step === s ? "bg-neutral-900 text-white" : i < ["property", "template", "edit"].indexOf(step) ? "bg-emerald-500 text-white" : "bg-neutral-200 text-neutral-500"
              }`}>{i + 1}</span>
              <span className={step === s ? "font-medium text-neutral-900 dark:text-neutral-100" : "text-neutral-500"}>
                {s === "property" ? "Property" : s === "template" ? "Template" : "Edit"}
              </span>
              {i < 2 && <span className="mx-1 text-neutral-300">→</span>}
            </div>
          ))}
        </div>
      )}

      {/* ── STEP 1: PROPERTY ─────────────────────────────────────────────────── */}
      {step === "property" && (
        <div>
          <button onClick={() => setStep("gallery")} className="mb-4 flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" /> Templates</button>
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
          <button onClick={() => setStep(editFrom)} className="mb-4 flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900">
            <ArrowLeft className="h-4 w-4" /> {editFrom === "gallery" ? "Templates" : "Templates"}
          </button>
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            {/* interactive canvas — tap to select, drag to move, toolbar to recolour/resize */}
            <div>
              <div className="sticky top-4">
                <div className="relative overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50" style={{ touchAction: "none" }}>
                  {preview ? (
                    <img ref={imgRef} src={preview} alt="Preview" draggable={false}
                      onLoad={() => setDispW(imgRef.current?.clientWidth ?? 0)}
                      className="block w-full select-none" />
                  ) : (
                    <div className="flex aspect-[4/5] items-center justify-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
                  )}

                  {/* tap-targets over each text element */}
                  {preview && !defaults.palette_locked && scale > 0 && (
                    <div className="absolute inset-0">
                      {defaults.editable_slots.filter((s) => (text[s.id] ?? "").trim() && !s.rotate).map((s) => {
                        const b = slotBox(s); const sel = selected === s.id;
                        return (
                          <div key={s.id} title={s.label} onPointerDown={(e) => onSlotDown(e, s)}
                            style={{ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale }}
                            className={`absolute cursor-grab touch-none rounded-[3px] ${sel ? "outline outline-2 outline-emerald-500" : "hover:outline hover:outline-2 hover:outline-emerald-400/60"}`} />
                        );
                      })}
                      {guide.v != null && <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-rose-500" style={{ left: guide.v * scale }} />}
                      {guide.h != null && <div className="pointer-events-none absolute left-0 right-0 h-px bg-rose-500" style={{ top: guide.h * scale }} />}
                    </div>
                  )}

                  {/* floating toolbar on the selected element */}
                  {preview && selectedSlot && !defaults.palette_locked && scale > 0 && (() => {
                    const b = slotBox(selectedSlot); const role = selectedSlot.role;
                    return (
                      <div className="absolute z-20 -translate-x-1/2 -translate-y-full" style={{ left: (b.x + b.w / 2) * scale, top: b.y * scale - 8 }}>
                        <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">
                          <label className="relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-md hover:bg-neutral-100" title="Colour">
                            <span className="h-4 w-4 rounded border border-black/15" style={{ background: colours[role] ?? "#888888" }} />
                            <input type="color" value={colours[role] ?? "#888888"} onChange={(e) => editColour(role, e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
                          </label>
                          <span className="mx-0.5 h-4 w-px bg-neutral-200" />
                          <button onClick={() => resizeSel(-3)} className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-700 hover:bg-neutral-100" title="Smaller"><Minus className="h-3.5 w-3.5" /></button>
                          <button onClick={() => resizeSel(3)} className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-700 hover:bg-neutral-100" title="Bigger"><Plus className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                    );
                  })()}

                  {rendering && <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-xs text-neutral-600 shadow"><Loader2 className="h-3 w-3 animate-spin" /> updating…</div>}
                </div>

                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-neutral-500">
                  <span className="min-w-0 truncate">
                    {selectedSlot ? <>Selected <b className="text-neutral-800">{selectedSlot.label}</b> — drag to move, toolbar to recolour &amp; resize</> : "Tap any text on the image to select it, then drag to move."}
                  </span>
                  {(Object.keys(positions).length > 0 || Object.keys(sizes).length > 0) && (
                    <button onClick={() => { setPositions({}); setSizes({}); setSelected(null); scheduleRender(); }} className="shrink-0 underline hover:text-neutral-800">Reset layout</button>
                  )}
                </div>
                {err && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
              </div>
            </div>

            {/* controls */}
            <div className="space-y-6">
              {/* language */}
              <div>
                <label className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Post language
                  {translating && <span className="flex items-center gap-1 font-normal normal-case text-neutral-400"><Loader2 className="h-3 w-3 animate-spin" /> translating…</span>}
                </label>
                <select value={language} disabled={translating} onChange={(e) => void changeLanguage(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 disabled:opacity-60">
                  {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-neutral-400">Write in any language — the text is translated into the language you pick.</p>
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
                        onFocus={() => setSelected(s.id)}
                        className={`w-full resize-none rounded-lg border bg-white px-3 py-1.5 text-sm outline-none ${selected === s.id ? "border-emerald-500 ring-1 ring-emerald-500" : "border-neutral-300 focus:border-neutral-900"}`} />
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
                      <label key={cl.role} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${selectedSlot?.role === cl.role ? "border-emerald-500 ring-1 ring-emerald-500" : "border-neutral-200"}`}>
                        <input type="color" value={colours[cl.role] ?? cl.value}
                          onChange={(e) => editColour(cl.role, e.target.value)}
                          className="h-6 w-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
                        <span className="truncate text-xs text-neutral-600">{cl.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* KIE finishing pass — photos only; the template + text never change */}
              <div className="space-y-2 rounded-xl border border-neutral-200 p-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">Clean up the photos</label>
                  {cleanedIds.length > 0 && <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600"><Check className="h-3 w-3" /> cleaned</span>}
                </div>
                <p className="text-[11px] leading-relaxed text-neutral-400">
                  Removes portal watermarks and improves the lighting on your photos, then puts them straight back
                  into this template. Your text and layout are never touched. Uses a credit per photo.
                </p>
                <input value={finishNote} onChange={(e) => setFinishNote(e.target.value)} disabled={finishing}
                  placeholder="Anything else? e.g. brighter sky, warmer light (optional)"
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 disabled:opacity-60" />
                <button onClick={() => void runFinish()} disabled={finishing || !preview}
                  className={`flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium ${finishing || !preview ? "border-neutral-200 text-neutral-400" : "border-neutral-900 text-neutral-900 hover:bg-neutral-50"}`}>
                  {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {cleanedIds.length > 0 ? "Clean up again" : `Clean up ${photos.length} photo${photos.length === 1 ? "" : "s"}`}
                </button>
                {finishMsg && <p className="text-[11px] text-neutral-500">{finishMsg}</p>}
              </div>

              {/* save to library + section */}
              <div className="space-y-2 rounded-xl border border-neutral-200 p-3">
                <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">Save to a section</label>
                <input list="studio-sections" value={section} onChange={(e) => { setSection(e.target.value); setSaved(false); }}
                  placeholder="e.g. Just listed (optional)"
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900" />
                <datalist id="studio-sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
                <button onClick={saveToLibrary} disabled={saving || !preview}
                  className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium ${saved ? "bg-emerald-600 text-white" : "bg-neutral-900 text-white"} ${saving || !preview ? "opacity-50" : ""}`}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                  {saved ? "Saved to library" : "Save to library"}
                </button>
              </div>

              {/* download */}
              <a href={preview ?? undefined} download={`${property?.title || "post"}-${templateId}.png`}
                className={`flex items-center justify-center gap-2 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700 ${preview ? "hover:bg-neutral-50" : "pointer-events-none opacity-40"}`}>
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
