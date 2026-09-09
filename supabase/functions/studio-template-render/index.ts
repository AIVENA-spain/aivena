// AIVENA CAPTURE — deploy-only Edge Function `studio-template-render`
//
// This file is a RECORD of what is deployed, not a source of new work.
// Do NOT deploy it without diffing against live first: the repo has been
// stale before, and deploying a stale twilio-whatsapp-inbound would have
// silenced Amanda entirely.
//
//   function          : studio-template-render
//   repo path         : supabase/functions/studio-template-render/index.ts
//   deployed version  : 3
//   deployed bundle   : ezbr_sha256 cae8cadb1eb1254f856930891d2c5f8aea181d59fec19463d5f8a58c5c23bec0
//   captured source   : sha256 b4d0840941b10d9fc3293ed8c37279d0f4b0b7c37f966b9cbfab10d0b25ea188
//   verified_at       : 2026-09-09
//   method            : pulled deployed source via Supabase Management API
//                       and written verbatim below the marker
//   verify_jwt        : false  (MUST be passed explicitly on any redeploy)
//   status            : verified
//   difference        : none — byte-for-byte. Live version re-checked immediately before capture (still v3, same bundle hash).
//
// The bundle hash is Supabase's hash of the DEPLOYED BUNDLE and cannot be
// recomputed from this file. It proves 'production has not changed since
// capture'. Source equivalence was established AT CAPTURE TIME by pulling
// live source and writing it verbatim; `captured source sha256` above lets
// us detect later edits to this file.
// ---8<--- CAPTURED SOURCE BELOW — verbatim from production, do not edit ---8<---
// studio-template-render — AIVENA Studio: render a tokenized Canva-template SVG with property photos.
// v0.1 (2026-06-19): photo-slot fill + resvg render. Templates live in the studio-templates bucket
//   as {template}.tokenized.svg. All template text is outlined to paths, so NO fonts are loaded.
//   Photo slots are tokens @@PHOTO0@@..@@PHOTONN@@ on one or more <image> tags (stacked layers share a token).
//   Fill: force preserveAspectRatio="xMidYMid slice" on every photo-slot <image> (crop-to-fill, matches Canva),
//   then substitute each token with a base64 data URI. Output to generated-images, signed URL returned.
//   Auth: x-internal-secret vs Vault (same as studio-compose / image-generate-create). Law-2 friendly errors.
// v0.2 (2026-06-20): optional color_map (Studio colour wheel) — find-replace hex fills before photo fill.

import { createClient } from "npm:@supabase/supabase-js@2";
import { Resvg, initWasm } from "npm:@resvg/resvg-wasm@2.6.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TEMPLATE_BUCKET = "studio-templates";
const PHOTO_BUCKET = "property-images";
const OUT_BUCKET = "generated-images";
const SIGNED_TTL = 60 * 60 * 24 * 365;
const WASM_URL = "https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm";
const RENDER_WIDTH = 1080;
// 1x1 transparent PNG — only used to blank a stray photo token that somehow survived fill (should never happen).
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

let wasmReady: Promise<void> | null = null;
function ensureWasm() {
  if (!wasmReady) wasmReady = (async () => { await initWasm(await fetch(WASM_URL)); })();
}

function j(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function toDataUri(bytes: Uint8Array, mime: string): Promise<string> {
  let bin = ""; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return `data:${mime};base64,${btoa(bin)}`;
}
async function loadPhoto(admin: any, storagePath: string | undefined, urlVal: string | undefined): Promise<string | null> {
  try {
    if (storagePath) {
      const { data, error } = await admin.storage.from(PHOTO_BUCKET).download(storagePath);
      if (error || !data) return null;
      return await toDataUri(new Uint8Array(await data.arrayBuffer()), data.type || "image/jpeg");
    }
    if (urlVal && urlVal.startsWith("http")) {
      const r = await fetch(urlVal); if (!r.ok) return null;
      return await toDataUri(new Uint8Array(await r.arrayBuffer()), r.headers.get("content-type") || "image/jpeg");
    }
  } catch { return null; }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return j(405, { ok: false, error: "method_not_allowed", message: "Use POST." });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const presented = req.headers.get("x-internal-secret") ?? "";
  const { data: expected } = await admin.rpc("_get_platform_secret", { p_name: "IMAGE_GEN_INTERNAL_SECRET" });
  if (!expected || !constantTimeEqual(presented, expected)) return j(401, { ok: false, error: "unauthorized", message: "Authentication failed." });

  let body: any;
  try { body = await req.json(); } catch { return j(400, { ok: false, error: "invalid_json", message: "Request body must be valid JSON." }); }

  const template: string = typeof body?.template === "string" ? body.template.trim() : "";
  if (!template || /[^a-zA-Z0-9_-]/.test(template)) return j(400, { ok: false, error: "invalid_template", message: "A valid template is required." });

  // Fetch the tokenized template SVG from the studio-templates bucket (service-role read; bucket is private).
  const tplName = `${template}.tokenized.svg`;
  const { data: tplBlob, error: tplErr } = await admin.storage.from(TEMPLATE_BUCKET).download(tplName);
  if (tplErr || !tplBlob) return j(404, { ok: false, error: "template_not_found", message: "That template couldn't be found." });
  let svg = await tplBlob.text();

  // Optional colour remap (Studio colour wheel): find-replace fill/stroke hex on the template's vector
  // colours BEFORE any photo substitution, so swaps never touch photo data URIs. No-op when color_map is
  // absent (output byte-identical to prior behaviour). Each key/value validated as #rrggbb so only real
  // hex colours can be remapped (never arbitrary string edits).
  const colorMap = (body?.color_map && typeof body.color_map === "object" && !Array.isArray(body.color_map)) ? body.color_map : null;
  if (colorMap) {
    for (const [from, to] of Object.entries(colorMap)) {
      if (typeof from === "string" && typeof to === "string" && /^#[0-9a-fA-F]{6}$/.test(from) && /^#[0-9a-fA-F]{6}$/.test(to as string)) {
        svg = svg.split(from).join(to as string);
      }
    }
  }

  // Discover the photo-slot tokens actually present in this template, ordered 0..N.
  const tokenSet = new Set<string>();
  for (const m of svg.matchAll(/@@PHOTO(\d+)@@/g)) tokenSet.add(m[0]);
  const tokens = Array.from(tokenSet).sort((a, b) => parseInt(a.replace(/\D/g, ""), 10) - parseInt(b.replace(/\D/g, ""), 10));

  // Inspect mode: report tokens + <image> count without rendering (no photos needed). Used to verify token format.
  if (body?.inspect === true) {
    const imageTags = (svg.match(/<image\b[^>]*>/g) || []).length;
    const allTokens = Array.from(new Set(svg.match(/@@[A-Za-z0-9_]+@@/g) || [])).sort();
    return j(200, { ok: true, inspect: true, template: tplName, bytes: svg.length, photo_tokens: tokens, all_tokens: allTokens, image_tags: imageTags });
  }

  if (tokens.length === 0) return j(422, { ok: false, error: "no_photo_slots", message: "This template has no photo slots to fill." });

  // Resolve photos in slot order: explicit URLs / storage paths, or pull a property's image list in order.
  let orderedUrls: string[] = Array.isArray(body?.photo_urls) ? body.photo_urls.filter((x: unknown) => typeof x === "string" && (x as string).startsWith("http")) : [];
  let orderedPaths: string[] = Array.isArray(body?.photo_storage_paths) ? body.photo_storage_paths.filter((x: unknown) => typeof x === "string" && x) : [];

  const propertyId: string | null = typeof body?.property_id === "string" && body.property_id ? body.property_id : null;
  const agencyId: string | null = typeof body?.agency_id === "string" && body.agency_id ? body.agency_id : null;
  if (orderedUrls.length === 0 && orderedPaths.length === 0 && propertyId) {
    let q = admin.from("properties").select("images, agency_id").eq("id", propertyId);
    if (agencyId) q = q.eq("agency_id", agencyId);
    const { data: prop } = await q.maybeSingle();
    if (prop) {
      let imgs: string[] = [];
      try { imgs = Array.isArray(prop.images) ? prop.images : JSON.parse(prop.images ?? "[]"); } catch { imgs = []; }
      orderedUrls = imgs.filter((u) => typeof u === "string" && u.startsWith("http"));
    }
  }

  const sourceCount = Math.max(orderedUrls.length, orderedPaths.length);
  if (sourceCount === 0) return j(422, { ok: false, error: "no_photos", message: "Please provide at least one photo." });

  // One data URI per token. Reuse the last supplied photo when fewer photos than slots are provided.
  const dataUris: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const idx = i < sourceCount ? i : sourceCount - 1;
    const uri = await loadPhoto(admin, orderedPaths[idx], orderedUrls[idx]);
    if (!uri) return j(422, { ok: false, error: "photo_unavailable", message: "One of the photos couldn't be loaded." });
    dataUris.push(uri);
  }

  // Force crop-to-fill on every photo-slot <image> tag (matches Canva). Done on the SHORT tokens, before substitution,
  // so the [^>]* match never has to scan a multi-MB data URI. Baked graphics/logos (no token) are left untouched.
  svg = svg.replace(/<image\b[^>]*>/g, (tag) => {
    if (!/@@PHOTO\d+@@/.test(tag)) return tag;
    let t = tag.replace(/\s+preserveAspectRatio\s*=\s*"[^"]*"/g, "");
    t = t.replace(/^<image\b/, '<image preserveAspectRatio="xMidYMid slice"');
    return t;
  });

  // Substitute each token with its data URI (all occurrences — stacked layers share a token).
  tokens.forEach((tok, i) => { svg = svg.split(tok).join(dataUris[i]); });
  svg = svg.replace(/@@PHOTO\d+@@/g, PIXEL);

  const outPath: string = (typeof body?.out_path === "string" && body.out_path && !body.out_path.includes(".."))
    ? body.out_path
    : `${agencyId ?? "studio"}/studio_${template}_${crypto.randomUUID().replace(/-/g, "")}.png`;

  try {
    ensureWasm(); await wasmReady;
    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: RENDER_WIDTH }, font: { loadSystemFonts: false } });
    const rendered = resvg.render();
    const png = rendered.asPng();
    const { error: upErr } = await admin.storage.from(OUT_BUCKET).upload(outPath, png, { contentType: "image/png", upsert: true });
    if (upErr) return j(500, { ok: false, error: "storage_upload_failed", message: "The image couldn't be saved. Please try again." });
    const { data: signed } = await admin.storage.from(OUT_BUCKET).createSignedUrl(outPath, SIGNED_TTL);
    return j(200, {
      ok: true,
      template,
      storage_path: outPath,
      signed_url: signed?.signedUrl ?? null,
      bytes: png.length,
      width: rendered.width,
      height: rendered.height,
      slots_filled: tokens.length,
      photos_used: sourceCount,
    });
  } catch (e) {
    console.error("template_render_failed:", (e as Error)?.message);
    return j(500, { ok: false, error: "render_failed", message: "The post couldn't be rendered. Please try again." });
  }
});
