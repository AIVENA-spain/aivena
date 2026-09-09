// AIVENA CAPTURE — deploy-only Edge Function `fetch-b64`
//
// This file is a RECORD of what is deployed, not a source of new work.
// Do NOT deploy it without diffing against live first: the repo has been
// stale before, and deploying a stale twilio-whatsapp-inbound would have
// silenced Amanda entirely.
//
//   function          : fetch-b64
//   repo path         : supabase/functions/fetch-b64/index.ts
//   deployed version  : 2
//   deployed bundle   : ezbr_sha256 02323e91d296e02889e0b15d6ae324291484cea73d7e2a7ec1612ea40536d4d7
//   captured source   : sha256 21f1d8f64d87254e114476b0448afa3450013f9fe228fc3691554c3183098a01
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
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOW = "https://atminvhrybxegpdtnnpl.supabase.co/storage/";

function b64(bytes: Uint8Array): string {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)) as unknown as number[]);
  }
  return btoa(bin);
}

Deno.serve(async (req: Request) => {
  try {
    const { urls } = await req.json();
    const photos: unknown[] = [];
    for (const u of (urls || [])) {
      if (typeof u !== "string" || !u.startsWith(ALLOW)) {
        photos.push({ url: u, error: "blocked" });
        continue;
      }
      const r = await fetch(u);
      if (!r.ok) {
        photos.push({ url: u, error: `http ${r.status}` });
        continue;
      }
      const buf = new Uint8Array(await r.arrayBuffer());
      const ct = r.headers.get("content-type") || "image/jpeg";
      photos.push({ url: u, dataUri: `data:${ct};base64,${b64(buf)}`, bytes: buf.length });
    }
    return new Response(JSON.stringify({ ok: true, photos }), {
      headers: { "Content-Type": "application/json", "Connection": "keep-alive" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
