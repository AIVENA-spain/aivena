// twilio-whatsapp-inbound — W6 receive path v6 (2026-08-31).
//
//   v6: THE AGENT'S REPLY IS THE ANSWER. A staff message used to be recorded
//   and dropped. When we have pinged that agent a question, their next message
//   is matched back to it (by the PING we sent, never by parsing their words),
//   the question is answered, the mirrored dashboard task is cleared, and the
//   same ticket_answered row the dashboard files is enqueued — so Amanda relays
//   it to the buyer in the buyer's language under the same mode law.
//
//   REPO-vs-LIVE WARNING (found 2026-08-29): this file had DIVERGED badly from
//   the deployed function — the repo copy was still v2 plus the v4 clear-line
//   block, missing ALL of v3 (the amanda_inbound_queue outbox, the funnel
//   event, the media/button descriptors, the W4C cutover). Deploying it would
//   have stopped every queue row and silenced Amanda in production. This file
//   was therefore rebuilt from the DEPLOYED source (supabase get_edge_function
//   on v13), and v5 applied on top. ALWAYS diff against live before deploying.
//
//   v5: honour conversations.amanda_mode_override in BOTH mode decisions this
//   function makes — what to enqueue, and whether legacy W4C drafts.
//
//   v4 (2026-08-28) THE CLEAR LINE: agents message the SAME AIVENA number as
//   buyers, so the number itself is the only discriminator. The agent roster is
//   checked BEFORE find-or-create-lead: a registered agent can never become a
//   lead and never reaches the buyer engine. Fail-safe: if the lookup errors we
//   fall through to the buyer path, so a broken lookup can never swallow buyers.
//
// verify_jwt stays FALSE (Twilio posts raw; auth is the X-Twilio-Signature HMAC).

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

  // ── THE CLEAR LINE: staff, or client? (v4) ────────────────────────────────
  try {
    const { data: staff } = await admin.rpc("lookup_agency_agent", {
      p_agency_id: agencyId,
      p_whatsapp: fromNumber,
    });
    const agent = Array.isArray(staff) ? staff[0] : staff;
    if (agent) {
      // A reply also proves presence — the shift check-in's whole purpose.
      await admin.from("agency_agents")
        .update({ last_checkin_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", agent.id);

      // ── v6: THE REPLY IS THE ANSWER ────────────────────────────────────────
      // Until now a staff message was recorded and dropped. If we pinged this
      // agent a question, their next message IS the answer to it — that is what
      // the ping literally asks for — so it is matched back and relayed to the
      // buyer in the buyer's own language, exactly as answering in the
      // dashboard does. Matched by the PING we sent, never by reading their
      // text: the agent should be able to answer in plain words.
      let answeredCode: number | null = null;
      try {
        const { data: pings } = await admin
          .from("agent_messages")
          .select("question_id")
          .eq("agent_id", agent.id)
          .eq("direction", "outbound")
          .eq("kind", "question_ping")
          .not("question_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(5);

        for (const ping of pings ?? []) {
          const { data: q } = await admin
            .from("amanda_questions")
            .select("id, agency_id, conversation_id, lead_id, short_code, question_text, status")
            .eq("id", (ping as { question_id: string }).question_id)
            .maybeSingle();
          const open = q && ["open", "clarifying", "escalated"].includes(String(q.status));
          if (!open || body.trim().length === 0) continue;

          await admin.from("amanda_questions")
            .update({
              answer_raw: body.slice(0, 2000),
              answered_by: agent.full_name,
              answered_at: new Date().toISOString(),
              status: "answered",
            })
            .eq("id", q.id);

          await admin.from("amanda_question_events").insert({
            agency_id: q.agency_id,
            question_id: q.id,
            event_type: "answer_received",
            detail: { answered_by: agent.full_name, via: "whatsapp_agent_reply" },
          });

          // The relay ride — the SAME row the dashboard answer path files, so
          // Amanda handles both identically and the mode law still governs.
          await admin.from("amanda_inbound_queue").insert({
            agency_id: q.agency_id,
            conversation_id: q.conversation_id,
            lead_id: q.lead_id,
            provider_message_id: `ticket-answer:${q.id}`,
            kind: "ticket_answered",
            payload: {
              question_id: q.id,
              short_code: q.short_code,
              question: q.question_text,
              answer: body.slice(0, 2000),
            },
            status: "pending",
          });

          // Clear the mirrored dashboard task so it stops asking for an answer
          // that has already arrived.
          await admin.from("dashboard_tasks")
            .update({ status: "handled", handled_at: new Date().toISOString(), handled_by: agent.full_name })
            .eq("task_type", "amanda_question")
            .eq("status", "pending")
            .filter("raw_payload->>amanda_question_id", "eq", q.id);

          await admin.from("agent_messages").insert({
            agency_id: q.agency_id, agent_id: agent.id, direction: "inbound",
            kind: "reply", body: body.slice(0, 2000), question_id: q.id,
            provider_message_id: messageSid, status: "received",
          });

          answeredCode = Number(q.short_code) || null;
          break;
        }
      } catch (_replyErr) {
        // Never fatal: the message is still logged below and the question stays
        // open in the dashboard, which is the safe direction.
      }

      if (answeredCode === null) {
        await admin.from("agent_messages").insert({
          agency_id: agencyId, agent_id: agent.id, direction: "inbound",
          kind: body.trim().length > 0 ? "note" : "reply",
          body: body.slice(0, 2000), provider_message_id: messageSid, status: "received",
        }).then(({ error }) => { if (error) console.error("staff note:", error.code); });
      }

      await admin.from("webhook_events")
        .update({
          processing_status: "staff_message",
          error_message: (answeredCode
            ? `agent ${agent.full_name} answered Q${answeredCode}`
            : `from agent ${agent.full_name}`).slice(0, 240),
          processed_at: new Date().toISOString(),
        })
        .eq("id", webhookEvent?.id);
      return twiml();
    }
  } catch (_staffErr) {
    // Deliberately swallowed — fail-safe to the buyer path (see header note).
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
        raw_payload: { twilio_message_sid: messageSid, profile_name: profileName, via: "twilio_whatsapp_inbound_v4" },
        dedup_key: `whatsapp:${agencyId}:${fromNumber}`,
      })
      .select("id")
      .single();
    if (leadErr || !newLead) {
      await admin.from("webhook_events").update({ processing_status: "lead_create_failed", error_message: leadErr?.message?.slice(0, 240) }).eq("id", webhookEvent?.id);
      return twiml();
    }
    leadId = newLead.id;
    // Amanda data pack (design §11.4): the funnel starts here. Best-effort.
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
        profile_name: profileName, num_media: numMedia, via: "twilio_whatsapp_inbound_v4",
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

  // ── v5: the per-conversation switch has to be honoured HERE too ───────────
  // The dashboard switch (conversations.amanda_mode_override) decides who
  // answers ONE person. This function makes two decisions off the mode — what
  // to enqueue, and whether legacy W4C drafts — and both read the AGENCY mode
  // only. Two real holes that opened the moment the switch shipped:
  //   * agency 'shadow' + a conversation raised to 'full' → the engine sends
  //     AND W4C drafts the same inbound: one buyer reply plus a stray task.
  //   * agency 'full' + "I'll handle this one" → no engine turn (correct), but
  //     W4C would still draft, so the person who asked for silence gets an AI
  //     suggestion anyway.
  // Agency 'off' still wins absolutely and is never raised by an override.
  let convOverride: string | null = null;
  try {
    const { data: ovRow } = await admin
      .from("conversations")
      .select("amanda_mode_override")
      .eq("id", conversationId)
      .maybeSingle();
    const ov = (ovRow as { amanda_mode_override?: string | null } | null)?.amanda_mode_override;
    if (typeof ov === "string" && ov.length > 0) convOverride = ov;
  } catch (_ovErr) {
    // Fail-safe: the agency mode governs, exactly as it did before v5.
  }
  const effectiveMode = amandaMode === "off" ? "off" : (convOverride ?? amandaMode);
  const silencedForThisPerson = convOverride === "off";

  if (finalStatus === "processed") {
    // v3 OUTBOX — only when the dial is on (an 'off' agency's rows would
    // accumulate unbounded with nothing draining them). Media messages are
    // enqueued TOO (kind 'media') — v10's body-length gate silently dropped
    // caption-less voice notes from the AI path.
    // Unique(provider_message_id, kind) makes redeliveries no-ops.
    if (effectiveMode !== "off") {
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
    // drafter once the EFFECTIVE dial reaches approval/assisted/full — W4C
    // firing too would double-draft every inbound. off/shadow keep W4C
    // (shadow runs the engine SILENTLY alongside for comparison).
    const engineIsDrafter = ["approval", "assisted", "full"].includes(effectiveMode);
    if (
      body.trim().length > 0 &&
      !engineIsDrafter &&
      // "I'll handle this one" means no AI writes here at all — not the engine,
      // and not the legacy drafter either.
      !silencedForThisPerson &&
      Deno.env.get("AMANDA_W4C_DISABLED") !== "true"
    ) {
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
