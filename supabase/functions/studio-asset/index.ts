// AIVENA CAPTURE — deploy-only Edge Function `studio-asset`
//
// This file is a RECORD of what is deployed, not a source of new work.
// Do NOT deploy it without diffing against live first: the repo has been
// stale before, and deploying a stale twilio-whatsapp-inbound would have
// silenced Amanda entirely.
//
//   function          : studio-asset
//   repo path         : supabase/functions/studio-asset/index.ts
//   deployed version  : 1
//   deployed bundle   : ezbr_sha256 fafef0af7e8609a30d3fa48f5a2a51e8920a9e957ea708877fe5c1704f597d73
//   captured source   : sha256 48d4af673c44452703e4518b100399b471ba3ac10a1250bb7aacb830b5ae7315
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
// studio-asset — persist a remote image into Supabase Storage and return a durable URL.
// Purpose: (a) cache 2K cleaned photos per property for reuse across templates,
// (b) persist final Studio outputs durably for review (tempfile URLs expire).
// pg_net cannot upload binary to Storage; this edge function fetches a URL server-side
// and uploads the bytes. POST { src_url, dest_path, bucket?, content_type?, signed_ttl_seconds? }
// Auth: x-internal-secret vs Vault IMAGE_GEN_INTERNAL_SECRET. Friendly errors only (Law-2).

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_BUCKET = "generated-images";
const DEFAULT_TTL = 60 * 60 * 24 * 365; // 1 year

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
  try { body = await req.json(); } catch { return j(400, { ok: false, error: "invalid_json", message: "Something went wrong. Please try again." }); }

  const srcUrl: string = body?.src_url;
  const destPath: string = body?.dest_path;
  const bucket: string = (typeof body?.bucket === "string" && body.bucket) ? body.bucket : DEFAULT_BUCKET;
  const ttl: number = Number.isInteger(body?.signed_ttl_seconds) && body.signed_ttl_seconds > 0 ? body.signed_ttl_seconds : DEFAULT_TTL;

  if (!srcUrl || typeof srcUrl !== "string" || !/^https:\/\//.test(srcUrl)) {
    return j(400, { ok: false, error: "missing_src_url", message: "Something went wrong. Please try again." });
  }
  if (!destPath || typeof destPath !== "string") {
    return j(400, { ok: false, error: "missing_dest_path", message: "Something went wrong. Please try again." });
  }
  if (/\.\.|^\/|\s|['"]/.test(destPath)) {
    return j(400, { ok: false, error: "bad_dest_path", message: "Something went wrong. Please try again." });
  }

  let bytes: Uint8Array;
  let contentType: string;
  try {
    const resp = await fetch(srcUrl);
    if (!resp.ok) return j(502, { ok: false, error: "fetch_failed", message: "Couldn't retrieve the image. Please try again." });
    contentType = (typeof body?.content_type === "string" && body.content_type) ? body.content_type : (resp.headers.get("content-type") || "image/jpeg");
    const buf = await resp.arrayBuffer();
    bytes = new Uint8Array(buf);
    if (!bytes.byteLength) return j(502, { ok: false, error: "empty_source", message: "Couldn't retrieve the image. Please try again." });
  } catch {
    return j(502, { ok: false, error: "fetch_error", message: "Couldn't retrieve the image. Please try again." });
  }

  const { error: upErr } = await admin.storage.from(bucket).upload(destPath, bytes, { contentType, upsert: true });
  if (upErr) return j(500, { ok: false, error: "upload_failed", message: "Something went wrong saving the image. Please try again." });

  let signedUrl: string | null = null;
  try {
    const { data: s } = await admin.storage.from(bucket).createSignedUrl(destPath, ttl);
    signedUrl = s?.signedUrl ?? null;
  } catch { /* non-fatal */ }
  let publicUrl: string | null = null;
  try {
    const { data: pub } = admin.storage.from(bucket).getPublicUrl(destPath);
    publicUrl = pub?.publicUrl ?? null;
  } catch { /* non-fatal */ }

  return j(200, { ok: true, bucket, path: destPath, bytes: bytes.byteLength, content_type: contentType, signed_url: signedUrl, public_url: publicUrl });
});
