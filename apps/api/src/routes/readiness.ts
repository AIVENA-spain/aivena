import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../../../packages/db/client';
import { WhatsAppReadinessSchema } from './whatsapp';
import {
  computeReadiness,
  type ReadinessSignals,
  type WhatsAppSignal,
} from '../lib/readiness/compute';

const route = new Hono();

/**
 * Read gate for go-live readiness. Unlike settings' canWriteSettings (which gates
 * WRITES and lets every GET through), readiness is owner/aivena_staff even for GET:
 * the go-live picture is sensitive and admin-facing, so it is method-agnostic.
 * Exported for unit testing the truth table.
 */
const READINESS_READ_ROLES = new Set(['owner', 'aivena_staff']);

export function canReadReadiness(role: string | null | undefined): boolean {
  return !!role && READINESS_READ_ROLES.has(role);
}

route.use('*', async (c, next) => {
  if (!canReadReadiness(c.get('role'))) {
    return c.json(
      { error: "You don't have permission to view go-live readiness — ask an agency owner." },
      403,
    );
  }
  return next();
});

/**
 * Run a single signal query inside its OWN savepoint. The whole request runs in
 * one agency-context transaction, so a single failing statement (e.g. the
 * WhatsApp readiness RPC before Chat 3 deploys Phase 1c) would otherwise abort
 * EVERYTHING. The savepoint isolates the failure: that one signal degrades to
 * `fallback` (→ honest `unavailable`) and the rest of the request continues.
 */
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

// Loosely-typed view of the dashboard_settings(0) jsonb (only the fields we read).
type DashboardSettings = {
  profile?: {
    legal_name?: string | null;
    name?: string | null;
    status?: string | null;
    region?: string | null;
    supported_languages?: string[] | null;
    from_email?: string | null;
    domain_verified?: boolean | null;
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

const asJson = (raw: unknown): unknown =>
  typeof raw === 'string' ? JSON.parse(raw) : raw;

/**
 * GET /api/v1/readiness — read-only, agency-scoped (RLS GUC = agencies.id, never
 * the slug). Computes per-item + per-provider + per-gate status + go-live
 * eligibility from LIVE signals only. No write, no migration, no provider write.
 * WhatsApp is consumed from Chat 3's RPC and degrades honestly when undeployed.
 */
route.get('/', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');

  // Block 1 — the rich identity/branding/config/team block from Vega's canonical
  // SECURITY DEFINER contract (the same source /settings uses; proven readable).
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

  const agencyLangs = await safe<string[] | null>(
    tx,
    async (sp) => {
      const r = await sp.execute(
        sql`SELECT supported_languages FROM public.agencies WHERE id = ${AGENCY_GUC}`,
      );
      return rows<{ supported_languages: string[] | null }>(r)[0]?.supported_languages ?? null;
    },
    null,
  );

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

  // Block 3 — WhatsApp readiness: CONSUMED from Chat 3's RPC (not re-derived).
  // The RPC may not be deployed yet (Phase 1c) → savepoint isolates the failure
  // and we degrade to null → the model reports WhatsApp as "unavailable", never faked.
  const waParsed = await safe<WhatsAppSignal | null>(
    tx,
    async (sp) => {
      const r = await sp.execute(
        sql`SELECT public.get_whatsapp_provider_readiness() AS readiness`,
      );
      const parsed = WhatsAppReadinessSchema.safeParse(asJson(rows<{ readiness: unknown }>(r)[0]?.readiness));
      if (!parsed.success) return null; // ok:false envelopes (context unset / not found) degrade too
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

  // Assemble signals (agencies.id internally, never the slug).
  const profile = ds?.profile ?? null;
  const branding = ds?.branding ?? null;
  const config = ds?.config ?? null;
  const members = ds?.team?.members ?? null;

  const signals: ReadinessSignals = {
    agency: profile
      ? {
          legal_name: profile.legal_name ?? null,
          trading_name: profile.name ?? null,
          status: profile.status ?? null,
          primary_region: profile.region ?? null,
          supported_languages: agencyLangs,
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
            human_approval_required:
              posture?.human_approval_required ?? config?.approve_before_sending ?? null,
            reply_handling_mode: config?.reply_handling_mode ?? null,
          }
        : null,
    email: profile
      ? { from_email: profile.from_email ?? null, domain_verified: profile.domain_verified ?? null }
      : null,
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
  };

  const result = computeReadiness(agencyId, signals);
  return c.json({ computedAt: new Date().toISOString(), ...result });
});

export default route;
