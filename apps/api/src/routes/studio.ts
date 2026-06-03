import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase-admin';

/**
 * Studio uploads — the agent's own reference/base image for the Ad creative and
 * Social post generators.
 *
 * The file bytes are NOT sent through this API (or through a Next Server Action,
 * which caps bodies at 1MB). Instead this endpoint mints a short-lived SIGNED
 * UPLOAD URL (service-role) for a path under the public agency-assets bucket;
 * the browser then uploads the file directly to storage with that token. Path:
 *   agency-assets/{agency_id}/studio-uploads/{uuid}.{ext}
 *
 * Only stores the image + returns its public URL — the generation pipeline
 * (kie.ai) is separate and not wired yet.
 */
const route = new Hono();

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

route.post('/upload-url', async (c) => {
  const agencyId = c.get('agencyId');

  let body: { contentType?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const contentType = typeof body.contentType === 'string' ? body.contentType : '';
  const ext = MIME_EXT[contentType];
  if (!ext) {
    return c.json({ error: 'Please upload a PNG, JPG, or WebP image.' }, 400);
  }

  const path = `${agencyId}/studio-uploads/${randomUUID()}.${ext}`;

  try {
    const { data, error } = await supabaseAdmin.storage
      .from('agency-assets')
      .createSignedUploadUrl(path);
    if (error || !data) {
      console.error('[studio/upload-url] createSignedUploadUrl failed:', error);
      return c.json({ error: 'Couldn\'t start the upload — please try again, and contact support if it keeps happening.' }, 500);
    }
    const { data: pub } = supabaseAdmin.storage
      .from('agency-assets')
      .getPublicUrl(path);
    return c.json({ path: data.path, token: data.token, publicUrl: pub.publicUrl });
  } catch (err) {
    console.error('[studio/upload-url] failed:', err);
    return c.json({ error: 'Couldn\'t start the upload — please try again, and contact support if it keeps happening.' }, 500);
  }
});

export default route;
