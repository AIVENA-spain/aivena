import { createMiddleware } from 'hono/factory';
import * as crypto from 'crypto';
import { env } from '../../../../packages/config/env';

export const whatsappSignatureMiddleware = createMiddleware(async (c, next) => {
  const signature = c.req.header('x-hub-signature-256');

  if (!signature) {
    return c.json({ error: 'Missing signature' }, 401);
  }

  const body = await c.req.text();
  const appSecret = env.META_WHATSAPP_APP_SECRET;

  if (!appSecret) {
    return c.json({ error: 'WhatsApp signature validation not configured' }, 503);
  }

  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(body)
    .digest('hex');

  // Timing-safe comparison — protects against signature byte-by-byte attacks
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);

  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  await next();
});

export const twilioSignatureMiddleware = createMiddleware(async (c, next) => {
  const signature = c.req.header('x-twilio-signature');

  if (!signature) {
    return c.json({ error: 'Missing Twilio signature' }, 401);
  }

  // Twilio signature validation will be fully implemented in Phase 4
  // For now this gate ensures the header is always present
  await next();
});