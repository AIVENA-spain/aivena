// twilio-whatsapp-inbound — W6 receive path v2.
//
// REPO CAPTURE 2026-08-26 (Amanda auto-mode P0): byte-exact source of the LIVE
// deployed version (v10, ezbr_sha256 b23cb3e876d1dd6918e3d3d5e78c0df42d83442e
// 3133a065b54310fbb1848089). This EF was deploy-only until now — do not edit
// casually; any change requires an approval-gated redeploy. See
// docs/amanda-automode/DESIGN_v1.2_2026-08-26.md §8 P0 and CAPTURE_NOTES.md
// beside this file for the media audit + planned outbox changes.
//
// v2 changes:
// - After successfully storing a NEW inbound message (not a duplicate), fires
//   the W4c WhatsApp Suggested Reply webhook in the background
//   (EdgeRuntime.waitUntil) so Twilio's TwiML response is not delayed.
//   W4c drafts an AI reply with Claude Haiku and creates the dashboard task.
//
// Auth: X-Twilio-Signature HMAC validation against pinned PUBLIC_URL.
// Flow: validate signature → parse form payload → resolve agency by To number
// → webhook_events row → find-or-create lead → upsert conversation → insert
// conversation_message (idempotent on MessageSid) → update lead 24h-window
// timestamp → trigger W4c (background) → 200 with empty TwiML.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PUBLIC_URL = "https://atminvhrybxegpdtnnpl.supabase.co/functions/v1/twilio-whatsapp-inbound";
const W4C_WEBHOOK_URL = "https://chrisscholte.app.n8n.cloud/webhook/w4c-whatsapp-inbound";

const EMPTY_TWIML = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

function twiml(): Response {
  return new Response(EMPTY_TWIML, { status: 200, headers: { "Content-Type": "text/xml" } });
}

async function validateTwilioSignature(authToken: string, url: string, params: URLSearchParams, signature: string): Promise<boolean> {
  const sortedKeys = [...params.keys()].sort();
  let data = url;
  for (const k of sortedKeys) data += k + (params.get(k) ?? "");

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return new Response("forbidden", { status: 403 });

  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authToken } = await admin.rpc("_get_platform_secret", { p_name: "TWILIO_AUTH_TOKEN" });
  if (!authToken) return new Response("server_error", { status: 500 });

  const valid = await validateTwilioSignature(authToken, PUBLIC_URL, params, signature);
  if (!valid) return new Response("forbidden", { status: 403 });

  const messageSid  = params.get("MessageSid") ?? params.get("SmsMessageSid");
  const fromRaw     = params.get("From") ?? "";
  const toRaw       = params.get("To") ?? "";
  const body        = params.get("Body") ?? "";
  const profileName = params.get("ProfileName") ?? null;
  const numMedia    = parseInt(params.get("NumMedia") ?? "0", 10) || 0;

  const fromNumber = fromRaw.replace(/^whatsapp:/, "");
  const toNumber   = toRaw.replace(/^whatsapp:/, "");

  if (!messageSid || !fromNumber || !toNumber) {
    return new Response("bad_request", { status: 400 });
  }

  const { data: agencyRow } = await admin
    .from("agency_settings")
    .select("agency_id")
    .eq("whatsapp_from_number", toNumber)
    .eq("whatsapp_provider", "twilio")
    .maybeSingle();

  const { data: webhookEvent } = await admin
    .from("webhook_events")
    .insert({
      agency_id: agencyRow?.agency_id ?? null,
      source: "twilio_whatsapp",
      event_type: "message_inbound",
      payload: Object.fromEntries(params.entries()),
      processing_status: agencyRow ? "received" : "unresolved_agency",
    })
    .select("id")
    .single();

  if (!agencyRow) {
    return twiml();
  }
  const agencyId = agencyRow.agency_id;

  // ── THE CLEAR LINE: staff, or client? (Christian, 2026-08-28) ──────────────
  // Agents message the SAME AIVENA number as buyers, so the number itself is
  // the only discriminator — and until now nothing looked. An agent texting in
  // was turned into a LEAD and answered as if they were house-hunting. The
  // roster is checked FIRST: a registered agent can never become a lead and
  // never reaches the buyer engine.
  //
  // Today the staff lane only records the message (the ping/reply machinery is
  // the next slice), which is the correct conservative behaviour: doing
  // nothing is right, becoming a buyer is wrong. Fail-safe: if the lookup
  // itself errors we fall through to the buyer path exactly as before, because
  // an empty roster and a broken lookup must not silently swallow real buyers.
  try {
    const { data: staff } = await admin.rpc("lookup_agency_agent", {
      p_agency_id: agencyId,
      p_whatsapp: fromNumber,
    });
    const agent = Array.isArray(staff) ? staff[0] : staff;
    if (agent) {
      await admin.from("webhook_events")
        .update({
          processing_status: "staff_message",
          error_message: `from agent ${agent.full_name}`.slice(0, 240),
        })
        .eq("id", webhookEvent?.id);
      // A reply also proves presence — the shift check-in's whole purpose.
      await admin.from("agency_agents")
        .update({ last_checkin_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", agent.id);
      return twiml();
    }
  } catch (_staffErr) {
    // Deliberately swallowed — see fail-safe note above.
  }

  const { data: existingLead } = await admin
    .from("leads")
    .select("id, language")
    .eq("agency_id", agencyId)
    .eq("phone", fromNumber)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let leadId: string;
  if (existingLead) {
    leadId = existingLead.id;
    await admin.from("leads")
      .update({ last_inbound_whatsapp_at: new Date().toISOString(), last_contact_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", leadId);
  } else {
    const { data: newLead, error: leadErr } = await admin
      .from("leads")
      .insert({
        agency_id: agencyId,
        full_name: profileName,
        phone: fromNumber,
        source: "whatsapp_inbound",
        source_type: "whatsapp",
        channel: "whatsapp",
        message: body.slice(0, 2000),
        status: "new",
        opt_in_status: "opted_in",
        opt_in_at: new Date().toISOString(),
        last_inbound_whatsapp_at: new Date().toISOString(),
        received_at: new Date().toISOString(),
        raw_payload: { twilio_message_sid: messageSid, profile_name: profileName, via: "twilio_whatsapp_inbound_v2" },
        dedup_key: `whatsapp:${agencyId}:${fromNumber}`,
      })
      .select("id")
      .single();
    if (leadErr || !newLead) {
      await admin.from("webhook_events").update({ processing_status: "lead_create_failed", error_message: leadErr?.message?.slice(0, 240) }).eq("id", webhookEvent?.id);
      return twiml();
    }
    leadId = newLead.id;
    await admin.from("consent_log").insert({
      agency_id: agencyId,
      lead_id: leadId,
      event_type: "opt_in",
      channel: "whatsapp",
      consent_method: "inbound_message",
      consent_text: "Lead initiated WhatsApp conversation with agency sender (Twilio inbound).",
      recorded_by: "twilio-whatsapp-inbound-ef",
    });
  }

  const { data: existingConv } = await admin
    .from("conversations")
    .select("id, message_count")
    .eq("agency_id", agencyId)
    .eq("lead_id", leadId)
    .eq("channel", "whatsapp")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversationId: string;
  if (existingConv) {
    conversationId = existingConv.id;
    await admin.from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
        last_inbound_at: new Date().toISOString(),
        message_count: (existingConv.message_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId);
  } else {
    const { data: newConv, error: convErr } = await admin
      .from("conversations")
      .insert({
        agency_id: agencyId,
        lead_id: leadId,
        channel: "whatsapp",
        external_thread_id: fromNumber,
        status: "open",
        last_message_at: new Date().toISOString(),
        last_inbound_at: new Date().toISOString(),
        message_count: 1,
      })
      .select("id")
      .single();
    if (convErr || !newConv) {
      await admin.from("webhook_events").update({ processing_status: "conversation_create_failed", error_message: convErr?.message?.slice(0, 240) }).eq("id", webhookEvent?.id);
      return twiml();
    }
    conversationId = newConv.id;
  }

  const { error: msgErr } = await admin
    .from("conversation_messages")
    .insert({
      conversation_id: conversationId,
      agency_id: agencyId,
      lead_id: leadId,
      direction: "inbound",
      message_type: numMedia > 0 ? "media" : "text",
      content: body,
      provider_message_id: messageSid,
      status: "received",
      sent_at: new Date().toISOString(),
      raw_payload: { profile_name: profileName, num_media: numMedia, via: "twilio_whatsapp_inbound_v2" },
    });

  const finalStatus = msgErr
    ? (msgErr.code === "23505" ? "duplicate_ignored" : "message_insert_failed")
    : "processed";

  await admin.from("webhook_events")
    .update({ processing_status: finalStatus, lead_id: leadId, processed_at: new Date().toISOString(), error_message: msgErr && msgErr.code !== "23505" ? msgErr.message?.slice(0, 240) : null })
    .eq("id", webhookEvent?.id);

  // v2: trigger W4c AI reply drafting in the background (new messages only —
  // Twilio retries / duplicates must not double-draft). Failure is non-fatal:
  // the message is stored; a missed draft surfaces as a quiet thread, and the
  // operator still sees the inbound in the dashboard.
  if (finalStatus === "processed" && body.trim().length > 0) {
    const w4cCall = fetch(W4C_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agency_id: agencyId,
        lead_id: leadId,
        conversation_id: conversationId,
        message_body: body,
        profile_name: profileName,
        provider_message_id: messageSid,
      }),
    }).catch(() => { /* non-fatal */ });
    try {
      // @ts-ignore EdgeRuntime is provided by the Supabase Edge runtime
      EdgeRuntime.waitUntil(w4cCall);
    } catch {
      await w4cCall;
    }
  }

  return twiml();
});
