// AIVENA CAPTURE — deploy-only Edge Function `studio-callback`
//
// This file is a RECORD of what is deployed, not a source of new work.
// Do NOT deploy it without diffing against live first: the repo has been
// stale before, and deploying a stale twilio-whatsapp-inbound would have
// silenced Amanda entirely.
//
//   function          : studio-callback
//   repo path         : supabase/functions/studio-callback/index.ts
//   deployed version  : 1
//   deployed bundle   : ezbr_sha256 4cc0912799b18e86e41b385425044b67feba77ab112231c34ee94554464d5661
//   captured source   : sha256 6d4e2024d112366926efd2671e8f5fd974cb2932fae483bc3cd53ff79f743cba
//   verified_at       : 2026-09-09
//   method            : pulled deployed source via Supabase Management API
//                       and written verbatim below the marker
//   verify_jwt        : false  (MUST be passed explicitly on any redeploy)
//   status            : verified
//   difference        : none — byte-for-byte
//
// The bundle hash is Supabase's hash of the DEPLOYED BUNDLE and cannot be
// recomputed from this file. It proves 'production has not changed since
// capture'. Source equivalence was established AT CAPTURE TIME by pulling
// live source and writing it verbatim; `captured source sha256` above lets
// us detect later edits to this file.
// ---8<--- CAPTURED SOURCE BELOW — verbatim from production, do not edit ---8<---
// studio-callback — AIVENA Studio completion handler v0.1.0 (2026-06-19).
// Receives kie's ENHANCED PHOTO (watermark removed, relit), then renders the Canva template
// ON TOP of it via the Railway render API, so the designed text/logo is laid down AFTER kie
// and is never touched by it. Stores the rendered post as the final. Deliberately isolated
// from image-generate-callback so it cannot affect the live ad/social/renovation pipeline.
// Reuses image_generations rows + the 2-slot revision metadata shape. Law-2 errors.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET         = "generated-images";
const SIGNED_URL_TTL = 60 * 60 * 24 * 365;
const RENDER_URL     = "https://aivena-production.up.railway.app/studio/render";
const MAX_REVISIONS  = 2;

function firstUrl(payload: any): string | null {
  const d = payload?.data ?? payload ?? {};
  if (typeof d?.resultJson === "string") {
    try {
      const parsed = JSON.parse(d.resultJson);
      const u = parsed?.resultUrls ?? parsed?.result_urls ?? parsed?.urls;
      if (Array.isArray(u) && u.length > 0 && typeof u[0] === "string") return u[0];
      if (typeof u === "string" && u.startsWith("http")) return u;
      if (typeof parsed?.resultUrl === "string") return parsed.resultUrl;
    } catch { /* fall through */ }
  }
  const candidates: unknown[] = [
    d?.resultUrls, d?.resultImageUrl, d?.imageUrl, d?.image_url,
    d?.info?.resultUrls, d?.info?.resultImageUrl, d?.info?.imageUrl,
    d?.response?.resultUrls, d?.response?.result_urls, d?.response?.resultImageUrl,
    d?.output, d?.output_url, d?.urls,
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === "string" && c.startsWith("http")) return c;
    if (Array.isArray(c) && c.length > 0 && typeof c[0] === "string" && c[0].startsWith("http")) return c[0];
  }
  return null;
}

function isSuccess(payload: any): boolean {
  const code = payload?.code ?? payload?.data?.code;
  const state = (payload?.data?.state ?? payload?.data?.status ?? payload?.state ?? "").toString().toLowerCase();
  if (state === "success" || state === "completed" || state === "succeeded") return true;
  if (code === 200 && state === "") return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const url = new URL(req.url);
  const genId = url.searchParams.get("gen");
  const token = url.searchParams.get("token");
  const revParam = url.searchParams.get("rev");
  if (!genId || !token) return new Response("bad_request", { status: 400 });

  let payload: any;
  try { payload = await req.json(); } catch { payload = {}; }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: gen } = await admin
    .from("image_generations")
    .select("id, agency_id, generation_type, status, callback_token, raw_request, result_metadata")
    .eq("id", genId)
    .maybeSingle();
  if (!gen || gen.callback_token !== token) return new Response("forbidden", { status: 403 });

  const pendingRevision = gen.raw_request?.pending_revision ?? null;
  const isRevision = !!pendingRevision || !!revParam;
  if (gen.status === "completed" && !pendingRevision) return new Response("ok", { status: 200 });

  const rr0: any = gen.raw_request ?? {};
  const template: string | null = typeof rr0.template === "string" ? rr0.template : null;
  const rawPhotos: string[] = Array.isArray(rr0.photos) ? rr0.photos.filter((u: any) => typeof u === "string") : [];
  const heroIdx: number = Number.isInteger(rr0.hero_index) ? rr0.hero_index : 0;

  async function refundRevision() {
    const md = { ...((gen.result_metadata as any) ?? {}) };
    const started = Math.max(0, (pendingRevision?.number ?? 1) - 1);
    md.revisions_started = started;
    md.revisions_remaining = MAX_REVISIONS - started;
    md.last_revision_error = true;
    const rr = { ...(gen.raw_request ?? {}) }; delete (rr as any).pending_revision;
    await admin.from("image_generations").update({
      status: "completed", result_metadata: md, raw_request: rr, updated_at: new Date().toISOString(),
    }).eq("id", genId);
  }

  async function failInitial(reason: string) {
    await admin.from("image_generations").update({
      status: "failed",
      failure_reason: reason.slice(0, 240),
      raw_response: payload,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", genId);
  }

  const ok = isSuccess(payload);
  const enhancedUrl = ok ? firstUrl(payload) : null;
  if (!ok || !enhancedUrl) {
    if (isRevision) { await refundRevision(); return new Response("ok", { status: 200 }); }
    await failInitial((payload?.data?.failMsg ?? payload?.msg ?? "enhance_failed_or_no_url").toString());
    return new Response("ok", { status: 200 });
  }

  if (!template) {
    if (isRevision) { await refundRevision(); return new Response("ok", { status: 200 }); }
    await failInitial("studio_template_missing");
    return new Response("ok", { status: 200 });
  }

  // Download kie's enhanced photo and store it as the source for the render.
  let imgBytes: Uint8Array | null = null;
  let contentType = "image/png";
  try {
    const r = await fetch(enhancedUrl);
    if (r.ok) { contentType = r.headers.get("content-type") || "image/png"; imgBytes = new Uint8Array(await r.arrayBuffer()); }
  } catch { /* handled below */ }
  if (!imgBytes || imgBytes.length === 0) {
    if (isRevision) { await refundRevision(); return new Response("ok", { status: 200 }); }
    await failInitial("enhanced_photo_download_failed");
    return new Response("ok", { status: 200 });
  }

  const ext = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
  const photoPath = `${gen.agency_id}/${genId}-photo.${ext}`;
  const { error: upErr } = await admin.storage.from(BUCKET).upload(photoPath, imgBytes, { contentType, upsert: true });
  if (upErr) {
    if (isRevision) { await refundRevision(); return new Response("ok", { status: 200 }); }
    await failInitial("enhanced_photo_store_failed");
    return new Response("ok", { status: 200 });
  }

  // Render the Canva template ON TOP of the enhanced photo.
  let finalPath: string | null = null;
  let renderError: string | null = null;
  try {
    const { data: secret } = await admin.rpc("_get_platform_secret", { p_name: "IMAGE_GEN_INTERNAL_SECRET" });
    if (!secret) throw new Error("secret_unavailable");
    const { data: sourceSigned } = await admin.storage.from(BUCKET).createSignedUrl(photoPath, SIGNED_URL_TTL);
    if (!sourceSigned?.signedUrl) throw new Error("signed_url_failed");

    const photos = rawPhotos.length ? [...rawPhotos] : [sourceSigned.signedUrl];
    photos[heroIdx >= 0 && heroIdx < photos.length ? heroIdx : 0] = sourceSigned.signedUrl;

    const outPath = `${gen.agency_id}/${genId}.png`;
    const rResp = await fetch(RENDER_URL, {
      method: "POST",
      headers: { "x-internal-secret": secret, "Content-Type": "application/json" },
      body: JSON.stringify({ template, agency_id: gen.agency_id, photo_urls: photos, out_path: outPath }),
    });
    const rData = await rResp.json().catch(() => null);
    if (rResp.ok && rData?.ok) finalPath = outPath;
    else renderError = (rData?.error ?? `render_http_${rResp.status}`).toString().slice(0, 120);
  } catch (e) {
    renderError = ((e as Error)?.message ?? "render_failed").slice(0, 120);
  }

  if (!finalPath) {
    if (isRevision) { await refundRevision(); return new Response("ok", { status: 200 }); }
    await failInitial(renderError ?? "render_failed");
    return new Response("ok", { status: 200 });
  }

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(finalPath, SIGNED_URL_TTL);
  const signedUrl = signed?.signedUrl ?? null;

  const priorRevisions: any[] = Array.isArray(gen.result_metadata?.revisions) ? gen.result_metadata.revisions : [];
  const revisions = isRevision
    ? [...priorRevisions, {
        number: pendingRevision?.number ?? (priorRevisions.length + 1),
        edit_note: pendingRevision?.edit_note ?? null,
        at: new Date().toISOString(),
        result_image_storage_path: finalPath,
      }]
    : priorRevisions;
  const revisionsStarted: number = isRevision
    ? (Number.isInteger(gen.result_metadata?.revisions_started) ? gen.result_metadata.revisions_started : revisions.length)
    : 0;

  const rr = { ...(gen.raw_request ?? {}) }; delete (rr as any).pending_revision;

  await admin.from("image_generations").update({
    status: "completed",
    result_image_url: signedUrl,
    result_image_storage_path: finalPath,
    result_metadata: {
      pipeline: "studio_v1",
      template,
      enhanced: true,
      content_type: "image/png",
      bytes: imgBytes.length,
      enhanced_photo_path: photoPath,
      kie_source_url: enhancedUrl,
      revisions,
      revisions_used: revisions.length,
      revisions_started: revisionsStarted,
      revisions_remaining: MAX_REVISIONS - revisionsStarted,
      last_revision_error: false,
    },
    raw_request: rr,
    raw_response: payload,
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", genId);

  if (!isRevision) {
    await admin.rpc("image_gen_increment_usage", { p_agency_id: gen.agency_id, p_generation_type: gen.generation_type });
  }

  return new Response("ok", { status: 200 });
});
