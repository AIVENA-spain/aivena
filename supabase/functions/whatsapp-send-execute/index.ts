// whatsapp-send-execute — W6 send path v6.7 (Twilio WhatsApp API).
// v6.7 (P3 source cleanup, 2026-07-31): the Twilio Account SID is read from the
//   TWILIO_ACCOUNT_SID env var (Deno.env) instead of a hardcoded literal, so the
//   full source can be versioned without a secret in git. Fail-closed: a missing /
//   empty / malformed SID returns 500 credentials_unavailable BEFORE any Twilio
//   request is built (no send). Auth token, verify_jwt=false, the v6.6 opt-out
//   guard, and all send/template/audit/thread behavior are unchanged.
// v6.6 (P3 audit fix, 2026-07-31): opt-out guard now refuses BOTH 'blocked' AND
//   'opted_out' (was blocked-only). Single shared predicate sendBlockedByOptIn in
//   ./optout-guard.ts (unit-tested). Defense-in-depth only; every other behavior,
//   the enqueue RPCs, provider settings, and the send path itself are unchanged.
// v6.5 (2026-07-04): LANGUAGE ALIAS in template resolution — the lead's language is
//   normalized before matching (ISO 'no'/'nn'/'nob' -> WhatsApp 'nb' Bokmal), so a lead
//   whose language is 'no' resolves to the approved 'nb' template. Alias-only; the strict
//   approved-only + English-floor-OFF behavior (v6.4) is unchanged.
// v6.4 (I3, approved 2026-07-04): APPROVED-TEMPLATE-ONLY resolver.
//   - The resolver only uses VERIFIED-APPROVED rows (provider_status='approved'
//     AND provider_synced_at NOT NULL AND provider_template_id NOT NULL).
//   - A registered key with NO approved rows BLOCKS (409 template_not_approved)
//     — it never silently falls through to freeform.
//   - STRICT language: an approved row in the lead's language is required.
//     ENGLISH FLOOR IS OFF (Christian decision 2026-07-04): no approved template
//     in the lead's language => 409 template_language_not_approved + the queued
//     row is failed (F3 creates the manual-review task). No silent EN fallback.
//   - Audit payload gains template_language + english_floor_used.
// v6.3: on ANY send failure, reconcile the pre-inserted 'queued' outbound row
//   (created by approve_dashboard_task) to 'failed' so the dashboard never shows
//   a phantom 'sent'/stuck 'queued'. Failure-path only; success path unchanged.
// v6.2: first-name auto-inject covers buyer_first_name / caller_first_name / seller_first_name.
//
// v6.1 corrections over v6:
// - TEMPLATE MODE NOW REQUIRES A REGISTERED template_key. A send only goes
//   through the Content API if template_key resolves to a row in
//   whatsapp_templates (agency-specific or __platform__). Any other
//   template_key (e.g. the W3 engine's 'followup_personalized',
//   'super_hot_human_alert', which are content LABELS, not WhatsApp templates)
//   falls through to the freeform Body path unchanged. This prevents v6 from
//   breaking existing freeform-with-label sends.
// - AUTO-INJECT agency-level / lead-level variables the EF already has in hand:
//     agency_name      <- agency_settings.agency_name
//     buyer_first_name <- first token of leads.full_name
//   Injected only when the template's contract needs them AND the enqueuer did
//   not already supply them. Removes the biggest enqueuer gap (no enqueuer
//   provides agency_name) for every template at once.
//
// v6 (retained): registered templates send via ContentSid + ContentVariables.
//   Variable ORDER lives only in the registry (whatsapp_templates.variables =
//   [{index,name}]); enqueuers emit NAMED variables; the EF maps name->index
//   (numeric keys also accepted). conversation_messages.content is rendered
//   from whatsapp_templates.components.body so the thread shows real text.
// v5 (retained): optional send_queue_id reconciles the queued conversation_
//   message row created by approve_dashboard_task. Freeform path unchanged.
//
// Auth: x-internal-secret header vs Vault WHATSAPP_SEND_INTERNAL_SECRET.
// POST { agency_id, body?, lead_id?, to_number?, sent_by?, send_queue_id?,
//        template_key?, template_variables?, language? }

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendBlockedByOptIn } from "./optout-guard.ts";
import { isValidTwilioAccountSid, twilioMessagesUrl, twilioBasicAuth } from "./twilio-config.ts";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Read from the Edge Function env var (set via Supabase function secrets) — never
// hardcoded, so the source is secret-free. Validated + fail-closed at request time.
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const STATUS_CALLBACK_URL = "https://atminvhrybxegpdtnnpl.supabase.co/functions/v1/twilio-whatsapp-status";

const E164 = /^\+[1-9]\d{6,14}$/;

// Language alias: normalize a lead/enqueuer language code to the WhatsApp template
// language code used in the registry (ISO 'no'/'nn'/'nob' -> 'nb' Bokmal). Identity otherwise.
const LANG_ALIAS: Record<string, string> = { no: "nb", nn: "nb", nob: "nb", nb_no: "nb" };
function normLang(l: string): string {
  const k = String(l || "").trim().toLowerCase();
  return LANG_ALIAS[k] ?? k;
}

function j(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function renderBody(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => vars[String(n)] ?? "");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return j(405, { ok: false, error: "method_not_allowed" });

  const presented = req.headers.get("x-internal-secret") ?? "";
  if (!presented) return j(401, { ok: false, error: "unauthorized" });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: expected } = await admin.rpc("_get_platform_secret", { p_name: "WHATSAPP_SEND_INTERNAL_SECRET" });
  if (!expected || !constantTimeEqual(presented, expected)) {
    return j(401, { ok: false, error: "unauthorized" });
  }

  let body: any;
  try { body = await req.json(); } catch { return j(400, { ok: false, error: "invalid_json" }); }

  const { agency_id, lead_id, sent_by, send_queue_id } = body ?? {};
  let toNumber: string | null = body?.to_number ?? null;
  const messageBody: string | undefined = body?.body;

  // On any send failure, reconcile the pre-inserted 'queued' outbound row (from
  // approve_dashboard_task) to 'failed' so the dashboard never shows a phantom
  // 'sent'/stuck 'queued'. Best-effort: must never worsen the failure response.
  async function markQueuedFailed(): Promise<void> {
    if (!send_queue_id) return;
    try {
      await admin.from("conversation_messages")
        .update({ status: "failed" })
        .eq("send_queue_id", send_queue_id)
        .eq("direction", "outbound")
        .eq("status", "queued");
    } catch (_) { /* best-effort */ }
    try {
      await admin.from("send_queue").update({ status: "failed" }).eq("id", send_queue_id);
    } catch (_) { /* best-effort */ }
  }

  if (!agency_id || typeof agency_id !== "string") {
    return j(400, { ok: false, error: "missing_agency_id" });
  }
  if (!toNumber && !lead_id) {
    return j(400, { ok: false, error: "missing_recipient", hint: "Provide to_number or lead_id." });
  }

  // --- Candidate template_key (POST body, or read from the send_queue row) ---
  let templateKey: string | null =
    (typeof body?.template_key === "string" && body.template_key.length) ? body.template_key : null;
  let templateVariables: Record<string, any> =
    (body?.template_variables && typeof body.template_variables === "object") ? body.template_variables : {};
  const postLanguage: string | null =
    (typeof body?.language === "string" && body.language.length) ? body.language : null;

  if (!templateKey && send_queue_id) {
    const { data: q } = await admin
      .from("send_queue")
      .select("template_key, template_variables")
      .eq("id", send_queue_id)
      .maybeSingle();
    if (q?.template_key && q.template_key !== "freeform") {
      templateKey = q.template_key;
      if (q.template_variables && typeof q.template_variables === "object") {
        templateVariables = q.template_variables;
      }
    }
  }

  // Template mode is decided by REGISTRATION: only a template_key that exists in
  // whatsapp_templates (agency-specific or __platform__) sends as a template.
  // Anything else (incl. label keys like 'followup_personalized') => freeform.
  // v6.4: only VERIFIED-APPROVED rows count; a registered key with nothing
  // approved BLOCKS here (never freeform-fallthrough, never an unapproved SID).
  let tplRows: any[] = [];
  let isRegisteredKey = false;
  if (templateKey && templateKey !== "freeform") {
    const { data: rows } = await admin
      .from("whatsapp_templates")
      .select("provider_template_id, variables, components, language, agency_id, provider_status, provider_synced_at")
      .eq("template_key", templateKey)
      .in("agency_id", [agency_id, "__platform__"]);
    const allRows = rows ?? [];
    isRegisteredKey = allRows.length > 0;
    tplRows = allRows.filter((r: any) =>
      r.provider_status === "approved" && r.provider_synced_at != null && r.provider_template_id);
    if (isRegisteredKey && tplRows.length === 0) {
      await markQueuedFailed();
      return j(409, { ok: false, error: "template_not_approved", template_key: templateKey,
        hint: "No approved+synced template for this key — routed to manual review." });
    }
  }
  const templateMode = tplRows.length > 0;

  // Freeform body validation (template mode supplies no freeform body).
  if (!templateMode) {
    if (!messageBody || typeof messageBody !== "string" || messageBody.trim().length === 0) {
      return j(400, { ok: false, error: "missing_body" });
    }
    if (messageBody.length > 1600) {
      return j(400, { ok: false, error: "body_too_long", hint: "WhatsApp freeform limit is 1600 chars" });
    }
  }

  const { data: settings, error: settingsErr } = await admin
    .from("agency_settings")
    .select("whatsapp_provider, whatsapp_from_number, whatsapp_access_token_connected, agency_name")
    .eq("agency_id", agency_id)
    .maybeSingle();

  if (settingsErr) return j(500, { ok: false, error: "settings_lookup_failed" });
  if (!settings)   return j(404, { ok: false, error: "agency_not_found" });
  if (settings.whatsapp_provider !== "twilio" || !settings.whatsapp_from_number || !settings.whatsapp_access_token_connected) {
    return j(409, { ok: false, error: "whatsapp_not_configured", hint: "Agency has no active Twilio WhatsApp sender." });
  }
  const fromNumber: string = settings.whatsapp_from_number;
  const agencyName: string | null = (settings as any).agency_name ?? null;

  let leadLanguage: string | null = null;
  let leadFullName: string | null = null;
  if (lead_id) {
    const { data: lead } = await admin
      .from("leads")
      .select("opt_in_status, phone, language, full_name")
      .eq("id", lead_id)
      .eq("agency_id", agency_id)
      .maybeSingle();
    if (!lead) {
      return j(404, { ok: false, error: "lead_not_found" });
    }
    // P3 audit fix: refuse BOTH 'blocked' and 'opted_out' (shared guard).
    if (sendBlockedByOptIn(lead.opt_in_status)) {
      return j(409, { ok: false, error: "lead_opted_out", hint: "Lead is blocked or opted out (opt_in_status). No sends allowed." });
    }
    if (!toNumber) toNumber = lead.phone;
    leadLanguage = (lead as any).language ?? null;
    leadFullName = (lead as any).full_name ?? null;
  }

  if (!toNumber || !E164.test(toNumber)) {
    return j(400, { ok: false, error: "invalid_to_number", hint: "E.164 format required (lead has no valid phone on file)." });
  }

  // --- Template resolution (template mode only) ------------------------------
  let contentSid: string | null = null;
  const contentVars: Record<string, string> = {};
  let renderedContent: string | null = null;
  let resolvedTpl: any = null;
  let englishFloorUsed = false;

  if (templateMode) {
    // v6.5: normalize the effective lead language (ISO 'no' -> WhatsApp 'nb', etc.)
    // before matching against the registry's language codes.
    const lang = normLang(
      (typeof templateVariables?.lead_language === "string" && templateVariables.lead_language) ||
      postLanguage || leadLanguage || "en"
    );

    // v6.4 (I3): STRICT language selection over verified-approved rows only.
    // English floor OFF (Christian, 2026-07-04): no approved template in the
    // lead's language => block + manual review. Never a silent EN fallback.
    const ENGLISH_FLOOR_ALLOWED = false;
    const agencyFirst = (a: any, b: any) => (b.agency_id === agency_id ? 1 : 0) - (a.agency_id === agency_id ? 1 : 0);
    const langMatch = tplRows.filter((r: any) => r.language === lang);
    if (langMatch.length > 0) {
      resolvedTpl = [...langMatch].sort(agencyFirst)[0];
    } else if (ENGLISH_FLOOR_ALLOWED) {
      const enMatch = tplRows.filter((r: any) => r.language === "en");
      if (enMatch.length === 0) {
        await markQueuedFailed();
        return j(409, { ok: false, error: "template_language_not_approved", template_key: templateKey, language: lang,
          hint: "No approved template in the lead's language — routed to manual review." });
      }
      resolvedTpl = [...enMatch].sort(agencyFirst)[0];
      englishFloorUsed = true;
    } else {
      await markQueuedFailed();
      return j(409, { ok: false, error: "template_language_not_approved", template_key: templateKey, language: lang,
        hint: "No approved template in the lead's language — routed to manual review." });
    }
    const tpl = resolvedTpl;

    contentSid = tpl.provider_template_id ?? null;
    if (!contentSid) {
      return j(409, { ok: false, error: "template_no_content_sid", template_key: templateKey });
    }

    const contract: Array<{ index: number; name: string }> = Array.isArray(tpl.variables) ? tpl.variables : [];
    const needs = (name: string) => contract.some((c) => c.name === name);
    const blank = (val: any) => val === undefined || val === null || val === "";

    // Auto-inject agency-level / lead-level vars when the contract needs them
    // and the enqueuer didn't supply them.
    if (needs("agency_name") && blank(templateVariables.agency_name) && agencyName) {
      templateVariables = { ...templateVariables, agency_name: agencyName };
    }
    // The lead's first name fills whichever name-slot the template uses.
    if (leadFullName) {
      const first = String(leadFullName).trim().split(/\s+/)[0] ?? "";
      if (first) {
        for (const slot of ["buyer_first_name", "caller_first_name", "seller_first_name"]) {
          if (needs(slot) && blank(templateVariables[slot])) {
            templateVariables = { ...templateVariables, [slot]: first };
          }
        }
      }
    }

    // Build positional ContentVariables from the named contract.
    if (contract.length > 0) {
      for (const c of contract) {
        const byName = templateVariables?.[c.name];
        const byIndex = templateVariables?.[String(c.index)];
        const v = byName !== undefined ? byName : byIndex;
        contentVars[String(c.index)] = v != null ? String(v) : "";
      }
    } else {
      for (const [k, v] of Object.entries(templateVariables ?? {})) {
        if (/^\d+$/.test(k)) contentVars[k] = v != null ? String(v) : "";
      }
    }

    const tplBody: string | null =
      (tpl.components && typeof tpl.components === "object" && typeof (tpl.components as any).body === "string")
        ? (tpl.components as any).body
        : null;
    renderedContent = tplBody ? renderBody(tplBody, contentVars) : `[template:${templateKey}]`;
  }

  const { data: token, error: tokenErr } = await admin.rpc("_get_platform_secret", { p_name: "TWILIO_AUTH_TOKEN" });
  if (tokenErr || !token) {
    return j(500, { ok: false, error: "credentials_unavailable" });
  }

  // Fail closed: a missing / empty / malformed TWILIO_ACCOUNT_SID env var stops the
  // send BEFORE any Twilio request is built (no request, no send). Same error shape
  // as a missing auth token.
  if (!isValidTwilioAccountSid(TWILIO_ACCOUNT_SID)) {
    return j(500, { ok: false, error: "credentials_unavailable" });
  }

  const twilioUrl = twilioMessagesUrl(TWILIO_ACCOUNT_SID);
  let form: URLSearchParams;
  if (templateMode) {
    form = new URLSearchParams({
      From: `whatsapp:${fromNumber}`,
      To:   `whatsapp:${toNumber}`,
      ContentSid: contentSid!,
      StatusCallback: STATUS_CALLBACK_URL,
    });
    if (Object.keys(contentVars).length > 0) {
      form.set("ContentVariables", JSON.stringify(contentVars));
    }
  } else {
    form = new URLSearchParams({
      From: `whatsapp:${fromNumber}`,
      To:   `whatsapp:${toNumber}`,
      Body: messageBody!,
      StatusCallback: STATUS_CALLBACK_URL,
    });
  }

  // Content stored on the thread row (freeform => exactly messageBody, as v5).
  const effectiveContent: string = templateMode
    ? (renderedContent ?? `[template:${templateKey}]`)
    : (messageBody as string);

  const startedAt = Date.now();
  let twilioStatus = 0;
  let twilioJson: any = null;
  let fetchErr: string | undefined;

  try {
    const resp = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Authorization": twilioBasicAuth(TWILIO_ACCOUNT_SID, token),
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
    agency_id,
    provider_type: "twilio_whatsapp",
    request_method: "POST",
    request_url: twilioUrl,
    request_payload: {
      from: fromNumber, to: toNumber,
      mode: templateMode ? "template" : "freeform",
      template_key: templateMode ? templateKey : null,
      content_sid: templateMode ? contentSid : null,
      template_language: templateMode ? (resolvedTpl?.language ?? null) : null,
      english_floor_used: englishFloorUsed,
      body_length: effectiveContent.length,
      lead_id: lead_id ?? null,
      send_queue_id: send_queue_id ?? null,
    },
    response_status: twilioStatus || null,
    response_payload: twilioJson,
    provider_message_id: messageSid,
    error_message: fetchErr ?? (success ? null : (twilioJson?.message ?? `twilio_http_${twilioStatus}`)),
    duration_ms: durationMs,
  });

  if (fetchErr) {
    await markQueuedFailed();
    return j(502, { ok: false, error: "twilio_unreachable", detail: fetchErr });
  }
  if (!success) {
    await markQueuedFailed();
    const code = twilioJson?.code;
    const hint = code === 63016
      ? "Outside 24h window. The recipient must message the sender first, or use an approved template."
      : undefined;
    return j(502, { ok: false, error: "twilio_send_failed", twilio_code: code ?? null, twilio_message: twilioJson?.message ?? null, hint });
  }

  // --- Conversation thread writing ---
  let conversationId: string | null = null;
  const nowIso = new Date().toISOString();

  if (send_queue_id) {
    // Queue-driven send: approve_dashboard_task already inserted a 'queued'
    // outbound row linked by send_queue_id — update it in place. Templates also
    // overwrite content with the rendered text; freeform touches the SAME 3
    // fields as v5.
    const reconcileUpdate: Record<string, unknown> = {
      provider_message_id: messageSid, status: "sent", sent_at: nowIso,
    };
    if (templateMode) reconcileUpdate.content = effectiveContent;

    const { data: updatedMsg } = await admin
      .from("conversation_messages")
      .update(reconcileUpdate)
      .eq("send_queue_id", send_queue_id)
      .eq("direction", "outbound")
      .select("id, conversation_id")
      .maybeSingle();

    if (updatedMsg) {
      conversationId = updatedMsg.conversation_id;
      const { data: conv } = await admin
        .from("conversations")
        .select("message_count")
        .eq("id", conversationId)
        .maybeSingle();
      await admin.from("conversations")
        .update({ last_message_at: nowIso, message_count: (conv?.message_count ?? 0) + 1, updated_at: nowIso })
        .eq("id", conversationId);

      return j(200, {
        ok: true,
        provider_message_id: messageSid,
        twilio_status: twilioJson?.status ?? null,
        conversation_id: conversationId,
        reconciled_queued_message: true,
        mode: templateMode ? "template" : "freeform",
        from: fromNumber,
        to: toNumber,
      });
    }
    // No queued row (e.g. enqueue without message insert) -> fall through.
  }

  if (lead_id) {
    const { data: existingConv } = await admin
      .from("conversations")
      .select("id, message_count")
      .eq("agency_id", agency_id)
      .eq("lead_id", lead_id)
      .eq("channel", "whatsapp")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingConv) {
      conversationId = existingConv.id;
      await admin.from("conversations")
        .update({ last_message_at: nowIso, message_count: (existingConv.message_count ?? 0) + 1, updated_at: nowIso })
        .eq("id", conversationId);
    } else {
      const { data: newConv } = await admin
        .from("conversations")
        .insert({
          agency_id, lead_id, channel: "whatsapp",
          external_thread_id: toNumber, status: "open",
          last_message_at: nowIso, message_count: 1,
        })
        .select("id")
        .single();
      conversationId = newConv?.id ?? null;
    }

    if (conversationId) {
      await admin.from("conversation_messages").insert({
        conversation_id: conversationId,
        agency_id,
        lead_id,
        direction: "outbound",
        message_type: "text",
        content: effectiveContent,
        provider_message_id: messageSid,
        status: "sent",
        sent_by: sent_by ?? "system",
        sent_at: nowIso,
        send_queue_id: send_queue_id ?? null,
        raw_payload: {
          via: "whatsapp-send-execute_v6_6",
          mode: templateMode ? "template" : "freeform",
          template_key: templateMode ? templateKey : null,
          twilio_status: twilioJson?.status ?? null,
        },
      });
    }
  }

  return j(200, {
    ok: true,
    provider_message_id: messageSid,
    twilio_status: twilioJson?.status ?? null,
    conversation_id: conversationId,
    reconciled_queued_message: false,
    mode: templateMode ? "template" : "freeform",
    from: fromNumber,
    to: toNumber,
  });
});
