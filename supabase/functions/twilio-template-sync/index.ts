// supabase/functions/twilio-template-sync/index.ts  (Phase 1c)
// Reconciles whatsapp_templates.status from Twilio ContentAndApprovals.
// Read-only against Twilio (GET only). Writes ONLY via apply_template_provider_status.
// Never downgrades a row absent from a successful response. Internal/platform-level —
// agency users never see this; failures return small JSON and are logged to provider_audit_log.
//
// Auth: x-internal-secret header vs Vault TEMPLATE_SYNC_INTERNAL_SECRET (mirrors the
// whatsapp-send-execute pattern). Pure parsing/mapping logic lives in ./sync-logic.ts.
//
// Deploy is gated. Prerequisite before deploy: provision the Vault secret
// TEMPLATE_SYNC_INTERNAL_SECRET (or, to reuse whatsapp-send's secret, change the p_name below
// to WHATSAPP_SEND_INTERNAL_SECRET).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { extractItems, computeMissingSids, type SyncItem } from './sync-logic.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CONTENT_BASE = 'https://content.twilio.com';

function j(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function ctEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return j(405, { ok: false, error: 'method_not_allowed' });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const presented = req.headers.get('x-internal-secret') ?? '';
  const { data: expected } = await admin.rpc('_get_platform_secret', { p_name: 'TEMPLATE_SYNC_INTERNAL_SECRET' });
  if (!presented || !expected || !ctEqual(presented, expected)) {
    return j(401, { ok: false, error: 'unauthorized' });
  }

  const { data: accountSid } = await admin.rpc('_get_platform_secret', { p_name: 'TWILIO_ACCOUNT_SID' });
  const { data: token, error: tokErr } = await admin.rpc('_get_platform_secret', { p_name: 'TWILIO_AUTH_TOKEN' });
  if (tokErr || !token || !accountSid) return j(500, { ok: false, error: 'credentials_unavailable' });

  const authHeader = 'Basic ' + btoa(`${accountSid}:${token}`);

  // 1) Fetch all pages of ContentAndApprovals. Accumulate; on a page failure, stop and apply
  //    only what was fetched from prior 200 pages (a partial fetch never downgrades a row).
  const items: SyncItem[] = [];
  let url: string | null = `${CONTENT_BASE}/v2/ContentAndApprovals?PageSize=100`;
  let partial = false;
  let pages = 0;
  let lastStatus = 0;
  let lastError: string | null = null;
  const startedAt = Date.now();

  while (url && pages < 20) {
    pages++;
    let resp: Response;
    try {
      resp = await fetch(url, { method: 'GET', headers: { Authorization: authHeader, Accept: 'application/json' } });
    } catch (e) {
      partial = true;
      lastError = (e as Error).message?.slice(0, 240) ?? 'fetch_error';
      break;
    }
    lastStatus = resp.status;
    const raw = await resp.text();
    if (resp.status < 200 || resp.status >= 300) {
      partial = true;
      lastError = raw.slice(0, 300);
      break;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      partial = true;
      lastError = 'unparseable_json';
      break;
    }

    for (const it of extractItems(body)) items.push(it);
    url = (body as { meta?: { next_page_url?: string | null } })?.meta?.next_page_url ?? null;
  }

  // 2) Audit the fetch (internal log; never surfaced to agency users).
  await admin.from('provider_audit_log').insert({
    agency_id: '__platform__',
    provider_type: 'twilio_content_sync',
    request_method: 'GET',
    request_url: `${CONTENT_BASE}/v2/ContentAndApprovals`,
    request_payload: { pages, page_size: 100 },
    response_status: lastStatus || null,
    response_payload: { fetched: items.length, partial },
    error_message: lastError,
    duration_ms: Date.now() - startedAt,
  });

  // 3) Apply (idempotent). If nothing fetched, do not write.
  let applied: unknown[] = [];
  if (items.length > 0) {
    const { data, error } = await admin.rpc('apply_template_provider_status', { p_items: items });
    if (error) return j(500, { ok: false, error: 'apply_failed' });
    applied = data ?? [];
  }

  // 4) Report DB SIDs not seen in Twilio (informational; never downgraded).
  const seen = new Set(items.map((i) => i.sid));
  const { data: dbSids } = await admin
    .from('whatsapp_templates')
    .select('provider_template_id')
    .not('provider_template_id', 'is', null);
  const dbSidMissingInTwilio = computeMissingSids(
    (dbSids ?? []).map((r: { provider_template_id: string | null }) => r.provider_template_id),
    seen,
  );

  return j(200, {
    ok: true,
    pages,
    fetched: items.length,
    applied_sids: applied.length,
    partial,
    db_sids_missing_in_twilio: dbSidMissingInTwilio,
    last_twilio_status: lastStatus,
  });
});
