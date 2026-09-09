// AIVENA CAPTURE — deploy-only Edge Function `studio-tpl`
//
// This file is a RECORD of what is deployed, not a source of new work.
// Do NOT deploy it without diffing against live first: the repo has been
// stale before, and deploying a stale twilio-whatsapp-inbound would have
// silenced Amanda entirely.
//
//   function          : studio-tpl
//   repo path         : supabase/functions/studio-tpl/index.ts
//   deployed version  : 2
//   deployed bundle   : ezbr_sha256 02b65873f9a6ab19d435eeeac4370c4d741568a94b157e329bce9a3223308177
//   captured source   : sha256 8a9209760fa6618d80d894d9e08ead488878652a056538b70fe9ec05fbcf7ac6
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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "studio-templates";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const okName = (s: string) => /^[A-Za-z0-9_.\-]+$/.test(s) && !s.includes("..");

async function expectedSecret(): Promise<string> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/_get_platform_secret`, {
      method: "POST",
      headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_name: "IMAGE_GEN_INTERNAL_SECRET" }),
    });
    if (!r.ok) return "";
    const t = (await r.text()).trim();
    return t.replace(/^"|"$/g, "");
  } catch (_) { return ""; }
}

async function readObj(path: string): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}` },
  });
  if (!r.ok) throw new Error(`read ${path} -> ${r.status}`);
  return await r.text();
}

async function writeObj(path: string, svg: string): Promise<number> {
  const bytes = new TextEncoder().encode(svg);
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "image/svg+xml", "x-upsert": "true" },
    body: bytes,
  });
  if (!r.ok) throw new Error(`write ${path} -> ${r.status} ${await r.text()}`);
  return bytes.length;
}

Deno.serve(async (req) => {
  try {
    const expected = await expectedSecret();
    if (!expected || req.headers.get("x-internal-secret") !== expected) return json({ ok: false, error: "unauthorized" }, 401);
    const b = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = String(b.action ?? "");
    const template = String(b.template ?? "");
    if (!okName(template + ".x")) return json({ ok: false, error: "bad template" }, 400);
    const path = `${template}.tokenized.svg`;

    if (action === "len") {
      const svg = await readObj(path);
      return json({ ok: true, length: svg.length });
    }

    if (action === "slice") {
      const svg = await readObj(path);
      const offset = Math.max(0, Number(b.offset ?? 0));
      const limit = Math.min(45000, Math.max(1, Number(b.limit ?? 20000)));
      return json({ ok: true, length: svg.length, offset, slice: svg.slice(offset, offset + limit) });
    }

    if (action === "find") {
      const svg = await readObj(path);
      const ctx = Math.min(3000, Math.max(0, Number(b.context ?? 250)));
      let flags = String(b.flags ?? "g"); if (!flags.includes("g")) flags += "g";
      const re = new RegExp(String(b.pattern ?? ""), flags);
      const out: unknown[] = []; let m: RegExpExecArray | null; let n = 0;
      while ((m = re.exec(svg)) !== null && n < 40) {
        const i = m.index;
        out.push({ index: i, match: m[0].slice(0, 400), before: svg.slice(Math.max(0, i - ctx), i), after: svg.slice(i + m[0].length, i + m[0].length + ctx) });
        n++; if (m.index === re.lastIndex) re.lastIndex++;
      }
      return json({ ok: true, length: svg.length, count: out.length, matches: out });
    }

    if (action === "edit") {
      const outTemplate = String(b.outTemplate ?? template);
      if (!okName(outTemplate + ".x")) return json({ ok: false, error: "bad outTemplate" }, 400);
      const reps = Array.isArray(b.replacements) ? b.replacements : [];
      if (!reps.length) return json({ ok: false, error: "no replacements" }, 400);
      let svg = await readObj(path);
      const original = svg;
      const report: unknown[] = [];
      let missing = false;
      for (const rep of reps as Array<Record<string, unknown>>) {
        const find = String(rep.find ?? "");
        const replace = String(rep.replace ?? "");
        const count = find ? svg.split(find).length - 1 : 0;
        report.push({ count, findLen: find.length });
        if (count === 1 || (rep.allowMany && count > 0)) svg = svg.split(find).join(replace);
        else missing = true;
      }
      if (b.dryRun) return json({ ok: true, dryRun: true, report, newLength: svg.length });
      if (missing) return json({ ok: false, error: "some finds matched 0 or were ambiguous", report }, 422);
      const ts = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
      const backup = `backups/${outTemplate}.${ts}.tokenized.svg`;
      await writeObj(backup, original);
      const bytes = await writeObj(`${outTemplate}.tokenized.svg`, svg);
      return json({ ok: true, report, bytes, out: `${outTemplate}.tokenized.svg`, backup });
    }

    if (action === "copy") {
      const to = String(b.to ?? "");
      if (!okName(to + ".x")) return json({ ok: false, error: "bad to" }, 400);
      const svg = await readObj(path);
      const ts = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
      let backup: string | null = null;
      try { const dst = await readObj(`${to}.tokenized.svg`); backup = `backups/${to}.${ts}.tokenized.svg`; await writeObj(backup, dst); } catch (_) { /* no existing dest */ }
      const bytes = await writeObj(`${to}.tokenized.svg`, svg);
      return json({ ok: true, from: path, to: `${to}.tokenized.svg`, bytes, backup });
    }

    return json({ ok: false, error: "unknown action" }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
