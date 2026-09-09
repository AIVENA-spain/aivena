// AIVENA CAPTURE — deploy-only Edge Function `vapi-call-webhook`
//
// This file is a RECORD of what is deployed, not a source of new work.
// Do NOT deploy it without diffing against live first: the repo has been
// stale before, and deploying a stale twilio-whatsapp-inbound would have
// silenced Amanda entirely.
//
//   function          : vapi-call-webhook
//   repo path         : supabase/functions/vapi-call-webhook/index.ts
//   deployed version  : 11
//   deployed bundle   : ezbr_sha256 aa88007b2dc0dfeb487746a815192a169c7ce9bca253161ed3ff12274bf89564
//   captured source   : sha256 b0ef059f0aab7cea7bcc90a7ad5ce452c8da6803febb0d9f1788d0fa0c2e442c
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

// vapi-call-webhook
// Single server URL for the AIVENA voice agent. Handles BOTH:
//   - mid-call tool calls (type 'tool-calls'/'function-call') -> search_properties
//   - post-call ingestion (type 'end-of-call-report') -> ingest_voice_call + recovery
// Agency is resolved from (in order): call metadata -> ?agency= query param on the
// server URL -> (end-of-call only) phone-number match inside ingest_voice_call.
// The ?agency= param makes single-agency assistants bullet-proof without relying
// on Vapi metadata propagation.

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

// Best-effort instant missed-call WhatsApp recovery. Never throws to the caller.
async function tryVoiceRecovery(voiceCallId: string | null | undefined) {
  try {
    if (!voiceCallId) return;
    const dec = await rpc("prepare_voice_recovery", { p_voice_call_id: voiceCallId });
    const d: any = dec.data;
    if (!dec.ok || !d || d.send !== true) return;

    const secret = await rpc("_get_platform_secret", { p_name: "WHATSAPP_SEND_INTERNAL_SECRET" });
    const sec = (secret.ok && typeof secret.data === "string" && secret.data.length) ? secret.data : null;
    if (!sec) { console.error("voice recovery: no internal secret"); return; }

    const resp = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": sec },
      body: JSON.stringify({
        agency_id: d.agency_id, lead_id: d.lead_id, to_number: d.to_number,
        content_sid: d.content_sid, content_variables: d.content_variables,
        sent_by: "voice_recovery", context: "voice_recovery",
      }),
    });
    if (!resp.ok) {
      const errText = (await resp.text()).slice(0, 300);
      console.error("voice recovery send failed", resp.status, errText);
      if (resp.status >= 500) {
        await fetch(`${SUPABASE_URL}/rest/v1/voice_calls?id=eq.${voiceCallId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: "return=minimal" },
          body: JSON.stringify({ recovery_sent: false }),
        });
      }
    }
  } catch (e) {
    console.error("voice recovery block error", String(e));
  }
}

function pick(...vals: unknown[]): string | null {
  for (const v of vals) if (typeof v === "string" && v.trim() !== "") return v;
  return null;
}
function num(...vals: unknown[]): number {
  for (const v of vals) {
    const n = typeof v === "number" ? v : (typeof v === "string" ? Number(v) : NaN);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}
function mapStatus(endedReason: string | null): string {
  const r = (endedReason || "").toLowerCase();
  if (r.includes("voicemail")) return "voicemail";
  if (r.includes("no-answer") || r.includes("did-not-answer") || r.includes("noanswer")) return "no_answer";
  if (r.includes("busy")) return "busy";
  if (r.includes("error") || r.includes("fail")) return "failed";
  return "answered";
}

// --- Mid-call tool helpers (catalogue search) ---
function extractToolCalls(msg: any): Array<{ id: string; name: string; args: any }> {
  const out: Array<{ id: string; name: string; args: any }> = [];
  const list = Array.isArray(msg?.toolCallList) ? msg.toolCallList
            : Array.isArray(msg?.toolCalls) ? msg.toolCalls
            : [];
  for (const tc of list) {
    const fn = tc?.function ?? tc?.functionCall ?? {};
    const id = pick(tc?.id, tc?.toolCallId, fn?.id) ?? "";
    const name = pick(fn?.name, tc?.name) ?? "";
    let args: any = fn?.arguments ?? fn?.parameters ?? tc?.arguments ?? {};
    if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
    if (id && name) out.push({ id, name, args: args || {} });
  }
  if (out.length === 0 && msg?.functionCall) {
    const fn = msg.functionCall;
    let args: any = fn?.parameters ?? fn?.arguments ?? {};
    if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
    const name = pick(fn?.name) ?? "";
    const id = pick(msg?.toolCallId, fn?.id) ?? "legacy";
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
  try { payload = await req.json(); } catch { return json({ ok: false, message: "Invalid request" }, 400); }

  const msg = payload?.message ?? payload ?? {};
  const type = (msg?.type ?? "").toString();

  let qpAgency: string | null = null;
  try { qpAgency = new URL(req.url).searchParams.get("agency"); } catch { qpAgency = null; }

  // --- Mid-call tool calls: property catalogue search ---
  if (type === "tool-calls" || type === "function-call") {
    const agencyId = pick(
      msg?.call?.metadata?.agency_id,
      msg?.call?.assistantOverrides?.metadata?.agency_id,
      msg?.metadata?.agency_id,
      qpAgency,
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
  }

  // --- Everything that isn't a tool call or an end-of-call report is ignored ---
  if (type !== "end-of-call-report") return json({ ok: true, ignored: type || "unknown" }, 200);

  try {
    const call = msg?.call ?? {};
    const artifact = msg?.artifact ?? {};
    const analysis = msg?.analysis ?? {};
    const structured = analysis?.structuredData ?? {};

    const duration = Math.round(num(msg?.durationSeconds, msg?.duration, call?.duration));
    const args = {
      p_vapi_call_id: pick(call?.id, msg?.callId, payload?.callId),
      p_from_number: pick(call?.customer?.number, msg?.customer?.number, msg?.from, call?.from),
      p_to_number: pick(call?.phoneNumber?.number, msg?.phoneNumber?.number, msg?.to, call?.to),
      p_direction: /outbound/i.test(pick(call?.type, "") || "") ? "outbound" : "inbound",
      p_status: mapStatus(pick(msg?.endedReason, call?.endedReason)),
      p_duration_seconds: duration,
      p_recording_url: pick(artifact?.recordingUrl, artifact?.recording?.url, msg?.recordingUrl),
      p_transcript: pick(artifact?.transcript, msg?.transcript),
      p_ai_summary: pick(analysis?.summary, msg?.summary),
      p_started_at: pick(msg?.startedAt, call?.startedAt),
      p_ended_at: pick(msg?.endedAt, call?.endedAt),
      p_twilio_call_sid: pick(call?.phoneCallProviderId, msg?.phoneCallProviderId, call?.providerId),
      p_lead_name: pick(structured?.name, structured?.caller_name, structured?.full_name),
      p_lead_intent: pick(structured?.intent),
      p_lead_type: pick(structured?.lead_type),
      p_language: pick(structured?.language, call?.metadata?.language, msg?.metadata?.language),
      p_agency_id: pick(call?.metadata?.agency_id, msg?.metadata?.agency_id, call?.assistantOverrides?.metadata?.agency_id, qpAgency),
      p_raw_payload: payload,
    };

    const r = await rpc("ingest_voice_call", args);
    if (!r.ok) {
      console.error("ingest_voice_call transport failed", r.status, JSON.stringify(r.data));
      return json({ ok: false, message: "Temporary error recording the call." }, 500);
    }
    const result: any = r.data;
    if (result && result.ok === false) {
      console.error("ingest_voice_call logical error", JSON.stringify(result));
      return json({ ok: false, message: "Call received but could not be matched to an agency." }, 200);
    }

    await tryVoiceRecovery(result?.voice_call_id);

    return json({ ok: true, voice_call_id: result?.voice_call_id, lead_id: result?.lead_id }, 200);
  } catch (e) {
    console.error("vapi-call-webhook error", String(e));
    return json({ ok: false, message: "Something went wrong handling the call." }, 500);
  }
});
