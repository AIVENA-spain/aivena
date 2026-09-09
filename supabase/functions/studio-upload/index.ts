// AIVENA CAPTURE — deploy-only Edge Function `studio-upload`
//
// This file is a RECORD of what is deployed, not a source of new work.
// Do NOT deploy it without diffing against live first: the repo has been
// stale before, and deploying a stale twilio-whatsapp-inbound would have
// silenced Amanda entirely.
//
//   function          : studio-upload
//   repo path         : supabase/functions/studio-upload/index.ts
//   deployed version  : 2
//   deployed bundle   : ezbr_sha256 1fc544107e8ba5e427768a0ff59e4ebecb12a7cdbd52d18ed2b7ac38b3fb6fa6
//   captured source   : sha256 78c52bd00c468507d05066cda821531f71c1dbd0b3ccc1fef7a9e0a32534ffd2
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
// studio-upload v2: gunzip a base64 gzipped SVG and write to studio-templates. Strips whitespace before decode.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function getSecret(name: string): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/_get_platform_secret`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ p_name: name }),
  });
  let t = (await r.text()).trim();
  if (t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
  return t;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function gunzipB64(b64: string): Promise<string> {
  const clean = b64.replace(/\s+/g, "");
  const bin = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return new TextDecoder().decode(buf);
}

const J = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  try {
    const sec = await getSecret("IMAGE_GEN_INTERNAL_SECRET");
    if (!sec || req.headers.get("x-internal-secret") !== sec) return J({ ok: false, error: "unauthorized" }, 401);
    const body = await req.json();
    const template = String(body.template || "");
    const gz = String(body.gz || "");
    const dryRun = body.dryRun === true;
    if (!template || !gz) return J({ ok: false, error: "missing template or gz" }, 400);
    if (!/^[A-Za-z0-9_-]+$/.test(template)) return J({ ok: false, error: "bad template name" }, 400);
    let svg: string;
    try { svg = await gunzipB64(gz); } catch (e) { return J({ ok: false, error: "gunzip failed: " + String(e).slice(0, 120) }, 400); }
    if (!svg.includes("<svg")) return J({ ok: false, error: "decoded content is not svg", bytes: svg.length }, 400);
    const sha = await sha256Hex(svg);
    if (dryRun) return J({ ok: true, dryRun: true, template, bytes: svg.length, sha256: sha });
    const path = `${template}.tokenized.svg`;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/studio-templates/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "image/svg+xml", "x-upsert": "true" },
      body: svg,
    });
    const upText = await up.text();
    if (!up.ok) return J({ ok: false, error: "upload failed", status: up.status, detail: upText.slice(0, 300) }, 500);
    return J({ ok: true, template, path, bytes: svg.length, sha256: sha });
  } catch (e) {
    return J({ ok: false, error: String(e).slice(0, 300) }, 500);
  }
});
