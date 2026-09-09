// AIVENA CAPTURE — deploy-only Edge Function `vapi-property-search`
//
// This file is a RECORD of what is deployed, not a source of new work.
// Do NOT deploy it without diffing against live first: the repo has been
// stale before, and deploying a stale twilio-whatsapp-inbound would have
// silenced Amanda entirely.
//
//   function          : vapi-property-search
//   repo path         : supabase/functions/vapi-property-search/index.ts
//   deployed version  : 9
//   deployed bundle   : ezbr_sha256 54a3383e8c99f86c2cbca8566b39dd96aa05316107bb59365b09dfb8eec5d79d
//   captured source   : sha256 5039df100ae40fc34b8ca5aa0538db3deb027c90448dd6f9626eec0a2d917fc6
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

// vapi-property-search
// Mid-call catalog lookup tool for the AIVENA voice agent.
// Vapi posts a `tool-calls` server message here when the assistant calls the
// `search_properties` tool. We validate the Vapi secret, derive the agency from
// the signed call metadata, run the agency-fenced voice_search_properties RPC,
// and return Vapi's expected { results: [{ toolCallId, result }] } shape.
// Strict RAG: the agent can ONLY ever see one agency's own active listings.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-vapi-secret, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function rpc(name: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: r.ok, status: r.status, data };
}

async function expectedSecret(): Promise<string | null> {
  try {
    const r = await rpc("_get_platform_secret", { p_name: "VAPI_WEBHOOK_SECRET" });
    if (r.ok && typeof r.data === "string" && r.data.length) return r.data;
  } catch (_) { /* fall through */ }
  const env = Deno.env.get("VAPI_WEBHOOK_SECRET");
  return env && env.length ? env : null;
}

function pickStr(...vals: unknown[]): string | null {
  for (const v of vals) if (typeof v === "string" && v.trim() !== "") return v;
  return null;
}

// Normalize Vapi's tool-call payload shapes into [{ id, name, args }].
function extractToolCalls(msg: any): Array<{ id: string; name: string; args: any }> {
  const out: Array<{ id: string; name: string; args: any }> = [];
  const list = Array.isArray(msg?.toolCallList) ? msg.toolCallList
            : Array.isArray(msg?.toolCalls) ? msg.toolCalls
            : [];
  for (const tc of list) {
    const fn = tc?.function ?? tc?.functionCall ?? {};
    const id = pickStr(tc?.id, tc?.toolCallId, fn?.id) ?? "";
    const name = pickStr(fn?.name, tc?.name) ?? "";
    let args: any = fn?.arguments ?? fn?.parameters ?? tc?.arguments ?? {};
    if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
    if (id && name) out.push({ id, name, args: args || {} });
  }
  // Legacy single function-call shape.
  if (out.length === 0 && msg?.functionCall) {
    const fn = msg.functionCall;
    let args: any = fn?.parameters ?? fn?.arguments ?? {};
    if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
    const name = pickStr(fn?.name) ?? "";
    const id = pickStr(msg?.toolCallId, fn?.id) ?? "legacy";
    if (name) out.push({ id, name, args: args || {} });
  }
  return out;
}

function buildFilter(a: any): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  for (const k of ["price_min", "price_max", "bedrooms_min", "bathrooms_min"]) {
    const v = a?.[k];
    if (v !== undefined && v !== null && v !== "") f[k] = v;
  }
  for (const k of ["location_city", "location_region", "property_type", "status"]) {
    const v = a?.[k];
    if (typeof v === "string" && v.trim() !== "") f[k] = v.trim();
  }
  return f;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed" }, 405);

  const want = await expectedSecret();
  const got = req.headers.get("x-vapi-secret");
  if (!want || !got || got !== want) return json({ ok: false, message: "Unauthorized" }, 401);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ results: [] }, 200); }

  const msg = payload?.message ?? payload ?? {};
  const type = (msg?.type ?? "").toString();
  if (type !== "tool-calls" && type !== "function-call") {
    return json({ ok: true, ignored: type || "unknown" }, 200);
  }

  const agencyId = pickStr(
    msg?.call?.metadata?.agency_id,
    msg?.call?.assistantOverrides?.metadata?.agency_id,
    msg?.metadata?.agency_id,
    payload?.call?.metadata?.agency_id,
  );

  const calls = extractToolCalls(msg);
  const results: Array<{ toolCallId: string; result: string }> = [];

  for (const c of calls) {
    if (!/search.*propert|propert.*search|find.*propert/i.test(c.name)) {
      results.push({ toolCallId: c.id, result: "Unsupported tool." });
      continue;
    }
    if (!agencyId) {
      results.push({ toolCallId: c.id, result: JSON.stringify({ count: 0, properties: [], note: "Catalog unavailable for this call." }) });
      continue;
    }
    const filter = buildFilter(c.args);
    const limit = (typeof c.args?.limit === "number" && c.args.limit > 0) ? c.args.limit : 5;
    const r = await rpc("voice_search_properties", { p_agency_id: agencyId, p_filter: filter, p_limit: limit });
    let resultObj: any = { count: 0, properties: [] };
    if (r.ok && r.data && (r.data as any).ok !== false) {
      resultObj = { count: (r.data as any).count ?? 0, properties: (r.data as any).properties ?? [] };
    }
    results.push({ toolCallId: c.id, result: JSON.stringify(resultObj) });
  }

  return json({ results }, 200);
});
