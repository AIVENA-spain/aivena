// CAPTURE (version control) of the deploy-only Edge Function `twilio-whatsapp-status`.
// Slug: twilio-whatsapp-status · id 2337c85a-7b23-4624-9c3e-be36548e6b85 · version 9 · ACTIVE · verify_jwt=false
// ezbr_sha256: 24a9c4523ff8a2a98c48061a3f3e89059fd2954b4c78f375f5f69938776ea94e
// Captured 2026-09-01 from the DEPLOYED source, byte-for-byte (no secrets present).
// Do NOT deploy this file without diffing against live first — the repo has been stale before.
// verify_jwt MUST stay false: Twilio calls this with an HMAC signature, not a JWT.
//
// twilio-whatsapp-status — W6 delivery receipt handler v1.
//
// Twilio posts message status transitions here (StatusCallback set by the
// send EF): queued → sent → delivered → read, or failed/undelivered.
// Auth: X-Twilio-Signature HMAC validation (same scheme as the inbound EF;
// signed against THIS function's public URL).
//
// Effects:
// - conversation_messages.status updated by provider_message_id (MessageSid)
// - delivered_at / read_at timestamps set on those transitions
// - send_queue rows with matching provider_message_id move sent → delivered
// - failed/undelivered → webhook_events row for visibility (success receipts
//   are NOT logged to webhook_events — too noisy, the message row is the record)

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_URL = "https://atminvhrybxegpdtnnpl.supabase.co/functions/v1/twilio-whatsapp-status";

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

  const messageSid    = params.get("MessageSid") ?? params.get("SmsSid");
  const messageStatus = params.get("MessageStatus");   // queued|sent|delivered|read|failed|undelivered
  const errorCode     = params.get("ErrorCode");

  if (!messageSid || !messageStatus) return new Response("bad_request", { status: 400 });

  const nowIso = new Date().toISOString();

  // Map Twilio status → our message status + timestamp columns
  const patch: Record<string, unknown> = { status: messageStatus };
  if (messageStatus === "delivered") patch.delivered_at = nowIso;
  if (messageStatus === "read")      { patch.read_at = nowIso; }

  // "read" implies delivered; don't regress delivered_at if already set —
  // update only fills columns in the patch, existing delivered_at survives.
  const { data: updated } = await admin
    .from("conversation_messages")
    .update(patch)
    .eq("provider_message_id", messageSid)
    .select("id, agency_id")
    .maybeSingle();

  // send_queue progression: sent → delivered (only that transition; failures
  // are handled below and terminal states are never reopened)
  if (messageStatus === "delivered") {
    await admin
      .from("send_queue")
      .update({ status: "delivered", updated_at: nowIso })
      .eq("provider_message_id", messageSid)
      .eq("status", "sent");
  }

  if (messageStatus === "failed" || messageStatus === "undelivered") {
    await admin.from("webhook_events").insert({
      agency_id: updated?.agency_id ?? null,
      source: "twilio_whatsapp",
      event_type: "message_status_failed",
      payload: Object.fromEntries(params.entries()),
      processing_status: "surfaced",
      error_message: errorCode ? `twilio_error_${errorCode}` : "delivery_failed",
    });
    await admin
      .from("send_queue")
      .update({ status: "failed", failed_at: nowIso, failure_reason: errorCode ? `twilio_error_${errorCode}` : "delivery_failed", updated_at: nowIso })
      .eq("provider_message_id", messageSid)
      .in("status", ["sent", "processing"]);
  }

  return new Response("ok", { status: 200 });
});
