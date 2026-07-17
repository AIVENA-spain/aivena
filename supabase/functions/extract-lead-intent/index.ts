// AIVENA — extract-lead-intent  (El Raso Phase 2 · Option 2: LLM buyer-message intent extraction)
// Slug: extract-lead-intent · verify_jwt=false (internal-secret gated, mirrors property-sync)
//
// Turns ONE inbound buyer message into the structured intent CONTRACT and applies it through the
// safe SECURITY DEFINER RPC apply_extracted_intent. It is the LLM arm of the single ingestion path:
//   conversation_messages INSERT → trg_message_apply_interest → apply_conversation_interest
//     (deterministic extractor stays; on qualifying messages it fire-and-forget dispatches HERE via pg_net)
// Everything here is NON-FATAL by construction: any failure returns HTTP 200 with {ok:false,...}, never a
// 500 on the processing path, so a bad LLM call can never break the message insert or the webhook 200.
// The feature is OFF by default (intent_extraction_config.enabled=false, gated per agency) and the legal
// gate (buyer content → an LLM) is Christian-owned — nothing here runs against real buyer data until then.
//
// Auth: internal secret header  x-internal-secret == Vault EXTRACT_LEAD_INTENT_INTERNAL_SECRET
//       (fetched via _get_platform_secret RPC — identical shape to property-sync's gate).
// Invoke (pg_net from apply_conversation_interest) with JSON:
//   { lead_id, agency_id, message_id, text, dry_run? }
//   dry_run:true → return the extracted intent, WRITE NOTHING (this is what the eval harness uses).
//
// OpenAI: chat.completions, response_format json_schema (strict) === THE CONTRACT. Reuses the
// project-wide OPENAI_API_KEY already provisioned for embeddings (read WITHOUT `!`, like
// generate-lead-embedding — absent key is a graceful skip, not a crash). Write-back mirrors
// generate-lead-embedding: service-role supabase-js client → supabase.rpc(...). The API key and the
// gate secret are NEVER logged.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SECRET_NAME = "EXTRACT_LEAD_INTENT_INTERNAL_SECRET";
const DEFAULT_MODEL = "gpt-4o-mini";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// ── THE CONTRACT as a strict JSON schema (arrays default [], numbers nullable, all keys required) ──
// OpenAI strict mode requires every property to be listed in `required` and additionalProperties:false;
// "optional" fields are expressed as nullable / empty-array, never omitted from `required`.
const INTENT_JSON_SCHEMA = {
  name: "buyer_intent",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      areas_add: { type: "array", items: { type: "string" }, description: "Towns/areas the buyer positively wants, using the buyer's own names verbatim. Empty if none stated." },
      areas_exclude: { type: "array", items: { type: "string" }, description: "Towns/areas the buyer explicitly does NOT want. Empty if none stated." },
      open_to_nearby: { type: "boolean", description: "True if the buyer signalled flexibility to nearby/adjacent/other towns." },
      budget_max: { type: ["number", "null"], description: "Maximum budget in euros as a plain number, or null if not stated." },
      property_type: { type: ["string", "null"], description: "Desired property type (e.g. villa, apartment), or null if not stated." },
      bedrooms_min: { type: ["number", "null"], description: "Minimum bedrooms, or null if not stated." },
      bedrooms_max: { type: ["number", "null"], description: "Maximum bedrooms, or null if not stated." },
      bathrooms_min: { type: ["number", "null"], description: "Minimum bathrooms, or null if not stated." },
      must_haves: { type: "array", items: { type: "string" }, description: "Concrete must-have features the buyer asked for (e.g. pool, garage, sea view). Empty if none stated." },
      confidence: { type: "number", description: "Your confidence 0..1 that this extraction faithfully reflects the buyer's message." },
      summary: { type: "string", description: "One plain sentence, in the BUYER's own language, restating what they want. Empty string if nothing was expressed." },
    },
    required: [
      "areas_add", "areas_exclude", "open_to_nearby", "budget_max", "property_type",
      "bedrooms_min", "bedrooms_max", "bathrooms_min", "must_haves", "confidence", "summary",
    ],
  },
} as const;

// The four GUARANTEES are stated verbatim; they must be impossible to violate.
const SYSTEM_PROMPT = `You extract ONLY the buyer-expressed real-estate intent from a single buyer message for a Spanish estate agency. You return a JSON object matching the given schema and nothing else.

Rules:
- Extract ONLY what the buyer actually expressed in THIS message. Every field stays empty/false/null unless the buyer expressed it. NEVER invent, guess, or infer a value that is not in the message.
- Use the buyer's OWN town/area names, verbatim. NEVER invent a town name that the buyer did not write.
- "summary" is exactly one plain sentence, written in the BUYER's own language, restating what they want. If the buyer expressed nothing actionable, set summary to an empty string.

The FOUR GUARANTEES (these must be impossible to violate):
(1) negation -> areas_exclude, NEVER a positive area (the "we do NOT want Torrevieja -> Torrevieja" bug must be impossible)
(2) vague-with-no-town -> open_to_nearby=true and areas_add=[] (no hallucinated town)
(3) "doesn't have to be <area>" -> open_to_nearby=true, NOT an exclusion of that area
(4) contradictions within one message -> last-affirmative wins

Worked cues:
- "not X", "no X", "not in X", "avoid X", "except X", "sin X", "menos X", "nada de X" -> X goes to areas_exclude, and X must NOT appear in areas_add.
- "somewhere near the coast", "other places too", "nearby", "elsewhere", "cerca", "alrededor" with NO specific town -> open_to_nearby=true, areas_add=[].
- "it doesn't have to be X", "no tiene que ser X" -> open_to_nearby=true; do NOT put X in areas_exclude (the buyer is relaxing, not rejecting).
- If the message both wants and then rejects the same area, the LAST affirmative statement wins.

Return numbers as plain numbers (e.g. 600000, not "600k"). budget_max is the maximum in euros.`;

interface IntentContract {
  areas_add: string[];
  areas_exclude: string[];
  open_to_nearby: boolean;
  budget_max: number | null;
  property_type: string | null;
  bedrooms_min: number | null;
  bedrooms_max: number | null;
  bathrooms_min: number | null;
  must_haves: string[];
  confidence: number;
  summary: string;
}

// Cheap client-side prefilter: greetings / thanks / too-short lines never reach the model. This is a
// courtesy net only — the DB dispatcher already gates on message length; the real spend cap lives
// in intent_extraction_config. Deaccented, lowercased, whole-message match.
const GREETING_RE = /^(hi|hey|hello|hola|thanks|thank you|gracias|ok|okay|vale|hei|takk|bye|adios)\b[\s!.,]*$/i;
function isTrivial(text: string): boolean {
  const t = text.normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (t.length < 3) return true;
  if (GREETING_RE.test(t)) return true;
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ── Internal gate (fail-closed): compare the caller's header against the Vault-held secret ──
  // Identical shape to property-sync so the two internal EFs share one secret-management story.
  const { data: gateSecret, error: gateErr } = await sb.rpc("_get_platform_secret", { p_name: SECRET_NAME });
  if (gateErr || !gateSecret) return json({ ok: false, error: "secret_unavailable" }, 500);
  if (req.headers.get("x-internal-secret") !== gateSecret) return json({ ok: false, error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const lead_id = typeof body.lead_id === "string" ? body.lead_id : null;
  const agency_id = typeof body.agency_id === "string" ? body.agency_id : null;
  const message_id = typeof body.message_id === "string" ? body.message_id : null;
  const text = typeof body.text === "string" ? body.text : null;
  const dry_run = body.dry_run === true;
  const model = typeof body.model === "string" && body.model ? body.model : DEFAULT_MODEL;

  if (!lead_id) return json({ ok: false, error: "lead_id_required" }, 400);
  if (!agency_id) return json({ ok: false, error: "agency_id_required" }, 400);
  if (typeof text !== "string" || text.trim() === "") return json({ ok: false, error: "text_required" }, 400);

  // No key provisioned → graceful skip (mirrors generate-lead-embedding reading the key without `!`).
  if (!OPENAI_API_KEY) return json({ ok: false, skipped: "no_key" });

  // Trivial (greeting / too-short) → nothing to extract, honest no-op.
  if (isTrivial(text)) return json({ ok: true, skipped: "trivial" });

  // ── Everything below is NON-FATAL: any throw returns 200 {ok:false,error}, never a 500 ──
  try {
    let oaResp: Response;
    try {
      oaResp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: text },
          ],
          response_format: { type: "json_schema", json_schema: INTENT_JSON_SCHEMA },
        }),
      });
    } catch (e) {
      // Network failure is non-fatal — the deterministic extractor already ran and stands.
      console.error("extract-lead-intent: openai network error", String((e as Error).message).slice(0, 200));
      return json({ ok: false, error: "openai_network_error" });
    }

    if (!oaResp.ok) {
      // Log status + a truncated body ONLY (never headers / key).
      const errBody = (await oaResp.text()).slice(0, 300);
      console.error(`extract-lead-intent: openai ${oaResp.status}`, errBody);
      return json({ ok: false, error: "openai_unavailable", upstream_status: oaResp.status });
    }

    const oaData = await oaResp.json();
    const content = oaData?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      return json({ ok: false, error: "empty_completion" });
    }

    let parsed: IntentContract;
    try {
      parsed = JSON.parse(content) as IntentContract;
    } catch {
      return json({ ok: false, error: "invalid_completion_json" });
    }

    // Normalise to the CONTRACT shape defensively (the RPC also safe-casts, but keep the wire clean).
    const intent: IntentContract = {
      areas_add: Array.isArray(parsed.areas_add) ? parsed.areas_add.filter((s) => typeof s === "string") : [],
      areas_exclude: Array.isArray(parsed.areas_exclude) ? parsed.areas_exclude.filter((s) => typeof s === "string") : [],
      open_to_nearby: parsed.open_to_nearby === true,
      budget_max: typeof parsed.budget_max === "number" ? parsed.budget_max : null,
      property_type: typeof parsed.property_type === "string" && parsed.property_type.trim() ? parsed.property_type : null,
      bedrooms_min: typeof parsed.bedrooms_min === "number" ? parsed.bedrooms_min : null,
      bedrooms_max: typeof parsed.bedrooms_max === "number" ? parsed.bedrooms_max : null,
      bathrooms_min: typeof parsed.bathrooms_min === "number" ? parsed.bathrooms_min : null,
      must_haves: Array.isArray(parsed.must_haves) ? parsed.must_haves.filter((s) => typeof s === "string") : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
    };

    // DRY-RUN: return the extracted intent, WRITE NOTHING. This is the eval-harness path.
    if (dry_run) return json({ ok: true, intent });

    // ── Write-back via the safe SECURITY DEFINER RPC (mirrors generate-lead-embedding's rpc call) ──
    // apply_extracted_intent derives agency_id + current profile values from the leads row itself and
    // never trusts an agency param; it is the ONLY way this EF touches lead columns.
    const { data: applyResult, error: applyErr } = await sb.rpc("apply_extracted_intent", {
      p_lead_id: lead_id,
      p_intent: intent,
      p_source: "llm",
      p_source_message_id: message_id,
      p_summary: intent.summary,
      p_model: model,
      p_input_text: text,
      p_confidence: intent.confidence,
    });

    if (applyErr) {
      console.error("extract-lead-intent: apply rpc error", String(applyErr.message).slice(0, 200));
      return json({ ok: false, error: "apply_failed" });
    }

    return json({ ok: true, applied: applyResult });
  } catch (e) {
    // Absolute backstop — never a 500 on the processing path.
    console.error("extract-lead-intent: unexpected", String((e as Error).message).slice(0, 200));
    return json({ ok: false, error: "unexpected_error" });
  }
});
