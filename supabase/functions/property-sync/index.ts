// AIVENA CAPTURE — deploy-only Edge Function `property-sync`
//
// This file is a RECORD of what is deployed, not a source of new work.
// Do NOT deploy it without diffing against live first: the repo has been
// stale before, and deploying a stale twilio-whatsapp-inbound would have
// silenced Amanda entirely.
//
//   function          : property-sync
//   repo path         : supabase/functions/property-sync/index.ts
//   deployed version  : 3
//   deployed bundle   : ezbr_sha256 0534701393f5c0d2be073a9eae4b8490d73d616a03340840c34ad65cf00a7daf
//   captured source   : sha256 e578cca9ff3da378240087197794a4e5defcad499be4f88fd319c2b888492315
//   verified_at       : 2026-09-09
//   method            : pulled deployed source via Supabase Management API
//                       and written verbatim below the marker
//   verify_jwt        : false  (MUST be passed explicitly on any redeploy)
//   status            : verified
//   also captured     : kyero.ts (COSMETIC — repo JSDoc KEPT, all 4 claims verified true of live), guard.ts (EXACT)
//   difference        : index.ts: COSMETIC by the scanner (executable code proven identical). The repo header was NOT preserved here, unlike kyero.ts, because it contained a claim that is FALSE of current production: it said deployed live is still v2, the old unguarded engine, and warned against pointing a real feed at it. Live IS v3 — the deployed source header says v3 and the deployed code calls evaluateWithdrawalGuard and mirrorImages. A stale warning about a danger that no longer exists would mislead the next reader, so the live header stands. The repo version is preserved at scratchpad/capture/preserved/.
//
// The bundle hash is Supabase's hash of the DEPLOYED BUNDLE and cannot be
// recomputed from this file. It proves 'production has not changed since
// capture'. Source equivalence was established AT CAPTURE TIME by pulling
// live source and writing it verbatim; `captured source sha256` above lets
// us detect later edits to this file.
// ---8<--- CAPTURED SOURCE BELOW — verbatim from production, do not edit ---8<---
// AIVENA — property-sync  (v3: safe real-catalogue ingestion — image mirror + withdrawal guard + dry-run)
// Slug: property-sync · id 8f98e0ec-8878-4e71-8766-7aa2bad27e77 · verify_jwt=false
//   1. IMAGE MIRRORING — feed image links are downloaded into our own property-images bucket and the
//      OWNED url stored, never the feed's link (storing links let montinmo.es take out 57% of the demo).
//   2. WITHDRAWAL GUARD — scoped to FEED-OWNED rows, active count read BEFORE the upsert, a delta cap
//      DEFERS a suspicious mass-withdraw (run → needs_review). allow_mass_withdraw is the human override.
//   3. DRY-RUN (default) — reports what it WOULD do and writes NOTHING unless dry_run:false.
// Parser is ./kyero.ts (unit-tested). Auth: x-internal-secret == Vault PROPERTY_SYNC_INTERNAL_SECRET.
// Invoke: { agency_id, feed_url? | feed_xml?, format?="kyero", dry_run?=true, allow_mass_withdraw?=false }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { XMLParser } from "npm:fast-xml-parser@4";
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

// Mirror a property's feed image urls into our own bucket → OWNED urls. Already-ours kept as-is; a feed
// image that can't be fetched/stored is SKIPPED (never fails the property). Capped at MAX_IMAGES.
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

  const { data: gateSecret, error: gateErr } = await sb.rpc("_get_platform_secret", { p_name: SECRET_NAME });
  if (gateErr || !gateSecret) return json({ ok: false, error: "secret_unavailable" }, 500);
  if (req.headers.get("x-internal-secret") !== gateSecret) return json({ ok: false, error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const agency_id = typeof body.agency_id === "string" ? body.agency_id : null;
  const feed_url = typeof body.feed_url === "string" ? body.feed_url : null;
  const feed_xml = typeof body.feed_xml === "string" ? body.feed_xml : null;
  const format = typeof body.format === "string" ? body.format : "kyero";
  // SAFE DEFAULT: dry-run unless the caller EXPLICITLY passes dry_run:false.
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

    // Feed-owned active rows, read BEFORE the upsert. Scoped to import_source='property-sync' so a feed
    // NEVER withdraws CSV-imported or demo rows; pre-upsert so the guard denominator isn't inflated.
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

    if (dry_run) {
      await finishRun({ status: "dry_run", properties_found: items.length, properties_updated: 0,
        properties_withdrawn: 0, error_message: `dry_run;${guard.reason}` });
      return json({ ok: true, dry_run: true, run_id, report });
    }

    // APPLY: mirror images → OWNED urls, then upsert.
    let mirroredTotal = 0, skippedImages = 0;
    for (const n of items) {
      if (n.images.length === 0) continue;
      const m = await mirrorImages(sb, agency_id, n.external_id, n.images);
      n.images = m.owned;
      mirroredTotal += m.mirrored;
      skippedImages += m.skipped;
    }

    const rows = items.map((n) => ({
      agency_id, external_id: n.external_id, title: n.title, description: n.description,
      property_type: n.property_type, status: "active", price: n.price,
      price_currency: n.price_currency || "EUR", bedrooms: n.bedrooms, bathrooms: n.bathrooms,
      area_sqm: n.area_sqm, area_built_sqm: n.area_built_sqm, area_plot_sqm: n.area_plot_sqm,
      location_city: n.location_city, location_region: n.location_region,
      location_country: n.location_country, lat: n.lat, lng: n.lng, images: n.images, features: n.features,
      source_url: n.source_url, scraped_at: nowIso,
      raw_payload: { import_source: "property-sync", format, synced_at: nowIso, descriptions: n.descriptions, feed: n.raw },
      updated_at: nowIso,
    }));

    const { error: upErr } = await sb.from("properties").upsert(rows, { onConflict: "agency_id,external_id" });
    if (upErr) { await finishRun({ status: "error", error_message: `upsert_${upErr.message.slice(0, 120)}`, properties_found: items.length });
      return json({ ok: false, error: "upsert_failed", detail: upErr.message }, 500); }

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
