// CAPTURE (version control) of the deploy-only Edge Function `whatsapp-send-template`.
// Slug: whatsapp-send-template · id fbbd9509-8bd0-4295-aff5-3a55005fef1d · version 9 · ACTIVE · verify_jwt=false
// ezbr_sha256: 53746c7f653d8b6ea869e0979353e0b51616754ad2aab7e58848cfb80889812b
// Captured 2026-09-01 from the DEPLOYED source. Do NOT deploy this file without
// diffing against live first — the repo has been stale before.
//
// ONE DELIBERATE DIFFERENCE FROM LIVE: the deployed source hardcodes the Twilio
// Account SID as a string literal. It is REDACTED here so a live credential does
// not enter version control. Before any redeploy, restore it from the Vault or
// (better) read it from an env var the way whatsapp-send-execute v6.7 does.
//
// whatsapp-send-template — sends a Twilio-APPROVED WhatsApp template via the
// Twilio Content API (ContentSid + ContentVariables). This is the business-initiated
// path: it works OUTSIDE the 24h window, unlike whatsapp-send-execute (freeform Body).
//
// Deliberately a SEPARATE function from whatsapp-send-execute so the live freeform
// send path is untouched and cannot regress.
//
// Auth: x-internal-secret header vs Vault WHATSAPP_SEND_INTERNAL_SECRET (same secret
// the freeform sender uses — no new secret to provision).
// POST { agency_id, content_sid, content_variables?, lead_id?, to_number?, sent_by?, context? }

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// REDACTED IN CAPTURE — live source has the literal SID here. See header.
const TWILIO_ACCOUNT_SID  = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "<REDACTED_IN_CAPTURE>";
const STATUS_CALLBACK_URL = "https://atminvhrybxegpdtnnpl.supabase.co/functions/v1/twilio-whatsapp-status";

const E164 = /^\+[1-9]\d{6,14}$/;

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
  if (req.method !== "POST") return j(405, { ok: false, error: "method_not_allowed" });

  const presented = req.headers.get("x-internal-secret") ?? "";
  if (!presented) return j(401, { ok: false, error: "unauthorized" });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: expected } = await admin.rpc("_get_platform_secret", { p_name: "WHATSAPP_SEND_INTERNAL_SECRET" });
  if (!expected || !constantTimeEqual(presented, expected)) return j(401, { ok: false, error: "unauthorized" });

  let body: any;
  try { body = await req.json(); } catch { return j(400, { ok: false, error: "invalid_json" }); }

  const { agency_id, lead_id, sent_by, content_sid } = body ?? {};
  const context: string = body?.context ?? "voice_recovery";
  let toNumber: string | null = body?.to_number ?? null;
  const contentVariables = body?.content_variables ?? null;

  if (!agency_id || typeof agency_id !== "string") return j(400, { ok: false, error: "missing_agency_id" });
  if (!content_sid || typeof content_sid !== "string") return j(400, { ok: false, error: "missing_content_sid" });
  if (!toNumber && !lead_id) return j(400, { ok: false, error: "missing_recipient", hint: "Provide to_number or lead_id." });

  const { data: settings, error: settingsErr } = await admin
    .from("agency_settings")
    .select("whatsapp_provider, whatsapp_from_number, whatsapp_access_token_connected")
    .eq("agency_id", agency_id)
    .maybeSingle();
  if (settingsErr) return j(500, { ok: false, error: "settings_lookup_failed" });
  if (!settings)   return j(404, { ok: false, error: "agency_not_found" });
  if (settings.whatsapp_provider !== "twilio" || !settings.whatsapp_from_number || !settings.whatsapp_access_token_connected) {
    return j(409, { ok: false, error: "whatsapp_not_configured", hint: "Agency has no active Twilio WhatsApp sender." });
  }
  const fromNumber: string = settings.whatsapp_from_number;

  if (lead_id) {
    const { data: lead } = await admin
      .from("leads").select("opt_in_status, phone")
      .eq("id", lead_id).eq("agency_id", agency_id).maybeSingle();
    if (!lead) return j(404, { ok: false, error: "lead_not_found" });
    if (lead.opt_in_status === "blocked" || lead.opt_in_status === "opted_out") {
      return j(409, { ok: false, error: "lead_opted_out", hint: "Lead has opted out. No sends allowed." });
    }
    if (!toNumber) toNumber = lead.phone;
  }
  if (!toNumber || !E164.test(toNumber)) {
    return j(400, { ok: false, error: "invalid_to_number", hint: "E.164 format required." });
  }

  const { data: token, error: tokenErr } = await admin.rpc("_get_platform_secret", { p_name: "TWILIO_AUTH_TOKEN" });
  if (tokenErr || !token) return j(500, { ok: false, error: "credentials_unavailable" });

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const form = new URLSearchParams({
    From: `whatsapp:${fromNumber}`,
    To:   `whatsapp:${toNumber}`,
    ContentSid: content_sid,
    StatusCallback: STATUS_CALLBACK_URL,
  });
  if (contentVariables && typeof contentVariables === "object") {
    form.set("ContentVariables", JSON.stringify(contentVariables));
  }

  const startedAt = Date.now();
  let twilioStatus = 0; let twilioJson: any = null; let fetchErr: string | undefined;
  try {
    const resp = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${token}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    twilioStatus = resp.status;
    const raw = await resp.text();
    try { twilioJson = JSON.parse(raw); } catch { twilioJson = { raw: raw.slice(0, 500) }; }
  } catch (e) {
    fetchErr = (e as Error).message?.slice(0, 240) ?? "unknown_fetch_error";
  }
  const durationMs = Date.now() - startedAt;
  const messageSid: string | null = twilioJson?.sid ?? null;
  const success = twilioStatus >= 200 && twilioStatus < 300 && !!messageSid;

  await admin.from("provider_audit_log").insert({
    agency_id, provider_type: "twilio_whatsapp", request_method: "POST", request_url: twilioUrl,
    request_payload: { from: fromNumber, to: toNumber, content_sid, has_variables: !!contentVariables, lead_id: lead_id ?? null, context },
    response_status: twilioStatus || null, response_payload: twilioJson, provider_message_id: messageSid,
    error_message: fetchErr ?? (success ? null : (twilioJson?.message ?? `twilio_http_${twilioStatus}`)),
    duration_ms: durationMs,
  });

  if (fetchErr)  return j(502, { ok: false, error: "twilio_unreachable", detail: fetchErr });
  if (!success)  return j(502, { ok: false, error: "twilio_send_failed", twilio_code: twilioJson?.code ?? null, twilio_message: twilioJson?.message ?? null });

  // Thread the outbound template into the lead's WhatsApp conversation so the reply lands.
  let conversationId: string | null = null;
  const nowIso = new Date().toISOString();
  if (lead_id) {
    const { data: existingConv } = await admin
      .from("conversations").select("id, message_count")
      .eq("agency_id", agency_id).eq("lead_id", lead_id).eq("channel", "whatsapp").eq("status", "open")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existingConv) {
      conversationId = existingConv.id;
      await admin.from("conversations")
        .update({ last_message_at: nowIso, message_count: (existingConv.message_count ?? 0) + 1, updated_at: nowIso })
        .eq("id", conversationId);
    } else {
      const { data: newConv } = await admin.from("conversations")
        .insert({ agency_id, lead_id, channel: "whatsapp", external_thread_id: toNumber, status: "open", last_message_at: nowIso, message_count: 1 })
        .select("id").single();
      conversationId = newConv?.id ?? null;
    }
    if (conversationId) {
      await admin.from("conversation_messages").insert({
        conversation_id: conversationId, agency_id, lead_id,
        direction: "outbound", message_type: "text",
        content: `[template:${context}]`,
        provider_message_id: messageSid, status: "sent", sent_by: sent_by ?? "voice_recovery", sent_at: nowIso,
        raw_payload: { via: "whatsapp-send-template", content_sid, content_variables: contentVariables, twilio_status: twilioJson?.status ?? null },
      });
    }
  }

  return j(200, { ok: true, provider_message_id: messageSid, twilio_status: twilioJson?.status ?? null, conversation_id: conversationId, from: fromNumber, to: toNumber });
});
