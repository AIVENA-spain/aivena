// CAPTURE (version control) of the deploy-only Edge Function `translate-text`.
// Slug: translate-text · id 57fde868-67c9-4b63-af59-42345ffad67c · version 16 · ACTIVE · verify_jwt=false
// ezbr_sha256: a5ea82d1872d3e8323b75dc10e4ad132d0db56a9df72bc0ffd61083d75c94e94
// Captured 2026-09-01 from the DEPLOYED source, byte-for-byte (no secrets present —
// DeepL key and shared secret both come from env).
// Do NOT deploy this file without diffing against live first — the repo has been stale before.
//
// !! LANGUAGE-CODE INCONSISTENCY FOUND DURING CAPTURE (2026-09-01), NOT FIXED HERE !!
// DETECTED_TO_AIVENA maps DeepL "NB" -> "no". This function WRITES that value into
// leads.language (the self-healing writeback at the bottom). Our canonical code for
// Norwegian is "nb" — SUPPORTED_LANGUAGES in apps/api/src/amanda-engine/validators.ts.
// So every Norwegian lead auto-detected here gets the LEGACY code, and production
// already contains language='no' because of it.
// Nothing is broken today: normalizeLeadLanguage() maps no -> nb on read, and the
// reminder tests pin that. But it violates the standing rule that a language code
// must be the same everywhere, and it only holds because a normaliser catches it.
// The one-word fix is "no" -> "nb" on the NB line, plus a backfill of existing rows.
// Held because changing it is a live write to lead data and needs its own approval.
//
// W18 Translation v0.2 — translate-text Edge Function
// Stateless DeepL wrapper. Optional row-update for conversation_messages.body_translated_owner
// and dashboard_tasks.suggested_reply_translated_owner.
//
// v0.2: source_lang 'auto' supported — DeepL auto-detects. When auto + the update target is a
// conversation_messages row, the detected language is written back to leads.language
// (only if currently NULL and within the 13 supported languages). Self-healing language detection.
//
// Auth: shared-secret header. verify_jwt=false because internal-only (n8n bridge).
//   - INTERNAL_TRANSLATE_SECRET in Supabase Vault (set by founder)
//   - Caller sends X-Internal-Secret: <same value> header
// Secrets required:
//   - DEEPL_API_KEY (set by founder)
//   - INTERNAL_TRANSLATE_SECRET (set by founder)
//
// Law-2 compliance: errors returned to caller are friendly strings; technical detail is in `error` code only.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// AIVENA -> DeepL language code mapping. AIVENA uses ISO-639-1; DeepL uses its own codes for some.
const DEEPL_LANG_MAP: Record<string, { source: string; target: string }> = {
  en: { source: "EN", target: "EN-US" },
  es: { source: "ES", target: "ES" },
  de: { source: "DE", target: "DE" },
  nl: { source: "NL", target: "NL" },
  fr: { source: "FR", target: "FR" },
  it: { source: "IT", target: "IT" },
  pl: { source: "PL", target: "PL" },
  pt: { source: "PT", target: "PT-PT" },  // European Portuguese for Costa Blanca market
  ru: { source: "RU", target: "RU" },
  sv: { source: "SV", target: "SV" },
  no: { source: "NB", target: "NB" },     // DeepL only supports Bokmål
  nb: { source: "NB", target: "NB" },     // legacy code -> same DeepL target
  da: { source: "DA", target: "DA" },
  fi: { source: "FI", target: "FI" },
};

// DeepL detected source code -> AIVENA ISO-639-1 (only the 13 we support on leads.language)
const DETECTED_TO_AIVENA: Record<string, string> = {
  EN: "en", ES: "es", DE: "de", NL: "nl", FR: "fr", IT: "it", PL: "pl",
  PT: "pt", RU: "ru", SV: "sv", NB: "no", DA: "da", FI: "fi",
};

// Tables/fields we allow row-updates against. Whitelisted to prevent injection.
const ALLOWED_UPDATE_TARGETS: Record<string, Set<string>> = {
  conversation_messages: new Set(["body_translated_owner"]),
  dashboard_tasks: new Set(["suggested_reply_translated_owner"]),
};

interface TranslateRequest {
  text: string;
  source_lang: string; // ISO-639-1 from our 13, or 'auto' for DeepL detection
  target_lang: string;
  update_target?: {
    table: string;
    id: string;
    field: string;
  };
}

interface TranslateResponse {
  ok: boolean;
  translated_text?: string | null;
  source_lang_detected?: string;
  lead_language_updated?: boolean;
  billed_characters?: number;
  skipped?: boolean;
  skip_reason?: string;
  row_updated?: boolean;
  error?: string;
  message?: string;
}

function friendlyError(error: string, message: string, status = 400): Response {
  return new Response(
    JSON.stringify({ ok: false, error, message } satisfies TranslateResponse),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

// Constant-time string comparison (defense against timing attacks)
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  // CORS: this is server-to-server only, no OPTIONS preflight needed
  if (req.method !== "POST") {
    return friendlyError("method_not_allowed", "Use POST.", 405);
  }

  // Auth: shared-secret header check
  const expectedSecret = Deno.env.get("INTERNAL_TRANSLATE_SECRET");
  if (!expectedSecret) {
    console.error("INTERNAL_TRANSLATE_SECRET not configured");
    return friendlyError(
      "translation_unavailable",
      "Translation service is not configured. Please contact support.",
      503,
    );
  }
  const providedSecret = req.headers.get("x-internal-secret") ?? "";
  if (!safeEqual(providedSecret, expectedSecret)) {
    return friendlyError("unauthorized", "Authentication failed.", 401);
  }

  let body: TranslateRequest;
  try {
    body = await req.json();
  } catch {
    return friendlyError("invalid_json", "Request body must be valid JSON.");
  }

  const { text, source_lang, target_lang, update_target } = body;

  // Input validation
  if (typeof text !== "string" || text.trim().length === 0) {
    return friendlyError("empty_text", "Nothing to translate — text is empty.");
  }
  const isAuto = source_lang === "auto";
  if (typeof source_lang !== "string" || (!isAuto && !DEEPL_LANG_MAP[source_lang])) {
    return friendlyError(
      "invalid_source_lang",
      `Source language '${source_lang}' is not supported.`,
    );
  }
  if (typeof target_lang !== "string" || !DEEPL_LANG_MAP[target_lang]) {
    return friendlyError(
      "invalid_target_lang",
      `Target language '${target_lang}' is not supported.`,
    );
  }
  // Hard cap on text length — protect quota and DeepL request limits
  if (text.length > 50_000) {
    return friendlyError(
      "text_too_long",
      "Message is too long to translate. Please contact support.",
    );
  }

  // No-op: source == target. Return early without calling DeepL. (Only when source is known.)
  // Note: 'no' and 'nb' both map to NB, treat them as equivalent.
  if (!isAuto) {
    const sourceNorm = source_lang === "nb" ? "no" : source_lang;
    const targetNorm = target_lang === "nb" ? "no" : target_lang;
    if (sourceNorm === targetNorm) {
      return new Response(
        JSON.stringify({
          ok: true,
          translated_text: null,
          skipped: true,
          skip_reason: "source equals target",
        } satisfies TranslateResponse),
        { headers: { "Content-Type": "application/json" } },
      );
    }
  }

  // Validate update_target if provided
  if (update_target) {
    const { table, field } = update_target;
    const allowedFields = ALLOWED_UPDATE_TARGETS[table];
    if (!allowedFields || !allowedFields.has(field)) {
      return friendlyError(
        "invalid_update_target",
        "That table or field can't be updated by this function.",
      );
    }
    if (typeof update_target.id !== "string" || update_target.id.length === 0) {
      return friendlyError("invalid_update_target_id", "Row id is required.");
    }
  }

  // Call DeepL
  const deeplKey = Deno.env.get("DEEPL_API_KEY");
  if (!deeplKey) {
    console.error("DEEPL_API_KEY not configured");
    return friendlyError(
      "translation_unavailable",
      "Translation service is not configured. Please contact support.",
      503,
    );
  }

  // DeepL endpoint: api-free.deepl.com for free plan, api.deepl.com for paid.
  // The free Developer plan key ends with `:fx`.
  const deeplEndpoint = deeplKey.endsWith(":fx")
    ? "https://api-free.deepl.com/v2/translate"
    : "https://api.deepl.com/v2/translate";

  const deeplTarget = DEEPL_LANG_MAP[target_lang].target;
  const deeplBody: Record<string, unknown> = {
    text: [text],
    target_lang: deeplTarget,
    preserve_formatting: true,
    // TODO v0.2: integrate Spanish real-estate glossary (escritura, nota simple, IBI, arras)
  };
  if (!isAuto) {
    deeplBody.source_lang = DEEPL_LANG_MAP[source_lang].source;
  }

  let deeplResp: Response;
  try {
    deeplResp = await fetch(deeplEndpoint, {
      method: "POST",
      headers: {
        "Authorization": `DeepL-Auth-Key ${deeplKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(deeplBody),
    });
  } catch (e) {
    console.error("DeepL fetch failed:", e);
    return friendlyError(
      "translation_unavailable",
      "Couldn't reach the translation service. Please try again in a moment.",
      503,
    );
  }

  if (!deeplResp.ok) {
    const errBody = await deeplResp.text().catch(() => "");
    console.error("DeepL non-2xx:", deeplResp.status, errBody);
    // Map DeepL status to friendly messages
    if (deeplResp.status === 403 || deeplResp.status === 401) {
      return friendlyError(
        "translation_unavailable",
        "Translation service rejected the request. Please contact support.",
        503,
      );
    }
    if (deeplResp.status === 429) {
      return friendlyError(
        "translation_rate_limited",
        "Translation service is busy. Please try again in a moment.",
        429,
      );
    }
    if (deeplResp.status === 456) {
      return friendlyError(
        "translation_quota_exceeded",
        "Translation quota for this month is used up.",
        429,
      );
    }
    return friendlyError(
      "translation_failed",
      "Something went wrong with translation. Please try again.",
      502,
    );
  }

  let deeplData: {
    translations?: Array<{ text: string; detected_source_language?: string }>;
  };
  try {
    deeplData = await deeplResp.json();
  } catch {
    return friendlyError(
      "translation_failed",
      "Translation service returned an unexpected response.",
      502,
    );
  }

  const translation = deeplData.translations?.[0];
  if (!translation?.text) {
    return friendlyError(
      "translation_failed",
      "Translation service returned an empty result.",
      502,
    );
  }

  const translatedText = translation.text;
  const detectedSource = translation.detected_source_language;
  const billedChars = text.length;

  // Optional: update the row (+ lead language writeback when auto-detected)
  let rowUpdated = false;
  let leadLanguageUpdated = false;
  if (update_target) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.error("Supabase env not configured for row update");
      return new Response(
        JSON.stringify({
          ok: true,
          translated_text: translatedText,
          source_lang_detected: detectedSource,
          billed_characters: billedChars,
          row_updated: false,
          error: "row_update_unavailable",
          message: "Translation succeeded but couldn't be saved. Caller should retry the save.",
        } satisfies TranslateResponse),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    const supa = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: updErr } = await supa
      .from(update_target.table)
      .update({ [update_target.field]: translatedText })
      .eq("id", update_target.id);

    if (updErr) {
      console.error("Row update failed:", updErr);
      return new Response(
        JSON.stringify({
          ok: true,
          translated_text: translatedText,
          source_lang_detected: detectedSource,
          billed_characters: billedChars,
          row_updated: false,
          error: "row_update_failed",
          message: "Translation succeeded but couldn't be saved. Caller should retry the save.",
        } satisfies TranslateResponse),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    rowUpdated = true;

    // Self-healing language detection: when the caller didn't know the source language
    // and the target row is an inbound message, persist the detected language to the lead
    // — only if leads.language is currently NULL and the detected language is one of the 13.
    if (isAuto && update_target.table === "conversation_messages" && detectedSource) {
      const mapped = DETECTED_TO_AIVENA[detectedSource.toUpperCase()];
      if (mapped) {
        try {
          const { data: msgRow, error: msgErr } = await supa
            .from("conversation_messages")
            .select("lead_id")
            .eq("id", update_target.id)
            .single();
          if (!msgErr && msgRow?.lead_id) {
            const { data: updLead, error: leadErr } = await supa
              .from("leads")
              .update({ language: mapped })
              .eq("id", msgRow.lead_id)
              .is("language", null)
              .select("id");
            if (!leadErr && updLead && updLead.length > 0) {
              leadLanguageUpdated = true;
            }
          }
        } catch (e) {
          // Best-effort: never fail the translation because writeback failed
          console.error("Lead language writeback failed:", e);
        }
      }
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      translated_text: translatedText,
      source_lang_detected: detectedSource,
      lead_language_updated: leadLanguageUpdated,
      billed_characters: billedChars,
      row_updated: rowUpdated,
    } satisfies TranslateResponse),
    { headers: { "Content-Type": "application/json" } },
  );
});
