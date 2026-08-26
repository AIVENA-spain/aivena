// twilio-whatsapp-inbound v3 — PROPOSED, NOT DEPLOYED (live = v10, captured in
// index.ts). Deploying this is an approval-gated prod change; it must go out
// TOGETHER WITH (or after) the P0 schema migration that creates
// amanda_inbound_queue. Diff vs v10, and nothing else:
//
//   1. OUTBOX (Amanda P0): after a NEW message is stored, insert an
//      amanda_inbound_queue row (idempotent on provider_message_id) so the
//      engine consumes a durable queue instead of a fire-and-forget webhook.
//      Insert failure is logged onto webhook_events but never breaks ingestion.
//   2. MEDIA LAW v0: MediaUrl0/MediaContentType0 (+ count) are persisted in the
//      message row's raw_payload and the queue payload, and media messages are
//      ENQUEUED TOO (v10's body-length gate silently dropped voice notes from
//      the AI path). Media bytes are NOT fetched here (Twilio URLs are
//      authed + expiring; STT/vision is the P2 gate) — the engine acknowledges
//      and asks the buyer to type it.
//   3. Button context: ButtonPayload / OriginalRepliedMessageSid forwarded in
//      the queue payload (pending-action confirmations + future ping spine).
//   4. W4C legacy path: per-agency cutover on amanda_mode — agencies at
//      'approval'/'assisted'/'full' get engine drafts ONLY (no double-draft);
//      'off'/'shadow' agencies keep W4C (shadow = engine runs silently
//      alongside). AMANDA_W4C_DISABLED='true' retires W4C globally.
//
// AT-3 discipline: signature validation, agency resolution, lead/consent
// creation, conversation upsert, idempotency and webhook_events statuses are
// byte-identical to v10.

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
  // v3: media descriptors + interactive-reply context (persisted, not fetched).
  const mediaUrl0        = params.get("MediaUrl0") ?? null;
  const mediaContentType = params.get("MediaContentType0") ?? null;
  const buttonPayload    = params.get("ButtonPayload") ?? null;
  const buttonText       = params.get("ButtonText") ?? null;
  const repliedMessageSid = params.get("OriginalRepliedMessageSid") ?? null;

  const fromNumber = fromRaw.replace(/^whatsapp:/, "");
  const toNumber   = toRaw.replace(/^whatsapp:/, "");

  if (!messageSid || !fromNumber || !toNumber) {
    return new Response("bad_request", { status: 400 });
  }

  const { data: agencyRow } = await admin
    .from("agency_settings")
    .select("agency_id, amanda_mode")
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
        raw_payload: { twilio_message_sid: messageSid, profile_name: profileName, via: "twilio_whatsapp_inbound_v3" },
        dedup_key: `whatsapp:${agencyId}:${fromNumber}`,
      })
      .select("id")
      .single();
    if (leadErr || !newLead) {
      await admin.from("webhook_events").update({ processing_status: "lead_create_failed", error_message: leadErr?.message?.slice(0, 240) }).eq("id", webhookEvent?.id);
      return twiml();
    }
    leadId = newLead.id;
    // Amanda data pack (design §11.4): the funnel starts here. Best-effort —
    // the table exists only after the P0 migration this EF deploys with.
    await admin.from("amanda_funnel_events").insert({
      agency_id: agencyId,
      lead_id: leadId,
      event_type: "lead_created",
      amanda_attributed: false,
      source: "whatsapp_inbound",
      metadata: {},
    }).then(({ error }) => { if (error) console.error("funnel lead_created:", error.code); });
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
      raw_payload: {
        profile_name: profileName, num_media: numMedia, via: "twilio_whatsapp_inbound_v3",
        // v3 Media Law v0: descriptors persisted on the message row (URLs are
        // authed + expiring — forensics/context, not a fetch source).
        media_url: mediaUrl0, media_content_type: mediaContentType,
        button_payload: buttonPayload, button_text: buttonText,
        replied_message_sid: repliedMessageSid,
      },
    });

  const finalStatus = msgErr
    ? (msgErr.code === "23505" ? "duplicate_ignored" : "message_insert_failed")
    : "processed";

  await admin.from("webhook_events")
    .update({ processing_status: finalStatus, lead_id: leadId, processed_at: new Date().toISOString(), error_message: msgErr && msgErr.code !== "23505" ? msgErr.message?.slice(0, 240) : null })
    .eq("id", webhookEvent?.id);

  const amandaMode = (agencyRow as { amanda_mode?: string }).amanda_mode ?? "off";
  if (finalStatus === "processed") {
    // v3 OUTBOX — only for agencies whose dial is on (an 'off' agency's rows
    // would accumulate unbounded with nothing draining them). Media messages
    // are enqueued TOO (kind 'media') — v10's body-length gate silently
    // dropped caption-less voice notes from the AI path.
    // Unique(provider_message_id, kind) makes redeliveries no-ops.
    if (amandaMode !== "off") {
      const { error: queueErr } = await admin.from("amanda_inbound_queue").insert({
        agency_id: agencyId,
        conversation_id: conversationId,
        lead_id: leadId,
        provider_message_id: messageSid,
        kind: numMedia > 0 ? "media" : "message",
        payload: {
          body,
          profile_name: profileName,
          num_media: numMedia,
          media_url: mediaUrl0,
          media_content_type: mediaContentType,
          button_payload: buttonPayload,
          button_text: buttonText,
          replied_message_sid: repliedMessageSid,
        },
        status: "pending",
      });
      if (queueErr && queueErr.code !== "23505") {
        await admin.from("webhook_events").update({ error_message: ("queue: " + queueErr.message).slice(0, 240) }).eq("id", webhookEvent?.id);
      }
    }

    // Legacy W4C drafting: per-agency cutover, deterministic. The engine is the
    // drafter once the agency's dial reaches approval/assisted/full — W4C
    // firing too would double-draft every inbound. off/shadow agencies keep W4C
    // (shadow runs the engine SILENTLY alongside for comparison). ROLLOUT LAW
    // (go-live pack): AMANDA_ENGINE_ENABLED must be true on Railway BEFORE any
    // agency leaves off/shadow, or approval+ agencies get NO drafts at all.
    // Env kill switch retires W4C globally at full cutover.
    const engineIsDrafter = ["approval", "assisted", "full"].includes(amandaMode);
    if (body.trim().length > 0 && !engineIsDrafter && Deno.env.get("AMANDA_W4C_DISABLED") !== "true") {
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
  }

  return twiml();
});
