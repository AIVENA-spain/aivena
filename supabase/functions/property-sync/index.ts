// AIVENA — property-sync  (v3: safe real-catalogue ingestion — image mirror + withdrawal guard + dry-run)
// Slug: property-sync · id 8f98e0ec-8878-4e71-8766-7aa2bad27e77 · verify_jwt=false
//
// This is the v3 SOURCE built for deploy (deployed live is still v2, the old unguarded engine). Deploy
// is a separate GATED step — do NOT point a real feed at the live v2. v3 fixes the three ways the old
// engine was unsafe:
//   1. IMAGE MIRRORING (index.ts) — feed image links are downloaded into our own `property-images`
//      bucket and the OWNED url is stored, never the feed's link. Storing links is what let montinmo.es
//      take 57% of the demo catalogue down with it (2026-07-14). See guard.ts ownedUrlFor().
//   2. WITHDRAWAL GUARD (guard.ts) — the old engine withdrew every active row not in the feed, with no
//      guard, so a truncated / re-keyed / wrong-agency feed would wipe a catalogue. Now: withdrawal is
//      scoped to FEED-OWNED rows only (never CSV/demo rows), the active count is read BEFORE the upsert
//      (honest denominator), and a delta cap DEFERS a suspicious mass-withdraw (run → needs_review)
//      rather than executing it. allow_mass_withdraw is the human override.
//   3. DRY-RUN (default) — the function reports what it WOULD do and writes NOTHING unless the caller
//      passes dry_run:false. First real-feed contact must be a dry-run, reviewed, before any apply.
// The Kyero v3 parser lives in ./kyero.ts (built/plot separated, all languages kept, 0=unknown) and is
// unit-tested (kyero.test.ts). Auto-embedding is the property_autoembed DB trigger; this fn never embeds.
//
// Auth: internal secret header x-internal-secret == Vault PROPERTY_SYNC_INTERNAL_SECRET.
// Invoke (pg_net / n8n) with JSON:
//   { agency_id, feed_url? | feed_xml?, format?="kyero", dry_run?=true, allow_mass_withdraw?=false }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { XMLParser } from "npm:fast-xml-parser@4";
// The normaliser lives in ./kyero.ts — pure, dependency-free and unit-tested against real Kyero v3
// fixtures (kyero.test.ts). It previously lived inline in this file, which is precisely why it went
// unproven: nothing here can be unit-tested (it needs Deno + the network + the DB). Keep the split —
// parsing/normalising belongs there, I/O belongs here.
import { normalizeFeed, MAX_IMAGES, type NormProp } from "./kyero.ts";
import {
  evaluateWithdrawalGuard, isOwnedImageUrl, imageExt, storagePathFor, ownedUrlFor,
} from "./guard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET_NAME = "PROPERTY_SYNC_INTERNAL_SECRET";
const IMAGE_BUCKET = "property-images";
const UA = "AIVENA-PropertySync/3.0 (+https://aivena.es)";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function parseFeed(xml: string, format: string): NormProp[] {
  if (format !== "kyero") throw new Error(`unsupported_format:${format}`);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: true, parseTagValue: false });
  return normalizeFeed(parser.parse(xml));
}

// Mirror a property's feed image urls into our own bucket → return the OWNED urls. A url that is
// ALREADY ours is kept as-is (a re-sync must not re-download). A feed image that can't be fetched or
// stored is SKIPPED (never fails the property) — a listing with fewer photos beats a broken one, and
// the shared usable-photo rule then treats a fully-unmirrored listing as photoless, honestly.
// Capped at MAX_IMAGES (50, the Kyero schema max) per property.
async function mirrorImages(
  sb: ReturnType<typeof createClient>,
  agencyId: string,
  externalId: string,
  urls: string[],
): Promise<{ owned: string[]; mirrored: number; skipped: number; alreadyOwned: number }> {
  const owned: string[] = [];
  let mirrored = 0, skipped = 0, alreadyOwned = 0;
  const slice = urls.slice(0, MAX_IMAGES);
  for (let i = 0; i < slice.length; i++) {
    const src = slice[i];
    if (isOwnedImageUrl(src)) { owned.push(src); alreadyOwned++; continue; }
    try {
      const resp = await fetch(src, { headers: { "User-Agent": UA, Accept: "image/*" }, redirect: "follow" });
      if (!resp.ok) { skipped++; continue; }
      const bytes = new Uint8Array(await resp.arrayBuffer());
      if (bytes.length === 0) { skipped++; continue; }
      const ext = imageExt(src);
      const path = storagePathFor(agencyId, externalId, i, ext);
      const { error } = await sb.storage.from(IMAGE_BUCKET).upload(path, bytes, {
        contentType: resp.headers.get("content-type") ?? `image/${ext}`,
        upsert: true,
      });
      if (error) { skipped++; continue; }
      owned.push(ownedUrlFor(SUPABASE_URL, path));
      mirrored++;
    } catch { skipped++; }
  }
  return { owned, mirrored, skipped, alreadyOwned };
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
  // SAFE DEFAULT: dry-run unless the caller EXPLICITLY passes dry_run:false. First real-feed contact
  // must be a dry-run. allow_mass_withdraw is the deliberate human override for a genuine delisting.
  const dry_run = body.dry_run !== false;
  const allow_mass_withdraw = body.allow_mass_withdraw === true;
  if (!agency_id) return json({ ok: false, error: "agency_id_required" }, 400);
  if (!feed_url && !feed_xml) return json({ ok: false, error: "feed_url_or_feed_xml_required" }, 400);

  const nowIso = new Date().toISOString();
  const { data: runRow, error: runErr } = await sb
    .from("property_sync_runs")
    .insert({ agency_id, status: dry_run ? "dry_run" : "running", started_at: nowIso })
    .select("id").single();
  if (runErr) return json({ ok: false, error: "sync_run_open_failed", detail: runErr.message }, 500);
  const run_id = runRow.id as string;
  const finishRun = (patch: Record<string, unknown>) =>
    sb.from("property_sync_runs").update({ ...patch, completed_at: new Date().toISOString() }).eq("id", run_id);

  try {
    // ── fetch + parse — FAIL-CLOSED before any write or withdrawal ──
    let xml = feed_xml;
    if (!xml) {
      let resp: Response;
      try { resp = await fetch(feed_url!, { headers: { "User-Agent": UA } }); }
      catch (e) { await finishRun({ status: "error", error_message: `feed_fetch_${String((e as Error).message).slice(0, 80)}` });
        return json({ ok: false, error: "feed_fetch_failed" }, 502); }
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

    const feedSet = new Set(items.map((n) => n.external_id));

    // ── PRE-UPSERT read of FEED-OWNED active rows: the honest withdraw set + denominator ──
    // Scoped to import_source='property-sync' → a feed NEVER withdraws CSV-imported or demo rows.
    // Read BEFORE the upsert so the guard's denominator isn't inflated by the upsert forcing 'active'.
    const { data: activeRows, error: aErr } = await sb.from("properties")
      .select("id, external_id")
      .eq("agency_id", agency_id).eq("status", "active")
      .eq("raw_payload->>import_source", "property-sync");
    if (aErr) { await finishRun({ status: "error", error_message: `active_read_${aErr.message.slice(0, 120)}`, properties_found: items.length });
      return json({ ok: false, error: "active_read_failed" }, 500); }

    const activeFeedOwned = activeRows ?? [];
    const existingExt = new Set(activeFeedOwned.map((r) => r.external_id as string));
    const toWithdraw = activeFeedOwned.filter((r) => !feedSet.has(r.external_id as string)).map((r) => r.id as string);
    const guard = evaluateWithdrawalGuard(toWithdraw.length, activeFeedOwned.length, allow_mass_withdraw);

    const imagesTotal = items.reduce((s, n) => s + n.images.length, 0);
    const alreadyOwned = items.reduce((s, n) => s + n.images.filter(isOwnedImageUrl).length, 0);
    const wouldInsert = items.filter((n) => !existingExt.has(n.external_id)).length;

    const report = {
      found: items.length,
      would_insert: wouldInsert,
      would_update: items.length - wouldInsert,
      would_withdraw: toWithdraw.length,
      withdraw_blocked: guard.blocked,
      withdraw_reason: guard.reason,
      active_feed_owned_before: activeFeedOwned.length,
      images_total: imagesTotal,
      images_already_owned: alreadyOwned,
      images_to_mirror: imagesTotal - alreadyOwned,
      with_built: items.filter((n) => n.area_built_sqm != null).length,
      with_plot: items.filter((n) => n.area_plot_sqm != null).length,
      no_usable_area: items.filter((n) => n.area_sqm == null).length,
    };

    // ── DRY RUN (default): report what WOULD happen, write NOTHING ──
    if (dry_run) {
      await finishRun({ status: "dry_run", properties_found: items.length, properties_updated: 0,
        properties_withdrawn: 0, error_message: `dry_run;${guard.reason}` });
      return json({ ok: true, dry_run: true, run_id, report });
    }

    // ── APPLY: mirror every property's images into our own bucket, then upsert with OWNED urls ──
    let mirroredTotal = 0, skippedImages = 0;
    for (const n of items) {
      if (n.images.length === 0) continue;
      const m = await mirrorImages(sb, agency_id, n.external_id, n.images);
      n.images = m.owned;                 // OWNED urls only — never the feed's links
      mirroredTotal += m.mirrored;
      skippedImages += m.skipped;
    }

    const rows = items.map((n) => ({
      agency_id, external_id: n.external_id, title: n.title, description: n.description,
      property_type: n.property_type, status: "active", price: n.price,
      price_currency: n.price_currency || "EUR", bedrooms: n.bedrooms, bathrooms: n.bathrooms,
      // Built and plot in their own columns; area_sqm is the BUILT size only (Studio renders it as
      // "N m² built") — a plot size must never reach it.
      area_sqm: n.area_sqm, area_built_sqm: n.area_built_sqm, area_plot_sqm: n.area_plot_sqm,
      location_city: n.location_city, location_region: n.location_region,
      location_country: n.location_country, lat: n.lat, lng: n.lng, images: n.images, features: n.features,
      source_url: n.source_url, scraped_at: nowIso,
      // descriptions keeps every language the feed supplied; `description` is only the preferred one.
      raw_payload: { import_source: "property-sync", format, synced_at: nowIso, descriptions: n.descriptions, feed: n.raw },
      updated_at: nowIso,
    }));

    const { error: upErr } = await sb.from("properties").upsert(rows, { onConflict: "agency_id,external_id" });
    if (upErr) { await finishRun({ status: "error", error_message: `upsert_${upErr.message.slice(0, 120)}`, properties_found: items.length });
      return json({ ok: false, error: "upsert_failed", detail: upErr.message }, 500); }

    // ── WITHDRAWAL: apply only if the guard passed; else DEFER (keep the upsert, flag needs_review) ──
    if (guard.blocked) {
      await finishRun({ status: "needs_review", properties_found: items.length, properties_updated: items.length,
        properties_withdrawn: 0, error_message: guard.reason });
      return json({ ok: false, error: "withdraw_deferred_needs_review", run_id,
        withdraw_deferred: toWithdraw.length, reason: guard.reason,
        mirrored_images: mirroredTotal, skipped_images: skippedImages, found: items.length });
    }

    let withdrawn = 0;
    for (let i = 0; i < toWithdraw.length; i += 200) {
      const chunk = toWithdraw.slice(i, i + 200);
      const { error: wErr } = await sb.from("properties").update({ status: "withdrawn", updated_at: nowIso }).in("id", chunk);
      if (wErr) { await finishRun({ status: "error", error_message: `withdraw_${wErr.message.slice(0, 120)}`, properties_found: items.length, properties_withdrawn: withdrawn });
        return json({ ok: false, error: "withdraw_failed" }, 500); }
      withdrawn += chunk.length;
    }

    await finishRun({ status: "success", properties_found: items.length, properties_updated: items.length,
      properties_withdrawn: withdrawn });
    return json({ ok: true, run_id, found: items.length, withdrawn,
      mirrored_images: mirroredTotal, skipped_images: skippedImages });
  } catch (e) {
    await finishRun({ status: "error", error_message: `unexpected_${String((e as Error).message).slice(0, 120)}` });
    return json({ ok: false, error: "unexpected_error" }, 500);
  }
});
