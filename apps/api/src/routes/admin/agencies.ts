import { Hono } from 'hono';
import { z } from 'zod';
import {
  userClient,
  handleRpc,
  readJson,
  ADMIN_GENERIC_ERROR,
} from './_shared';

/**
 * Admin → Agencies. Staff-only (gated by requireAivenaStaff). Each handler is a
 * thin proxy over a SECURITY DEFINER `admin_*` RPC called through the caller's
 * JWT (so is_aivena_staff() resolves). The RPCs own all validation and return
 * friendly `{ ok, ... }` envelopes; handleRpc maps those to HTTP responses.
 */

const route = new Hono();

const PLAN_TIERS = ['starter', 'pro', 'unlimited'] as const;

// Reserved slugs — mirror of the RPC's list, for the live check-slug endpoint.
const RESERVED_SLUGS = new Set([
  'admin','api','app','auth','account','accounts','login','logout','register',
  'signup','signin','signout','dashboard','settings','profile','system','public',
  'www','mail','root','support','help','billing','agency','agencies','new','edit',
  'delete','create','update','reset','verify','confirm','password','about','contact',
  'privacy','terms','legal','blog','careers','jobs','status','team','users','user',
  'members','member','leads','properties','lead','property','assets','staff','onboarding',
]);

const createSchema = z.object({
  slug: z
    .string()
    .min(3, 'Identifier must be at least 3 characters.')
    .max(50, 'Identifier must be 50 characters or fewer.')
    .regex(
      /^[a-z][a-z0-9-]*[a-z0-9]$/,
      'Identifier can only contain lowercase letters, numbers, and hyphens.',
    )
    .refine((s) => !s.includes('--'), 'Identifier cannot contain consecutive hyphens.'),
  trading_name: z.string().min(2, 'Trading name is required.').max(100),
  legal_name: z.string().max(200).optional(),
  cif_nif: z.string().max(40).optional(),
  primary_owner_email: z.string().email('Please enter a valid email address.'),
  primary_owner_phone: z.string().max(40).optional(),
  primary_region: z.string().max(120).optional(),
  supported_languages: z.array(z.string().min(2).max(8)).min(1).default(['en']),
  default_language: z.string().min(2).max(8).default('en'),
  plan_tier: z.enum(PLAN_TIERS).default('starter'),
  send_invitation: z.boolean().default(true),
});

// ─── GET /api/v1/admin/agencies/check-slug?slug=… — live availability ────────
// Registered before /:id so the static path wins.
route.get('/check-slug', async (c) => {
  const slug = c.req.query('slug')?.toLowerCase().trim() ?? '';
  if (slug.length < 3 || slug.length > 50) {
    return c.json({ available: false, reason: 'Identifier must be 3–50 characters.' });
  }
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    return c.json({
      available: false,
      reason: 'Identifier can only contain lowercase letters, numbers, and hyphens.',
    });
  }
  if (slug.includes('--')) {
    return c.json({ available: false, reason: 'Identifier cannot contain consecutive hyphens.' });
  }
  if (RESERVED_SLUGS.has(slug)) {
    return c.json({ available: false, reason: 'This identifier is reserved. Try a different one.' });
  }
  try {
    const supabase = userClient(c);
    const { data, error } = await supabase
      .from('agencies')
      .select('id')
      .or(`id.eq.${slug},slug.eq.${slug}`)
      .limit(1);
    if (error) {
      console.error('[admin/check-slug] query error:', error);
      return c.json({ ok: false, error: ADMIN_GENERIC_ERROR }, 500);
    }
    const taken = Array.isArray(data) && data.length > 0;
    return c.json({
      available: !taken,
      reason: taken ? 'This identifier is already in use. Try something else.' : null,
    });
  } catch (err) {
    console.error('[admin/check-slug] failed:', err);
    return c.json({ ok: false, error: ADMIN_GENERIC_ERROR }, 500);
  }
});

// ─── GET /api/v1/admin/agencies — list (optional ?status, ?search) ──────────
route.get('/', async (c) => {
  const statusRaw = c.req.query('status');
  const search = c.req.query('search')?.trim() || null;
  const status =
    statusRaw && ['active', 'paused', 'archived'].includes(statusRaw)
      ? statusRaw
      : null;
  const supabase = userClient(c);
  const rpc = await supabase.rpc('admin_list_agencies', {
    p_status: status,
    p_search: search,
  });
  return handleRpc(c, 'list', rpc);
});

// ─── POST /api/v1/admin/agencies — create ───────────────────────────────────
route.post('/', async (c) => {
  const parsed = createSchema.safeParse(await readJson(c));
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Please check the form and try again.';
    return c.json({ ok: false, error: msg }, 400);
  }
  const b = parsed.data;
  const supabase = userClient(c);
  const rpc = await supabase.rpc('admin_create_agency', {
    p_slug: b.slug,
    p_trading_name: b.trading_name,
    p_primary_owner_email: b.primary_owner_email,
    p_legal_name: b.legal_name ?? null,
    p_cif_nif: b.cif_nif ?? null,
    p_primary_owner_phone: b.primary_owner_phone ?? null,
    p_primary_region: b.primary_region ?? null,
    p_supported_languages: b.supported_languages,
    p_default_language: b.default_language,
    p_plan_tier: b.plan_tier,
    p_send_invitation: b.send_invitation,
  });
  return handleRpc(c, 'create', rpc);
});

// ─── GET /api/v1/admin/agencies/:id — detail ────────────────────────────────
route.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ ok: false, error: 'That agency could not be found.' }, 404);
  const supabase = userClient(c);
  const rpc = await supabase.rpc('admin_get_agency', { p_agency_id: id });
  return handleRpc(c, 'detail', rpc);
});

export default route;
