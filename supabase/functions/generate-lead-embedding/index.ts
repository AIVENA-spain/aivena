// AIVENA — generate-lead-embedding
// W19b v0.1 — v1.14.5
// v3: embed the distilled buyer criteria. Conversation leads keep their evolving
// criteria in `summary` (scorer output) while `message` holds only the latest line
// (often a greeting). v3 leads with `summary` and falls back to extracted
// location/budget when the raw fields are null, so ongoing WhatsApp/voice leads
// embed what they actually want — not "Hello again".
//
// Pipeline:
//   1. verify_jwt=true at platform handles auth
//   2. Validate input (lead_id + agency_id)
//   3. Fetch lead by id+agency_id (defense-in-depth)
//   4. Fetch context-flagged notes (lead_notes where context_for_ai=true)
//   5. Optionally fetch property title via properties.external_id = lead.listing_id
//   6. Build buyer-criteria composite text (summary-first)
//   7. Low-signal check
//   8. OpenAI text-embedding-3-small (1536 dims)
//   9. Write via mark_lead_embedding_synced RPC

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

const MODEL = 'text-embedding-3-small';
const DIMS = 1536;
const MESSAGE_MAX_CHARS = 2000;
const SUMMARY_MAX_CHARS = 2000;
const NOTE_MAX_CHARS = 500;
const COMPOSITE_MAX_CHARS = 4000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface LeadRow {
  id: string;
  agency_id: string;
  message: string | null;
  summary: string | null;
  call_summary: string | null;
  budget_raw: string | null;
  budget_extracted: string | null;
  location_interest_raw: string | null;
  location_interest_extracted: string | null;
  listing_id: string | null;
  language: string | null;
}

function hasMeaningfulSignal(lead: LeadRow, noteCount: number, propertyTitle: string | null): boolean {
  const sigSummary = !!(lead.summary && lead.summary.trim().length > 5);
  const sigMessage = !!(lead.message && lead.message.trim().length > 5);
  const sigCallSummary = !!(lead.call_summary && lead.call_summary.trim().length > 5);
  const sigBudget = !!((lead.budget_raw && lead.budget_raw.trim()) || (lead.budget_extracted && lead.budget_extracted.trim()));
  const sigLocation = !!((lead.location_interest_raw && lead.location_interest_raw.trim()) || (lead.location_interest_extracted && lead.location_interest_extracted.trim()));
  const sigListing = !!(lead.listing_id && propertyTitle);
  const sigNotes = noteCount > 0;
  return sigSummary || sigMessage || sigCallSummary || sigBudget || sigLocation || sigListing || sigNotes;
}

function buildBuyerCriteriaText(
  lead: LeadRow,
  notes: Array<{ body: string }>,
  propertyTitle: string | null,
): string {
  const lines: string[] = [];

  // Distilled criteria first (best signal for conversation/voice leads).
  if (lead.summary && lead.summary.trim()) {
    lines.push(`Buyer criteria: ${String(lead.summary).trim().slice(0, SUMMARY_MAX_CHARS)}`);
  }

  // Then the most recent buyer text, if it carries content.
  if (lead.message && lead.message.trim().length > 5) {
    lines.push(String(lead.message).trim().slice(0, MESSAGE_MAX_CHARS));
  } else if (lead.call_summary && lead.call_summary.trim()) {
    lines.push(`Voice call summary: ${String(lead.call_summary).trim().slice(0, MESSAGE_MAX_CHARS)}`);
  }

  const budget = (lead.budget_raw && lead.budget_raw.trim()) ? lead.budget_raw.trim()
    : (lead.budget_extracted && lead.budget_extracted.trim()) ? lead.budget_extracted.trim() : null;
  const location = (lead.location_interest_raw && lead.location_interest_raw.trim()) ? lead.location_interest_raw.trim()
    : (lead.location_interest_extracted && lead.location_interest_extracted.trim()) ? lead.location_interest_extracted.trim() : null;

  const criteriaLines: string[] = [];
  if (budget) criteriaLines.push(`Budget: ${budget}`);
  if (location) criteriaLines.push(`Location wanted: ${location}`);
  if (propertyTitle) {
    criteriaLines.push(`Interested property: ${propertyTitle}`);
  } else if (lead.listing_id) {
    criteriaLines.push(`Listing reference: ${lead.listing_id}`);
  }
  if (lead.language) criteriaLines.push(`Buyer language: ${lead.language}`);
  if (criteriaLines.length > 0) {
    lines.push('');
    lines.push(...criteriaLines);
  }

  if (notes.length > 0) {
    lines.push('');
    for (const n of notes) {
      const truncatedBody = String(n.body).trim().slice(0, NOTE_MAX_CHARS);
      if (truncatedBody) lines.push(`Note: ${truncatedBody}`);
    }
  }

  let text = lines.join('\n').trim();
  if (text.length > COMPOSITE_MAX_CHARS) {
    text = text.slice(0, COMPOSITE_MAX_CHARS);
  }
  return text;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }

  if (!OPENAI_API_KEY) {
    return jsonResponse({
      ok: false,
      error: 'openai_not_configured',
      message: 'OPENAI_API_KEY env var not set on Edge Function.',
    }, 500);
  }

  let payload: { lead_id?: unknown; agency_id?: unknown };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }

  const lead_id = payload?.lead_id;
  const agency_id = payload?.agency_id;
  if (typeof lead_id !== 'string' || !lead_id) {
    return jsonResponse({ ok: false, error: 'lead_id_required' }, 400);
  }
  if (typeof agency_id !== 'string' || !agency_id) {
    return jsonResponse({ ok: false, error: 'agency_id_required' }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('id, agency_id, message, summary, call_summary, budget_raw, budget_extracted, location_interest_raw, location_interest_extracted, listing_id, language')
    .eq('id', lead_id)
    .eq('agency_id', agency_id)
    .maybeSingle();

  if (leadErr) {
    console.error('Lead fetch error:', leadErr);
    return jsonResponse({ ok: false, error: 'fetch_failed', message: 'Could not load lead' }, 500);
  }
  if (!lead) {
    return jsonResponse({ ok: false, error: 'lead_not_found', message: 'No lead with that id in this agency' }, 404);
  }

  const { data: notes } = await supabase
    .from('lead_notes')
    .select('body')
    .eq('agency_id', agency_id)
    .eq('lead_id', lead_id)
    .eq('context_for_ai', true)
    .order('created_at', { ascending: true });
  const contextNotes = (notes || []).filter((n: { body: string | null }) => n?.body);

  // properties.external_id, not properties.listing_id. Lead's listing_id stores the
  // external portal reference which corresponds to properties.external_id in the catalog.
  let propertyTitle: string | null = null;
  if (lead.listing_id) {
    const { data: prop } = await supabase
      .from('properties')
      .select('title')
      .eq('agency_id', agency_id)
      .eq('external_id', lead.listing_id)
      .maybeSingle();
    if (prop?.title) propertyTitle = String(prop.title).trim();
  }

  if (!hasMeaningfulSignal(lead as LeadRow, contextNotes.length, propertyTitle)) {
    return jsonResponse({
      ok: false,
      error: 'lead_low_signal_for_embedding',
      message: 'Lead has no summary, message, voice summary, budget, location, or context notes — cannot embed meaningfully',
    }, 422);
  }

  const text = buildBuyerCriteriaText(lead as LeadRow, contextNotes, propertyTitle);
  if (!text || text.length < 5) {
    return jsonResponse({
      ok: false,
      error: 'lead_low_signal_for_embedding',
      message: 'Composed text too short — cannot embed meaningfully',
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
      body: JSON.stringify({ input: text, model: MODEL, encoding_format: 'float' }),
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
    return jsonResponse({
      ok: false,
      error: 'embedding_shape_mismatch',
      expected: DIMS,
      got: Array.isArray(embedding) ? embedding.length : 'not-array',
    }, 500);
  }

  const embeddingLiteral = `[${embedding.join(',')}]`;

  const { data: writeResult, error: writeErr } = await supabase
    .rpc('mark_lead_embedding_synced', {
      p_lead_id: lead_id,
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
    lead_id,
    dimensions: DIMS,
    model: MODEL,
    latency_ms: latency,
    text_length: text.length,
    note_count: contextNotes.length,
    had_property_title: !!propertyTitle,
    write_result: writeResult,
  });
});
