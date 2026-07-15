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
  previewAction,
  generateAction,
  reviseAction,
  setSectionAction,
  type FinishJob,
} from "./wizard-actions";
import { PropertyPicker, downloadImage, type PickerProperty } from "./property-picker";

// ── types mirroring the /api/studio/editable-* envelopes ──────────────────────
type PropertyCard = PickerProperty;
type Brand = { navy: string; gold: string; cream: string; text: string };
type ColourScheme = { id: string; name: string; brand: Brand };
type EditSlot = {
  id: string; label: string; role: string; source: string; default_text: string;
  bbox: number[]; align: string; valign: string; size: number | null; rotate: number;
};
type ColourRegion = { role: string; bbox: number[] };
type TemplateMeta = {
  id: string; photo_count: number; palette_locked: boolean;
  canvas: { width: number; height: number };
  colour_regions: ColourRegion[];
  editable_slots: EditSlot[];
  colour_layers: { role: string; label: string; default: string; locked: boolean; used: boolean }[];
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

// A few templates keep pieces of the ORIGINAL design as fixed artwork (fonts we can't licence-match or
// baked glass panels). Being honest about it beats a tap that silently does nothing.
const BAKED_ART_NOTE: Record<string, string> = {
  "2": "The \u201Copen HOUSE\u201D lettering is part of this template's original artwork — it can't be edited or recoloured.",
  "3": "The \u201CLUXURY\u201D lettering and the glass features panel are part of this template's original artwork — they can't be edited or recoloured.",
  "10": "The big lettering and colours are this template's fixed identity — that's why colour options are limited here.",
};
// beds · baths · area — a missing fact is hidden, never invented (data-honesty law).
const specsOf = (p: PropertyCard) =>
  [p.bedrooms != null ? `${p.bedrooms} bed` : null,
   p.bathrooms != null ? `${p.bathrooms} bath` : null,
   p.area != null ? `${p.area} m²` : null].filter(Boolean).join(" · ");

// The best 4 of the old engine's finished designs, kept by Christian's ask (the rest are retired).
// These are AI-FINISHED: the photo goes through the enhance pass and the design is composed on top —
// one credit, ~a minute, 2 free changes after.
const CLASSICS: { key: string; name: string; desc: string }[] = [
  { key: "magazine", name: "Magazine", desc: "Cover-style, big masthead" },
  { key: "editorial", name: "Editorial", desc: "Clean serif, understated" },
  { key: "price_hero", name: "Price hero", desc: "Leads with the price" },
  { key: "statement", name: "Statement", desc: "Bold type poster" },
];

// tiny concurrency limiter so a fresh gallery doesn't fire 17 heavy renders at once.
async function runLimited<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let idx = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; await fn(items[i], i); }
  });
  await Promise.all(workers);
}

export function EditableWizard() {
  const [step, setStep] = useState<"gallery" | "property" | "template" | "edit" | "classic">("gallery");
  const [editFrom, setEditFrom] = useState<"gallery" | "template">("gallery");

  // gallery step
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [galleryThumbs, setGalleryThumbs] = useState<Record<string, string | null | undefined>>({});
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [hasListings, setHasListings] = useState(true);

  // chosen
  const [property, setProperty] = useState<PropertyCard | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);

  // classic designs (the old engine's finished looks — enhance + composed overlay)
  const [classicThumbs, setClassicThumbs] = useState<Record<string, string | null | undefined>>({});
  const [classicKey, setClassicKey] = useState<string | null>(null);
  const [classicGenId, setClassicGenId] = useState<string | null>(null);
  const [classicImage, setClassicImage] = useState<string | null>(null);
  const [classicBusy, setClassicBusy] = useState<string | null>(null);
  const [classicRevLeft, setClassicRevLeft] = useState(2);
  const [classicNote, setClassicNote] = useState("");
  const [classicSection, setClassicSection] = useState("");
  const [classicFiled, setClassicFiled] = useState(false);
  const classicPoll = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (classicPoll.current) clearTimeout(classicPoll.current); }, []);

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
  // move/crop each photo inside its frame: { [photoIndex]: { zoom, x, y } }
  const [photoTr, setPhotoTr] = useState<Record<number, { zoom: number; x: number; y: number }>>({});
  const [finishNote, setFinishNote] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [finishMsg, setFinishMsg] = useState<string | null>(null);

  // interactive editor — move / resize / selection on the live image
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  // a tapped non-text colour area (panel / plate / badge / the page background)
  const [regionSel, setRegionSel] = useState<ColourRegion | null>(null);
  // hovering a swatch flashes what it changes on the image (the "which colour is what" fix)
  const [hoverRole, setHoverRole] = useState<string | null>(null);
  const [dispW, setDispW] = useState(0);
  const [guide, setGuide] = useState<{ v: number | null; h: number | null }>({ v: null, h: null });
  const imgRef = useRef<HTMLImageElement | null>(null);
  const editStateRef = useRef({ text, colours, positions, sizes, cleanedIds, photoTr });
  editStateRef.current = { text, colours, positions, sizes, cleanedIds, photoTr };

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
    // every eligible template uses EXACTLY the photos you chose (photo_count === chosen.length)
    const eligible = cat.filter((t) => t.photo_count === chosen.length);


    setThumbs(Object.fromEntries(eligible.map((t) => [t.id, undefined as unknown as string])));
    eligible.forEach(async (t) => {
      const res = await editablePreviewAction({ template_id: t.id, property_id: p.id, photos: chosen });
      setThumbs((prev) => ({ ...prev, [t.id]: res.ok ? (res.image_url as string) : null }));
    });
    // classic previews (free, instant-ish): the design composed over the chosen hero photo
    setClassicThumbs(Object.fromEntries(CLASSICS.map((c) => [c.key, undefined])));
    CLASSICS.forEach(async (cd) => {
      const res = await previewAction({
        generation_type: "social_post", content_type: "listing", composition: cd.key,
        source_property_id: p.id, image_urls: [chosen[0]],
      });
      setClassicThumbs((prev) => ({ ...prev, [cd.key]: res.ok && res.signed_url ? (res.signed_url as string) : null }));
    });
  }

  // ── classic: generate the finished version (enhance pass + composed design) ──
  function watchClassic(id: string) {
    const started = Date.now();
    const tick = async () => {
      const st = await statusAction(id);
      const status = st.ok ? (st.status as string) : null;
      if (status === "completed") {
        setClassicImage((st.image_url as string) ?? null);
        if (typeof st.revisions_remaining === "number") setClassicRevLeft(st.revisions_remaining as number);
        setClassicBusy(null); return;
      }
      if (status === "failed") {
        setErr((st.message as string) ?? "That design couldn't be finished. Please try again.");
        setClassicBusy(null); return;
      }
      if (Date.now() - started > 5 * 60 * 1000) {
        setErr("This is taking longer than expected — check your library in a minute.");
        setClassicBusy(null); return;
      }
      classicPoll.current = setTimeout(tick, 4000);
    };
    classicPoll.current = setTimeout(tick, 3000);
  }
  async function pickClassic(key: string) {
    if (!property) return;
    setClassicKey(key); setStep("classic"); setErr(null);
    setClassicImage(null); setClassicGenId(null); setClassicRevLeft(2);
    setClassicNote(""); setClassicSection(""); setClassicFiled(false);
    setClassicBusy("Polishing the photo and composing your design — about a minute…");
    const res = await generateAction({
      generation_type: "social_post", content_type: "listing", composition: key,
      source_property_id: property.id, image_urls: [photos[0]],
    });
    if (!res.ok || !res.generation_id) {
      setErr((res.message as string) ?? "Couldn't start that design. Please try again.");
      setClassicBusy(null); return;
    }
    setClassicGenId(res.generation_id as string);
    watchClassic(res.generation_id as string);
  }
  async function reviseClassic() {
    if (!classicGenId || !classicNote.trim()) return;
    setErr(null); setClassicBusy("Applying your change…");
    const res = await reviseAction(classicGenId, classicNote.trim());
    if (!res.ok) { setErr((res.message as string) ?? "Couldn't apply that change."); setClassicBusy(null); return; }
    setClassicNote("");
    watchClassic(classicGenId);
  }
  async function fileClassic() {
    if (!classicGenId) return;
    const r = await setSectionAction(classicGenId, classicSection.trim() || null);
    if (r.ok) { setClassicFiled(true); const sec = classicSection.trim(); if (sec && !sections.includes(sec)) setSections((prev) => [...prev, sec].sort()); }
    else setErr(r.message as string);
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
    setPositions({}); setSizes({}); setSelected(null); setRegionSel(null); setHoverRole(null);
    setCleanedIds([]); setFinishMsg(null); setFinishNote(""); setPhotoTr({});
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
      photo_transforms: Object.keys(s.photoTr).length ? s.photoTr : undefined,
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
  // the colour role currently being targeted — from a tapped text element OR a tapped area OR the background
  const activeRole = selectedSlot?.role ?? regionSel?.role ?? null;
  const roleLabel = (role: string) => defaults?.colour_layers.find((c) => c.role === role)?.label ?? role;
  function selectSlot(id: string) { setSelected(id); setRegionSel(null); }
  function selectRegion(r: ColourRegion) { setRegionSel(r); setSelected(null); }
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
  // move/crop a photo inside its frame — nudge pans, zoom crops in
  function framePhoto(i: number, patch: Partial<{ zoom: number; x: number; y: number }>) {
    setPhotoTr((t) => {
      const cur = t[i] ?? { zoom: 1, x: 0.5, y: 0.5 };
      const next = { ...cur, ...patch };
      next.zoom = Math.min(4, Math.max(1, next.zoom));
      next.x = Math.min(1, Math.max(0, next.x));
      next.y = Math.min(1, Math.max(0, next.y));
      return { ...t, [i]: next };
    });
    setSaved(false); scheduleRender();
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
      if (!moved) selectSlot(s.id); else { setSaved(false); scheduleRender(); }
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
      photo_transforms: Object.keys(photoTr).length ? photoTr : undefined,
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
    setPositions({}); setSizes({}); setSelected(null); setRegionSel(null); setHoverRole(null);
    setCleanedIds([]); setFinishMsg(null); setFinishNote(""); setPhotoTr({});
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

      {/* ── STEP 1: PROPERTY (the one shared picker — search/filter + photos in place) ── */}
      {step === "property" && (
        <div>
          <button onClick={() => setStep("gallery")} className="mb-4 flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" /> Templates</button>
          <PropertyPicker onConfirm={(p, chosen) => {
            setProperty(p); setPhotos(chosen);
            void enterTemplateStep(p, chosen);
          }} />
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

          {/* the best 4 of the old engine's finished designs (Christian kept these) */}
          <div className="mt-8">
            <div className="mb-1 text-sm font-semibold text-neutral-900">Classic designs</div>
            <p className="mb-3 text-xs text-neutral-500">
              AI-finished looks — your photo gets polished and the design composed on top. Uses a credit · 2 free changes after.
            </p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {CLASSICS.map((cd) => (
                <button key={cd.key} onClick={() => void pickClassic(cd.key)}
                  className="group overflow-hidden rounded-xl border border-neutral-200 bg-white text-left transition hover:-translate-y-0.5 hover:border-neutral-900 hover:shadow-md">
                  <div className="aspect-[4/5] bg-neutral-100">
                    {classicThumbs[cd.key] === undefined ? (
                      <div className="flex h-full items-center justify-center text-neutral-300"><Loader2 className="h-5 w-5 animate-spin" /></div>
                    ) : classicThumbs[cd.key] ? (
                      <img src={classicThumbs[cd.key]!} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="flex h-full items-center justify-center px-3 text-center text-xs text-neutral-400">preview unavailable</div>
                    )}
                  </div>
                  <div className="p-2">
                    <div className="text-xs font-semibold text-neutral-800">{cd.name}</div>
                    <div className="text-[11px] text-neutral-400">{cd.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── CLASSIC RESULT: generated look with 2 free changes ─────────────────── */}
      {step === "classic" && (
        <div>
          <button onClick={() => { if (classicPoll.current) clearTimeout(classicPoll.current); setStep("template"); }}
            className="mb-4 flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" /> Templates</button>
          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
              {classicImage ? (
                <img src={classicImage} alt="Your design" className="w-full" referrerPolicy="no-referrer" />
              ) : (
                <div className="flex aspect-[4/5] flex-col items-center justify-center gap-3 text-neutral-400">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <p className="px-6 text-center text-sm">{classicBusy ?? "Working…"}</p>
                </div>
              )}
            </div>
            <div className="space-y-4">
              <div className="rounded-xl border border-neutral-200 p-3">
                <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Change something ({classicRevLeft} free change{classicRevLeft === 1 ? "" : "s"} left)
                </label>
                <textarea rows={2} value={classicNote} onChange={(e) => setClassicNote(e.target.value)} maxLength={1000}
                  disabled={!classicImage || classicRevLeft <= 0 || !!classicBusy}
                  placeholder="e.g. warmer evening light, remove the car"
                  className="mt-2 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 disabled:opacity-50" />
                <button onClick={() => void reviseClassic()} disabled={!classicImage || classicRevLeft <= 0 || !classicNote.trim() || !!classicBusy}
                  className="mt-2 w-full rounded-lg border border-neutral-900 px-4 py-2 text-sm font-medium text-neutral-900 disabled:border-neutral-200 disabled:text-neutral-400">
                  Apply change
                </button>
              </div>
              <div className="space-y-2 rounded-xl border border-neutral-200 p-3">
                <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">File it in a section</label>
                <input list="studio-sections" value={classicSection} onChange={(e) => { setClassicSection(e.target.value); setClassicFiled(false); }}
                  placeholder="e.g. Just listed (optional)"
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900" />
                <button onClick={() => void fileClassic()} disabled={!classicImage}
                  className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white ${classicFiled ? "bg-emerald-600" : "bg-neutral-900"} disabled:opacity-40`}>
                  {classicFiled ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}{classicFiled ? "Filed ✓" : "File in section"}
                </button>
                <p className="text-[11px] text-neutral-400">Saved to your library automatically — this only chooses where it lives.</p>
              </div>
              <button type="button" disabled={!classicImage}
                onClick={() => classicImage && void downloadImage(classicImage, `${property?.title || "post"}-${classicKey}.png`)}
                className={`flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700 ${classicImage ? "hover:bg-neutral-50" : "opacity-40"}`}>
                <Download className="h-4 w-4" /> Download image
              </button>
              {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}
            </div>
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
                      {/* tap empty image = the page background colour */}
                      <div className="absolute inset-0"
                        onPointerDown={() => selectRegion({ role: "background", bbox: [0, 0, canvas.width, canvas.height] })} />

                      {/* tappable non-text colour areas (panels, plates, badges) — under the text targets */}
                      {defaults.colour_regions.map((r, i) => (
                        <div key={`region-${i}`} title={roleLabel(r.role)}
                          onPointerDown={(e) => { e.stopPropagation(); selectRegion(r); }}
                          style={{ left: r.bbox[0] * scale, top: r.bbox[1] * scale, width: (r.bbox[2] - r.bbox[0]) * scale, height: (r.bbox[3] - r.bbox[1]) * scale }}
                          className={`absolute cursor-pointer rounded-[3px] transition ${
                            hoverRole === r.role ? "bg-emerald-400/25 outline outline-2 outline-emerald-500"
                            : regionSel?.role === r.role ? "outline outline-2 outline-emerald-500"
                            : "hover:outline hover:outline-2 hover:outline-emerald-400/50"}`} />
                      ))}

                      {defaults.editable_slots.filter((s) => (text[s.id] ?? "").trim() && !s.rotate).map((s) => {
                        const b = slotBox(s); const sel = selected === s.id;
                        return (
                          <div key={s.id} title={s.label} onPointerDown={(e) => onSlotDown(e, s)}
                            style={{ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale }}
                            className={`absolute cursor-grab touch-none rounded-[3px] transition ${
                              hoverRole === s.role ? "bg-emerald-400/25 outline outline-2 outline-emerald-500"
                              : sel ? "outline outline-2 outline-emerald-500"
                              : "hover:outline hover:outline-2 hover:outline-emerald-400/60"}`} />
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

                  {/* tapped an AREA (background / panel / badge) → recolour it right there */}
                  {preview && regionSel && !selectedSlot && !defaults.palette_locked && scale > 0 && (() => {
                    const b = regionSel.bbox;
                    return (
                      <div className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
                        style={{ left: ((b[0] + b[2]) / 2) * scale, top: ((b[1] + b[3]) / 2) * scale }}>
                        <label className="relative flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 shadow-lg">
                          <span className="h-4 w-4 rounded border border-black/15" style={{ background: colours[regionSel.role] ?? "#888888" }} />
                          <span className="whitespace-nowrap text-xs font-medium text-neutral-700">{roleLabel(regionSel.role)}</span>
                          <input type="color" value={colours[regionSel.role] ?? "#888888"}
                            onChange={(e) => editColour(regionSel.role, e.target.value)}
                            className="absolute inset-0 cursor-pointer opacity-0" />
                        </label>
                      </div>
                    );
                  })()}

                  {rendering && <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-xs text-neutral-600 shadow"><Loader2 className="h-3 w-3 animate-spin" /> updating…</div>}
                </div>

                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-neutral-500">
                  <span className="min-w-0 truncate">
                    {selectedSlot ? <>Selected <b className="text-neutral-800">{selectedSlot.label}</b> — drag to move, toolbar to recolour &amp; resize</>
                      : regionSel ? <>Selected <b className="text-neutral-800">{roleLabel(regionSel.role)}</b> — tap the colour chip to change it</>
                      : "Tap anything on the image — text, a panel, the background — to select and recolour it."}
                  </span>
                  {(Object.keys(positions).length > 0 || Object.keys(sizes).length > 0) && (
                    <button onClick={() => { setPositions({}); setSizes({}); setSelected(null); scheduleRender(); }} className="shrink-0 underline hover:text-neutral-800">Reset layout</button>
                  )}
                </div>
                {err && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}

                {/* colours live UNDER the template (Christian 2026-07-15) — tap a swatch to see what it
                    changes flash on the image, or tap the thing itself above. */}
                {!defaults.palette_locked && (
                  <div className="mt-4">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Colours</div>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {defaults.colour_layers.filter((cl) => cl.used).map((cl) => (
                        <label key={cl.role} onPointerEnter={() => setHoverRole(cl.role)} onPointerLeave={() => setHoverRole(null)}
                          className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 transition ${activeRole === cl.role ? "border-emerald-500 ring-1 ring-emerald-500" : "border-neutral-200 hover:border-neutral-400"}`}>
                          <span className="relative h-7 w-full overflow-hidden rounded-lg border border-black/10" style={{ background: colours[cl.role] ?? cl.value }}>
                            <input type="color" value={colours[cl.role] ?? cl.value}
                              onChange={(e) => editColour(cl.role, e.target.value)}
                              className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                          </span>
                          <span className="max-w-full truncate text-[11px] font-medium text-neutral-600">{cl.label}</span>
                        </label>
                      ))}
                    </div>
                    {BAKED_ART_NOTE[templateId ?? ""] && (
                      <p className="mt-2 text-[11px] text-neutral-400">{BAKED_ART_NOTE[templateId ?? ""]}</p>
                    )}
                  </div>
                )}
                {defaults.palette_locked && (
                  <p className="mt-3 text-[11px] text-neutral-400">This template keeps its own colours — they&apos;re part of its design.</p>
                )}
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


              {/* move / crop each photo inside its frame */}
              {photos.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Photos</div>
                  <p className="mb-2 text-[11px] text-neutral-400">Not framed how you want it? Move it or zoom in.</p>
                  <div className="space-y-2">
                    {photos.map((u, i) => {
                      const t = photoTr[i] ?? { zoom: 1, x: 0.5, y: 0.5 };
                      const moved = !!photoTr[i];
                      return (
                        <div key={u} className="flex items-center gap-2 rounded-lg border border-neutral-200 p-2">
                          <img src={u} alt="" referrerPolicy="no-referrer" className="h-11 w-11 shrink-0 rounded object-cover" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <span className="w-8 shrink-0 text-[10px] font-medium uppercase text-neutral-400">Zoom</span>
                              <input type="range" min={1} max={4} step={0.1} value={t.zoom}
                                onChange={(e) => framePhoto(i, { zoom: Number(e.target.value) })}
                                className="h-1 w-full cursor-pointer accent-neutral-900" />
                            </div>
                            <div className="mt-1 flex items-center gap-1">
                              <span className="w-8 shrink-0 text-[10px] font-medium uppercase text-neutral-400">Move</span>
                              <div className="flex gap-1">
                                <button onClick={() => framePhoto(i, { x: t.x - 0.08 })} className="rounded border border-neutral-200 px-1.5 text-xs text-neutral-600 hover:bg-neutral-50" title="Left">←</button>
                                <button onClick={() => framePhoto(i, { x: t.x + 0.08 })} className="rounded border border-neutral-200 px-1.5 text-xs text-neutral-600 hover:bg-neutral-50" title="Right">→</button>
                                <button onClick={() => framePhoto(i, { y: t.y - 0.08 })} className="rounded border border-neutral-200 px-1.5 text-xs text-neutral-600 hover:bg-neutral-50" title="Up">↑</button>
                                <button onClick={() => framePhoto(i, { y: t.y + 0.08 })} className="rounded border border-neutral-200 px-1.5 text-xs text-neutral-600 hover:bg-neutral-50" title="Down">↓</button>
                                {moved && (
                                  <button onClick={() => { setPhotoTr((p) => { const n = { ...p }; delete n[i]; return n; }); setSaved(false); scheduleRender(); }}
                                    className="ml-1 text-[10px] text-neutral-400 underline hover:text-neutral-700">reset</button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

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
              <button type="button" disabled={!preview}
                onClick={() => preview && void downloadImage(preview, `${property?.title || "post"}-${templateId}.png`)}
                className={`flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700 ${preview ? "hover:bg-neutral-50" : "opacity-40"}`}>
                <Download className="h-4 w-4" /> Download image
              </button>
              <button onClick={reset} className="w-full text-center text-xs text-neutral-400 hover:text-neutral-600">Start over</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
