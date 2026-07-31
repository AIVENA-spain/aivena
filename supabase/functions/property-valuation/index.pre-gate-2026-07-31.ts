// property-valuation — W-Val v0.1 public widget endpoint.
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
  "Access-Control-Allow-Headers": "content-type, apikey, authorization",
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
  consent_required:    "Please tick both boxes so we can prepare your valuation and have an agent follow up.",
  missing_contact:     "Please add an email or phone number so we can send your valuation.",
  missing_municipality:"Please tell us which town or area the property is in.",
  invalid_size:        "Please enter the property size in m² (a number greater than 0).",
  missing_agency:      "Something went wrong — please refresh the page and try again.",
  unknown_agency:      "Something went wrong — please refresh the page and try again.",
  valuation_failed:    "Something went wrong preparing your valuation — please try again, and contact the agency if it keeps happening.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")   return j(405, { ok: false, error: "method_not_allowed" });

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
