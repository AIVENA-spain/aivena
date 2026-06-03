import { Hono } from 'hono';
import { sql } from 'drizzle-orm';

/**
 * Content library read surface — the Studio "Library" tab browses past
 * generated content (content_items). Read-only. Runs as aivena_app inside the
 * agency-context tx (RLS-scoped). The content_type and status columns are
 * Postgres enums — cast to text for plain-string JSON.
 */
const route = new Hono();

route.get('/', async (c) => {
  const tx = c.get('tx');
  try {
    const result = await tx.execute(sql`
      SELECT id,
             content_type::text AS content_type,
             platform,
             title,
             body,
             hashtags,
             media_urls,
             media_type,
             status::text       AS status,
             property_id,
             lead_id,
             tone,
             length,
             created_at
        FROM content_items
       WHERE agency_id = current_setting('app.current_agency_id', true)
       ORDER BY created_at DESC
       LIMIT 500
    `);
    const rows = result as unknown as Array<Record<string, unknown>>;
    return c.json({ items: rows });
  } catch (err) {
    console.error('[/content GET] read failed:', err);
    return c.json({ error: 'Failed to load content library' }, 500);
  }
});

export default route;
