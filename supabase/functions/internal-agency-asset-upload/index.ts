// AIVENA CAPTURE — deploy-only Edge Function `internal-agency-asset-upload`
//
// This file is a RECORD of what is deployed, not a source of new work.
// Do NOT deploy it without diffing against live first: the repo has been
// stale before, and deploying a stale twilio-whatsapp-inbound would have
// silenced Amanda entirely.
//
//   function          : internal-agency-asset-upload
//   repo path         : supabase/functions/internal-agency-asset-upload/index.ts
//   deployed version  : 12
//   deployed bundle   : ezbr_sha256 b4bde98515ea5a5a722efb2c546a7d80bd2838b75ac56ee2f30c0f10aef243f5
//   captured source   : sha256 59475dfd2573651d3a9d229d3860e9056e492301a0b2e527d8ef3069ebf6847f
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
// internal-agency-asset-upload
// Internal admin upload path for the Onboarding Console workflow.
// Replaces 3 HTTP Storage nodes that previously contained the service_role JWT in plaintext.
//
// Auth: shared-secret X-Internal-Secret header (constant-time compare).
// Body: raw binary (file bytes).
// Required headers:
//   X-Internal-Secret: shared secret (matches INTERNAL_AGENCY_ASSET_SECRET env var)
//   X-Agency-Id: agency_id (must exist in agencies.id OR agency_settings.agency_id)
//   X-Asset-Type: 'logo' | 'banner' | 'agent'
//   X-File-Extension: file extension without the dot (png, jpg, jpeg, webp, gif, svg, avif)
//   Content-Type: mime type of the file
// Returns 200: {ok: true, public_url, storage_path, bucket, uploaded_at}
// Returns 4xx/5xx with friendly {ok: false, error, ...} envelope (Law-2).

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("INTERNAL_AGENCY_ASSET_SECRET");

const BUCKET = "agency-assets";
const ALLOWED_ASSET_TYPES = new Set(["logo", "banner", "agent"]);
const ALLOWED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"]);
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function friendly(status: number, error: string, details?: string) {
  const body: Record<string, unknown> = { ok: false, error };
  if (details) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return friendly(405, "Method not allowed");
  }

  // Auth: shared-secret
  const providedSecret = req.headers.get("X-Internal-Secret");
  if (!INTERNAL_SECRET) {
    return friendly(500, "Server is not configured for asset uploads. Please contact support.");
  }
  if (!providedSecret || !constantTimeEquals(providedSecret, INTERNAL_SECRET)) {
    return friendly(401, "Authentication required");
  }

  // Required headers
  const agencyId = req.headers.get("X-Agency-Id");
  const assetType = req.headers.get("X-Asset-Type");
  let fileExt = (req.headers.get("X-File-Extension") || "").toLowerCase().replace(".", "");
  const contentType = req.headers.get("Content-Type") || "application/octet-stream";

  if (!agencyId) {
    return friendly(400, "Missing X-Agency-Id header");
  }
  if (!assetType || !ALLOWED_ASSET_TYPES.has(assetType)) {
    return friendly(400, "Asset type must be one of: logo, banner, agent");
  }
  if (fileExt === "jpeg") fileExt = "jpg"; // normalize
  if (!fileExt || !ALLOWED_EXTENSIONS.has(fileExt)) {
    return friendly(400, `File extension must be one of: ${Array.from(ALLOWED_EXTENSIONS).join(", ")}`);
  }

  // Read binary body
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await req.arrayBuffer());
  } catch (e) {
    return friendly(400, "Could not read file body", e instanceof Error ? e.message : undefined);
  }
  if (bytes.length === 0) {
    return friendly(400, "Empty file body");
  }
  if (bytes.length > MAX_SIZE_BYTES) {
    return friendly(400, `File too large. Max ${MAX_SIZE_BYTES} bytes`);
  }

  // Verify agency exists (defense-in-depth)
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let agencyExists = false;
  // Try agencies.id (text)
  const { data: agencyById } = await admin
    .from("agencies")
    .select("id")
    .eq("id", agencyId)
    .maybeSingle();
  if (agencyById) agencyExists = true;

  // Try agency_settings.agency_id (text) — the n8n workflow uses this identifier
  if (!agencyExists) {
    const { data: settingsRow } = await admin
      .from("agency_settings")
      .select("agency_id")
      .eq("agency_id", agencyId)
      .maybeSingle();
    if (settingsRow) agencyExists = true;
  }

  if (!agencyExists) {
    return friendly(404, `Agency not found: ${agencyId}`);
  }

  // Upload to storage. Path matches existing Onboarding Console convention: <agency_id>/<asset_type>.<ext>
  const storagePath = `${agencyId}/${assetType}.${fileExt}`;

  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType,
      cacheControl: "3600",
      upsert: true,
    });

  if (uploadErr) {
    return friendly(500, "Upload failed. Please try again or contact support.", uploadErr.message);
  }

  const { data: urlData } = admin.storage.from(BUCKET).getPublicUrl(storagePath);

  return new Response(
    JSON.stringify({
      ok: true,
      public_url: urlData.publicUrl,
      storage_path: storagePath,
      bucket: BUCKET,
      uploaded_at: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
});
