// AIVENA CAPTURE — deploy-only Edge Function `studio-generate`
//
// This file is a RECORD of what is deployed, not a source of new work.
// Do NOT deploy it without diffing against live first: the repo has been
// stale before, and deploying a stale twilio-whatsapp-inbound would have
// silenced Amanda entirely.
//
//   function          : studio-generate
//   repo path         : supabase/functions/studio-generate/index.ts
//   deployed version  : 2
//   deployed bundle   : ezbr_sha256 973c0055d52b7512436e5c6a624ff858df4e3aa92ee5474d8fa91fc29e4c879a
//   captured source   : sha256 aef5a7f8a88e01854263203ba32972b1f9b208d5f4e8e3bcd01a3bc1a6628139
//   verified_at       : 2026-09-09
//   method            : pulled deployed source via Supabase Management API
//                       and written verbatim below the marker
//   verify_jwt        : false  (MUST be passed explicitly on any redeploy)
//   status            : verified
//   difference        : none — byte-for-byte. Live version re-checked immediately before capture (still v2, same bundle hash).
//
// The bundle hash is Supabase's hash of the DEPLOYED BUNDLE and cannot be
// recomputed from this file. It proves 'production has not changed since
// capture'. Source equivalence was established AT CAPTURE TIME by pulling
// live source and writing it verbatim; `captured source sha256` above lets
// us detect later edits to this file.
// ---8<--- CAPTURED SOURCE BELOW — verbatim from production, do not edit ---8<---
// studio-generate — AIVENA Studio render+enhance orchestrator v0.2.0 (2026-06-19).
// FLIPPED ORDER: kie cleans the PHOTO first (watermark removed, natural relight), then
// studio-callback renders the Canva template ON TOP of the enhanced photo — so the designed
// text/logo is laid down after kie and never touched by it (fixes the footer crop + keeps
// text crisp + natural colour). The 2-slot revision model applies: photo edits re-run kie +
// re-render; text/template edits just re-render. Result is stored by studio-callback.
// Heavy work is on kie (external) + Railway (render), so this fn stays inside edge limits.
// Auth: x-internal-secret vs Vault. Law-2 errors.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RENDER_URL          = "https://aivena-production.up.railway.app/studio/render";
const KIE_CREATE_URL      = "https://api.kie.ai/api/v1/jobs/createTask";
const STUDIO_CALLBACK_BASE = "https://atminvhrybxegpdtnnpl.supabase.co/functions/v1/studio-callback";
const MODEL_ENHANCE       = "bytedance/seedream-v4-edit";
const BUCKET              = "generated-images";
const SIGNED_URL_TTL      = 60 * 60 * 24 * 365;
const GEN_TYPE            = "social_post"; // Studio posts charge the social_post quota for now.

// Photo-only enhancement prompt: clean the photograph, remove burned-in watermark, and relight
// NATURALLY (explicitly NOT warm/orange/golden). The designed text is added afterward by the
// render step, so kie only ever sees the raw photo — it cannot touch any layout text.
const STUDIO_PHOTO_ENHANCE =
  "Enhance this real-estate property photograph to clean, professional, magazine-grade quality. " +
  "Remove any real-estate agency watermark, stamp, logo, phone number or website address printed across the photo. " +
  "Correct the lighting and white balance so it looks natural and true to life — bright, clean and inviting, with realistic, accurate colours. " +
  "Do NOT make the image warm, orange, golden or heavily saturated; keep whites neutral, greens natural and the sky a believable blue. " +
  "Sharpen genuine detail and tidy minor clutter, but keep the architecture, walls, windows, room layout, structure, furniture and views EXACTLY as in the original photo. " +
  "Photorealistic. Do not add any text, words, letters, logos or watermarks.";

function j(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return j(405, { ok: false, error: "method_not_allowed", message: "Use POST." });

  const presented = req.headers.get("x-internal-secret") ?? "";
  if (!presented) return j(401, { ok: false, error: "unauthorized", message: "Authentication failed." });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: secret } = await admin.rpc("_get_platform_secret", { p_name: "IMAGE_GEN_INTERNAL_SECRET" });
  if (!secret || !constantTimeEqual(presented, secret)) {
    return j(401, { ok: false, error: "unauthorized", message: "Authentication failed." });
  }

  let body: any;
  try { body = await req.json(); } catch { return j(400, { ok: false, error: "invalid_json", message: "Something went wrong. Please try again." }); }

  const agency_id: string | null   = typeof body?.agency_id === "string" && body.agency_id ? body.agency_id : null;
  const template: string | null    = typeof body?.template === "string" && body.template ? body.template : null;
  const property_id: string | null = typeof body?.property_id === "string" && body.property_id ? body.property_id : null;
  const requested_by: string | null = typeof body?.requested_by === "string" ? body.requested_by : null;
  const agentNote: string | null   = typeof body?.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : null;
  const enhance: boolean           = body?.enhance !== false; // default true; enhance:false returns the raw render
  const W = 1080, H = 1350;

  if (!agency_id)   return j(400, { ok: false, error: "missing_agency_id", message: "Something went wrong. Please try again." });
  if (!template)    return j(400, { ok: false, error: "missing_template", message: "Please choose a template." });
  if (!property_id) return j(400, { ok: false, error: "missing_property", message: "Please choose a property." });

  const { data: quota, error: quotaErr } = await admin.rpc("image_gen_check_quota", { p_agency_id: agency_id, p_generation_type: GEN_TYPE });
  if (quotaErr) return j(500, { ok: false, error: "quota_check_failed", message: "Something went wrong. Please try again." });
  if (!quota?.ok) return j(409, { ok: false, error: "quota_unavailable", message: "You've reached your plan's limit for this. Upgrade or wait for the next cycle.", reason: quota?.reason ?? "unknown" });

  const { data: property } = await admin.from("properties")
    .select("id, title, images")
    .eq("id", property_id).eq("agency_id", agency_id).maybeSingle();
  if (!property) return j(404, { ok: false, error: "property_not_found", message: "We couldn't find that property." });
  let photos: string[] = [];
  try { photos = Array.isArray(property.images) ? property.images : JSON.parse(property.images ?? "[]"); } catch { photos = []; }
  photos = photos.filter((u) => typeof u === "string" && u.startsWith("http")).slice(0, 6);
  if (photos.length === 0) return j(400, { ok: false, error: "no_photos", message: "This property has no photos to use." });

  const heroIndex = 0;
  const heroUrl = photos[heroIndex];
  const callbackToken = crypto.randomUUID().replace(/-/g, "");

  const { data: genRow, error: insErr } = await admin.from("image_generations").insert({
    agency_id,
    generation_type: GEN_TYPE,
    status: "pending",
    prompt: agentNote ?? "studio_template_render",
    source_property_id: property_id,
    source_image_url: heroUrl,            // RAW hero photo — revisions edit this, not the composite.
    width: W, height: H,
    kie_model: enhance ? MODEL_ENHANCE : null,
    callback_token: callbackToken,
    requested_by,
    raw_request: { pipeline: "studio_v1", template, photos, hero_index: heroIndex, enhance, agent_note: agentNote },
  }).select("id").single();
  if (insErr || !genRow) return j(500, { ok: false, error: "create_row_failed", message: "Something went wrong. Please try again." });
  const genId: string = genRow.id;

  // No-enhance path: render the template directly on the raw photos and finish.
  if (!enhance) {
    const outPath = `${agency_id}/${genId}.png`;
    try {
      const rResp = await fetch(RENDER_URL, {
        method: "POST",
        headers: { "x-internal-secret": secret, "Content-Type": "application/json" },
        body: JSON.stringify({ template, agency_id, photo_urls: photos, out_path: outPath }),
      });
      const rData = await rResp.json().catch(() => null);
      if (!rResp.ok || !rData?.ok) {
        await admin.from("image_generations").update({ status: "failed", failure_reason: (rData?.error ?? `render_http_${rResp.status}`).toString().slice(0, 240), updated_at: new Date().toISOString() }).eq("id", genId);
        return j(502, { ok: false, error: "render_failed", message: "Couldn't create the design. Please try again.", generation_id: genId });
      }
    } catch (e) {
      await admin.from("image_generations").update({ status: "failed", failure_reason: ((e as Error)?.message ?? "render_failed").slice(0, 240), updated_at: new Date().toISOString() }).eq("id", genId);
      return j(502, { ok: false, error: "render_failed", message: "Couldn't create the design. Please try again.", generation_id: genId });
    }
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(outPath, SIGNED_URL_TTL);
    await admin.from("image_generations").update({
      status: "completed",
      result_image_storage_path: outPath,
      result_image_url: signed?.signedUrl ?? null,
      result_metadata: { pipeline: "studio_v1", template, enhanced: false },
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", genId);
    await admin.rpc("image_gen_increment_usage", { p_agency_id: agency_id, p_generation_type: GEN_TYPE });
    return j(200, { ok: true, generation_id: genId, status: "completed", enhanced: false, signed_url: signed?.signedUrl ?? null });
  }

  // Enhance path: kie cleans the HERO photo; studio-callback then renders the template on top.
  const { data: kieKey } = await admin.rpc("_get_platform_secret", { p_name: "KIE_API_KEY" });
  if (!kieKey) {
    await admin.from("image_generations").update({ status: "failed", failure_reason: "credentials_unavailable", updated_at: new Date().toISOString() }).eq("id", genId);
    return j(500, { ok: false, error: "credentials_unavailable", message: "Something went wrong. Please try again.", generation_id: genId });
  }

  const finalPrompt = STUDIO_PHOTO_ENHANCE + (agentNote ? " Also apply this request to the photo: " + agentNote : "");
  const callBackUrl = `${STUDIO_CALLBACK_BASE}?gen=${genId}&token=${callbackToken}`;
  const kiePayload = {
    model: MODEL_ENHANCE,
    callBackUrl,
    input: { prompt: finalPrompt, image_resolution: "2K", nsfw_checker: true, image_urls: [heroUrl] },
  };

  let kieStatus = 0; let kieJson: any = null; let fetchErr: string | undefined;
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
    raw_response: kieJson,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", genId);

  return j(200, { ok: true, generation_id: genId, kie_task_id: taskId, status: "processing", template });
});
