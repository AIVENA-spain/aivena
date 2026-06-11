import { Hono } from 'hono';
import {
  listMembershipsForUser,
  supabaseAdmin,
} from '../lib/supabase-admin';

const route = new Hono();

const SUPPORTED_LANGUAGES = new Set([
  'en',
  'es',
  'pl',
  'nb',
  'fr',
  'nl',
  'de',
  'ru',
  'sv',
  'it',
]);
const SUPPORTED_THEMES = new Set(['light', 'dark', 'system']);

const DEFAULT_PREFERENCES = {
  uiLanguage: 'en',
  messageLanguage: 'en',
  theme: 'system',
};

type PreferencesRow = {
  user_id: string;
  ui_language: string;
  message_language: string;
  theme: string;
  created_at: string;
  updated_at: string;
};

function displayName(
  agency: {
    id: string;
    slug: string | null;
    trading_name: string | null;
    legal_name: string | null;
  } | null,
  fallbackId: string,
): string {
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

/**
 * GET /api/v1/me/preferences — read the caller's own user_preferences row.
 *
 * Self-data flow: we never expose user_preferences to the browser via a
 * client-side Supabase query. The verified token's `sub` is the only thing
 * that selects a row. supabaseAdmin (service role) bypasses RLS at this one
 * guarded door, scoped by user_id = sub.
 */
route.get('/preferences', async (c) => {
  const user = c.get('user');

  const { data, error } = await supabaseAdmin
    .from('user_preferences')
    .select('user_id, ui_language, message_language, theme, created_at, updated_at')
    .eq('user_id', user.sub)
    .maybeSingle();

  if (error) {
    console.error('[me/preferences] load failed:', error.message);
    return c.json(
      { error: 'Something went wrong — please refresh, and contact support if it persists.' },
      500,
    );
  }

  const row = (data ?? null) as PreferencesRow | null;
  return c.json({
    uiLanguage: row?.ui_language ?? DEFAULT_PREFERENCES.uiLanguage,
    messageLanguage: row?.message_language ?? DEFAULT_PREFERENCES.messageLanguage,
    theme: row?.theme ?? DEFAULT_PREFERENCES.theme,
  });
});

/**
 * PATCH /api/v1/me/preferences — partial update of the caller's own row.
 *
 * Accepts any subset of { uiLanguage, messageLanguage, theme }. Each provided
 * value is validated against the same CHECK constraints the DB enforces, so
 * the API rejects bad input with 400 instead of relying on a DB error message
 * leaking out as 500. Upserts so callers who somehow never got the auto-row
 * still end up with a valid row.
 */
route.patch('/preferences', async (c) => {
  const user = c.get('user');

  let body: {
    uiLanguage?: unknown;
    messageLanguage?: unknown;
    theme?: unknown;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const update: Record<string, string> = {};

  if (body.uiLanguage !== undefined) {
    if (
      typeof body.uiLanguage !== 'string' ||
      !SUPPORTED_LANGUAGES.has(body.uiLanguage)
    ) {
      return c.json({ error: 'Unsupported uiLanguage' }, 400);
    }
    update.ui_language = body.uiLanguage;
  }
  if (body.messageLanguage !== undefined) {
    if (
      typeof body.messageLanguage !== 'string' ||
      !SUPPORTED_LANGUAGES.has(body.messageLanguage)
    ) {
      return c.json({ error: 'Unsupported messageLanguage' }, 400);
    }
    update.message_language = body.messageLanguage;
  }
  if (body.theme !== undefined) {
    if (typeof body.theme !== 'string' || !SUPPORTED_THEMES.has(body.theme)) {
      return c.json({ error: 'Unsupported theme' }, 400);
    }
    update.theme = body.theme;
  }

  if (Object.keys(update).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400);
  }

  // Upsert keyed on user_id so callers without an auto-created row still end
  // up with one. Includes user_id so an INSERT on a missing row has the PK.
  const { data, error } = await supabaseAdmin
    .from('user_preferences')
    .upsert(
      { user_id: user.sub, ...update },
      { onConflict: 'user_id' },
    )
    .select('user_id, ui_language, message_language, theme, created_at, updated_at')
    .single();

  if (error) {
    console.error('[me/preferences] save failed:', error.message);
    return c.json(
      { error: 'Something went wrong — please try again, and contact support if it persists.' },
      500,
    );
  }
  const row = data as PreferencesRow;

  return c.json({
    uiLanguage: row.ui_language,
    messageLanguage: row.message_language,
    theme: row.theme,
  });
});

export default route;
