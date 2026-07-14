// image-generate-create — W13 image generation create path v0.6.7 (AIVENA Studio).
// v0.6.7 (2026-07-14): KIE output raised to 4K (Christian: "all kie should be done in 4k so its the best
//   quality possible"). seedream-v4-edit's image_resolution accepts 1K|2K|4K per docs.kie.ai/market/seedream/
//   seedream-v4-edit — it was hardcoded "2K". image_size stays omitted so the source aspect ratio is preserved.
//   KIE's ROLE IS PHOTOS ONLY (Christian 2026-07-14): it is given the image(s) and told to remove watermarks +
//   apply the requested aesthetic changes; it NEVER renders text. The cleaned photo goes back into the
//   deterministic template, which draws every fact itself. That is why `template:"none"` (raw cleaned photo out)
//   is the lever the template finishing pass uses.
//   NOTE: this file was deploy-only (not in the repo) until now; it is captured here as the source of truth.
// v0.6.6 (2026-06-16): photo-enhancement model switched off Google's nano-banana-edit (E005 "sensitive"
//   false-flags on normal property photos, non-deterministic — same photo passes one attempt, fails the next)
//   to ByteDance bytedance/seedream-v4-edit. Renovation stays on nano-banana-edit. Seedream input:
//   image_urls + image_resolution + nsfw_checker; image_size omitted to preserve source aspect ratio
//   (studio-compose cover-fits the final canvas). Same jobs/createTask endpoint + same callback envelope.
// v0.6.5 (2026-06-16): launch content_type auto-fills the 3-stat row from the property
//   (Bedrooms / Bathrooms / From-price, 13-lang) when the wizard sends no stats; +launch_hero composition.
// v0.6.4 (2026-06-15): price_text/specs_text now accept body overrides (any content_type),
// falling back to listing auto-fill. Enables sold price + "from €X" launch + manual price.
// v0.6.3: VALID_COMPOSITION +9 layouts to match studio-compose v3.4.
// v0.6.2: preview_only flag — compose design over the ORIGINAL photo, synchronously, free.
// v0.6.1: prompt-builder (free-text optional). v0.6: wizard contract → studio-compose v3.1.
// Auth: x-internal-secret vs Vault. Quota charged on success only (callback). Law-2.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY         = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const KIE_CREATE_URL  = "https://api.kie.ai/api/v1/jobs/createTask";
const CALLBACK_BASE   = "https://atminvhrybxegpdtnnpl.supabase.co/functions/v1/image-generate-callback";
const COMPOSE_URL     = "https://atminvhrybxegpdtnnpl.supabase.co/functions/v1/studio-compose";

const MODEL_T2I     = "google/nano-banana";
const MODEL_EDIT    = "google/nano-banana-edit";
const MODEL_ENHANCE = "bytedance/seedream-v4-edit"; // photo-enhance path: off Google's safety stack (nano-banana E005 false-flags). Renovation keeps MODEL_EDIT.

// Max-quality KIE output. seedream-v4-edit accepts "1K" | "2K" | "4K" (verified against docs.kie.ai).
const KIE_IMAGE_RESOLUTION = "4K";

// Only photos WE host count when deriving photos from a property row — montinmo.es (the source of ~57% of the
// demo catalog's hotlinks) is permanently gone, and any third-party hotlink dies with its host. Mirrors the
// shared rule in apps/api/src/lib/property-images.ts (body-provided URLs are the caller's responsibility and
// may be signed, so they are NOT filtered by this).
const OWNED_STORAGE_MARKER = "/storage/v1/object/public/property-images/";
const usableCatalogPhoto = (u: unknown): u is string => typeof u === "string" && u.includes(OWNED_STORAGE_MARKER);

const MODEL_BY_TYPE: Record<string, string> = {
  ad_creative:  MODEL_T2I,
  social_post:  MODEL_T2I,
  renovation:   MODEL_EDIT,
};
const VALID_TYPES = ["ad_creative", "social_post", "renovation"];

const VALID_CONTENT     = ["listing", "brand", "educational", "sold", "launch"];
const VALID_COMPOSITION = ["full_bleed", "bottom_panel", "side_panel", "framed", "split", "collage", "magazine", "editorial", "postcard", "band", "quote", "stat", "statement", "project", "price_hero", "launch_hero"];
const VALID_TEXT        = ["on_photo", "scrim", "negative_space"];
const VALID_FONTSET     = ["serif", "sans", "mixed"];
const VALID_COLOR       = ["photo_only", "accent_line", "color_block"];

const VALID_TEMPLATES = ["new_listing", "open_house", "sold", "ad_classic", "label_only", "none"];
const VALID_STYLES    = ["editorial", "elegant", "modern", "bold"];

type L = Record<string, string>;
const STR_NEW: L = { en: "New listing", es: "Nuevo en venta", de: "Neu im Angebot", nl: "Nieuw aanbod", fr: "Nouveau bien", it: "Nuovo annuncio", pl: "Nowa oferta", pt: "Novo imóvel", ru: "Новый объект", sv: "Ny bostad", no: "Ny bolig", da: "Ny bolig", fi: "Uusi kohde" };
const STR_OPEN: L = { en: "Open house", es: "Puertas abiertas", de: "Besichtigung", nl: "Open huis", fr: "Portes ouvertes", it: "Porte aperte", pl: "Dzień otwarty", pt: "Casa aberta", ru: "Открытый показ", sv: "Visning", no: "Visning", da: "Åbent hus", fi: "Avoimet ovet" };
const STR_SOLD: L = { en: "Sold", es: "Vendido", de: "Verkauft", nl: "Verkocht", fr: "Vendu", it: "Venduto", pl: "Sprzedane", pt: "Vendido", ru: "Продано", sv: "Såld", no: "Solgt", da: "Solgt", fi: "Myyty" };
const STR_JUST: L = { en: "Just", es: "Recién", de: "Soeben", nl: "Zojuist", fr: "À l'instant", it: "Appena", pl: "Właśnie", pt: "Agora", ru: "Только что", sv: "Nyss", no: "Nettopp", da: "Netop", fi: "Juuri" };
const STR_CTA: L = { en: "Book a viewing", es: "Reserva una visita", de: "Besichtigung buchen", nl: "Plan een bezichtiging", fr: "Réserver une visite", it: "Prenota una visita", pl: "Umów wizytę", pt: "Marcar visita", ru: "Записаться на просмотр", sv: "Boka visning", no: "Book visning", da: "Book fremvisning", fi: "Varaa esittely" };
const STR_LABEL: L = { en: "AI-enhanced", es: "Mejorada con IA", de: "KI-optimiert", nl: "AI-bewerkt", fr: "Améliorée par IA", it: "Migliorata con IA", pl: "Ulepszone przez AI", pt: "Melhorada por IA", ru: "Улучшено ИИ", sv: "AI-förbättrad", no: "AI-forbedret", da: "AI-forbedret", fi: "AI-paranneltu" };
const STR_BED: L = { en: "bed", es: "dorm", de: "SZ", nl: "slpk", fr: "ch", it: "cam", pl: "syp", pt: "qts", ru: "спал", sv: "sov", no: "sov", da: "sov", fi: "mh" };
const STR_BATH: L = { en: "bath", es: "baño", de: "Bad", nl: "badk", fr: "sdb", it: "bagno", pl: "łaz", pt: "wc", ru: "ванн", sv: "bad", no: "bad", da: "bad", fi: "kph" };
// Full-word stat-row labels (launch 3-stat row). Distinct from the abbreviated STR_BED/STR_BATH used in specs_text.
const STR_BEDROOMS: L = { en: "Bedrooms", es: "Dormitorios", de: "Schlafzimmer", nl: "Slaapkamers", fr: "Chambres", it: "Camere", pl: "Sypialnie", pt: "Quartos", ru: "Спальни", sv: "Sovrum", no: "Soverom", da: "Soveværelser", fi: "Makuuhuoneet" };
const STR_BATHROOMS: L = { en: "Bathrooms", es: "Baños", de: "Badezimmer", nl: "Badkamers", fr: "Salles de bain", it: "Bagni", pl: "Łazienki", pt: "Casas de banho", ru: "Ванные", sv: "Badrum", no: "Bad", da: "Badeværelser", fi: "Kylpyhuoneet" };
const STR_FROM: L = { en: "From", es: "Desde", de: "Ab", nl: "Vanaf", fr: "À partir de", it: "Da", pl: "Od", pt: "Desde", ru: "От", sv: "Från", no: "Fra", da: "Fra", fi: "Alkaen" };
function t(map: L, lang: string): string { return map[lang] ?? map.en; }

function formatPriceEUR(price: unknown): string | null {
  const n = typeof price === "string" ? parseFloat(price) : typeof price === "number" ? price : NaN;
  if (!isFinite(n) || n <= 0) return null;
  const intPart = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${intPart} €`;
}

const ENHANCE_BASE =
  "Professional real-estate photo enhancement of the exact property shown. " +
  "Keep the architecture, room layout, walls, windows, views and every structural element exactly as in the original photo. " +
  "Remove any watermark text, logos, phone numbers or website overlays printed on the photo. " +
  "Relight and color-grade like a top architectural photographer: warm, natural, inviting light with golden-hour warmth where it fits, rich but realistic colors, crisp detail, blue sky if outdoors. Tidy and declutter loose objects; subtly improve styling. " +
  "Not allowed: adding or removing rooms, walls, windows, pools or views; repairing visible damage; changing what the property fundamentally is; adding any text, words, letters, logos or watermarks. " +
  "Photorealistic, magazine-grade property marketing quality.";
// CLEAN-ONLY (Christian 2026-07-14): the template finishing pass hands KIE a photo purely to strip the portal
// watermark. An empty request box must NOT relight, colour-grade or declutter — ENHANCE_BASE does all three, so
// it is the wrong prompt for this job. Anything the agent explicitly asks for is appended as the ONLY extra change.
const CLEAN_ONLY_BASE =
  "Remove any watermark text, logos, phone numbers or website overlays printed on this property photo. " +
  "Change absolutely nothing else. Keep the exact same lighting, exposure, brightness, contrast, colours, " +
  "white balance, framing, composition, furniture, decor, clutter and every structural element precisely as in " +
  "the original photo. Do not relight. Do not colour-grade. Do not declutter, tidy or restyle. Do not sharpen or " +
  "beautify. Do not add or remove anything. Reconstruct only the small areas the removed overlay covered, " +
  "matching the surrounding pixels exactly. The output must be indistinguishable from the original except that " +
  "the overlay is gone. No text, letters, logos or watermarks in the image.";
// SMART DESIGN MODE (Christian 2026-07-14) — the ONE place KIE is allowed to render text and invent a layout:
// "i want it to make its own template, just whatever he thinks looks best... in this smart section kie needs to
// be the one to handle text and everything, but he has creative freedom." Every other path keeps the
// deterministic rule (KIE = photos only, the engine draws the facts).
// The facts are handed over VERBATIM so creative freedom never becomes invented data — the model is told to
// reproduce them exactly and add nothing else.
const VALID_IMAGE_SIZES = [
  "square", "square_hd", "portrait_4_3", "portrait_3_2", "portrait_16_9",
  "landscape_4_3", "landscape_3_2", "landscape_16_9", "landscape_21_9",
];
function buildDesignBrief(opts: {
  property: any; agencyName: string | null; language: string; agentNote: string | null; contentType: string;
}): string {
  const p = opts.property;
  const facts: string[] = [];
  if (p?.title) facts.push(`Headline: ${p.title}`);
  const price = formatPriceEUR(p?.price);
  if (price) facts.push(`Price: ${price}`);
  const specs: string[] = [];
  if (p?.bedrooms) specs.push(`${p.bedrooms} ${t(STR_BEDROOMS, opts.language)}`);
  if (p?.bathrooms) specs.push(`${p.bathrooms} ${t(STR_BATHROOMS, opts.language)}`);
  if (p?.area_sqm) specs.push(`${p.area_sqm} m2`);
  if (specs.length) facts.push(`Details: ${specs.join(" · ")}`);
  const loc = [p?.location_city, p?.location_region].filter(Boolean).join(", ");
  if (loc) facts.push(`Location: ${loc}`);
  if (opts.agencyName) facts.push(`Agency: ${opts.agencyName}`);

  return [
    "Design a premium real-estate social media marketing post using the supplied photo(s) of this property.",
    "You have full creative freedom over the layout, composition, typography, colour and styling — make it look",
    "like the work of a high-end property brand's art director. Use the supplied photos as the imagery.",
    facts.length
      ? "Render EXACTLY these facts, word for word and digit for digit — never invent, alter, round or add to them:\n- " + facts.join("\n- ")
      : "Do not put any factual claims, prices or numbers on the image.",
    "Spell every word correctly. Do NOT add any other text, prices, phone numbers, dates, ratings or claims that are not listed above.",
    "Do not change the property itself: no adding or removing rooms, walls, pools or views. Remove any watermark, logo or website overlay already printed on the photos.",
    `All text must be written in this language: ${opts.language}.`,
    opts.agentNote ? `The agent specifically asks for: ${opts.agentNote}` : "",
    "Photorealistic photography, magazine-grade marketing quality.",
  ].filter(Boolean).join(" ");
}
const NEGSPACE_HINT =
  " Compose with generous clean empty space (clear sky, plain wall or floor) on one side or the lower third where marketing text can later be placed; keep that area free of clutter and detail.";
const RENOVATION_GUARD =
  " Keep the room's structure, walls, windows, ceiling and view exactly as in the original photo. Furniture, decor, surfaces and styling may change. Remove any watermark text or logo overlays printed on the photo. Photorealistic interior-design quality. No text, letters, logos or watermarks in the image.";

function j(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function selectHeroPhoto(urls: string[], propertyTitle: string): Promise<{ index: number; reason: string } | null> {
  if (!ANTHROPIC_API_KEY || urls.length < 2) return null;
  try {
    const content: unknown[] = urls.slice(0, 8).map((u) => ({ type: "image", source: { type: "url", url: u } }));
    content.push({
      type: "text",
      text: `These are listing photos of "${propertyTitle}". You are the creative director of a premium property brand choosing the single HERO photo for a social media creative. Choose the most striking, bright, emotionally appealing frame: stunning interiors, terraces with views, pools, dramatic exteriors. Strongly avoid: dull or flat facades, dark/blurry/low-quality shots, cluttered rooms, and frames where a watermark or text overlay covers an important area. Reply with ONLY JSON: {"best_index": <0-based index>, "reason": "<short>"}`,
    });
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 150, messages: [{ role: "user", content }] }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const txt = (data?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    const parsed = JSON.parse(txt.replace(/```json|```/g, "").trim());
    const idx = Number(parsed?.best_index);
    if (Number.isInteger(idx) && idx >= 0 && idx < Math.min(urls.length, 8)) {
      return { index: idx, reason: String(parsed?.reason ?? "").slice(0, 200) };
    }
    return null;
  } catch { return null; }
}

function legacyContentType(template: string, genType: string): string {
  if (template === "sold") return "sold";
  if (genType === "social_post" || genType === "ad_creative") return "listing";
  return "listing";
}
function legacyComposition(genType: string): string {
  return "full_bleed";
}

const VALID_MOODS = ["sunny_bright", "golden_hour", "cozy_evening", "clean_neutral"];
const MOOD_DIRECTIVE: Record<string, string> = {
  sunny_bright: "Bright sunny Mediterranean daylight, clear blue sky, vivid but natural colors, airy and fresh.",
  golden_hour:  "Warm golden-hour light, soft long shadows, glowing inviting tones, premium and aspirational.",
  cozy_evening: "Warm cozy evening ambiance, soft interior lighting glowing, calm and intimate mood.",
  clean_neutral: "Clean neutral editorial light, balanced and crisp, magazine-grade and understated.",
};
const CONTENT_MOOD_DEFAULT: Record<string, string> = {
  listing: "sunny_bright",
  launch:  "golden_hour",
  sold:    "golden_hour",
  brand:   "clean_neutral",
  educational: "clean_neutral",
};
function buildEnhanceDirective(opts: { contentType: string; mood: string | null; agentNote: string | null; }): string {
  const note = (opts.agentNote ?? "").trim();
  if (note) return note;
  const mood = opts.mood && VALID_MOODS.includes(opts.mood) ? opts.mood
    : (CONTENT_MOOD_DEFAULT[opts.contentType] ?? "sunny_bright");
  return MOOD_DIRECTIVE[mood];
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return j(405, { ok: false, error: "method_not_allowed", message: "Use POST." });

  const presented = req.headers.get("x-internal-secret") ?? "";
  if (!presented) return j(401, { ok: false, error: "unauthorized", message: "Authentication failed." });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: expectedSecret } = await admin.rpc("_get_platform_secret", { p_name: "IMAGE_GEN_INTERNAL_SECRET" });
  if (!expectedSecret || !constantTimeEqual(presented, expectedSecret)) {
    return j(401, { ok: false, error: "unauthorized", message: "Authentication failed." });
  }

  let body: any;
  try { body = await req.json(); } catch { return j(400, { ok: false, error: "invalid_json", message: "Request body must be valid JSON." }); }

  const { agency_id, generation_type, prompt, source_property_id, requested_by } = body ?? {};
  let source_image_url: string | null = typeof body?.source_image_url === "string" && body.source_image_url ? body.source_image_url : null;
  const width  = Number.isInteger(body?.width)  ? body.width  : null;
  const height = Number.isInteger(body?.height) ? body.height : null;
  const language: string = typeof body?.language === "string" && body.language ? (body.language === "nb" ? "no" : body.language) : "en";
  const mood: string | null = typeof body?.mood === "string" ? body.mood : null;
  const agentNote: string | null = typeof prompt === "string" && prompt.trim() ? prompt.trim() : null;
  const previewOnly: boolean = body?.preview_only === true;
  // clean_only: watermark removal ONLY — no relight/grade/declutter. Used by the template finishing pass.
  const cleanOnly: boolean = body?.clean_only === true;
  // design_mode: SMART only — KIE composes the whole post (layout + text) from ALL the chosen photos.
  const designMode: boolean = body?.design_mode === true;
  const imageSize: string | null = typeof body?.image_size === "string" && VALID_IMAGE_SIZES.includes(body.image_size) ? body.image_size : null;

  if (!agency_id || typeof agency_id !== "string") return j(400, { ok: false, error: "missing_agency_id", message: "Something went wrong. Please try again." });
  if (!VALID_TYPES.includes(generation_type))       return j(400, { ok: false, error: "invalid_generation_type", message: "Unknown generation type." });
  if (agentNote && agentNote.length > 4000) return j(400, { ok: false, error: "prompt_too_long", message: "That request is too long." });
  if (!previewOnly && generation_type === "renovation" && !agentNote) return j(400, { ok: false, error: "missing_prompt", message: "Please describe the renovation you'd like to see." });
  if (!previewOnly && generation_type === "renovation" && !source_image_url) {
    return j(400, { ok: false, error: "missing_source_image", message: "A source photo is required for this." });
  }

  const legacyTemplate: string | null = typeof body?.template === "string" && VALID_TEMPLATES.includes(body.template) ? body.template : null;
  let contentType: string = VALID_CONTENT.includes(body?.content_type) ? body.content_type
    : legacyContentType(legacyTemplate ?? "", generation_type);
  let composition: string = VALID_COMPOSITION.includes(body?.composition) ? body.composition
    : legacyComposition(generation_type);
  const textTreatment: string = VALID_TEXT.includes(body?.text_treatment) ? body.text_treatment : "on_photo";
  const fontSet: string = VALID_FONTSET.includes(body?.font_set) ? body.font_set : "serif";
  const colorTreatment: string = VALID_COLOR.includes(body?.color_treatment) ? body.color_treatment : "photo_only";
  const wantsCompose: boolean = legacyTemplate !== "none";

  const imageStoragePaths: string[] = Array.isArray(body?.image_storage_paths)
    ? body.image_storage_paths.filter((x: unknown) => typeof x === "string" && x) : [];
  const imageUrls: string[] = Array.isArray(body?.image_urls)
    ? body.image_urls.filter((x: unknown) => typeof x === "string" && (x as string).startsWith("http")) : [];

  if (!previewOnly) {
    const { data: quota, error: quotaErr } = await admin.rpc("image_gen_check_quota", {
      p_agency_id: agency_id, p_generation_type: generation_type,
    });
    if (quotaErr) return j(500, { ok: false, error: "quota_check_failed", message: "Something went wrong. Please try again." });
    if (!quota?.ok) {
      return j(409, { ok: false, error: "quota_unavailable", message: "You've reached your plan's limit for this. Upgrade or wait for the next cycle.", reason: quota?.reason ?? "unknown", quota: quota?.quota ?? null, used: quota?.used ?? null });
    }
  }

  let property: any = null;
  if (source_property_id) {
    const { data } = await admin.from("properties")
      .select("id, title, location_city, location_region, price, bedrooms, bathrooms, area_sqm, images")
      .eq("id", source_property_id).eq("agency_id", agency_id).maybeSingle();
    property = data ?? null;
  }
  let branding: any = null;
  {
    const { data } = await admin.from("agency_branding")
      .select("brand_name, logo_url, primary_color, accent_color")
      .eq("agency_id", agency_id).maybeSingle();
    branding = data ?? null;
  }
  let agencyName: string | null = branding?.brand_name ?? null;
  if (!agencyName) {
    const { data } = await admin.from("agencies").select("trading_name, legal_name").eq("id", agency_id).maybeSingle();
    agencyName = data?.trading_name ?? data?.legal_name ?? "Your agency";
  }

  let photoSelection: { index: number; reason: string; method: string } | null = null;
  const agentPickedPhotos = imageUrls.length > 0 || imageStoragePaths.length > 0 || !!source_image_url;
  if (!previewOnly && !agentPickedPhotos && property && generation_type !== "renovation") {
    let imgs: string[] = [];
    try { imgs = Array.isArray(property.images) ? property.images : JSON.parse(property.images ?? "[]"); } catch { imgs = []; }
    imgs = imgs.filter(usableCatalogPhoto);
    if (imgs.length > 0) {
      const picked = await selectHeroPhoto(imgs, property.title ?? "property");
      const idx = picked?.index ?? 0;
      source_image_url = imgs[idx];
      photoSelection = { index: idx, reason: picked?.reason ?? "first image fallback", method: picked ? "claude_vision" : "fallback_first" };
    }
  }
  if (!source_image_url && imageUrls.length > 0) source_image_url = imageUrls[0];

  let model = (typeof body?.model === "string" && body.model) ? body.model : MODEL_BY_TYPE[generation_type];
  const directive = buildEnhanceDirective({ contentType, mood, agentNote });
  let finalPrompt = directive;
  if (generation_type === "renovation") {
    finalPrompt = (agentNote ?? "") + RENOVATION_GUARD;
  } else if (source_image_url && designMode) {
    // SMART: full creative freedom — KIE lays out the post AND renders the text, from every chosen photo.
    model = MODEL_ENHANCE; // seedream-v4-edit: many reference images in, one composed design out
    finalPrompt = buildDesignBrief({ property, agencyName, language, agentNote, contentType });
  } else if (source_image_url && cleanOnly) {
    // Watermark removal only. An agent note is the ONLY additional change allowed — never the mood directive.
    model = MODEL_ENHANCE;
    finalPrompt = CLEAN_ONLY_BASE + (agentNote ? " Additionally, apply ONLY this specific requested change, and nothing more: " + agentNote : "");
  } else if (source_image_url) {
    model = MODEL_ENHANCE;
    finalPrompt = ENHANCE_BASE + (textTreatment === "negative_space" ? NEGSPACE_HINT : "") + " Creative direction: " + directive;
  }

  let compose: any = null;
  if (wantsCompose) {
    const specsParts: string[] = [];
    if (property?.bedrooms) specsParts.push(`${property.bedrooms} ${t(STR_BED, language)}`);
    if (property?.bathrooms) specsParts.push(`${property.bathrooms} ${t(STR_BATH, language)}`);
    const kicker = property ? [property.location_city, property.location_region ?? "Alicante"].filter(Boolean).join(", ") : null;
    const isSold = contentType === "sold";
    const labelText = (contentType === "renovation" || generation_type === "renovation") ? t(STR_LABEL, language) : null;
    const priceOverride = typeof body?.price_text === "string" && body.price_text.trim() ? body.price_text.trim() : null;
    const specsOverride = typeof body?.specs_text === "string" && body.specs_text.trim() ? body.specs_text.trim() : null;

    // Launch: auto-fill the 3-stat row from the property when the wizard sends no stats.
    // Trio = Bedrooms / Bathrooms / From-price (13-lang labels). From-value honours a price_text override.
    let autoLaunchStats: { label: string; value: string }[] | null = null;
    if (contentType === "launch" && property) {
      const ls: { label: string; value: string }[] = [];
      if (property.bedrooms !== null && property.bedrooms !== undefined && `${property.bedrooms}` !== "") ls.push({ label: t(STR_BEDROOMS, language), value: `${property.bedrooms}` });
      if (property.bathrooms !== null && property.bathrooms !== undefined && `${property.bathrooms}` !== "") ls.push({ label: t(STR_BATHROOMS, language), value: `${property.bathrooms}` });
      const fromVal = priceOverride ?? formatPriceEUR(property.price);
      if (fromVal) ls.push({ label: t(STR_FROM, language), value: fromVal });
      if (ls.length) autoLaunchStats = ls.slice(0, 3);
    }

    const copy: any = {
      kicker: typeof body?.kicker === "string" ? body.kicker : (isSold ? (property?.title ?? kicker) : kicker),
      headline: typeof body?.headline === "string" && body.headline ? body.headline
        : (isSold ? t(STR_SOLD, language) : (property?.title ?? null)),
      price_text: priceOverride ?? ((contentType === "listing") ? formatPriceEUR(property?.price) : null),
      specs_text: specsOverride ?? ((contentType === "listing" && specsParts.length) ? specsParts.join(" · ") : null),
      badge_text: typeof body?.badge_text === "string" && body.badge_text ? body.badge_text
        : (isSold ? t(STR_JUST, language) : null),
      cta_text: typeof body?.cta_text === "string" ? body.cta_text
        : (contentType === "listing" ? t(STR_CTA, language) : null),
      tagline: typeof body?.tagline === "string" ? body.tagline : null,
      bullets: Array.isArray(body?.bullets) ? body.bullets.filter((b: unknown) => typeof b === "string").slice(0, 4) : null,
      stats: Array.isArray(body?.stats) ? body.stats.filter((s: any) => s && typeof s.label === "string").slice(0, 3) : autoLaunchStats,
      location_text: kicker,
      label_text: labelText,
    };

    compose = {
      content_type: contentType,
      composition,
      text_treatment: textTreatment,
      font_set: fontSet,
      color_treatment: colorTreatment,
      badge_label: contentType === "listing" ? t(STR_NEW, language) : (typeof body?.badge_label === "string" ? body.badge_label : t(STR_NEW, language)),
      extra_storage_paths: imageStoragePaths,
      copy,
      brand: {
        name: agencyName,
        logo_url: branding?.logo_url ?? null,
        primary_color: branding?.primary_color ?? null,
        accent_color: branding?.accent_color ?? null,
      },
      language,
    };
  }

  if (previewOnly) {
    if (!wantsCompose || !compose) return j(400, { ok: false, error: "preview_not_composable", message: "Nothing to preview." });
    let previewBody: Record<string, unknown> | null = null;
    if (imageStoragePaths.length > 0) previewBody = { image_storage_path: imageStoragePaths.length > 1 ? imageStoragePaths : imageStoragePaths[0] };
    else if (imageUrls.length > 0)    previewBody = { image_url: imageUrls.length > 1 ? imageUrls : imageUrls[0] };
    else if (source_image_url)        previewBody = { image_url: source_image_url };
    else if (property) {
      let imgs: string[] = [];
      try { imgs = Array.isArray(property.images) ? property.images : JSON.parse(property.images ?? "[]"); } catch { imgs = []; }
      imgs = imgs.filter(usableCatalogPhoto);
      if (imgs.length > 0) previewBody = { image_url: imgs[0] };
    }
    if (!previewBody) return j(400, { ok: false, error: "missing_preview_photo", message: "Please pick a photo to preview." });

    const { data: secret } = await admin.rpc("_get_platform_secret", { p_name: "IMAGE_GEN_INTERNAL_SECRET" });
    if (!secret) return j(500, { ok: false, error: "credentials_unavailable", message: "Something went wrong. Please try again." });

    const W = width ?? 1080, H = height ?? 1350;
    const outPath = `${agency_id}/_preview_${crypto.randomUUID().replace(/-/g, "")}.png`;
    try {
      const resp = await fetch(COMPOSE_URL, {
        method: "POST",
        headers: { "x-internal-secret": secret, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...previewBody,
          content_type: compose.content_type,
          composition: compose.composition,
          text_treatment: compose.text_treatment,
          font_set: compose.font_set,
          color_treatment: compose.color_treatment,
          width: W, height: H, out_path: outPath,
          badge_label: compose.badge_label,
          copy: compose.copy, brand: compose.brand,
        }),
      });
      const data = await resp.json().catch(() => null);
      if (resp.ok && data?.ok && data?.signed_url) {
        return j(200, {
          ok: true, preview: true,
          signed_url: data.signed_url,
          storage_path: data.storage_path,
          width: data.width, height: data.height,
          content_type: compose.content_type,
          composition: compose.composition,
        });
      }
      return j(502, { ok: false, error: "preview_compose_failed", message: "Couldn't render the preview. Please try again." });
    } catch {
      return j(502, { ok: false, error: "preview_compose_failed", message: "Couldn't render the preview. Please try again." });
    }
  }

  const callbackToken = crypto.randomUUID().replace(/-/g, "");
  const { data: genRow, error: insErr } = await admin
    .from("image_generations")
    .insert({
      agency_id,
      generation_type,
      status: "pending",
      prompt: agentNote ?? directive,
      prompt_language: language,
      source_property_id: source_property_id ?? null,
      source_image_url: source_image_url ?? null,
      width, height,
      kie_model: model,
      callback_token: callbackToken,
      requested_by: requested_by ?? null,
      raw_request: {
        generation_type, model, has_source_image: !!source_image_url,
        pipeline: "v0.6",
        content_type: contentType,
        composition,
        text_treatment: textTreatment,
        font_set: fontSet,
        color_treatment: colorTreatment,
        mood,
        agent_note: agentNote,
        enhance_prompt: finalPrompt,
        photo_selection: photoSelection,
        compose,
      },
    })
    .select("id")
    .single();

  if (insErr || !genRow) return j(500, { ok: false, error: "create_row_failed", message: "Something went wrong. Please try again." });
  const genId: string = genRow.id;

  const { data: kieKey } = await admin.rpc("_get_platform_secret", { p_name: "KIE_API_KEY" });
  if (!kieKey) {
    await admin.from("image_generations").update({ status: "failed", failure_reason: "credentials_unavailable", updated_at: new Date().toISOString() }).eq("id", genId);
    return j(500, { ok: false, error: "credentials_unavailable", message: "Something went wrong. Please try again." });
  }

  const callBackUrl = `${CALLBACK_BASE}?gen=${genId}&token=${callbackToken}`;
  // Per-model input shape. Seedream v4 edit (photo enhance): image_urls + image_resolution + nsfw_checker,
  // image_size omitted so the source aspect ratio is preserved (studio-compose cover-fits the final canvas).
  // image_resolution is 4K (max quality) — the model accepts 1K|2K|4K.
  // nano-banana (T2I / renovation edit): legacy output_format + image_size pixel string.
  let input: Record<string, unknown>;
  if (model === MODEL_ENHANCE) {
    input = { prompt: finalPrompt, image_resolution: KIE_IMAGE_RESOLUTION, nsfw_checker: true };
    if (source_image_url) {
      // SMART design uses EVERY selected photo (seedream accepts up to 10 reference images) — the old code
      // sent only image_urls[0], which is why "i selected 4 images it just used one of them". The clean-up and
      // renovation paths stay strictly single-photo: one photo in, that same photo out.
      input.image_urls = designMode
        ? [source_image_url, ...imageUrls.filter((u) => u !== source_image_url)].slice(0, 10)
        : [source_image_url];
    }
    // aspect ratio is only meaningful when KIE is composing the design; the clean-up must keep the source ratio.
    if (designMode && imageSize) input.image_size = imageSize;
  } else {
    input = { prompt: finalPrompt, output_format: "png" };
    if (source_image_url) input.image_urls = [source_image_url];
    if (width && height) input.image_size = `${width}x${height}`;
  }

  const kiePayload = { model, callBackUrl, input };

  const startedAt = Date.now();
  let kieStatus = 0;
  let kieJson: any = null;
  let fetchErr: string | undefined;
  try {
    const resp = await fetch(KIE_CREATE_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${kieKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(kiePayload),
    });
    kieStatus = resp.status;
    const raw = await resp.text();
    try { kieJson = JSON.parse(raw); } catch { kieJson = { raw: raw.slice(0, 500) }; }
  } catch (e) {
    fetchErr = (e as Error).message?.slice(0, 240) ?? "unknown_fetch_error";
  }

  const taskId: string | null = kieJson?.data?.taskId ?? null;
  const success = kieStatus >= 200 && kieStatus < 300 && kieJson?.code === 200 && !!taskId;

  if (!success) {
    await admin.from("image_generations").update({
      status: "failed",
      failure_reason: fetchErr ?? (kieJson?.msg ?? `kie_http_${kieStatus}`),
      raw_response: kieJson,
      updated_at: new Date().toISOString(),
    }).eq("id", genId);
    return j(502, { ok: false, error: "kie_create_failed", message: "The image service is unavailable right now. Please try again.", generation_id: genId });
  }

  await admin.from("image_generations").update({
    status: "processing",
    kie_task_id: taskId,
    started_at: new Date().toISOString(),
    raw_response: kieJson,
    updated_at: new Date().toISOString(),
  }).eq("id", genId);

  return j(200, {
    ok: true,
    generation_id: genId,
    kie_task_id: taskId,
    status: "processing",
    pipeline: "v0.6",
    content_type: contentType,
    composition,
    photo_selected: photoSelection ? source_image_url : null,
    duration_ms: Date.now() - startedAt,
  });
});
