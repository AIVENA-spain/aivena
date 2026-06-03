import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase-admin';

/**
 * Studio uploads — the agent's own reference/base image for the Ad creative and
 * Social post generators. Server-mediated upload to the public `agency-assets`
 * bucket via the service-role client (consistent with the logo upload pattern;
 * no client storage-RLS dependency). Path convention:
 *   agency-assets/{agency_id}/studio-uploads/{uuid}.{ext}
 *
 * This only stores the image and returns its public URL — the generation
 * pipeline (kie.ai) is separate and not wired yet; the URL is held in the
 * generator's form state for the eventual payload.
 */
const route = new Hono();

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

route.post('/uploads', async (c) => {
  const agencyId = c.get('agencyId');

  let file: File;
  try {
    const form = await c.req.formData();
    const f = form.get('file');
    if (!f || typeof f === 'string') {
      return c.json({ error: 'Attach an image to upload.' }, 400);
    }
    file = f;
  } catch (err) {
    console.error('[studio/uploads] form parse failed:', err);
    return c.json({ error: 'Couldn\'t read that upload — please try again.' }, 400);
  }

  const ext = MIME_EXT[file.type];
  if (!ext) {
    return c.json({ error: 'Please upload a PNG, JPG, or WebP image.' }, 400);
  }
  if (file.size > MAX_BYTES) {
    return c.json({ error: 'That image is over 10 MB — please choose a smaller one.' }, 400);
  }

  const path = `${agencyId}/studio-uploads/${randomUUID()}.${ext}`;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await supabaseAdmin.storage
      .from('agency-assets')
      .upload(path, buffer, { contentType: file.type, upsert: false });
    if (uploadError) {
      console.error('[studio/uploads] storage upload failed:', uploadError);
      return c.json({ error: 'Upload failed — please try again, and contact support if it keeps happening.' }, 500);
    }
    const { data } = supabaseAdmin.storage.from('agency-assets').getPublicUrl(path);
    return c.json({ url: data.publicUrl, path });
  } catch (err) {
    console.error('[studio/uploads] upload failed:', err);
    return c.json({ error: 'Upload failed — please try again, and contact support if it keeps happening.' }, 500);
  }
});

export default route;
