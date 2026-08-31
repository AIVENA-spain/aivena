// property-valuation — W-Val v0.1 public widget endpoint.
//
// ██ LAUNCH GATE (added 2026-07-31, P1 safety fix) ██
// Public valuation capture is NOT approved for launch. Until the function
// secret AIVENA_VALUATION_LAUNCH is set to "true", every request returns 503
// and NOTHING is written (no lead, no consent row, no valuation row).
// Internal testing only: send header  x-aivena-valuation-test  matching the
// AIVENA_VALUATION_TEST_KEY function secret. While that secret is unset
// (current state), there is no internal path either — the gate is fully closed.
// Rollback: redeploy supabase/functions/property-valuation/index.pre-gate-2026-07-31.ts
//
// Thin HTTP shell over the create_property_valuation RPC (which does the
// authoritative validation, valuation math via get_pricing_zone, lead creation,
// LOPDGDD consent logging, and timeline event — all atomic).
//
// Public widget: verify_jwt:false. The RPC is the trust boundary (service-role
// only, validates the agency + consent). All user-facing messages are friendly
// and schema-free (Law-2). CORS open so it can be embedded on agency sites.
//
// POST JSON: { agency_id, municipality, size_m2, contact_email|contact_phone,
//   contact_name?, neighbourhood?, property_type?, bedrooms?, condition?,
//   preferred_language?, consent_privacy:true, consent_contact:true, consent_text?,
//   source_meta? }

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-aivena-valuation-test",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function j(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// Friendly, schema-free copy per error code (Law-2).
const FRIENDLY: Record<string, string> = {
  valuation_unavailable: "Online valuations aren't available yet — please contact the agency directly.",
  consent_required:    "Please tick both boxes so we can prepare your valuation and have an agent follow up.",
  missing_contact:     "Please add an email or phone number so we can send your valuation.",
  missing_municipality:"Please tell us which town or area the property is in.",
  invalid_size:        "Please enter the property size in m² (a number greater than 0).",
  missing_agency:      "Something went wrong — please refresh the page and try again.",
  unknown_agency:      "Something went wrong — please refresh the page and try again.",
  valuation_failed:    "Something went wrong preparing your valuation — please try again, and contact the agency if it keeps happening.",
};

/** Same helper the studio and send-executor edge functions use — an early
 *  mismatch exit leaks key bytes through response timing. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")   return j(405, { ok: false, error: "method_not_allowed" });

  // ---- launch gate: closed until explicitly approved for public launch ----
  const launched = Deno.env.get("AIVENA_VALUATION_LAUNCH") === "true";
  if (!launched) {
    const testKey = Deno.env.get("AIVENA_VALUATION_TEST_KEY");
    const given   = req.headers.get("x-aivena-valuation-test");
    if (!testKey || !given || !constantTimeEqual(given, testKey)) {
      return j(503, { ok: false, error: "valuation_unavailable", message: FRIENDLY.valuation_unavailable });
    }
  }

  let b: any;
  try { b = await req.json(); }
  catch { return j(400, { ok: false, error: "invalid_json", message: FRIENDLY.valuation_failed }); }

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
  const ua = req.headers.get("user-agent") || null;

  const sizeNum = typeof b?.size_m2 === "number"
    ? b.size_m2
    : (b?.size_m2 != null && b.size_m2 !== "" ? Number(b.size_m2) : null);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc("create_property_valuation", {
    p_agency_id:          b?.agency_id ?? null,
    p_municipality:       b?.municipality ?? null,
    p_size_m2:            (sizeNum != null && !Number.isNaN(sizeNum)) ? sizeNum : null,
    p_contact_name:       b?.contact_name ?? null,
    p_contact_email:      b?.contact_email ?? null,
    p_contact_phone:      b?.contact_phone ?? null,
    p_neighbourhood:      b?.neighbourhood ?? null,
    p_property_type:      b?.property_type ?? null,
    p_bedrooms:           Number.isInteger(b?.bedrooms) ? b.bedrooms : null,
    p_condition:          b?.condition ?? "good",
    p_preferred_language: b?.preferred_language ?? null,
    p_consent_privacy:    b?.consent_privacy === true,
    p_consent_contact:    b?.consent_contact === true,
    p_consent_text:       b?.consent_text ?? null,
    p_ip_address:         ip,
    p_user_agent:         ua,
    p_source_meta:        b?.source_meta ?? {},
  });

  if (error) {
    return j(500, { ok: false, error: "valuation_failed", message: FRIENDLY.valuation_failed });
  }
  if (!data?.ok) {
    const code = data?.error ?? "valuation_failed";
    const httpStatus = (code === "missing_agency" || code === "unknown_agency") ? 400 : 422;
    return j(httpStatus, { ok: false, error: code, message: FRIENDLY[code] ?? FRIENDLY.valuation_failed });
  }

  // Success: pass the RPC result straight through (estimate, confidence, ids).
  return j(200, data);
});
