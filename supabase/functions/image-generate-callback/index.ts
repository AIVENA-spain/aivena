// image-generate-callback — W13 completion handler v0.5.1 (AIVENA Studio pipeline).
// v0.5.1 (2026-07-16): revision results write to a NEW storage path (-revN suffix). Until now a revision
//   UPSERTED over the original file — Christian's favourite first renovation was destroyed by its own
//   "remove watermark" revision. Prior results are now permanent.
// v0.5 (2026-07-15): RENOVATION FALLBACK. Google's nano-banana-edit E005-false-flags some room photos
//   DETERMINISTICALLY (Christian's kitchen failed 3 straight tries) — retrying the same model is useless
//   for those images. On a renovation failure that matches the policy-filter signature, the callback now
//   RESUBMITS the job once to bytedance/seedream-v4-edit with a decisively aggressive restyle prompt
//   (seedream is conservative by default), keeps the row processing, and lets the new callback finish it.
//   Guarded by raw_request.renovation_fallback so a second failure terminates normally. Quota still only
//   charged on real success. NOTE: this file was deploy-only until now; captured as source of truth.
// v0.4.2 (2026-06-15): atomic revision cap (revisions_started via RPC) + refund-on-failure.
//   Success preserves revisions_started and mirrors revisions_remaining; revision failures
//   refund the slot and set last_revision_error. v0.4.1: free revisions. v0.4: v3.1 contract.
// Idempotency: a completed row with no pending revision is terminal. Law-2 errors.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY         = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const BUCKET = "generated-images";
const SIGNED_URL_TTL = 60 * 60 * 24 * 365;
const COMPOSE_URL = "https://atminvhrybxegpdtnnpl.supabase.co/functions/v1/studio-compose";
const CALLBACK_BASE = "https://atminvhrybxegpdtnnpl.supabase.co/functions/v1/image-generate-callback";
const KIE_CREATE_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const MAX_REVISIONS = 2;

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

async function qcCheck(imageUrl: string): Promise<any | null> {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 250,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "url", url: imageUrl } },
            { type: "text", text: "You are quality control for a real-estate marketing creative. Check: 1) all text crisp and legible, 2) no visual artifacts or distorted geometry, 3) professional overall look. Reply ONLY JSON: {\"score\": 1-5, \"issues\": [\"...\"]}" },
          ],
        }],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const txt = (data?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    const parsed = JSON.parse(txt.replace(/```json|```/g, "").trim());
    if (typeof parsed?.score === "number") return { score: parsed.score, issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 5) : [] };
    return null;
  } catch { return null; }
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
    .select("id, agency_id, generation_type, status, callback_token, width, height, source_image_url, raw_request, result_metadata")
    .eq("id", genId)
    .maybeSingle();

  if (!gen || gen.callback_token !== token) {
    return new Response("forbidden", { status: 403 });
  }

  const pendingRevision = gen.raw_request?.pending_revision ?? null;
  const isRevision = !!pendingRevision || !!revParam;

  if (gen.status === "completed" && !pendingRevision) {
    return new Response("ok", { status: 200 });
  }

  // A revision that fails keeps the agent's existing image and REFUNDS the reserved slot,
  // so a transient failure doesn't burn a free revision. Surfaces last_revision_error.
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

  const ok = isSuccess(payload);
  const resultUrl = ok ? firstUrl(payload) : null;

  if (!ok || !resultUrl) {
    if (isRevision) {
      await refundRevision();
      return new Response("ok", { status: 200 });
    }

    // v0.5 RENOVATION FALLBACK: Google's policy filter rejects some room photos every time — for those,
    // resubmit ONCE to seedream with an aggressive restyle prompt instead of failing the job.
    const failMsg = (payload?.data?.failMsg ?? payload?.msg ?? "").toString();
    const policyBlocked = /prohibited use|policy|filtered|no images found/i.test(failMsg);
    const alreadyFellBack = !!gen.raw_request?.renovation_fallback;
    if (gen.generation_type === "renovation" && policyBlocked && !alreadyFellBack) {
      try {
        const { data: kieKey } = await admin.rpc("_get_platform_secret", { p_name: "KIE_API_KEY" });
        const srcUrl = gen.source_image_url;
        const basePrompt = (gen.raw_request?.enhance_prompt ?? "").toString();
        if (kieKey && typeof srcUrl === "string" && srcUrl.startsWith("http") && basePrompt) {
          const prompt =
            "IMPORTANT: you MUST transform this image decisively — a viewer must instantly see it was redesigned. " +
            basePrompt +
            " Replace the furniture, textiles, decor, lighting fixtures and colour palette completely in the requested style. " +
            "Remove all clutter and personal items. Keep the architecture, walls, windows, room layout and camera angle exactly as in the original photo.";
          const resp = await fetch(KIE_CREATE_URL, {
            method: "POST",
            headers: { "Authorization": `Bearer ${kieKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "bytedance/seedream-v4-edit",
              callBackUrl: `${CALLBACK_BASE}?gen=${genId}&token=${token}`,
              input: { prompt, image_resolution: "4K", nsfw_checker: true, image_urls: [srcUrl] },
            }),
          });
          const j: any = await resp.json().catch(() => null);
          const taskId = j?.data?.taskId ?? null;
          if (resp.ok && j?.code === 200 && taskId) {
            await admin.from("image_generations").update({
              kie_task_id: taskId,
              raw_request: { ...(gen.raw_request ?? {}), renovation_fallback: true },
              updated_at: new Date().toISOString(),
            }).eq("id", genId);
            return new Response("ok", { status: 200 });
          }
        }
      } catch { /* fall through to the normal failure path */ }
    }

    await admin.from("image_generations").update({
      status: "failed",
      failure_reason: (payload?.data?.failMsg ?? payload?.msg ?? "generation_failed_or_no_url").toString().slice(0, 240),
      raw_response: payload,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", genId);
    return new Response("ok", { status: 200 });
  }

  let imgBytes: Uint8Array | null = null;
  let contentType = "image/png";
  try {
    const imgResp = await fetch(resultUrl);
    if (imgResp.ok) {
      contentType = imgResp.headers.get("content-type") || "image/png";
      imgBytes = new Uint8Array(await imgResp.arrayBuffer());
    }
  } catch { /* handled below */ }

  if (!imgBytes || imgBytes.length === 0) {
    if (isRevision) {
      await refundRevision();
      return new Response("ok", { status: 200 });
    }
    await admin.from("image_generations").update({
      status: "completed",
      result_image_url: resultUrl,
      result_metadata: { storage_skipped: "download_failed", kie_source_url: resultUrl },
      raw_response: payload,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", genId);
    await admin.rpc("image_gen_increment_usage", { p_agency_id: gen.agency_id, p_generation_type: gen.generation_type });
    return new Response("ok", { status: 200 });
  }

  const ext = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
  const compose = gen.raw_request?.compose ?? null;
  const wantCompose = compose && typeof compose === "object" && typeof compose.content_type === "string";

  const revSuffix = isRevision ? `-rev${pendingRevision?.number ?? revParam ?? Date.now() % 100000}` : "";
  const photoPath = wantCompose ? `${gen.agency_id}/${genId}-photo${revSuffix}.${ext}` : `${gen.agency_id}/${genId}${revSuffix}.${ext}`;

  const { error: upErr } = await admin.storage.from(BUCKET).upload(photoPath, imgBytes, {
    contentType, upsert: true,
  });

  if (upErr) {
    if (isRevision) {
      await refundRevision();
      return new Response("ok", { status: 200 });
    }
    await admin.from("image_generations").update({
      status: "completed",
      result_image_url: resultUrl,
      result_metadata: { storage_skipped: "upload_failed", kie_source_url: resultUrl },
      raw_response: payload,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", genId);
    await admin.rpc("image_gen_increment_usage", { p_agency_id: gen.agency_id, p_generation_type: gen.generation_type });
    return new Response("ok", { status: 200 });
  }

  let finalPath = photoPath;
  let composed = false;
  let composeError: string | null = null;

  if (wantCompose) {
    try {
      const { data: secret } = await admin.rpc("_get_platform_secret", { p_name: "IMAGE_GEN_INTERNAL_SECRET" });
      if (!secret) throw new Error("secret_unavailable");
      const W = Number.isInteger(gen.width) && gen.width ? gen.width : 1080;
      const H = Number.isInteger(gen.height) && gen.height ? gen.height : 1350;

      const extras: string[] = Array.isArray(compose.extra_storage_paths) ? compose.extra_storage_paths : [];
      const photoPaths: string[] = [photoPath, ...extras];

      const resp = await fetch(COMPOSE_URL, {
        method: "POST",
        headers: { "x-internal-secret": secret, "Content-Type": "application/json" },
        body: JSON.stringify({
          image_storage_path: photoPaths.length > 1 ? photoPaths : photoPath,
          content_type: compose.content_type,
          composition: compose.composition ?? "full_bleed",
          text_treatment: compose.text_treatment ?? undefined,
          font_set: compose.font_set ?? undefined,
          color_treatment: compose.color_treatment ?? undefined,
          width: W,
          height: H,
          out_path: `${gen.agency_id}/${genId}${revSuffix}.png`,
          badge_label: compose.badge_label ?? undefined,
          copy: compose.copy ?? {},
          brand: compose.brand ?? {},
        }),
      });
      const data = await resp.json().catch(() => null);
      if (resp.ok && data?.ok && data?.storage_path) {
        finalPath = data.storage_path;
        composed = true;
      } else {
        composeError = (data?.error ?? `compose_http_${resp.status}`).toString().slice(0, 120);
      }
    } catch (e) {
      composeError = ((e as Error)?.message ?? "compose_failed").slice(0, 120);
    }
  }

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(finalPath, SIGNED_URL_TTL);
  const signedUrl = signed?.signedUrl ?? null;

  const qc = signedUrl ? await qcCheck(signedUrl) : null;

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
    result_image_url: signedUrl ?? resultUrl,
    result_image_storage_path: finalPath,
    result_metadata: {
      content_type: composed ? "image/png" : contentType,
      bytes: imgBytes.length,
      kie_source_url: resultUrl,
      storage_uploaded: true,
      pipeline: "v0.6",
      composed,
      compose_content_type: compose?.content_type ?? null,
      compose_composition: compose?.composition ?? null,
      photo_path: wantCompose ? photoPath : null,
      compose_error: composeError,
      revisions,
      revisions_used: revisions.length,
      revisions_started: revisionsStarted,
      revisions_remaining: MAX_REVISIONS - revisionsStarted,
      last_revision_error: false,
      qc,
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
