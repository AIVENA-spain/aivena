// AIVENA CAPTURE — deploy-only Edge Function `tpl-io`
//
// This file is a RECORD of what is deployed, not a source of new work.
// Do NOT deploy it without diffing against live first: the repo has been
// stale before, and deploying a stale twilio-whatsapp-inbound would have
// silenced Amanda entirely.
//
//   function          : tpl-io
//   repo path         : supabase/functions/tpl-io/index.ts
//   deployed version  : 1
//   deployed bundle   : ezbr_sha256 3a2e30da06f176b3509f05c0f464ddaa59cdd35a24a58be17c062429a7516f9f
//   captured source   : sha256 6ecf622631a7ab90248a17c36ab4fbb439e047f069d2e701f2b5b1dd46be6d96
//   verified_at       : 2026-09-09
//   method            : pulled deployed source via Supabase Management API
//                       and written verbatim below the marker
//   verify_jwt        : false  (MUST be passed explicitly on any redeploy)
//   status            : verified
//   difference        : none — byte-for-byte. NOTE: its own header calls it a TEMPORARY workshop helper marked for deletion, yet it is still ACTIVE in production with service-role access to the studio-templates bucket. Flagged, not acted on.
//
// The bundle hash is Supabase's hash of the DEPLOYED BUNDLE and cannot be
// recomputed from this file. It proves 'production has not changed since
// capture'. Source equivalence was established AT CAPTURE TIME by pulling
// live source and writing it verbatim; `captured source sha256` above lets
// us detect later edits to this file.
// ---8<--- CAPTURED SOURCE BELOW — verbatim from production, do not edit ---8<---
// tpl-io  — TEMPORARY Vega workshop helper. DELETE after Studio template work is done.
// Lets my sandbox reach the studio-templates bucket (which it can't hit directly).
// read_stripped: download a template SVG, remove embedded base64 image payloads so the
//   file is small enough to return through pg_net, and report the distinct colour fills.
// list: enumerate the bucket.
// No user data is ever touched — these are design files only.

import { createClient } from "jsr:@supabase/supabase-js@2";

const BUCKET = "studio-templates";

function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = String(body.action ?? "");
    const name = body.name ? String(body.name) : "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (action === "list") {
      const { data, error } = await supabase.storage.from(BUCKET).list("", { limit: 500 });
      if (error) return json({ ok: false, error: error.message }, 500);
      const files = (data ?? [])
        .filter((f) => f.name.toLowerCase().endsWith(".svg"))
        .map((f) => ({ name: f.name, bytes: f.metadata?.size ?? null }));
      return json({ ok: true, count: files.length, files });
    }

    if (action === "read_stripped") {
      if (!name) return json({ ok: false, error: "name required" }, 400);
      const { data, error } = await supabase.storage.from(BUCKET).download(name);
      if (error || !data) return json({ ok: false, error: error?.message ?? "download failed" }, 404);

      const raw = await data.text();
      const originalBytes = raw.length;

      let svg = raw.replace(
        /((?:xlink:)?href)\s*=\s*"data:image\/[a-zA-Z0-9.+\-]+;base64,[^"]*"/g,
        '$1=""',
      );
      svg = svg.replace(
        /url\(\s*data:image\/[a-zA-Z0-9.+\-]+;base64,[^)]*\)/g,
        "url()",
      );
      const strippedBytes = svg.length;

      const counts: Record<string, number> = {};
      const colreg = /(?:fill|stroke|stop-color)\s*[:=]\s*["']?(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/gi;
      let m: RegExpExecArray | null;
      while ((m = colreg.exec(svg)) !== null) {
        const c = m[1].toLowerCase().replace(/\s+/g, "");
        counts[c] = (counts[c] ?? 0) + 1;
      }
      const fills = Object.entries(counts)
        .map(([color, count]) => ({ color, count }))
        .sort((a, b) => b.count - a.count);

      return json({
        ok: true,
        name,
        originalBytes,
        strippedBytes,
        fillCount: fills.length,
        fills,
        svg,
      });
    }

    return json({ ok: false, error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
