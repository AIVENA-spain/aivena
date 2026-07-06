// CAPTURE (version control) of the deploy-only Edge Function `property-enrich-montinmo`.
// Slug: property-enrich-montinmo · id c1e916d0-b792-42e1-b982-5981961fb118 · version 5 · ACTIVE · verify_jwt=false
// ezbr_sha256: 70f66876bedf8b625e2d5d88a802fbdca3efbcea5cbd93833d61c03b6062243f
// Captured 2026-07-06 via Supabase get_edge_function. The DEPLOYED function is authoritative — if this
// file ever diverges, re-fetch and reconcile. Documentation/source-control only; deploying/running is a
// separate, gated action (permission-based Montinmo scrape — held).

// AIVENA — property-enrich-montinmo  (v5: + read-only scan: summary_only + pagination)
// Permission-based detail-page enrichment for the Montinmo DEMO source only.
// Fills ONLY gaps: built/plot area + clean features. Description & images SHOW-ONLY.
// Keyed by (agency_id, external_id): never inserts, withdraws, overwrites good values,
// or invents. Production path for real agencies stays property-sync (Kyero XML).
//
// modes: dry_run (DEFAULT, zero writes) | apply (area+features fill + provenance + run log)
// scan : pass summary_only=true (+ offset/limit) for read-only catalogue distribution counts.
// status: source_status live|sold_redirect|fetch_error ; parser_status ok|partial|parser_failed|skipped
// Auth: verify_jwt=false ; x-internal-secret == Vault PROPERTY_SYNC_INTERNAL_SECRET

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET_NAME = "PROPERTY_SYNC_INTERNAL_SECRET";
const UA = "AIVENA-PropertyEnrich/1.0 (+https://aivena.es; demo agency; permission-based)";
const SOURCE_TEMPLATE = "mediaelx_montinmo";

const PROMOTE: Record<string, string> = {
  "parking spaces": "Parking", "parking space": "Parking", "parking": "Parking", "garage": "Garage",
  "balcony": "Balcony", "terrace": "Terrace", "solarium": "Solarium", "porch": "Porch", "yard": "Yard",
};
const NEVER_PROMOTE = /(kitchen|distance|energy|community|comunidad|ibi|tax|impuesto|orientation|orientaci|year|año constr|floor|planta|reference)/i;
const CHROME = /(mortgage|hipoteca|privacy|cookie|consent|consentimiento|economy|economía|currency|divisa|calculate|calcul|newsletter|aviso legal|política|terms|término|navigation|menú|footer|ask for information|solicitar informaci)/i;

function json(b: unknown, s = 200): Response {
  return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&ntilde;/gi, "ñ").replace(/&aacute;/gi, "á").replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í").replace(/&oacute;/gi, "ó").replace(/&uacute;/gi, "ú")
    .replace(/&#(\d+);/g, (_m, n) => { try { return String.fromCodePoint(Number(n)); } catch { return " "; } });
}
function stripTags(html: string): string {
  return decodeEntities(
    html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}
function euroNum(raw: string | null | undefined): number | null {
  if (!raw) return null;
  let s = String(raw).replace(/[^0-9.,]/g, "");
  if (!s) return null;
  if (s.includes(".") && s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  else if (s.includes(".")) { const p = s.split("."); if (p.length > 1 && p[p.length - 1].length === 3) s = p.join(""); }
  const n = Number(s); return Number.isFinite(n) ? n : null;
}
function paneInner(html: string, id: string, endIds: string[]): string {
  const marker = `id=\"${id}\"`;
  const s = html.indexOf(marker);
  if (s < 0) return "";
  const gt = html.indexOf(">", s);
  const startInner = gt >= 0 ? gt + 1 : s + marker.length;
  const rest = html.slice(startInner);
  let end = rest.length;
  for (const e of endIds) { const i = rest.indexOf(`id=\"${e}\"`); if (i > 0 && i < end) end = i; }
  return rest.slice(0, end);
}
function normalizePool(k: string): string | null {
  if (k.includes("private pool")) return "Private Pool";
  if (k.includes("communal pool") || k.includes("community pool")) return "Communal Pool";
  if (k === "pool" || k === "swimming pool") return "Pool";
  return null;
}

interface Parsed {
  parser_status: "ok" | "partial" | "parser_failed";
  built: number | null; plot: number | null; bedrooms: number | null; bathrooms: number | null;
  reference: string | null; features: string[]; extra_specs: Record<string, string>; rejected: string[];
  description: string | null; images: string[]; primary_image: string | null;
}

function parseDetail(html: string): Parsed {
  const featPane = paneInner(html, "collapse-caracteristicas", ["collapse-descripcion", "pane-descripcion", "collapse-mapa", "pane-mapa"]);
  let built: number | null = null, plot: number | null = null, beds: number | null = null,
      baths: number | null = null, ref: string | null = null;
  const features: string[] = [];
  const extra_specs: Record<string, string> = {};
  const rejected: string[] = [];
  const addFeat = (tag: string) => { const v = tag.trim(); if (v && !features.some((f) => f.toLowerCase() === v.toLowerCase())) features.push(v); };

  for (const m of featPane.matchAll(/<div[^>]*class=\"[^\"]*\bfeatured\b[^\"]*\"[^>]*>([\s\S]*?)<\/div>/gi)) {
    const t = stripTags(m[1]);
    if (!t) continue;
    let mm: RegExpExecArray | null;
    if ((mm = /^Reference\s*:\s*(.+)$/i.exec(t))) { ref = mm[1].trim(); continue; }
    if ((mm = /^Bedrooms?\s*:\s*(\d+)/i.exec(t))) { beds = Number(mm[1]); continue; }
    if ((mm = /^Bathrooms?\s*:\s*(\d+)/i.exec(t))) { baths = Number(mm[1]); continue; }
    if ((mm = /^Built\s*:?\s*([\d.,]+)\s*m/i.exec(t))) { built = euroNum(mm[1]); continue; }
    if ((mm = /^Plot\s*:?\s*([\d.,]+)\s*m/i.exec(t))) { plot = euroNum(mm[1]); continue; }
    if (CHROME.test(t)) { rejected.push(t); continue; }
    if (t.includes(":")) {
      const idx = t.indexOf(":");
      const label = t.slice(0, idx).trim(); const value = t.slice(idx + 1).trim();
      if (!label || !value || label.length > 40 || value.length > 60) { rejected.push(t); continue; }
      extra_specs[label] = value;
      const k = label.toLowerCase();
      if (!NEVER_PROMOTE.test(k)) { const pool = normalizePool(k); if (pool) addFeat(pool); else if (PROMOTE[k]) addFeat(PROMOTE[k]); }
      continue;
    }
    if (t.length > 40 || /\d{3,}/.test(t) || NEVER_PROMOTE.test(t)) { rejected.push(t); continue; }
    const pool = normalizePool(t.toLowerCase());
    addFeat(pool ?? (PROMOTE[t.toLowerCase()] ?? t));
  }
  if (features.some((f) => /^(private|communal|community)\s+pool$/i.test(f))) {
    for (let j = features.length - 1; j >= 0; j--) if (/^pool$/i.test(features[j])) features.splice(j, 1);
  }

  const descPane = paneInner(html, "collapse-descripcion", ["collapse-mapa", "pane-mapa", "collapse-economia", "pane-economia"]);
  let description = stripTags(descPane).replace(/^Description\s*/i, "").trim();
  if (description.length < 15) description = "";

  const ids: string[] = [];
  for (const m of html.matchAll(/media\/images\/properties\/thumbnails\/(\d+)_w_xl\.jpg/g)) if (!ids.includes(m[1])) ids.push(m[1]);
  const images = ids.map((id) => `https://montinmo.es/media/images/properties/thumbnails/${id}_w_xl.jpg`);
  const og = /og:image[^>]*content=\"[^\"]*thumbnails\/(\d+)_lg\.jpg\"/i.exec(html);
  const primary_image = og ? `https://montinmo.es/media/images/properties/thumbnails/${og[1]}_w_xl.jpg` : (images[0] ?? null);

  const hasCore = built != null || plot != null || beds != null;
  const hasFeat = features.length > 0;
  const parser_status = (!hasCore && !hasFeat) ? "parser_failed" : (hasCore && hasFeat) ? "ok" : "partial";
  return { parser_status, built, plot, bedrooms: beds, bathrooms: baths, reference: ref, features, extra_specs, rejected, description: description || null, images, primary_image };
}

function arrLen(v: unknown): number { return Array.isArray(v) ? v.length : 0; }

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: gate, error: gateErr } = await sb.rpc("_get_platform_secret", { p_name: SECRET_NAME });
  if (gateErr || !gate) return json({ ok: false, error: "secret_unavailable" }, 500);
  if (req.headers.get("x-internal-secret") !== gate) return json({ ok: false, error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const agency_id = typeof body.agency_id === "string" ? body.agency_id : null;
  const mode = body.mode === "apply" ? "apply" : "dry_run";
  const summary_only = body.summary_only === true;
  const external_ids = Array.isArray(body.external_ids) ? body.external_ids.map(String) : null;
  const delay_ms = typeof body.delay_ms === "number" ? Math.max(250, Math.min(5000, body.delay_ms)) : 1500;
  const limit = typeof body.limit === "number" ? Math.max(1, Math.min(60, body.limit)) : 10;
  const offset = typeof body.offset === "number" ? Math.max(0, body.offset) : 0;
  if (!agency_id) return json({ ok: false, error: "agency_id_required" }, 400);
  if (summary_only && mode === "apply") return json({ ok: false, error: "summary_only_is_read_only" }, 400);

  let q = sb.from("properties")
    .select("id, external_id, area_sqm, area_built_sqm, area_plot_sqm, bedrooms, bathrooms, description, features, images, raw_payload")
    .eq("agency_id", agency_id).eq("raw_payload->>import_source", "montinmo");
  if (external_ids && external_ids.length) q = q.in("external_id", external_ids);
  else q = q.order("external_id", { ascending: true }).range(offset, offset + limit - 1);
  const { data: rows, error: rErr } = await q;
  if (rErr) return json({ ok: false, error: "load_failed", detail: rErr.message }, 500);
  if (!rows || rows.length === 0) return json({ ok: true, mode, summary_only, offset, summary: { targeted: 0 }, results: [] });

  let run_id: string | null = null;
  if (mode === "apply") {
    const { data: rr, error: re } = await sb.from("property_sync_runs")
      .insert({ agency_id, status: "running", started_at: new Date().toISOString() }).select("id").single();
    if (re) return json({ ok: false, error: "sync_run_open_failed", detail: re.message }, 500);
    run_id = rr.id as string;
  }

  const results: unknown[] = [];
  let updated = 0, sold = 0, fetchErr = 0;
  // scan counters
  let live = 0, pOk = 0, pPartial = 0, pFailed = 0, withBuilt = 0, withPlot = 0, withFeatures = 0,
      areaOnly = 0, nothingUseful = 0, wouldReembed = 0;
  const problems = { ref_mismatch: 0, beds_differ: 0, baths_differ: 0, total_rejected_items: 0 };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as Record<string, unknown>;
    const url = (row.raw_payload as Record<string, unknown> | null)?.["url"] as string | undefined;
    const ext = row.external_id as string;
    const base = {
      external_id: ext, url: url ?? null,
      current_area_sqm: row.area_sqm ?? null, current_features_count: arrLen(row.features),
      current_description_length: (row.description as string | null)?.length ?? 0, current_image_count: arrLen(row.images),
    };
    if (!url) { fetchErr++; if (!summary_only) results.push({ ...base, source_status: "fetch_error", parser_status: "skipped", risks: ["no_source_url"] }); continue; }
    if (i > 0) await sleep(delay_ms);

    let finalUrl = url, html = "", httpOk = false, redirectedAway = false;
    try {
      const resp = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html" }, redirect: "follow" });
      finalUrl = resp.url; httpOk = resp.ok; redirectedAway = !/\/property\//i.test(finalUrl); html = await resp.text();
    } catch (e) {
      fetchErr++; if (!summary_only) results.push({ ...base, source_status: "fetch_error", parser_status: "skipped", risks: [`fetch_${String((e as Error).message).slice(0, 50)}`] }); continue;
    }
    if (!httpOk) { fetchErr++; if (!summary_only) results.push({ ...base, final_url: finalUrl, source_status: "fetch_error", parser_status: "skipped", risks: ["http_non_200"] }); continue; }
    if (redirectedAway) { sold++; if (!summary_only) results.push({ ...base, final_url: finalUrl, source_status: "sold_redirect", parser_status: "skipped", fields_would_change: [], embedding_would_refresh: false, risks: ["sold_redirect_left_untouched"] }); continue; }

    const p = parseDetail(html);
    live++;
    if (p.parser_status === "ok") pOk++; else if (p.parser_status === "partial") pPartial++; else pFailed++;
    if (p.built != null) withBuilt++;
    if (p.plot != null) withPlot++;
    if (p.features.length > 0) withFeatures++;
    if ((p.built != null || p.plot != null) && p.features.length === 0) areaOnly++;
    if (p.built == null && p.plot == null && p.features.length === 0) nothingUseful++;
    problems.total_rejected_items += p.rejected.length;

    const filled: string[] = []; const skipped: string[] = []; const risks: string[] = [];
    const resulting_area = (row.area_sqm as number | null) ?? (p.built ?? p.plot ?? null);
    if (row.area_built_sqm == null && p.built != null) filled.push("area_built_sqm"); else if (p.built != null) skipped.push("area_built_sqm(exists)");
    if (row.area_plot_sqm == null && p.plot != null) filled.push("area_plot_sqm"); else if (p.plot != null) skipped.push("area_plot_sqm(exists)");
    if (row.area_sqm == null && (p.built != null || p.plot != null)) filled.push("area_sqm"); else if (p.built != null || p.plot != null) skipped.push("area_sqm(exists)");
    if (arrLen(row.features) === 0 && p.features.length > 0) filled.push("features"); else if (p.features.length > 0) skipped.push("features(exists)");

    if (p.reference && ext && p.reference.toLowerCase() !== ext.toLowerCase()) { risks.push(`ref_mismatch(page:${p.reference})`); problems.ref_mismatch++; }
    if (p.bedrooms != null && row.bedrooms != null && p.bedrooms !== row.bedrooms) { risks.push(`beds_differ`); problems.beds_differ++; }
    if (p.bathrooms != null && row.bathrooms != null && p.bathrooms !== row.bathrooms) { risks.push(`baths_differ`); problems.baths_differ++; }
    if (p.parser_status !== "ok") risks.push(`parser_${p.parser_status}`);
    const embedding_would_refresh = filled.includes("area_sqm") || filled.includes("features");
    if (embedding_would_refresh) wouldReembed++;

    if (mode === "apply" && filled.length > 0) {
      const patch: Record<string, unknown> = {};
      if (filled.includes("area_built_sqm")) patch.area_built_sqm = p.built;
      if (filled.includes("area_plot_sqm")) patch.area_plot_sqm = p.plot;
      if (filled.includes("area_sqm")) patch.area_sqm = resulting_area;
      if (filled.includes("features")) patch.features = p.features;
      const prevRaw = (row.raw_payload as Record<string, unknown>) ?? {};
      patch.raw_payload = { ...prevRaw, enrichment: {
        scraped_at: new Date().toISOString(), source_url: url, final_url: finalUrl,
        source_status: "live", parser_status: p.parser_status, source_template: SOURCE_TEMPLATE,
        fields_filled: filled, extra_specs: p.extra_specs, description_available: !!p.description,
        description_length: p.description?.length ?? 0, image_count_available: p.images.length, errors: [], run_id,
      } };
      patch.updated_at = new Date().toISOString();
      const { error: uErr } = await sb.from("properties").update(patch).eq("id", row.id as string);
      if (!uErr) updated++;
    }

    if (!summary_only) results.push({
      ...base, final_url: finalUrl, source_status: "live", parser_status: p.parser_status,
      scraped_built_area: p.built, scraped_plot_area: p.plot, resulting_area_sqm: resulting_area,
      clean_features: p.features, scraped_features_count: p.features.length, extra_specs: p.extra_specs,
      rejected_count: p.rejected.length, rejected_sample: p.rejected.slice(0, 6),
      scraped_description_length: p.description?.length ?? 0, scraped_description_preview: p.description ? p.description.slice(0, 180) : null,
      description_show_only: true, scraped_image_count: p.images.length, image_show_only: true,
      fields_would_change: filled, fields_skipped: skipped, embedding_would_refresh, risks,
    });
  }

  if (mode === "apply" && run_id) {
    await sb.from("property_sync_runs").update({
      status: "success", properties_found: rows.length, properties_updated: updated, properties_withdrawn: 0,
      error_message: `sold:${sold};fetch_error:${fetchErr}`, completed_at: new Date().toISOString(),
    }).eq("id", run_id);
  }

  return json({ ok: true, mode, summary_only, offset, run_id, agency_id,
    summary: {
      targeted: rows.length, live, sold_redirect: sold, fetch_error: fetchErr,
      parser_ok: pOk, parser_partial: pPartial, parser_failed: pFailed,
      with_built: withBuilt, with_plot: withPlot, with_features: withFeatures,
      area_only_no_features: areaOnly, nothing_useful: nothingUseful, would_reembed: wouldReembed,
      would_update: live - nothingUseful, updated, problems,
    },
    results });
});
