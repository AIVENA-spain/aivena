// AIVENA CAPTURE — deploy-only Edge Function `catastro-lookup`
//
// This file is a RECORD of what is deployed, not a source of new work.
// Do NOT deploy it without diffing against live first: the repo has been
// stale before, and deploying a stale twilio-whatsapp-inbound would have
// silenced Amanda entirely.
//
//   function          : catastro-lookup
//   repo path         : supabase/functions/catastro-lookup/index.ts
//   deployed version  : 15
//   deployed bundle   : ezbr_sha256 9c32970d37cd6919b93a54f757856167e756bb65e581df9980f3bea324372bc4
//   captured source   : sha256 b60ea57422951e473774f819abe2f3f947bc178e216de40b2f5653019c424eb4
//   verified_at       : 2026-09-09
//   method            : pulled deployed source via Supabase Management API
//                       and written verbatim below the marker
//   verify_jwt        : true  (MUST be passed explicitly on any redeploy)
//   status            : verified
//   difference        : none — byte-for-byte
//
// The bundle hash is Supabase's hash of the DEPLOYED BUNDLE and cannot be
// recomputed from this file. It proves 'production has not changed since
// capture'. Source equivalence was established AT CAPTURE TIME by pulling
// live source and writing it verbatim; `captured source sha256` above lets
// us detect later edits to this file.
// ---8<--- CAPTURED SOURCE BELOW — verbatim from production, do not edit ---8<---
// catastro-lookup — wrapper around catastrogps.es REST API.
//
// Auth: verify_jwt:true. Called from Hono backend on behalf of authenticated users.
// Env: CATASTRO_API_KEY (required), CATASTRO_API_BASE (optional, default api.parcelgps.com).
//
// Three lookup modes (mutually exclusive in body):
//   { ref: "<14- or 20-char catastral ref>" }
//   { lat: <num>, lng: <num> }
//   { address: "<free-form>", postcode?: "<string>" }
//
// Optional flags:
//   include_market:  boolean — also fetch /market (€/m² + comparables from upstream)
//   include_polygon: boolean — also fetch /polygon
//
// Output is a normalized envelope so callers don't have to know catastrogps internals.

const CATASTRO_API_KEY = Deno.env.get("CATASTRO_API_KEY");
const CATASTRO_API_BASE = (Deno.env.get("CATASTRO_API_BASE") || "https://api.parcelgps.com").replace(/\/$/, "");

function j(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function callCatastroJson(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<{ ok: boolean; status: number; data: any; raw?: string; error?: string }> {
  const url = `${CATASTRO_API_BASE}${path}`;
  try {
    const resp = await fetch(url, {
      method: init.method || "GET",
      headers: {
        "X-API-Key": CATASTRO_API_KEY!,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await resp.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* leave null */ }
    return { ok: resp.ok, status: resp.status, data, raw: text };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: (e as Error).message };
  }
}

function normalizeCatastroData(d: any) {
  if (!d) return null;
  return {
    catastral_ref: d.refCatastral ?? d.refcat ?? null,
    address: {
      full:        d.direccion ?? null,
      postcode:    d.codigoPostal ?? null,
      municipality: d.municipio ?? null,
      province:    d.provincia ?? null,
      country:     d.pais ?? "ES",
    },
    geo: {
      lat: d.latitud ?? null,
      lng: d.longitud ?? null,
      maps_url: d.googleMapsUrl ?? null,
    },
    parcel: {
      surface_built_m2:  d.superficieConstruida ?? null,
      surface_parcel_m2: d.superficieParcela ?? null,
      year_built:        d.anioConstruccion ?? null,
      use_type:          d.uso ?? null,
      class:             d.clase ?? null,
      coefficient_participation: d.coefParticipacion ?? null,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return j(405, { error: "method_not_allowed" });
  if (!CATASTRO_API_KEY) {
    return j(500, {
      error: "catastro_not_configured",
      detail: "CATASTRO_API_KEY env var not set on the Edge Function deployment.",
    });
  }

  let body: any;
  try { body = await req.json(); } catch { return j(400, { error: "invalid_json" }); }

  const { ref, lat, lng, address, postcode, include_market, include_polygon } = body ?? {};

  // Validate exactly one lookup mode
  const modes = [
    typeof ref === "string" && ref.length > 0,
    typeof lat === "number" && typeof lng === "number",
    typeof address === "string" && address.length > 0,
  ].filter(Boolean).length;

  if (modes === 0) {
    return j(400, {
      error: "missing_lookup_input",
      hint: "Provide one of: { ref }, { lat, lng }, or { address, postcode? }",
    });
  }
  if (modes > 1) {
    return j(400, { error: "ambiguous_lookup_input", hint: "Provide only one of ref/coords/address per call." });
  }

  // ---------- Resolve to a catastral ref ----------
  let resolved_ref: string | null = null;
  let resolve_raw: any = null;

  if (typeof ref === "string") {
    if (!/^[A-Za-z0-9]{14,20}$/.test(ref)) {
      return j(400, { error: "invalid_ref_format", detail: "Catastral ref is 14 (parcel) or 20 (immueble) alphanumeric chars." });
    }
    resolved_ref = ref.toUpperCase();
  } else if (typeof lat === "number" && typeof lng === "number") {
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return j(400, { error: "invalid_coordinates" });
    }
    const search = await callCatastroJson("/api/search/coordinates", {
      method: "POST",
      body: { lat, lng },
    });
    if (!search.ok) {
      return j(search.status >= 400 && search.status < 600 ? search.status : 502, {
        error: "upstream_error",
        phase: "coordinate_search",
        upstream_status: search.status,
        detail: search.error ?? (search.raw?.slice(0, 240)),
      });
    }
    resolve_raw = search.data;
    // Response shape: { success: true, data: { refCatastral: "...", ... } } or similar.
    resolved_ref = search.data?.data?.refCatastral ?? search.data?.refCatastral ?? null;
    if (!resolved_ref) {
      return j(404, { error: "not_found", phase: "coordinate_search", upstream: resolve_raw });
    }
  } else if (typeof address === "string") {
    const search = await callCatastroJson("/api/search/address/parse", {
      method: "POST",
      body: { address, postcode },
    });
    if (!search.ok) {
      return j(search.status >= 400 && search.status < 600 ? search.status : 502, {
        error: "upstream_error",
        phase: "address_search",
        upstream_status: search.status,
        detail: search.error ?? (search.raw?.slice(0, 240)),
      });
    }
    resolve_raw = search.data;
    resolved_ref = search.data?.data?.refCatastral ?? search.data?.refCatastral ?? null;
    if (!resolved_ref) {
      return j(404, { error: "not_found", phase: "address_search", upstream: resolve_raw });
    }
  }

  if (!resolved_ref) {
    return j(500, { error: "resolution_failed_no_ref" });
  }

  // ---------- Primary fetch ----------
  const primary = await callCatastroJson(`/api/catastro/${encodeURIComponent(resolved_ref)}`);
  if (!primary.ok) {
    if (primary.status === 404) {
      return j(404, { error: "not_found", phase: "primary_lookup", catastral_ref: resolved_ref });
    }
    if (primary.status === 429) {
      return j(429, { error: "quota_exceeded", detail: primary.raw?.slice(0, 240) });
    }
    return j(primary.status >= 400 && primary.status < 600 ? primary.status : 502, {
      error: "upstream_error",
      phase: "primary_lookup",
      upstream_status: primary.status,
      detail: primary.error ?? (primary.raw?.slice(0, 240)),
    });
  }

  const primaryData = primary.data?.data ?? primary.data ?? null;
  const normalized = normalizeCatastroData(primaryData);
  const searchesRemaining = primary.data?.searchesRemaining ?? null;

  // ---------- Optional enrichments ----------
  let market: any = null;
  let polygon: any = null;

  if (include_market) {
    const m = await callCatastroJson(`/api/catastro/${encodeURIComponent(resolved_ref)}/market`);
    if (m.ok) {
      market = m.data?.data ?? m.data ?? null;
    } else {
      market = { error: "upstream_market_unavailable", status: m.status };
    }
  }
  if (include_polygon) {
    const p = await callCatastroJson(`/api/catastro/${encodeURIComponent(resolved_ref)}/polygon`);
    if (p.ok) {
      polygon = p.data?.data ?? p.data ?? null;
    } else {
      polygon = { error: "upstream_polygon_unavailable", status: p.status };
    }
  }

  return j(200, {
    found: true,
    catastral_ref: resolved_ref,
    ...normalized,
    market,
    polygon,
    api_searches_remaining: searchesRemaining,
    resolved_via: typeof ref === "string" ? "ref"
      : typeof lat === "number" ? "coordinates"
      : "address",
    raw: primaryData,
  });
});
