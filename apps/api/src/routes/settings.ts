import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { env } from '../../../../packages/config/env';

const route = new Hono();

/**
 * Role gate for agency settings WRITES.
 *
 * The settings tables are RLS-fenced on `agency_id` only (no role check), so
 * role enforcement must live here. Stricter allowlist for now (default-deny):
 * only `owner` and `aivena_staff` may mutate agency-wide config (branding, AI
 * rules, reply lanes, languages, operational behaviour). `agent`, `viewer`, and
 * any unknown/missing role are blocked until granular per-field permissions
 * exist. Reads (GET) stay open to any agency member.
 *
 * Exported for unit testing the truth table.
 */
const SETTINGS_WRITE_ROLES = new Set(['owner', 'aivena_staff']);
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function canWriteSettings(
  method: string,
  role: string | null | undefined,
): boolean {
  if (!WRITE_METHODS.has(method)) return true; // reads always allowed
  return !!role && SETTINGS_WRITE_ROLES.has(role); // writes: owner/aivena_staff only
}

// Applies to every route in this sub-app; registered before the handlers so it
// runs first. `role` is set by agencyContextMiddleware (app.current_user_role).
// A 403 here rolls back the agency-context transaction (nothing is written).
route.use('*', async (c, next) => {
  if (!canWriteSettings(c.req.method, c.get('role'))) {
    return c.json(
      { error: 'You don\'t have permission to change agency settings — ask an agency owner to make this change.' },
      403,
    );
  }
  return next();
});

/**
 * Settings — agency-scoped, lives inside the agency-context transaction
 * (RLS scoped via app.current_agency_id). The single read is dashboard_settings(0)
 * (Vega's locked contract); writes target the individual tables the contract
 * reads from. Each write must UPDATE the matching *_reviewed_at column on
 * success — that's what drives the honest "Finish setting up" checklist.
 */

// Languages allowlist — the DB CHECK constraint `supported_languages_known`
// is the source of truth. Keep these in sync with the constraint definition
// (currently 13 codes).
const SUPPORTED_LANGUAGES = new Set([
  'es', 'en', 'no', 'sv', 'da', 'de', 'nl', 'fr', 'it', 'pt', 'ru', 'pl', 'fi',
]);

// Agency-level single-language fields (translation_target_language,
// dashboard_display_language) gate on the same 13-code DB CHECK as above —
// note these use 'no' (NOT the per-user 'nb' that user_preferences uses).
const AGENCY_LANGUAGE_CODES = SUPPORTED_LANGUAGES;

// Tone allowlist — the 5 chips the mockup exposes. The DB column has no CHECK,
// so we gate on the API to prevent random strings ending up there. Existing
// values outside the 5 (e.g. "professional") render in the UI as a muted
// "Currently: X — pick one of the new options" hint with no chip selected.
const TONE_VALUES = new Set(['warm', 'formal', 'concise', 'playful', 'luxury']);

const DAY_KEYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const;

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

type Settings = Record<string, unknown>;

/**
 * GET /api/v1/settings — read the agency's full settings view.
 *
 * Wraps Vega's dashboard_settings(0) RPC. The contract doesn't yet surface
 * the 4 dashboard toggles (draft_replies_auto / auto_send_cold /
 * require_approval_hot / auto_whatsapp_recovery), so we also read
 * agency_settings.reply_rules.dashboard_toggles inside the same tx and
 * inject it under config.dashboard_toggles. Vega's existing routing keys
 * (by_source, by_channel, default_lane, by_temperature, language_overrides)
 * are NOT exposed to the UI — only the dashboard_toggles sub-key.
 */
route.get('/', async (c) => {
  const tx = c.get('tx');

  try {
    // dashboard_settings(0) is Vega's locked read contract. The v1.15 commerce
    // columns (plan_tier, the four generator/voice quotas) and the v1.14
    // agency-level language fields (translation_target_language,
    // dashboard_display_language) are NOT in that contract yet, so we read them
    // straight off agency_settings in the same agency-context tx (RLS-scoped)
    // and merge them into the response. No RPC change needed — this route runs
    // as aivena_app with app.current_agency_id set.
    const result = await tx.execute(sql`
      SELECT
        dashboard_settings(0)                AS settings,
        (SELECT row_to_json(a) FROM (
           SELECT reply_rules,
                  plan_tier,
                  voice_minutes_monthly_quota,  voice_minutes_used_this_month,
                  ad_creative_monthly_quota,    ad_creative_used_this_month,
                  social_post_monthly_quota,    social_post_used_this_month,
                  renovation_monthly_quota,     renovation_used_this_month,
                  translation_target_language,
                  dashboard_display_language
             FROM agency_settings
            WHERE agency_id = current_setting('app.current_agency_id', true)
         ) a)                                 AS agency_row
    `);
    const rows = result as unknown as Array<{
      settings: Settings | null;
      agency_row: AgencyRow | null;
    }>;
    const settings = rows[0]?.settings ?? null;
    if (!settings) {
      return c.json({ error: 'Failed to load settings' }, 500);
    }
    const agencyRow = rows[0]?.agency_row ?? null;

    const toggles = readDashboardToggles(agencyRow?.reply_rules ?? null);
    const config = (settings.config && typeof settings.config === 'object')
      ? (settings.config as Record<string, unknown>)
      : {};
    config.dashboard_toggles = toggles;
    settings.config = config;

    // v1.15 plan + quota block. null quota = unlimited (the tier convention).
    settings.plan_tier = agencyRow?.plan_tier ?? 'starter';
    settings.quotas = {
      voiceMinutes: quotaPair(agencyRow?.voice_minutes_monthly_quota, agencyRow?.voice_minutes_used_this_month),
      adCreative: quotaPair(agencyRow?.ad_creative_monthly_quota, agencyRow?.ad_creative_used_this_month),
      socialPost: quotaPair(agencyRow?.social_post_monthly_quota, agencyRow?.social_post_used_this_month),
      renovation: quotaPair(agencyRow?.renovation_monthly_quota, agencyRow?.renovation_used_this_month),
    };
    // v1.14 agency-level language fields.
    settings.translation_target_language = agencyRow?.translation_target_language ?? 'en';
    settings.dashboard_display_language = agencyRow?.dashboard_display_language ?? 'en';

    // Reply-routing lanes for the AI-rules controls (default_lane +
    // by_temperature + the by_channel/by_action override keys). Read straight
    // off reply_rules so the UI reflects what the send pipeline actually uses.
    const rr = (agencyRow?.reply_rules ?? {}) as Record<string, unknown>;
    settings.reply_lanes = {
      default_lane: typeof rr.default_lane === 'string' ? rr.default_lane : 'review_first',
      by_temperature: rr.by_temperature && typeof rr.by_temperature === 'object' ? rr.by_temperature : {},
      by_channel: rr.by_channel && typeof rr.by_channel === 'object' ? rr.by_channel : {},
      by_action: rr.by_action && typeof rr.by_action === 'object' ? rr.by_action : {},
    };

    return c.json(settings);
  } catch (err) {
    console.error('[/api/v1/settings] RPC failed:', err);
    return c.json({ error: 'Failed to load settings' }, 500);
  }
});

type AgencyRow = {
  reply_rules: Record<string, unknown> | null;
  plan_tier: string | null;
  voice_minutes_monthly_quota: number | null;
  voice_minutes_used_this_month: number | null;
  ad_creative_monthly_quota: number | null;
  ad_creative_used_this_month: number | null;
  social_post_monthly_quota: number | null;
  social_post_used_this_month: number | null;
  renovation_monthly_quota: number | null;
  renovation_used_this_month: number | null;
  translation_target_language: string | null;
  dashboard_display_language: string | null;
};

// Quota shape: `quota === null` means unlimited (tier='unlimited' or an
// un-provisioned cap). `used` always coerces to a number so the UI bar maths
// never divides by NaN.
function quotaPair(
  quota: number | null | undefined,
  used: number | null | undefined,
): { quota: number | null; used: number } {
  return {
    quota: typeof quota === 'number' ? quota : null,
    used: typeof used === 'number' ? used : 0,
  };
}

function readDashboardToggles(
  replyRules: Record<string, unknown> | null,
): Record<string, boolean> {
  const fallback = {
    draft_replies_auto: false,
    auto_send_cold: false,
    require_approval_hot: false,
    auto_whatsapp_recovery: false,
  };
  if (!replyRules || typeof replyRules !== 'object') return fallback;
  const raw = (replyRules as Record<string, unknown>).dashboard_toggles;
  if (!raw || typeof raw !== 'object') return fallback;
  const t = raw as Record<string, unknown>;
  return {
    draft_replies_auto: Boolean(t.draft_replies_auto),
    auto_send_cold: Boolean(t.auto_send_cold),
    require_approval_hot: Boolean(t.require_approval_hot),
    auto_whatsapp_recovery: Boolean(t.auto_whatsapp_recovery),
  };
}

/**
 * POST /api/v1/settings/branding — editable branding fields.
 *
 * Writes brand_name / primary_color / email_signature_name /
 * email_signature_role / tone / brand_voice. Sets branding_reviewed_at = now()
 * in the same tx — that's the checklist contract.
 */
route.post('/branding', async (c) => {
  const tx = c.get('tx');
  const body = await readJson(c);

  const brandName = trimOrNull(body.brand_name);
  if (!brandName) {
    return c.json({ error: 'Agency name is required.' }, 400);
  }
  const primaryColor = typeof body.primary_color === 'string' ? body.primary_color : '';
  if (!HEX_RE.test(primaryColor)) {
    return c.json({ error: 'Brand colour must be a hex value like #1FE874.' }, 400);
  }

  const signatureName = trimOrNull(body.email_signature_name) ?? '';
  const signatureRole = trimOrNull(body.email_signature_role) ?? '';

  const tone = typeof body.tone === 'string' ? body.tone : '';
  if (tone && !TONE_VALUES.has(tone)) {
    return c.json({ error: 'Choose a tone from the available options.' }, 400);
  }
  const brandVoice = typeof body.brand_voice === 'string' ? body.brand_voice : '';

  try {
    const result = await tx.execute(sql`
      UPDATE agency_branding
         SET brand_name           = ${brandName},
             primary_color        = ${primaryColor},
             email_signature_name = ${signatureName},
             email_signature_role = ${signatureRole},
             tone                 = ${tone || null},
             brand_voice          = ${brandVoice},
             branding_reviewed_at = now(),
             updated_at           = now()
       WHERE agency_id = current_setting('app.current_agency_id', true)
       RETURNING agency_id
    `);
    const rows = result as unknown as Array<{ agency_id: string }>;
    if (rows.length === 0) {
      return c.json({ error: 'Branding row not found for this agency.' }, 404);
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error('[/api/v1/settings/branding] write failed:', err);
    return c.json({ error: 'Couldn\'t save branding. Please try again — if it keeps happening, contact support.' }, 500);
  }
});

/**
 * POST /api/v1/settings/identity — writes only reply_to. The sending domain
 * and from_email are hard read-only; we reject any attempt to write them so
 * a stray UI bug never silently mutates production routing.
 */
route.post('/identity', async (c) => {
  const tx = c.get('tx');
  const body = await readJson(c);

  if (body.from_email !== undefined || body.sending_domain !== undefined) {
    return c.json(
      { error: 'Sending domain and from-email are read-only — contact support to change them.' },
      400,
    );
  }

  const replyTo = trimOrNull(body.reply_to);
  if (!replyTo || !EMAIL_RE.test(replyTo)) {
    return c.json({ error: 'Reply-to must be a valid email address.' }, 400);
  }

  try {
    const result = await tx.execute(sql`
      UPDATE agency_email_config
         SET reply_to   = ${replyTo},
             updated_at = now()
       WHERE agency_id = current_setting('app.current_agency_id', true)
       RETURNING agency_id
    `);
    const rows = result as unknown as Array<{ agency_id: string }>;
    if (rows.length === 0) {
      return c.json({ error: 'Email config not found for this agency.' }, 404);
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error('[/api/v1/settings/identity] write failed:', err);
    return c.json({ error: 'Couldn\'t save reply-to. Please try again — if it keeps happening, contact support.' }, 500);
  }
});

/**
 * POST /api/v1/settings/working-hours — writes the full 7-day shape.
 *
 * Partial writes are rejected. W3's nextOpen() falls back to a hardcoded
 * Mon-Fri 9-18 for any missing day key, so a partial write silently masks
 * the unedited days. We require all 7 keys, every save.
 */
route.post('/working-hours', async (c) => {
  const tx = c.get('tx');
  const body = await readJson(c);

  const tz = trimOrNull(body.timezone);
  if (!tz) {
    return c.json({ error: 'A timezone is required.' }, 400);
  }

  const wh = body.working_hours;
  if (!wh || typeof wh !== 'object' || Array.isArray(wh)) {
    return c.json({ error: 'Working hours payload missing.' }, 400);
  }
  const whObj = wh as Record<string, unknown>;
  for (const day of DAY_KEYS) {
    const slot = whObj[day];
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) {
      return c.json({ error: `Working hours must include all 7 days (missing ${day}).` }, 400);
    }
    const s = slot as Record<string, unknown>;
    if (typeof s.enabled !== 'boolean') {
      return c.json({ error: `Working hours for ${day} must have an enabled flag.` }, 400);
    }
    if (typeof s.start !== 'string' || !TIME_RE.test(s.start)) {
      return c.json({ error: `Working hours for ${day} need a valid start time (HH:MM).` }, 400);
    }
    if (typeof s.end !== 'string' || !TIME_RE.test(s.end)) {
      return c.json({ error: `Working hours for ${day} need a valid end time (HH:MM).` }, 400);
    }
  }
  // The dashboard_settings RPC echoes `timezone` inside the working_hours
  // jsonb too. Make sure both copies agree.
  whObj.timezone = tz;

  try {
    const result = await tx.execute(sql`
      UPDATE agency_settings
         SET working_hours = ${JSON.stringify(whObj)}::jsonb,
             timezone      = ${tz},
             updated_at    = now()
       WHERE agency_id = current_setting('app.current_agency_id', true)
       RETURNING agency_id
    `);
    const rows = result as unknown as Array<{ agency_id: string }>;
    if (rows.length === 0) {
      return c.json({ error: 'Settings row not found for this agency.' }, 404);
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error('[/api/v1/settings/working-hours] write failed:', err);
    return c.json({ error: 'Couldn\'t save quiet hours. Please try again — if it keeps happening, contact support.' }, 500);
  }
});

/**
 * POST /api/v1/settings/ai-rules — writes the 4 dashboard toggles under
 * reply_rules.dashboard_toggles via a partial jsonb_set (Vega's routing
 * config under by_source/by_channel/default_lane/by_temperature/
 * language_overrides MUST remain untouched).
 *
 * Sets reply_rules_reviewed_at = now() on every save (mirrors the
 * branding_reviewed_at contract — the checklist flips on first save).
 */
route.post('/ai-rules', async (c) => {
  const tx = c.get('tx');
  const body = await readJson(c);

  const toggles = {
    draft_replies_auto: Boolean(body.draft_replies_auto),
    auto_send_cold: Boolean(body.auto_send_cold),
    require_approval_hot: Boolean(body.require_approval_hot),
    auto_whatsapp_recovery: Boolean(body.auto_whatsapp_recovery),
  };

  try {
    const result = await tx.execute(sql`
      UPDATE agency_settings
         SET reply_rules = jsonb_set(
                            COALESCE(reply_rules, '{}'::jsonb),
                            '{dashboard_toggles}',
                            ${JSON.stringify(toggles)}::jsonb,
                            true
                          ),
             reply_rules_reviewed_at = now(),
             updated_at              = now()
       WHERE agency_id = current_setting('app.current_agency_id', true)
       RETURNING agency_id
    `);
    const rows = result as unknown as Array<{ agency_id: string }>;
    if (rows.length === 0) {
      return c.json({ error: 'Settings row not found for this agency.' }, 404);
    }
    return c.json({ ok: true, dashboard_toggles: toggles });
  } catch (err) {
    console.error('[/api/v1/settings/ai-rules] write failed:', err);
    return c.json({ error: 'Couldn\'t save AI rules. Please try again — if it keeps happening, contact support.' }, 500);
  }
});

/**
 * POST /api/v1/settings/reply-lanes — the redesigned AI-rules controls.
 *
 * Body: { level: 'none'|'cold'|'cold_warm'|'all',
 *         overrides: { scheduling, followup, email, whatsapp } (booleans) }
 *
 * Writes the REAL routing keys in agency_settings.reply_rules:
 *   level     → default_lane + by_temperature.{cold,warm,hot,super_hot}
 *   overrides → ON = review_first under by_action.{scheduling,followup} /
 *               by_channel.{email,whatsapp}; OFF removes the key entirely so
 *               it forces nothing. An override always beats the level
 *               (review_first wins) — Vega's resolver must honour by_action.
 * Other reply_rules keys (by_source, voice_recovery, dashboard_toggles,
 * language_overrides) are preserved untouched.
 */
route.post('/reply-lanes', async (c) => {
  const tx = c.get('tx');
  const body = await readJson(c);

  const level = typeof body.level === 'string' ? body.level : '';
  const LEVELS: Record<string, { lane: string; temps: Record<string, string> }> = {
    none: { lane: 'review_first', temps: { cold: 'review_first', warm: 'review_first', hot: 'review_first', super_hot: 'review_first' } },
    cold: { lane: 'review_first', temps: { cold: 'auto_send', warm: 'review_first', hot: 'review_first', super_hot: 'review_first' } },
    cold_warm: { lane: 'review_first', temps: { cold: 'auto_send', warm: 'auto_send', hot: 'review_first', super_hot: 'review_first' } },
    all: { lane: 'auto_send', temps: { cold: 'auto_send', warm: 'auto_send', hot: 'auto_send', super_hot: 'auto_send' } },
  };
  const picked = LEVELS[level];
  if (!picked) {
    return c.json({ error: 'Choose an automation level from the available options.' }, 400);
  }

  const o = (body.overrides && typeof body.overrides === 'object' ? body.overrides : {}) as Record<string, unknown>;
  const byAction: Record<string, string> = {};
  if (o.scheduling === true) byAction.scheduling = 'review_first';
  if (o.followup === true) byAction.followup = 'review_first';
  const channelAdd: Record<string, string> = {};
  if (o.email === true) channelAdd.email = 'review_first';
  if (o.whatsapp === true) channelAdd.whatsapp = 'review_first';

  try {
    const result = await tx.execute(sql`
      UPDATE agency_settings
         SET reply_rules = jsonb_set(
                             jsonb_set(
                               jsonb_set(
                                 jsonb_set(
                                   COALESCE(reply_rules, '{}'::jsonb),
                                   '{default_lane}', to_jsonb(${picked.lane}::text), true),
                                 '{by_temperature}', ${JSON.stringify(picked.temps)}::jsonb, true),
                               '{by_action}', ${JSON.stringify(byAction)}::jsonb, true),
                             '{by_channel}',
                             (COALESCE(reply_rules->'by_channel', '{}'::jsonb) - 'email' - 'whatsapp')
                               || ${JSON.stringify(channelAdd)}::jsonb,
                             true),
             reply_rules_reviewed_at = now(),
             updated_at              = now()
       WHERE agency_id = current_setting('app.current_agency_id', true)
       RETURNING reply_rules
    `);
    const rows = result as unknown as Array<{ reply_rules: Record<string, unknown> }>;
    if (rows.length === 0) {
      return c.json({ error: 'Settings row not found for this agency.' }, 404);
    }
    const rr = rows[0].reply_rules ?? {};
    return c.json({
      ok: true,
      reply_lanes: {
        default_lane: rr.default_lane,
        by_temperature: rr.by_temperature ?? {},
        by_channel: rr.by_channel ?? {},
        by_action: rr.by_action ?? {},
      },
    });
  } catch (err) {
    console.error('[/api/v1/settings/reply-lanes] write failed:', err);
    return c.json({ error: 'Couldn\'t save AI rules. Please try again — if it keeps happening, contact support.' }, 500);
  }
});

/**
 * POST /api/v1/settings/languages — writes the supported_languages array.
 *
 * Validates against the DB CHECK constraint allowlist (13 codes), and
 * requires ≥1 language. The UI's per-chip-× already prevents the empty case;
 * we still gate at the API for defence-in-depth.
 */
route.post('/languages', async (c) => {
  const tx = c.get('tx');
  const body = await readJson(c);

  const langs = body.supported_languages;
  if (!Array.isArray(langs) || langs.length === 0) {
    return c.json({ error: 'At least one language is required.' }, 400);
  }
  const normalised: string[] = [];
  for (const code of langs) {
    if (typeof code !== 'string' || !SUPPORTED_LANGUAGES.has(code)) {
      return c.json({ error: 'One of the languages is not supported.' }, 400);
    }
    if (!normalised.includes(code)) normalised.push(code);
  }

  try {
    const result = await tx.execute(sql`
      UPDATE agency_settings
         SET supported_languages = ${normalised}::text[],
             updated_at          = now()
       WHERE agency_id = current_setting('app.current_agency_id', true)
       RETURNING agency_id
    `);
    const rows = result as unknown as Array<{ agency_id: string }>;
    if (rows.length === 0) {
      return c.json({ error: 'Settings row not found for this agency.' }, 404);
    }
    return c.json({ ok: true, supported_languages: normalised });
  } catch (err) {
    console.error('[/api/v1/settings/languages] write failed:', err);
    return c.json({ error: 'Couldn\'t save languages. Please try again — if it keeps happening, contact support.' }, 500);
  }
});

/**
 * POST /api/v1/settings/agency-languages — writes the two agency-level
 * single-language fields (v1.14.4 / v1.14.5):
 *   - translation_target_language: what inbound messages + AI drafts are
 *     translated INTO for the whole agency (Vega's auto-fill backend reads this).
 *   - dashboard_display_language: the per-agency DEFAULT dashboard language a
 *     new team member inherits before they set a personal preference.
 *
 * Both gate on the 13-code DB CHECK (using 'no', not the per-user 'nb'). This
 * is SEPARATE from /api/v1/me/preferences, which owns the caller's PERSONAL
 * ui_language (user_preferences) — that control is untouched. Accepts either
 * field independently; at least one must be present.
 */
route.post('/agency-languages', async (c) => {
  const tx = c.get('tx');
  const body = await readJson(c);

  const target = body.translation_target_language;
  const display = body.dashboard_display_language;

  const hasTarget = target !== undefined;
  const hasDisplay = display !== undefined;
  if (!hasTarget && !hasDisplay) {
    return c.json({ error: 'Nothing to update.' }, 400);
  }
  if (hasTarget && (typeof target !== 'string' || !AGENCY_LANGUAGE_CODES.has(target))) {
    return c.json({ error: 'That translation language isn\'t supported.' }, 400);
  }
  if (hasDisplay && (typeof display !== 'string' || !AGENCY_LANGUAGE_CODES.has(display))) {
    return c.json({ error: 'That dashboard language isn\'t supported.' }, 400);
  }

  try {
    // Build the SET list from only the provided fields. COALESCE-free because
    // each branch is an explicit literal; the un-provided field keeps its value.
    const result = await tx.execute(sql`
      UPDATE agency_settings
         SET translation_target_language = ${hasTarget ? (target as string) : sql`translation_target_language`},
             dashboard_display_language  = ${hasDisplay ? (display as string) : sql`dashboard_display_language`},
             updated_at                  = now()
       WHERE agency_id = current_setting('app.current_agency_id', true)
       RETURNING translation_target_language, dashboard_display_language
    `);
    const rows = result as unknown as Array<{
      translation_target_language: string;
      dashboard_display_language: string;
    }>;
    if (rows.length === 0) {
      return c.json({ error: 'Settings row not found for this agency.' }, 404);
    }
    return c.json({
      ok: true,
      translation_target_language: rows[0].translation_target_language,
      dashboard_display_language: rows[0].dashboard_display_language,
    });
  } catch (err) {
    console.error('[/api/v1/settings/agency-languages] write failed:', err);
    return c.json({ error: 'Couldn\'t save language settings. Please try again — if it keeps happening, contact support.' }, 500);
  }
});

/**
 * POST /api/v1/settings/logo — wraps Vega's upload-agency-logo Edge Function.
 *
 * Forwards the base64 payload along with the caller's JWT so the Edge
 * Function enforces its own role-check (only owners can upload). On 200,
 * refetches dashboard_settings() and returns the refreshed branding block —
 * the UI swaps the placeholder for the new logo without a full reload.
 */
const LOGO_ERROR_MAP: Record<string, string> = {
  file_too_large: 'That file is over 2 MB — please choose a smaller PNG or JPG.',
  unsupported_image_type: 'Logos must be PNG or JPG.',
  magic_bytes_mismatch: 'That file doesn\'t look like a real PNG or JPG.',
  role_not_owner: 'Only the agency owner can change the logo.',
  missing_token: 'Sign in again to upload a logo.',
  invalid_token: 'Sign in again to upload a logo.',
};

route.post('/logo', async (c) => {
  const tx = c.get('tx');
  // agency_id is sourced from the authed session (set by agencyContextMiddleware),
  // NEVER from the client. The Edge Function REQUIRES it in the body and
  // independently re-verifies the caller is owner of this agency.
  const agencyId = c.get('agencyId');
  const authHeader = c.req.header('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Sign in again to upload a logo.' }, 401);
  }
  if (!agencyId) {
    return c.json({ error: 'Sign in again to upload a logo.' }, 401);
  }

  const body = await readJson(c);
  const filename = typeof body.filename === 'string' ? body.filename : null;
  const contentType = typeof body.content_type === 'string' ? body.content_type : null;
  const contentBase64 = typeof body.content_base64 === 'string' ? body.content_base64 : null;
  if (!filename || !contentType || !contentBase64) {
    return c.json({ error: 'Logo upload payload is missing fields.' }, 400);
  }

  let edgeResponseStatus = 0;
  let edgeBody: unknown = null;
  try {
    const edgeUrl = `${env.SUPABASE_URL.replace(/\/$/, '')}/functions/v1/upload-agency-logo`;
    const edgeRes = await fetch(edgeUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Forwarding agency_id is the fix: omitting it made the EF return
        // `missing_fields` (400), which the proxy surfaced as the generic
        // "Logo upload failed" error while logo_url stayed null.
        agency_id: agencyId,
        filename,
        content_type: contentType,
        content_base64: contentBase64,
      }),
    });
    edgeResponseStatus = edgeRes.status;
    const text = await edgeRes.text();
    edgeBody = text ? safeParseJson(text) : null;
  } catch (err) {
    console.error('[/api/v1/settings/logo] edge fn fetch failed:', err);
    return c.json({ error: 'Logo upload failed — please try again.' }, 500);
  }

  if (edgeResponseStatus < 200 || edgeResponseStatus >= 300) {
    const code = (edgeBody && typeof edgeBody === 'object' && 'error' in edgeBody)
      ? String((edgeBody as { error: unknown }).error)
      : '';
    const friendly = LOGO_ERROR_MAP[code]
      ?? 'Logo upload failed — please try again, or contact support if it keeps happening.';
    console.error(`[/api/v1/settings/logo] edge fn rejected (${edgeResponseStatus}):`, edgeBody);
    return c.json({ error: friendly }, edgeResponseStatus === 401 ? 401 : 400);
  }

  // Refetch branding so the UI can swap the placeholder.
  try {
    const result = await tx.execute(sql`
      SELECT dashboard_settings(0) -> 'branding' AS branding
    `);
    const rows = result as unknown as Array<{ branding: Record<string, unknown> | null }>;
    return c.json({ ok: true, branding: rows[0]?.branding ?? null });
  } catch (err) {
    console.error('[/api/v1/settings/logo] post-upload refetch failed:', err);
    // The upload itself succeeded; return ok so the UI doesn't show an error
    // for a partially-successful flow. The next page load will reflect it.
    return c.json({ ok: true, branding: null });
  }
});

// ---------- helpers ----------

async function readJson(c: import('hono').Context): Promise<Record<string, unknown>> {
  try {
    const raw = await c.req.json();
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

function trimOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeParseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

export default route;
