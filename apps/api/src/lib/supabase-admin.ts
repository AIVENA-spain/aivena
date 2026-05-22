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

export type MembershipRow = {
  agency_id: string;
  role: string;
  is_default: boolean;
  agencies: {
    id: string;
    slug: string | null;
    trading_name: string | null;
    legal_name: string | null;
    status: string;
    primary_region: string | null;
    supported_languages: string[] | null;
  } | null;
};

export async function listMembershipsForUser(
  userId: string,
): Promise<MembershipRow[]> {
  const { data, error } = await supabaseAdmin
    .from('user_agencies')
    .select(
      'agency_id, role, is_default, agencies ( id, slug, trading_name, legal_name, status, primary_region, supported_languages )',
    )
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to load memberships: ${error.message}`);
  return (data ?? []) as unknown as MembershipRow[];
}
