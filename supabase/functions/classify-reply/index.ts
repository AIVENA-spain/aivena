// CAPTURE (version control) of the deploy-only Edge Function `classify-reply`.
// Slug: classify-reply · id 427080dc-6db5-4737-9e77-a2ec30392090 · version 11 · ACTIVE · verify_jwt=false
// ezbr_sha256: 164e92ec4dc7828de848b6cb5158610f9a3b31a1f57fbb5a83085caa0279c004
// Captured 2026-09-01 from the DEPLOYED source, byte-for-byte (no secrets present —
// both the API key and the shared secret come from env vars).
// Do NOT deploy this file without diffing against live first — the repo has been stale before.
//
// classify-reply
// Classifies inbound reply messages from leads into structured meaning + intent strength.
// Multilingual (13 languages), conversation-aware, Claude Haiku 4.5.
// Replaces W5 v1's regex classifier.
//
// Auth: shared-secret X-Internal-Secret header (matches INTERNAL_CLASSIFY_SECRET env var).
// Input JSON body: {
//   message_body: string,                  // required, the lead's reply text
//   lead_language: string,                 // required, ISO 639-1 e.g. "en", "es", "nl"
//   lead_full_name?: string,               // optional, for context
//   recent_context?: Array<{               // optional, last 3-5 messages
//     direction: 'inbound' | 'outbound',
//     body: string,
//     sent_at?: string
//   }>
// }
//
// Returns 200 with:
// {
//   ok: true,
//   meaning: 'stop_contact' | 'not_interested' | 'wants_callback' | 'wants_viewing'
//          | 'seller_lead' | 'asks_price_or_budget' | 'asks_location'
//          | 'asks_property_question' | 'negotiation_open' | 'wants_to_buy_now'
//          | 'wants_more_info' | 'human_help_needed' | 'unclear',
//   confidence: number,                    // 0-1
//   summary: string,                       // 1-sentence in English
//   detected_intent_strength: 'cold' | 'warm' | 'hot' | 'super_hot',
//   detected_time_hint: string | null,     // free-text, ISO if obvious
//   detected_budget_hint: string | null,
//   detected_urgency: 'low' | 'medium' | 'high' | null,
//   reasoning: string                      // 1-2 sentence explanation
// }
// Returns 4xx/5xx with friendly { ok: false, error, ... } envelope (Law-2).

import Anthropic from "npm:@anthropic-ai/sdk@0.30";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const INTERNAL_SECRET = Deno.env.get("INTERNAL_CLASSIFY_SECRET");

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 800;
const MAX_MESSAGE_LENGTH = 8000;

const VALID_MEANINGS = new Set([
  "stop_contact", "not_interested", "wants_callback", "wants_viewing",
  "seller_lead", "asks_price_or_budget", "asks_location",
  "asks_property_question", "negotiation_open", "wants_to_buy_now",
  "wants_more_info", "human_help_needed", "unclear",
]);
const VALID_INTENT_STRENGTHS = new Set(["cold", "warm", "hot", "super_hot"]);
const VALID_URGENCIES = new Set(["low", "medium", "high"]);

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function friendly(status: number, error: string, details?: string) {
  const body: Record<string, unknown> = { ok: false, error };
  if (details) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SYSTEM_PROMPT = `You classify inbound replies from real-estate leads in any of 13 languages: English, Spanish, German, Dutch, French, Polish, Swedish, Norwegian, Danish, Finnish, Russian, Italian, Portuguese.

You MUST classify into exactly one of these meanings:
- stop_contact: lead asks not to be contacted, unsubscribe, GDPR opt-out
- not_interested: lead lost interest, found another, no longer looking
- wants_callback: lead asks to be called on the phone
- wants_viewing: lead wants to visit/see/tour the property (in person or virtual)
- seller_lead: lead wants to SELL or value their own property (not buy)
- asks_price_or_budget: question about price, mortgage, deposit, fees, currency
- asks_location: question about address, neighborhood, distance to amenities
- asks_property_question: question about specific features (bedrooms, pool, garage, m2, condition, etc.)
- negotiation_open: lead is willing to negotiate, makes an offer, or asks if price is flexible
- wants_to_buy_now: lead expresses serious intent to buy soon, asks about purchase process, mentions ready cash/financing
- wants_more_info: general request for more info, photos, brochure, video tour, more details
- human_help_needed: lead asks for a human agent, has a complaint, sounds angry, or message is too complex to classify safely
- unclear: message is ambiguous, very short, garbled, or you cannot confidently classify

Intent strength scale:
- cold: minimal engagement, vague, possibly fishing
- warm: clear interest, asking real questions
- hot: high commitment signals (specific dates, naming who they'll bring to viewing, mentioning financing readiness)
- super_hot: ready-to-act language ("when can we sign", "I'll wire the deposit", "my offer is X")

Return ONLY a JSON object matching the requested schema. No prose, no markdown, no code fences. Be conservative with confidence: under 0.7 means a human should review. Be precise with intent strength — most leads are warm; only mark hot or super_hot if the language is unmistakable.`;

function buildUserPrompt(input: {
  message_body: string;
  lead_language: string;
  lead_full_name?: string;
  recent_context?: Array<{ direction: string; body: string; sent_at?: string }>;
}): string {
  const parts: string[] = [];
  parts.push(`Lead language: ${input.lead_language}`);
  if (input.lead_full_name) parts.push(`Lead name: ${input.lead_full_name}`);
  if (input.recent_context && input.recent_context.length > 0) {
    parts.push("\nRecent conversation context (oldest first):");
    for (const m of input.recent_context.slice(-5)) {
      const who = m.direction === "outbound" ? "Agency" : "Lead";
      const snippet = (m.body || "").slice(0, 600);
      parts.push(`${who}: ${snippet}`);
    }
  }
  parts.push("\n--- New reply from lead ---");
  parts.push(input.message_body.slice(0, MAX_MESSAGE_LENGTH));
  parts.push("\nReturn the classification as JSON with these keys: meaning, confidence, summary, detected_intent_strength, detected_time_hint, detected_budget_hint, detected_urgency, reasoning.");
  return parts.join("\n");
}

function sanitizeOutput(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const meaning = typeof obj.meaning === "string" && VALID_MEANINGS.has(obj.meaning) ? obj.meaning : "unclear";
  let confidence = typeof obj.confidence === "number" ? obj.confidence : 0.5;
  if (confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;
  const summary = typeof obj.summary === "string" ? obj.summary.slice(0, 500) : "";
  const intent = typeof obj.detected_intent_strength === "string" && VALID_INTENT_STRENGTHS.has(obj.detected_intent_strength)
    ? obj.detected_intent_strength : "warm";
  const timeHint = obj.detected_time_hint === null || typeof obj.detected_time_hint === "string"
    ? (obj.detected_time_hint as string | null) : null;
  const budgetHint = obj.detected_budget_hint === null || typeof obj.detected_budget_hint === "string"
    ? (obj.detected_budget_hint as string | null) : null;
  const urgency = obj.detected_urgency === null
    ? null
    : (typeof obj.detected_urgency === "string" && VALID_URGENCIES.has(obj.detected_urgency) ? obj.detected_urgency : null);
  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning.slice(0, 1000) : "";
  return {
    meaning,
    confidence,
    summary,
    detected_intent_strength: intent,
    detected_time_hint: timeHint,
    detected_budget_hint: budgetHint,
    detected_urgency: urgency,
    reasoning,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return friendly(405, "Method not allowed");

  if (!INTERNAL_SECRET) return friendly(500, "Server is not configured. Please contact support.");
  const providedSecret = req.headers.get("X-Internal-Secret");
  if (!providedSecret || !constantTimeEquals(providedSecret, INTERNAL_SECRET)) {
    return friendly(401, "Authentication required");
  }

  if (!ANTHROPIC_API_KEY) return friendly(500, "Server is not configured for classification. Please contact support.");

  let input: { message_body?: string; lead_language?: string; lead_full_name?: string; recent_context?: Array<{ direction: string; body: string; sent_at?: string }> };
  try {
    input = await req.json();
  } catch {
    return friendly(400, "Invalid JSON body");
  }

  if (!input.message_body || typeof input.message_body !== "string" || input.message_body.trim() === "") {
    return friendly(400, "Missing message_body");
  }
  if (!input.lead_language || typeof input.lead_language !== "string") {
    return friendly(400, "Missing lead_language");
  }
  if (input.message_body.length > MAX_MESSAGE_LENGTH * 2) {
    return friendly(400, `Message too long. Max ${MAX_MESSAGE_LENGTH * 2} characters.`);
  }

  const userPrompt = buildUserPrompt({
    message_body: input.message_body,
    lead_language: input.lead_language,
    lead_full_name: input.lead_full_name,
    recent_context: input.recent_context,
  });

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return friendly(502, "Classification temporarily unavailable. Please try again shortly.", msg);
  }

  const block = response.content.find((c) => c.type === "text");
  const text = block && block.type === "text" ? block.text : "";
  if (!text) return friendly(502, "Classification returned no content. Please try again.");

  // Strip code fences if model added them despite instructions.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return friendly(502, "Classification returned invalid JSON. Please try again.", text.slice(0, 200));
  }

  const sanitized = sanitizeOutput(parsed);
  if (!sanitized) {
    return friendly(502, "Classification returned unexpected shape. Please try again.");
  }

  return new Response(JSON.stringify({ ok: true, ...sanitized, model: MODEL }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
