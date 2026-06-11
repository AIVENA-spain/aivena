import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { env } from '../../../../packages/config/env';

/**
 * Image generation (W13) — agency-scoped, runs under authMiddleware +
 * agencyContextMiddleware (so `c.get('tx')` is RLS-fenced to the agency and
 * `c.get('agencyId')` is set).
 *
 * Create goes through the image-generate-create Edge Function (never the
 * browser): the EF needs a server-only internal secret and enforces quota.
 * Reads come straight off `image_generations` via the agency-fenced tx
 * (policy: agency_id = current_setting('app.current_agency_id')).
 */

const route = new Hono();

const TYPES = ['ad_creative', 'social_post', 'renovation'] as const;
type GenType = (typeof TYPES)[number];

const GENERIC =
  'Something went wrong generating that image — please try again, and contact support if it persists.';

// EF error token → friendly copy + HTTP status.
function friendlyEfError(
  token: string,
  generationType: string,
): { error: string; status: 400 | 402 | 409 | 502 | 500 } {
  switch (token) {
    case 'missing_agency_id':
    case 'missing_prompt':
      return { error: 'Please add a short description of the image you want.', status: 400 };
    case 'prompt_too_long':
      return { error: 'That description is too long — please shorten it.', status: 400 };
    case 'invalid_generation_type':
      return { error: 'That generation type is not available.', status: 400 };
    case 'missing_source_image':
      return { error: 'Renovation needs a room photo to work from — please upload one.', status: 400 };
    case 'quota_unavailable':
      return {
        error: `You've used all your ${labelFor(generationType)} generations for this month.`,
        status: 409,
      };
    case 'kie_create_failed':
      return { error: GENERIC, status: 502 };
    default:
      return { error: GENERIC, status: 500 };
  }
}

function labelFor(type: string): string {
  if (type === 'ad_creative') return 'ad creative';
  if (type === 'social_post') return 'social post';
  if (type === 'renovation') return 'renovation';
  return 'image';
}

async function readJson(c: import('hono').Context): Promise<Record<string, unknown>> {
  try {
    const raw = await c.req.json();
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

type GenerationRow = {
  id: string;
  generation_type: string;
  status: string;
  prompt: string;
  source_image_url: string | null;
  result_image_url: string | null;
  failure_reason: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
};

function toClient(r: GenerationRow) {
  return {
    id: r.id,
    generationType: r.generation_type,
    status: r.status,
    prompt: r.prompt,
    sourceImageUrl: r.source_image_url,
    resultImageUrl: r.result_image_url,
    failureReason: r.failure_reason,
    width: r.width,
    height: r.height,
    createdAt: r.created_at,
  };
}

// ─── GET /api/v1/images/quota?type=… ────────────────────────────────────────
// Registered before /:id so the static path wins.
route.get('/quota', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  const type = c.req.query('type') ?? '';
  if (!(TYPES as readonly string[]).includes(type)) {
    return c.json({ error: 'Unknown generation type.' }, 400);
  }
  try {
    const result = await tx.execute(sql`
      SELECT image_gen_check_quota(${agencyId}::text, ${type}::text) AS q
    `);
    const rows = result as unknown as Array<{ q: unknown }>;
    return c.json({ ok: true, quota: rows[0]?.q ?? null });
  } catch (err) {
    console.error('[images/quota] failed:', err);
    return c.json({ error: GENERIC }, 500);
  }
});

// ─── GET /api/v1/images — recent generations (newest first) ─────────────────
route.get('/', async (c) => {
  const tx = c.get('tx');
  try {
    const result = await tx.execute(sql`
      SELECT id, generation_type, status, prompt, source_image_url,
             result_image_url, failure_reason, width, height, created_at
      FROM image_generations
      ORDER BY created_at DESC
      LIMIT 60
    `);
    const rows = result as unknown as GenerationRow[];
    return c.json({ ok: true, generations: rows.map(toClient) });
  } catch (err) {
    console.error('[images/list] failed:', err);
    return c.json({ error: GENERIC }, 500);
  }
});

// ─── GET /api/v1/images/:id — one generation (poll target) ──────────────────
route.get('/:id', async (c) => {
  const tx = c.get('tx');
  const id = c.req.param('id');
  try {
    const result = await tx.execute(sql`
      SELECT id, generation_type, status, prompt, source_image_url,
             result_image_url, failure_reason, width, height, created_at
      FROM image_generations
      WHERE id = ${id}::uuid
      LIMIT 1
    `);
    const rows = result as unknown as GenerationRow[];
    if (rows.length === 0) {
      return c.json({ error: 'That image could not be found.' }, 404);
    }
    return c.json({ ok: true, generation: toClient(rows[0]) });
  } catch (err) {
    console.error('[images/get] failed:', err);
    return c.json({ error: GENERIC }, 500);
  }
});

// ─── POST /api/v1/images — create (→ Edge Function) ─────────────────────────
route.post('/', async (c) => {
  const agencyId = c.get('agencyId');
  const user = c.get('user');

  if (!env.IMAGE_GEN_INTERNAL_SECRET) {
    console.error('[images/create] IMAGE_GEN_INTERNAL_SECRET not configured');
    return c.json({ error: GENERIC }, 500);
  }

  const b = await readJson(c);
  const type = typeof b.generation_type === 'string' ? b.generation_type : '';
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  const sourceImageUrl =
    typeof b.source_image_url === 'string' && b.source_image_url.trim()
      ? b.source_image_url.trim()
      : null;

  // Client-side validation mirrors the EF so the user gets fast, friendly errors.
  if (!(TYPES as readonly string[]).includes(type)) {
    return c.json({ error: 'That generation type is not available.' }, 400);
  }
  if (!prompt) {
    return c.json({ error: 'Please add a short description of the image you want.' }, 400);
  }
  if (prompt.length > 4000) {
    return c.json({ error: 'That description is too long — please shorten it.' }, 400);
  }
  if (type === 'renovation' && !sourceImageUrl) {
    return c.json({ error: 'Renovation needs a room photo to work from — please upload one.' }, 400);
  }

  const width = Number.isInteger(b.width) ? (b.width as number) : undefined;
  const height = Number.isInteger(b.height) ? (b.height as number) : undefined;
  const sourcePropertyId =
    typeof b.source_property_id === 'string' && b.source_property_id
      ? b.source_property_id
      : undefined;

  const payload: Record<string, unknown> = {
    agency_id: agencyId,
    generation_type: type as GenType,
    prompt,
    requested_by: user?.sub,
  };
  if (sourceImageUrl) payload.source_image_url = sourceImageUrl;
  if (width) payload.width = width;
  if (height) payload.height = height;
  if (sourcePropertyId) payload.source_property_id = sourcePropertyId;

  let res: Response;
  try {
    res = await fetch(
      `${env.SUPABASE_URL}/functions/v1/image-generate-create`,
      {
        method: 'POST',
        headers: {
          'x-internal-secret': env.IMAGE_GEN_INTERNAL_SECRET,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );
  } catch (err) {
    console.error('[images/create] EF fetch failed:', err);
    return c.json({ error: GENERIC }, 502);
  }

  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    reason?: string;
    generation_id?: string;
    kie_task_id?: string;
    status?: string;
  };

  if (!res.ok || body.ok === false) {
    const token = body.error ?? body.reason ?? '';
    const f = friendlyEfError(token, type);
    console.error('[images/create] EF rejected:', res.status, token);
    return c.json({ error: f.error }, f.status);
  }

  return c.json({
    ok: true,
    generationId: body.generation_id,
    kieTaskId: body.kie_task_id ?? null,
    status: body.status ?? 'processing',
  });
});

export default route;
