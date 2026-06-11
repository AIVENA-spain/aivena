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
 * Short-TTL in-memory cache for memberships. This lookup runs on EVERY
 * agency-scoped API request and costs a full PostgREST round-trip (the DB is
 * cross-region from this box, so that's ~150-300ms per request). Memberships
 * change rarely (invites accepted, roles changed, default-agency flips), so a
 * 60s TTL trades at most a one-minute propagation delay for a round-trip
 * saved on nearly every request.
 */
const MEMBERSHIP_TTL_MS = 60_000;
const membershipCache = new Map<
  string,
  { at: number; rows: MembershipRow[] }
>();

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
  const hit = membershipCache.get(userId);
  if (hit && Date.now() - hit.at < MEMBERSHIP_TTL_MS) {
    return hit.rows;
  }
  const rows = await fetchMembershipsForUser(userId);
  membershipCache.set(userId, { at: Date.now(), rows });
  return rows;
}

async function fetchMembershipsForUser(
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
