import { Hono } from 'hono';
import { listMembershipsForUser } from '../lib/supabase-admin';

const route = new Hono();

function displayName(agency: {
  id: string;
  slug: string | null;
  trading_name: string | null;
  legal_name: string | null;
} | null, fallbackId: string): string {
  if (!agency) return fallbackId;
  return agency.trading_name || agency.legal_name || agency.slug || agency.id;
}

route.get('/', async (c) => {
  const user = c.get('user');
  const agencyId = c.get('agencyId');
  const role = c.get('role');

  const memberships = await listMembershipsForUser(user.sub);
  const isAivenaStaff = memberships.some((m) => m.role === 'aivena_staff');

  const activeRow = memberships.find((m) => m.agency_id === agencyId) ?? null;
  const activeAgency = activeRow
    ? {
        agencyId: activeRow.agency_id,
        role,
        displayName: displayName(activeRow.agencies, activeRow.agency_id),
        status: activeRow.agencies?.status ?? 'unknown',
        region: activeRow.agencies?.primary_region ?? null,
        languages: activeRow.agencies?.supported_languages ?? [],
      }
    : null;

  return c.json({
    userId: user.sub,
    email: user.email,
    isAivenaStaff,
    activeAgency,
    agencies: memberships.map((m) => ({
      agencyId: m.agency_id,
      role: m.role,
      isDefault: Boolean(m.is_default),
      displayName: displayName(m.agencies, m.agency_id),
    })),
  });
});

export default route;
