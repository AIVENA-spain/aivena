// AIVENA CAPTURE — deploy-only Edge Function `upload-agency-logo`
//
// This file is a RECORD of what is deployed, not a source of new work.
// Do NOT deploy it without diffing against live first: the repo has been
// stale before, and deploying a stale twilio-whatsapp-inbound would have
// silenced Amanda entirely.
//
//   function          : upload-agency-logo
//   repo path         : supabase/functions/upload-agency-logo/index.ts
//   deployed version  : 16
//   deployed bundle   : ezbr_sha256 e474b02c35229d80bd40a56af193f28c0faaf089ab731e1ba81f8ece54109c4e
//   captured source   : sha256 8801afe71c0b8fbd38c491842c3a0d6d1748c264e6f4de844c7f00eaa1f5f281
//   verified_at       : 2026-09-09
//   method            : pulled deployed source via Supabase Management API
//                       and written verbatim below the marker
//   verify_jwt        : true  (MUST be passed explicitly on any redeploy)
//   status            : verified
//   difference        : none — byte-for-byte
//
// The bundle hash is Supabase's hash of the DEPLOYED BUNDLE and cannot be
// recomputed from this file. It proves 'production has not changed since
// capture'. Source equivalence was established AT CAPTURE TIME by pulling
// live source and writing it verbatim; `captured source sha256` above lets
// us detect later edits to this file.
// ---8<--- CAPTURED SOURCE BELOW — verbatim from production, do not edit ---8<---
// upload-agency-logo — agency-owner-only logo upload, public-permanent URL.
// Auth: verify_jwt:true; caller must be 'owner' on user_agencies for target agency.
// Side effect: UPDATE agency_branding SET logo_url = <public_url>, branding_reviewed_at = now()
//              (also bumps updated_at). Same call.
// Path layout: agency-logos/<agency_id>/logo-<unix_ms>.<png|jpg>
// Limits: PNG/JPG only, 2 MB cap, magic-bytes verified.
// Note: SVG deferred pending sanitization (XSS-via-SVG risk in mail clients).

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BUCKET = "agency-logos";
const MAX_SIZE_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg"]);

function j(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function decodeB64(s: string): Uint8Array {
  // Strip data URL prefix if present ("data:image/png;base64,...").
  const cleaned = s.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(cleaned);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return j(405, { error: "method_not_allowed" });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return j(401, { error: "missing_authorization" });

  // Identify caller via their JWT.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return j(401, { error: "invalid_session", detail: userErr?.message });
  }
  const user = userData.user;

  let body: any;
  try { body = await req.json(); } catch { return j(400, { error: "invalid_json" }); }

  const { agency_id, filename, content_type, content_base64 } = body ?? {};
  if (!agency_id || !filename || !content_type || !content_base64) {
    return j(400, {
      error: "missing_fields",
      required: ["agency_id", "filename", "content_type", "content_base64"],
    });
  }
  if (typeof agency_id !== "string" || typeof filename !== "string" ||
      typeof content_type !== "string" || typeof content_base64 !== "string") {
    return j(400, { error: "invalid_field_types" });
  }
  if (!ALLOWED_TYPES.has(content_type)) {
    return j(400, {
      error: "unsupported_image_type",
      allowed: Array.from(ALLOWED_TYPES),
      note: "SVG support deferred pending sanitization.",
    });
  }

  // Service-role for membership check, storage write, branding update.
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Owner gate.
  const { data: membership, error: mErr } = await adminClient
    .from("user_agencies")
    .select("role")
    .eq("user_id", user.id)
    .eq("agency_id", agency_id)
    .maybeSingle();
  if (mErr) return j(500, { error: "membership_lookup_failed", detail: mErr.message });
  if (!membership) return j(403, { error: "not_a_member" });
  if (membership.role !== "owner") {
    return j(403, { error: "role_not_owner", your_role: membership.role });
  }

  // Branding row must already exist (we UPDATE it, do not INSERT).
  const { data: branding, error: bErr } = await adminClient
    .from("agency_branding")
    .select("agency_id")
    .eq("agency_id", agency_id)
    .maybeSingle();
  if (bErr) return j(500, { error: "branding_lookup_failed", detail: bErr.message });
  if (!branding) return j(404, { error: "branding_row_missing" });

  // Decode + validate bytes.
  let bytes: Uint8Array;
  try { bytes = decodeB64(content_base64); } catch { return j(400, { error: "invalid_base64" }); }
  if (bytes.length === 0) return j(400, { error: "empty_file" });
  if (bytes.length > MAX_SIZE_BYTES) {
    return j(400, { error: "file_too_large", bytes: bytes.length, max_bytes: MAX_SIZE_BYTES });
  }

  // Magic-bytes verification (defeats client-side content_type lying).
  const isPNG = bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const isJPG = bytes.length >= 3 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (content_type === "image/png" && !isPNG) {
    return j(400, { error: "magic_bytes_mismatch", declared: "image/png" });
  }
  if (content_type === "image/jpeg" && !isJPG) {
    return j(400, { error: "magic_bytes_mismatch", declared: "image/jpeg" });
  }

  // Upload (timestamped filename = automatic cache-bust on each upload).
  const ext = content_type === "image/png" ? "png" : "jpg";
  const ts = Date.now();
  const path = `${agency_id}/logo-${ts}.${ext}`;

  const { error: upErr } = await adminClient.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: content_type,
      cacheControl: "3600",
      upsert: false,
    });
  if (upErr) return j(500, { error: "upload_failed", detail: upErr.message });

  const { data: urlData } = adminClient.storage.from(BUCKET).getPublicUrl(path);
  const logo_url = urlData.publicUrl;
  const nowIso = new Date().toISOString();

  // Update branding atomically (logo_url + reviewed_at + updated_at).
  const { error: updErr } = await adminClient
    .from("agency_branding")
    .update({
      logo_url,
      branding_reviewed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("agency_id", agency_id);
  if (updErr) {
    // Best-effort rollback of the uploaded object.
    await adminClient.storage.from(BUCKET).remove([path]);
    return j(500, { error: "branding_update_failed", detail: updErr.message });
  }

  return j(200, {
    logo_url,
    bucket: BUCKET,
    path,
    uploaded_at: nowIso,
    branding_reviewed_at: nowIso,
  });
});
