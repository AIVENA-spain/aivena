// AIVENA CAPTURE — deploy-only Edge Function `generate-property-embedding`
//
// This file is a RECORD of what is deployed, not a source of new work.
// Do NOT deploy it without diffing against live first: the repo has been
// stale before, and deploying a stale twilio-whatsapp-inbound would have
// silenced Amanda entirely.
//
//   function          : generate-property-embedding
//   repo path         : supabase/functions/generate-property-embedding/index.ts
//   deployed version  : 16
//   deployed bundle   : ezbr_sha256 9a7d7e6b651808fea873fbe03e7227ffd01122a7d8605b1b70ffc31a609a01c0
//   captured source   : sha256 afce61847cdfeed67f9e586f5b85629afbbbf1b1ee3dc6692533ffd35879e2e8
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
// AIVENA — generate-property-embedding
// W19 v0.1 — v1.14.5
// v2: switched to verify_jwt=true (Supabase platform validates JWT).
// Removed broken custom service-role check (legacy SUPABASE_SERVICE_ROLE_KEY
// env var was undefined in new-key-format projects, causing 401s).
// Defense-in-depth maintained via property+agency pair validation and RPC fence.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

const MODEL = 'text-embedding-3-small';
const DIMS = 1536;
const DESCRIPTION_MAX_CHARS = 2000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface PropertyRow {
  id: string;
  agency_id: string;
  title: string | null;
  description: string | null;
  property_type: string | null;
  location_city: string | null;
  location_region: string | null;
  location_country: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqm: number | null;
  price: number | null;
  price_currency: string | null;
  features: unknown;
}

function buildCompositeText(prop: PropertyRow): string | null {
  if (!prop.title && !prop.description) return null;
  const lines: string[] = [];
  if (prop.title) lines.push(String(prop.title).trim());
  if (prop.description) {
    const desc = String(prop.description).trim().slice(0, DESCRIPTION_MAX_CHARS);
    if (desc) {
      lines.push('');
      lines.push(desc);
    }
  }
  lines.push('');
  if (prop.property_type) lines.push(`Type: ${prop.property_type}`);
  const locParts = [prop.location_city, prop.location_region, prop.location_country].filter(Boolean);
  if (locParts.length > 0) lines.push(`Location: ${locParts.join(', ')}`);
  const sizeParts: string[] = [];
  if (prop.bedrooms != null) sizeParts.push(`Bedrooms: ${prop.bedrooms}`);
  if (prop.bathrooms != null) sizeParts.push(`Bathrooms: ${prop.bathrooms}`);
  if (prop.area_sqm != null) sizeParts.push(`Area: ${prop.area_sqm} m²`);
  if (sizeParts.length > 0) lines.push(sizeParts.join(' | '));
  if (prop.price != null && prop.price_currency) {
    lines.push(`Price: ${prop.price} ${prop.price_currency}`);
  }
  if (Array.isArray(prop.features) && prop.features.length > 0) {
    lines.push(`Features: ${prop.features.join(', ')}`);
  }
  return lines.join('\n').trim();
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }

  // verify_jwt=true at platform level handles auth validation upfront.
  // No custom check needed here.

  if (!OPENAI_API_KEY) {
    return jsonResponse({
      ok: false,
      error: 'openai_not_configured',
      message: 'OPENAI_API_KEY env var not set. Configure in Supabase dashboard → Edge Functions → Secrets.',
    }, 500);
  }

  let payload: { property_id?: unknown; agency_id?: unknown };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }

  const property_id = payload?.property_id;
  const agency_id = payload?.agency_id;
  if (typeof property_id !== 'string' || !property_id) {
    return jsonResponse({ ok: false, error: 'property_id_required', message: 'Missing property_id in request' }, 400);
  }
  if (typeof agency_id !== 'string' || !agency_id) {
    return jsonResponse({ ok: false, error: 'agency_id_required', message: 'Missing agency_id in request' }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Fetch property with explicit agency_id check (defense-in-depth)
  const { data: prop, error: fetchErr } = await supabase
    .from('properties')
    .select('id, agency_id, title, description, property_type, location_city, location_region, location_country, bedrooms, bathrooms, area_sqm, price, price_currency, features')
    .eq('id', property_id)
    .eq('agency_id', agency_id)
    .maybeSingle();

  if (fetchErr) {
    console.error('Property fetch error:', fetchErr);
    return jsonResponse({ ok: false, error: 'fetch_failed', message: 'Could not load property' }, 500);
  }
  if (!prop) {
    return jsonResponse({ ok: false, error: 'property_not_found', message: 'No property with that id in this agency' }, 404);
  }

  const text = buildCompositeText(prop as PropertyRow);
  if (!text) {
    return jsonResponse({
      ok: false,
      error: 'no_embeddable_text',
      message: 'Property has no title or description — cannot embed',
    }, 422);
  }

  const t0 = performance.now();
  let oaResp: Response;
  try {
    oaResp = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: text,
        model: MODEL,
        encoding_format: 'float',
      }),
    });
  } catch (e) {
    console.error('OpenAI fetch failed:', e);
    return jsonResponse({ ok: false, error: 'openai_network_error', message: 'Embedding service unreachable, please try again' }, 502);
  }

  if (!oaResp.ok) {
    const errBody = await oaResp.text();
    console.error(`OpenAI ${oaResp.status}:`, errBody.slice(0, 500));
    return jsonResponse({
      ok: false,
      error: 'openai_unavailable',
      message: 'Embedding service temporarily unavailable, please try again',
      upstream_status: oaResp.status,
    }, 502);
  }

  const oaData = await oaResp.json();
  const embedding = oaData?.data?.[0]?.embedding;
  const latency = Math.round(performance.now() - t0);

  if (!Array.isArray(embedding) || embedding.length !== DIMS) {
    console.error('Unexpected embedding shape:', { length: Array.isArray(embedding) ? embedding.length : 'not-array' });
    return jsonResponse({
      ok: false,
      error: 'embedding_shape_mismatch',
      expected: DIMS,
      got: Array.isArray(embedding) ? embedding.length : 'not-array',
    }, 500);
  }

  const embeddingLiteral = `[${embedding.join(',')}]`;

  const { data: writeResult, error: writeErr } = await supabase
    .rpc('mark_property_embedding_synced', {
      p_property_id: property_id,
      p_agency_id: agency_id,
      p_embedding: embeddingLiteral,
      p_model: MODEL,
    });

  if (writeErr) {
    console.error('RPC error:', writeErr);
    return jsonResponse({
      ok: false,
      error: 'write_failed',
      message: 'Something went wrong saving the embedding',
      detail: writeErr.message,
    }, 500);
  }

  return jsonResponse({
    ok: true,
    property_id,
    dimensions: DIMS,
    model: MODEL,
    latency_ms: latency,
    text_length: text.length,
    write_result: writeResult,
  });
});
