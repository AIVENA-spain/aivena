// AIVENA CAPTURE — deploy-only Edge Function `whatsapp-template-replicate`
//
// This file is a RECORD of what is deployed, not a source of new work.
// Do NOT deploy it without diffing against live first: the repo has been
// stale before, and deploying a stale twilio-whatsapp-inbound would have
// silenced Amanda entirely.
//
//   function          : whatsapp-template-replicate
//   repo path         : supabase/functions/whatsapp-template-replicate/index.ts
//   deployed version  : 1
//   deployed bundle   : ezbr_sha256 930601e2636cf2ee4f843640db6107b929ea289fc4f001616553ff7abe3f3afd
//   captured source   : sha256 dc427516f75f54b4c94070d05aa15a141fbb4bbb757e54c8cd2425709e9e8ada
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
// whatsapp-template-replicate — I8 per-agency template replication engine (v1).
//
// Takes an agency and replicates the __platform__ multilingual master pack into that
// agency's scope in whatsapp_templates, one row per (template_key, language), matched
// to the agency's supported_languages. Idempotent; never overwrites an existing agency
// row (so approved rows are preserved). Language alias: lead/agency 'no' (ISO) -> 'nb'
// (WhatsApp Bokmal), which is how the master pack is keyed.
//
// SUBMIT GATE: SUBMIT_ENABLED=false. This build ONLY writes DB rows (provider_status
// 'draft' = seeded, NOT on the provider). It does NOT call the Twilio Content API and
// does NOT submit anything to Meta. Real submission is the remaining gated step (see the
// changelog / I8 design): flip SUBMIT_ENABLED + resolve subaccount creds (H4) + call
// POST /v1/Content per row, then set provider_status='pending' + provider_template_id.
//
// Auth: x-internal-secret header vs Vault WHATSAPP_SEND_INTERNAL_SECRET.
// POST { agency_id, languages? }  ->  per-row replication report (no provider calls).

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Never submits to a provider in this build. Do not flip without the H4 creds + approval.
const SUBMIT_ENABLED = false;

// ISO / variant language codes -> the WhatsApp template language code used in the master pack.
const LANG_ALIAS: Record<string, string> = { no: "nb", nn: "nb", nob: "nb", nb_no: "nb" };
function normLang(l: string): string {
  const k = String(l || "").trim().toLowerCase();
  return LANG_ALIAS[k] ?? k;
}

function j(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function ctEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return j(405, { ok: false, error: "method_not_allowed" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const presented = req.headers.get("x-internal-secret") ?? "";
  const { data: expected } = await admin.rpc("_get_platform_secret", { p_name: "WHATSAPP_SEND_INTERNAL_SECRET" });
  if (!expected || !presented || !ctEq(presented, expected)) return j(401, { ok: false, error: "unauthorized" });

  let body: any; try { body = await req.json(); } catch { return j(400, { ok: false, error: "invalid_json" }); }
  const agency_id = body?.agency_id;
  if (!agency_id || typeof agency_id !== "string") return j(400, { ok: false, error: "missing_agency_id" });

  // Agency must exist.
  const { data: ag } = await admin.from("agencies").select("id").eq("id", agency_id).maybeSingle();
  if (!ag) return j(404, { ok: false, error: "agency_not_found" });

  // Language set: explicit override, else agency_settings.supported_languages. Fail loud if empty.
  let supported: string[] = Array.isArray(body?.languages) ? body.languages : [];
  if (supported.length === 0) {
    const { data: s } = await admin.from("agency_settings").select("supported_languages").eq("agency_id", agency_id).maybeSingle();
    supported = Array.isArray(s?.supported_languages) ? s!.supported_languages : [];
  }
  if (supported.length === 0) {
    return j(409, { ok: false, error: "no_supported_languages", hint: "agency_settings.supported_languages is empty — set it before replicating (never guessed)." });
  }

  // Alias + dedupe the target languages; record the aliases applied.
  const aliasesApplied: Array<{ from: string; to: string }> = [];
  const targetLangs = Array.from(new Set(supported.map((l) => {
    const to = normLang(l);
    if (to !== String(l).trim().toLowerCase()) aliasesApplied.push({ from: l, to });
    return to;
  })));

  // Load the whole __platform__ master pack.
  const { data: master } = await admin.from("whatsapp_templates")
    .select("template_key, template_name, category, language, variables, components")
    .eq("agency_id", "__platform__");
  const masterRows = master ?? [];
  const masterLangs = new Set(masterRows.map((r: any) => r.language));
  const masterKeys = Array.from(new Set(masterRows.map((r: any) => r.template_key)));

  const coveredLangs = targetLangs.filter((l) => masterLangs.has(l));
  const missingMasterLangs = targetLangs.filter((l) => !masterLangs.has(l)); // supported but no master copy

  // What the agency already has (never overwrite).
  const { data: existing } = await admin.from("whatsapp_templates")
    .select("template_key, language").eq("agency_id", agency_id);
  const have = new Set((existing ?? []).map((r: any) => `${r.template_key}::${r.language}`));

  const toInsert: any[] = [];
  const alreadyPresent: Array<{ key: string; lang: string }> = [];
  for (const m of masterRows) {
    if (!coveredLangs.includes(m.language)) continue; // only agency's covered languages
    const sig = `${m.template_key}::${m.language}`;
    if (have.has(sig)) { alreadyPresent.push({ key: m.template_key, lang: m.language }); continue; }
    toInsert.push({
      agency_id, template_key: m.template_key, template_name: m.template_name,
      category: m.category, language: m.language, status: "draft", provider_status: "draft",
      provider_template_id: null, provider_synced_at: null, variables: m.variables, components: m.components,
    });
  }

  let replicated: Array<{ key: string; lang: string }> = [];
  let insertError: string | null = null;
  if (toInsert.length > 0) {
    // ignoreDuplicates => ON CONFLICT DO NOTHING on UNIQUE(agency_id,template_key,language):
    // race-safe and can never overwrite/downgrade an existing (e.g. approved) row.
    const { error } = await admin.from("whatsapp_templates")
      .upsert(toInsert, { onConflict: "agency_id,template_key,language", ignoreDuplicates: true });
    if (error) insertError = error.message;
    else replicated = toInsert.map((r) => ({ key: r.template_key, lang: r.language }));
  }
  if (insertError) return j(500, { ok: false, error: "replication_write_failed", detail: insertError });

  return j(200, {
    ok: true,
    agency_id,
    supported_languages: supported,
    target_languages: targetLangs,
    language_aliases_applied: aliasesApplied,
    master_keys: masterKeys.length,
    covered_languages: coveredLangs,
    missing_master_copy_languages: missingMasterLangs, // e.g. pl/sv — reported, skipped, never invented
    replicated_count: replicated.length,
    replicated,
    already_present_count: alreadyPresent.length,
    already_present: alreadyPresent,
    submit_enabled: SUBMIT_ENABLED,
    submitted_to_provider: 0,
    note: "SUBMIT gated: agency rows created as provider_status='draft' (not on Meta/Twilio). No provider call was made. Real submission is the remaining gated step.",
  });
});
