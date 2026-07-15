// image-generate-revise — W13 free-revision path v0.5 (AIVENA Studio pipeline).
//
// v0.5 (2026-07-15): model follows the JOB — renovation revisions on nano-banana-edit (creative restyle),
//   everything else on seedream (preserving). The v0.4 all-seedream move made renovation revisions inert.
//
// v0.4 (2026-07-15): CONTEXT-AWARE + off Google. (1) The revision prompt now BUILDS ON the row's original
//   enhance_prompt (returned by the RPC since v0.2 but never used): a renovation revision keeps restyling the
//   room in the originally requested style instead of silently reverting to a plain photo-enhance of the raw
//   room; an enhance revision keeps its creative direction. (2) Model switched google/nano-banana-edit →
//   bytedance/seedream-v4-edit with the seedream input shape (image_urls + image_resolution 4K + nsfw_checker,
//   image_size omitted = source ratio preserved) — the SAME move create v0.6.6 made for the enhance path,
//   because Google's safety stack E005-false-flags normal property photos non-deterministically (it did so
//   again live today on a renovation). NOTE: this file was deploy-only until now; captured as source of truth.
// v0.3 (2026-06-15): instruction-led revision prompt. The agent's edit note now LEADS the
// prompt as the top-priority change (was buried after the base enhancement paragraph, so
// removal requests like "remove the cars" were ignored). Removal requests explicitly handled.
// v0.2 (2026-06-15): ATOMIC CAP. The free-revision slot is reserved at accept time via the
// row-locked RPC image_gen_start_revision (counts revisions_started), instead of counting
// completed revisions — which lagged ~90s behind kie and let extra revisions through.
// Refunds the slot on a synchronous kie-submit failure. Still free (no quota).
//
// POST { generation_id, agency_id, edit_note, requested_by? }
// Auth: x-internal-secret vs Vault IMAGE_GEN_INTERNAL_SECRET. kie.ai key from Vault. Law-2.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const KIE_CREATE_URL  = "https://api.kie.ai/api/v1/jobs/createTask";
const CALLBACK_BASE   = "https://atminvhrybxegpdtnnpl.supabase.co/functions/v1/image-generate-callback";
// v0.5: the model follows the JOB. Renovation revisions need the CREATIVE model (nano-banana restyles;
// seedream preserves — a seedream "renovation" returns the same room). Enhance/clean revisions stay on
// seedream (nano-banana E005-false-flags normal property photos).
const MODEL_RENOVATE = "google/nano-banana-edit";
const MODEL_PRESERVE = "bytedance/seedream-v4-edit";
const KIE_IMAGE_RESOLUTION = "4K";
const MAX_REVISIONS = 2;

const FRIENDLY: Record<string, { status: number; message: string }> = {
  generation_not_found:   { status: 404, message: "We couldn't find that image." },
  revision_in_progress:   { status: 409, message: "A revision is already being prepared. Please wait a moment." },
  not_revisable:          { status: 409, message: "This image can't be revised right now." },
  no_source_photo:        { status: 422, message: "This image can't be revised because its source photo is unavailable." },
  revision_limit_reached: { status: 409, message: "You've used both free revisions for this image. You can start a new one anytime." },
};

function j(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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

  const generationId = body?.generation_id;
  const agencyId = body?.agency_id;
  const editNote: string = typeof body?.edit_note === "string" ? body.edit_note.trim() : "";

  if (!generationId || typeof generationId !== "string") return j(400, { ok: false, error: "missing_generation_id", message: "Something went wrong. Please try again." });
  if (!agencyId || typeof agencyId !== "string") return j(400, { ok: false, error: "missing_agency_id", message: "Something went wrong. Please try again." });
  if (!editNote) return j(400, { ok: false, error: "missing_edit_note", message: "Please describe what you'd like to change." });
  if (editNote.length > 1000) return j(400, { ok: false, error: "edit_note_too_long", message: "That request is too long. Please shorten it." });

  const callbackToken = crypto.randomUUID().replace(/-/g, "");
  const { data: reserved, error: rpcErr } = await admin.rpc("image_gen_start_revision", {
    p_id: generationId, p_agency_id: agencyId, p_edit_note: editNote,
    p_callback_token: callbackToken, p_max: MAX_REVISIONS,
  });
  if (rpcErr) return j(500, { ok: false, error: "revision_start_failed", message: "Something went wrong. Please try again." });
  if (!reserved?.ok) {
    const f = FRIENDLY[reserved?.error] ?? { status: 409, message: "This image can't be revised right now." };
    return j(f.status, { ok: false, error: reserved?.error ?? "not_revisable", message: f.message });
  }

  const revisionNumber: number = reserved.revision_number;
  const sourceImageUrl: string = reserved.source_image_url;
  const { data: genRow } = await admin.from("image_generations").select("generation_type, raw_request").eq("id", generationId).maybeSingle();
  const isRenovation = genRow?.generation_type === "renovation";
  // v0.4: the revision keeps doing what the ORIGINAL generation was asked to do, plus the new change on top.
  // Without this, revising a renovation quietly dropped the restyle and just photo-enhanced the raw room.
  const originalPrompt: string = typeof reserved.enhance_prompt === "string" && reserved.enhance_prompt.trim()
    ? reserved.enhance_prompt.trim()
    : "Professional real-estate photo enhancement of the exact property shown. Keep the architecture, room layout, walls, windows, views and every structural element exactly as in the original photo.";
  const finalPrompt =
    originalPrompt + " " +
    "ON TOP OF THAT — apply the agent's requested change fully and visibly; this is the top-priority goal of this edit: " + editNote + ". " +
    "If the request is to remove something (vehicles, cars, people, clutter, signs, reflections or other distractions), remove it completely and fill the area with a natural, seamless background that matches the surroundings. " +
    "Do not add any text, words, letters, logos or watermarks.";

  async function refund() {
    const { data: r } = await admin.from("image_generations").select("result_metadata, raw_request").eq("id", generationId).maybeSingle();
    const md = { ...((r?.result_metadata as any) ?? {}) };
    const started = Math.max(0, revisionNumber - 1);
    md.revisions_started = started;
    md.revisions_remaining = MAX_REVISIONS - started;
    md.last_revision_error = true;
    const rr = { ...((r?.raw_request as any) ?? {}) }; delete rr.pending_revision;
    await admin.from("image_generations").update({
      status: "completed", result_metadata: md, raw_request: rr, updated_at: new Date().toISOString(),
    }).eq("id", generationId);
  }

  const { data: kieKey } = await admin.rpc("_get_platform_secret", { p_name: "KIE_API_KEY" });
  if (!kieKey) {
    await refund();
    return j(500, { ok: false, error: "credentials_unavailable", message: "Something went wrong. Please try again." });
  }

  const callBackUrl = `${CALLBACK_BASE}?gen=${generationId}&token=${callbackToken}&rev=${revisionNumber}`;
  const W2 = Number.isInteger(reserved.width) && reserved.width ? reserved.width : 1080;
  const H2 = Number.isInteger(reserved.height) && reserved.height ? reserved.height : 1350;
  const model = isRenovation ? MODEL_RENOVATE : MODEL_PRESERVE;
  const input: Record<string, unknown> = isRenovation
    ? { prompt: finalPrompt, output_format: "png", image_urls: [sourceImageUrl], image_size: `${W2}x${H2}` }
    : { prompt: finalPrompt, image_resolution: KIE_IMAGE_RESOLUTION, nsfw_checker: true, image_urls: [sourceImageUrl] };
  const kiePayload = { model, callBackUrl, input };

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
    await refund();
    return j(502, { ok: false, error: "kie_create_failed", message: "The image service is unavailable right now. Please try again.", generation_id: generationId });
  }

  await admin.from("image_generations").update({
    kie_task_id: taskId,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", generationId);

  return j(200, {
    ok: true,
    generation_id: generationId,
    status: "processing",
    revision_number: revisionNumber,
    revisions_remaining: reserved.revisions_remaining,
  });
});
