import { sql } from 'drizzle-orm';
import type { Tx } from '../../../../../packages/db/client';
import { WhatsAppReadinessSchema } from '../../routes/whatsapp';
import type { ReadinessSignals, WhatsAppSignal, PilotStatus } from './compute';

/**
 * Live readiness signal-gathering for the agency in the transaction's RLS GUC
 * (`app.current_agency_id`). Shared by:
 *   - GET /api/v1/readiness (the caller's own agency, GUC set by agencyContextMiddleware);
 *   - POST /api/v1/admin/agencies/:id/go-live (a staff-chosen TARGET agency — the
 *     endpoint opens its own tx and sets the GUC to :id before calling this).
 * Same signals either way, so the go-live eligibility recompute matches the read surface.
 */

/** Savepoint-isolated single-signal query — a missing table/RPC degrades to `fallback`
 *  (→ honest `unavailable`) instead of aborting the whole transaction. */
async function safe<T>(tx: Tx, fn: (sp: Tx) => Promise<T>, fallback: T): Promise<T> {
  try {
    return await tx.transaction(async (sp) => fn(sp as unknown as Tx));
  } catch (err) {
    console.error('[readiness] signal degraded:', err instanceof Error ? err.message : err);
    return fallback;
  }
}

const rows = <T>(r: unknown): T[] => r as unknown as T[];
const AGENCY_GUC = sql`current_setting('app.current_agency_id', true)`;
const asJson = (raw: unknown): unknown => (typeof raw === 'string' ? JSON.parse(raw) : raw);
const VALID_PILOT = ['setup', 'ready_for_pilot', 'live', 'paused', 'blocked'];

// Loosely-typed view of the dashboard_settings(0) jsonb (only the fields we read).
type DashboardSettings = {
  profile?: {
    legal_name?: string | null;
    name?: string | null;
    status?: string | null;
    region?: string | null;
    supported_languages?: string[] | null;
    from_email?: string | null;
    send_proven?: boolean | null;
    send_proven_at?: string | null;
  } | null;
  branding?: {
    logo_url?: string | null;
    primary_color?: string | null;
    accent_color?: string | null;
    phone?: string | null;
    website_url?: string | null;
    city?: string | null;
    region?: string | null;
    country?: string | null;
    tone?: string | null;
    reviewed_at?: string | null;
  } | null;
  config?: {
    timezone?: string | null;
    working_hours?: Record<string, unknown> | null;
    reply_handling_mode?: string | null;
    approve_before_sending?: boolean | null;
  } | null;
  team?: { members?: Array<{ role?: string | null }> } | null;
};

export async function gatherReadinessSignals(tx: Tx): Promise<ReadinessSignals> {
  // Block 1 — identity/branding/config/team from Vega's canonical SECURITY DEFINER
  // contract (the same source /settings uses; reads the GUC agency).
  const ds = await safe<DashboardSettings | null>(
    tx,
    async (sp) => {
      const r = await sp.execute(sql`SELECT public.dashboard_settings(0) AS s`);
      return (asJson(rows<{ s: unknown }>(r)[0]?.s) ?? null) as DashboardSettings | null;
    },
    null,
  );

  // Block 2 — targeted signals not in dashboard_settings (each savepoint-isolated).
  const posture = await safe<{ human_approval_required: boolean | null; default_lane: string | null } | null>(
    tx,
    async (sp) => {
      const r = await sp.execute(
        sql`SELECT human_approval_required, reply_rules->>'default_lane' AS default_lane
            FROM public.agency_settings WHERE agency_id = ${AGENCY_GUC}`,
      );
      return rows<{ human_approval_required: boolean | null; default_lane: string | null }>(r)[0] ?? null;
    },
    null,
  );

  // agencies row: supported_languages (drift check) + pilot_status (C2 lifecycle, read-only).
  const agencyMeta = await safe<{ supported_languages: string[] | null; pilot_status: string | null } | null>(
    tx,
    async (sp) => {
      const r = await sp.execute(
        sql`SELECT supported_languages, pilot_status FROM public.agencies WHERE id = ${AGENCY_GUC}`,
      );
      return rows<{ supported_languages: string[] | null; pilot_status: string | null }>(r)[0] ?? null;
    },
    null,
  );
  const pilotStatus = (agencyMeta?.pilot_status && VALID_PILOT.includes(agencyMeta.pilot_status)
    ? agencyMeta.pilot_status
    : null) as PilotStatus | null;

  const templates = await safe<{ enApproved: number; nonEnApproved: number } | null>(
    tx,
    async (sp) => {
      const r = await sp.execute(
        sql`SELECT
              count(*) FILTER (WHERE language = 'en' AND status = 'approved')::int  AS en,
              count(*) FILTER (WHERE language <> 'en' AND status = 'approved')::int AS non_en
            FROM public.whatsapp_templates WHERE agency_id = ${AGENCY_GUC}`,
      );
      const row = rows<{ en: number; non_en: number }>(r)[0];
      return row ? { enApproved: row.en, nonEnApproved: row.non_en } : null;
    },
    null,
  );

  const properties = await safe<{ count: number } | null>(
    tx,
    async (sp) => {
      const r = await sp.execute(
        sql`SELECT count(*)::int AS n FROM public.properties WHERE agency_id = ${AGENCY_GUC}`,
      );
      return { count: rows<{ n: number }>(r)[0]?.n ?? 0 };
    },
    null,
  );

  const consent = await safe<{ count: number } | null>(
    tx,
    async (sp) => {
      const r = await sp.execute(
        sql`SELECT count(*)::int AS n FROM public.consent_log WHERE agency_id = ${AGENCY_GUC}`,
      );
      return { count: rows<{ n: number }>(r)[0]?.n ?? 0 };
    },
    null,
  );

  const calendar = await safe<{ oauthCount: number } | null>(
    tx,
    async (sp) => {
      const r = await sp.execute(
        sql`SELECT count(*)::int AS n FROM public.agency_oauth_credentials WHERE agency_id = ${AGENCY_GUC}`,
      );
      return { oauthCount: rows<{ n: number }>(r)[0]?.n ?? 0 };
    },
    null,
  );

  // Block 3 — WhatsApp readiness: CONSUMED from Chat 3's RPC (not re-derived); degrades to null.
  const waParsed = await safe<WhatsAppSignal | null>(
    tx,
    async (sp) => {
      const r = await sp.execute(sql`SELECT public.get_whatsapp_provider_readiness() AS readiness`);
      const parsed = WhatsAppReadinessSchema.safeParse(asJson(rows<{ readiness: unknown }>(r)[0]?.readiness));
      if (!parsed.success) return null;
      const w = parsed.data;
      return {
        whatsapp_sender_ready: w.whatsapp_sender_ready,
        whatsapp_channel_enabled: w.whatsapp_channel_enabled,
        templates_provider_approved: { count: w.templates_provider_approved.count },
        languages_ready: w.languages_ready,
        template_send_path_proven: w.template_send_path_proven,
        last_provider_sync_at: w.last_provider_sync_at,
      };
    },
    null,
  );

  const profile = ds?.profile ?? null;
  const branding = ds?.branding ?? null;
  const config = ds?.config ?? null;
  const members = ds?.team?.members ?? null;

  return {
    agency: profile
      ? {
          legal_name: profile.legal_name ?? null,
          trading_name: profile.name ?? null,
          status: profile.status ?? null,
          primary_region: profile.region ?? null,
          supported_languages: agencyMeta?.supported_languages ?? null,
        }
      : null,
    branding: branding
      ? {
          logo_url: branding.logo_url ?? null,
          primary_color: branding.primary_color ?? null,
          accent_color: branding.accent_color ?? null,
          phone: branding.phone ?? null,
          website_url: branding.website_url ?? null,
          city: branding.city ?? null,
          region: branding.region ?? null,
          country: branding.country ?? null,
          branding_reviewed_at: branding.reviewed_at ?? null,
        }
      : null,
    settings:
      profile || config || branding
        ? {
            supported_languages: profile?.supported_languages ?? null,
            timezone: config?.timezone ?? null,
            working_hours: config?.working_hours ?? null,
            tone: branding?.tone ?? null,
            reply_rules: posture?.default_lane != null ? { default_lane: posture.default_lane } : null,
            human_approval_required: posture?.human_approval_required ?? config?.approve_before_sending ?? null,
            reply_handling_mode: config?.reply_handling_mode ?? null,
          }
        : null,
    email: profile ? { from_email: profile.from_email ?? null, send_proven: profile.send_proven ?? null, send_proven_at: profile.send_proven_at ?? null } : null,
    team: members
      ? {
          owners: members.filter((m) => m.role === 'owner').length,
          agents: members.filter((m) => m.role === 'agent').length,
        }
      : null,
    templates,
    properties,
    consent,
    calendar,
    whatsapp: waParsed,
    pilotStatus,
  };
}
