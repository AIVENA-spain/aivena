// CAPTURE (version control) of the deploy-only Edge Function `property-sync`.
// Slug: property-sync · id 8f98e0ec-8878-4e71-8766-7aa2bad27e77 · version 2 · ACTIVE · verify_jwt=false
// ezbr_sha256: e7bf541d485f35d5bcbadb1d88033a169cf1d954f47e8ddc7bf6fdf6ba9c87e6
// Captured 2026-07-06 via Supabase get_edge_function. The DEPLOYED function is authoritative — if this
// file ever diverges, re-fetch and reconcile. This is documentation/source-control; deploying is a
// separate, gated action (not done here).

// AIVENA — property-sync  (Phase 1 ingestion engine)
// Pulls an agency property feed (Kyero XML standard), normalizes + upserts into
// `properties` keyed by (agency_id, external_id), marks vanished listings withdrawn,
// and logs a property_sync_run. Auto-embedding is handled by the property_autoembed
// DB trigger (fires on insert / content-change), so this function never embeds directly.
//
// Auth: deploy with verify_jwt=false (internal function). Gated by an internal secret
// header: x-internal-secret must equal the Vault secret PROPERTY_SYNC_INTERNAL_SECRET.
//
// Invoke (pg_net / n8n) with JSON:
//   { agency_id: string, feed_url?: string, feed_xml?: string, format?: "kyero" }
// Provide feed_url (production) OR feed_xml (inline, for testing). format defaults to kyero.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { XMLParser } from "npm:fast-xml-parser@4";
// The normaliser lives in ./kyero.ts — pure, dependency-free and unit-tested against real Kyero v3
// fixtures (kyero.test.ts). It previously lived inline in this file, which is precisely why it went
// unproven: nothing here can be unit-tested (it needs Deno + the network + the DB). Keep the split —
// parsing/normalising belongs there, I/O belongs here.
import { normalizeFeed, type NormProp } from "./kyero.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET_NAME = "PROPERTY_SYNC_INTERNAL_SECRET";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function parseFeed(xml: string, format: string): NormProp[] {
  if (format !== "kyero") throw new Error(`unsupported_format:${format}`);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: true, parseTagValue: false });
  return normalizeFeed(parser.parse(xml));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Internal gate: compare the caller's header against the Vault-held secret.
  const { data: gateSecret, error: gateErr } = await sb.rpc("_get_platform_secret", { p_name: SECRET_NAME });
  if (gateErr || !gateSecret) return json({ ok: false, error: "secret_unavailable" }, 500);
  if (req.headers.get("x-internal-secret") !== gateSecret) return json({ ok: false, error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const agency_id = typeof body.agency_id === "string" ? body.agency_id : null;
  const feed_url = typeof body.feed_url === "string" ? body.feed_url : null;
  const feed_xml = typeof body.feed_xml === "string" ? body.feed_xml : null;
  const format = typeof body.format === "string" ? body.format : "kyero";
  if (!agency_id) return json({ ok: false, error: "agency_id_required" }, 400);
  if (!feed_url && !feed_xml) return json({ ok: false, error: "feed_url_or_feed_xml_required" }, 400);

  const { data: runRow, error: runErr } = await sb
    .from("property_sync_runs")
    .insert({ agency_id, status: "running", started_at: new Date().toISOString() })
    .select("id").single();
  if (runErr) return json({ ok: false, error: "sync_run_open_failed", detail: runErr.message }, 500);
  const run_id = runRow.id as string;
  const finishRun = (patch: Record<string, unknown>) =>
    sb.from("property_sync_runs").update({ ...patch, completed_at: new Date().toISOString() }).eq("id", run_id);

  try {
    let xml = feed_xml;
    if (!xml) {
      const resp = await fetch(feed_url!, { headers: { "User-Agent": "AIVENA-PropertySync/1.0" } });
      if (!resp.ok) { await finishRun({ status: "error", error_message: `feed_fetch_${resp.status}` });
        return json({ ok: false, error: "feed_fetch_failed", upstream_status: resp.status }, 502); }
      xml = await resp.text();
    }

    let items: NormProp[];
    try { items = parseFeed(xml!, format); }
    catch (e) { await finishRun({ status: "error", error_message: `parse_${String((e as Error).message).slice(0, 120)}` });
      return json({ ok: false, error: "feed_parse_failed" }, 422); }

    if (items.length === 0) { await finishRun({ status: "error", error_message: "feed_empty", properties_found: 0 });
      return json({ ok: false, error: "feed_empty" }, 422); }

    const nowIso = new Date().toISOString();
    const rows = items.map((n) => ({
      agency_id, external_id: n.external_id, title: n.title, description: n.description,
      property_type: n.property_type, status: "active", price: n.price,
      price_currency: n.price_currency || "EUR", bedrooms: n.bedrooms, bathrooms: n.bathrooms,
      // Built and plot are written to their own columns; area_sqm carries the BUILT size only.
      // A plot size must never reach area_sqm — the Studio renders that as "N m² built".
      area_sqm: n.area_sqm, area_built_sqm: n.area_built_sqm, area_plot_sqm: n.area_plot_sqm,
      location_city: n.location_city, location_region: n.location_region,
      location_country: n.location_country, lat: n.lat, lng: n.lng, images: n.images, features: n.features,
      source_url: n.source_url, scraped_at: nowIso,
      // descriptions keeps every language the feed supplied (13 in Kyero's own sample, 33 in the
      // OpenEstate fixture); `description` above is only the preferred one. Nothing is discarded.
      raw_payload: { import_source: "property-sync", format, synced_at: nowIso, descriptions: n.descriptions, feed: n.raw },
      updated_at: nowIso,
    }));

    const { error: upErr } = await sb.from("properties").upsert(rows, { onConflict: "agency_id,external_id" });
    if (upErr) { await finishRun({ status: "error", error_message: `upsert_${upErr.message.slice(0, 120)}`, properties_found: items.length });
      return json({ ok: false, error: "upsert_failed", detail: upErr.message }, 500); }

    // Withdrawal: any still-active property for this agency that is no longer in the feed.
    const feedSet = new Set(items.map((n) => n.external_id));
    const { data: activeRows, error: aErr } = await sb.from("properties")
      .select("id, external_id").eq("agency_id", agency_id).eq("status", "active");
    if (aErr) { await finishRun({ status: "error", error_message: `active_read_${aErr.message.slice(0, 120)}`, properties_found: items.length });
      return json({ ok: false, error: "active_read_failed" }, 500); }

    const toWithdraw = (activeRows ?? []).filter((r) => !feedSet.has(r.external_id as string)).map((r) => r.id as string);
    let withdrawn = 0;
    for (let i = 0; i < toWithdraw.length; i += 200) {
      const chunk = toWithdraw.slice(i, i + 200);
      const { error: wErr } = await sb.from("properties").update({ status: "withdrawn", updated_at: nowIso }).in("id", chunk);
      if (wErr) { await finishRun({ status: "error", error_message: `withdraw_${wErr.message.slice(0, 120)}`, properties_found: items.length, properties_withdrawn: withdrawn });
        return json({ ok: false, error: "withdraw_failed" }, 500); }
      withdrawn += chunk.length;
    }

    await finishRun({ status: "success", properties_found: items.length, properties_updated: items.length, properties_withdrawn: withdrawn });
    return json({ ok: true, run_id, found: items.length, withdrawn });
  } catch (e) {
    await finishRun({ status: "error", error_message: `unexpected_${String((e as Error).message).slice(0, 120)}` });
    return json({ ok: false, error: "unexpected_error" }, 500);
  }
});
