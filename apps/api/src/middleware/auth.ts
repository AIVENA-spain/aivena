import { createMiddleware } from 'hono/factory';
import { verify } from 'hono/jwt';
import { env } from '../../../packages/config/env';

export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = await verify(token, env.JWT_SECRET);
    c.set('agencyId', payload.agencyId as string);
    c.set('userId', payload.userId as string);
    await next();
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
});