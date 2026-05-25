import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../../../../packages/config/env';

/**
 * Service-role Supabase client.
 *
 * Bypasses RLS — used at the API gateway for cross-tenant lookups that must
 * happen BEFORE we know which agency context to set (specifically, looking up
 * which agencies a freshly-authenticated user belongs to).
 *
 * Never expose this client to handler code; per-request queries should go
 * through `c.get('tx')` so RLS scopes them to the active agency.
 */
export const supabaseAdmin: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

export type AgencyRow = {
  id: string;
  slug: string | null;
  trading_name: string | null;
  legal_name: string | null;
  status: string;
  primary_region: string | null;
  supported_languages: string[] | null;
};

export type MembershipRow = {
  agency_id: string;
  role: string;
  is_default: boolean;
  agencies: AgencyRow | null;
};

type RawUserAgencyRow = {
  agency_id: string;
  role: string;
  is_default: boolean;
};

/**
 * Two-step explicit query — we never rely on PostgREST's embedded join between
 * user_agencies and agencies. PostgREST's schema cache for FK relationships is
 * fragile (it goes cold after DDL, project pause/resume, or simply when the FK
 * was never declared in the live schema) and produces a hard 4xx "Could not
 * find a relationship ... in the schema cache" the moment it's not present.
 * Stitching in code is one extra round-trip and zero magic.
 */
export async function listMembershipsForUser(
  userId: string,
): Promise<MembershipRow[]> {
  // Step 1 — the user's membership rows.
  const ua = await supabaseAdmin
    .from('user_agencies')
    .select('agency_id, role, is_default')
    .eq('user_id', userId);

  if (ua.error) {
    throw new Error(`Failed to load memberships: ${ua.error.message}`);
  }
  const rows = (ua.data ?? []) as RawUserAgencyRow[];
  if (rows.length === 0) return [];

  // Step 2 — the agencies those memberships point at.
  const agencyIds = Array.from(new Set(rows.map((r) => r.agency_id)));
  const ag = await supabaseAdmin
    .from('agencies')
    .select(
      'id, slug, trading_name, legal_name, status, primary_region, supported_languages',
    )
    .in('id', agencyIds);

  if (ag.error) {
    throw new Error(`Failed to load agencies: ${ag.error.message}`);
  }
  const agencyById = new Map<string, AgencyRow>(
    ((ag.data ?? []) as AgencyRow[]).map((a) => [a.id, a]),
  );

  return rows.map((r) => ({
    agency_id: r.agency_id,
    role: r.role,
    is_default: Boolean(r.is_default),
    agencies: agencyById.get(r.agency_id) ?? null,
  }));
}
