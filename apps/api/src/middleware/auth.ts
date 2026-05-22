import type { Context, Next } from 'hono';
import { env } from '../../../../packages/config/env';

/**
 * authMiddleware
 *
 * Verifies a Supabase access token presented as `Authorization: Bearer <token>`.
 *
 * Supabase projects with asymmetric signing keys (this project — confirmed via
 * the JWKS endpoint returning an ES256/P-256 key) sign access tokens with
 * ES256. We verify against the project's JWKS endpoint.
 *
 * On success, the decoded payload (including `sub` and `email`) is exposed on
 * the Hono context as `user`. On any failure — missing header, malformed token,
 * bad signature, expired token, wrong issuer/audience — we return 401.
 *
 * jose is an ESM-only package and the API resolves as CommonJS under
 * `module: node16`, so we lazy-load it via dynamic import at runtime. This is
 * paid once per process; subsequent verifications hit the cached module and
 * the JWKS-set's own in-memory key cache.
 */

const EXPECTED_ISSUER = new URL('/auth/v1', env.SUPABASE_URL).toString();
const EXPECTED_AUDIENCE = 'authenticated';

export type AuthenticatedUser = {
  sub: string;
  email: string;
  [key: string]: unknown;
};

// We intentionally do not type the jose module here. `typeof import('jose')`
// would be a type-only ESM reference from a CommonJS file, which node16
// requires to carry an explicit resolution-mode attribute. The dynamic import
// at runtime works fine; we lose only autocomplete inside this file.
let josePromise: Promise<unknown> | null = null;
function loadJose(): Promise<{
  createRemoteJWKSet: (url: URL) => unknown;
  jwtVerify: (
    token: string,
    keyOrJwks: unknown,
    options: { issuer: string; audience: string },
  ) => Promise<{ payload: Record<string, unknown> }>;
}> {
  if (!josePromise) josePromise = import('jose');
  // Cast at the boundary — types above declare only what we actually call.
  return josePromise as Promise<{
    createRemoteJWKSet: (url: URL) => unknown;
    jwtVerify: (
      token: string,
      keyOrJwks: unknown,
      options: { issuer: string; audience: string },
    ) => Promise<{ payload: Record<string, unknown> }>;
  }>;
}

let cachedJwks: unknown = null;
async function getJwks(): Promise<unknown> {
  if (cachedJwks) return cachedJwks;
  const { createRemoteJWKSet } = await loadJose();
  cachedJwks = createRemoteJWKSet(
    new URL('/auth/v1/.well-known/jwks.json', env.SUPABASE_URL),
  );
  return cachedJwks;
}

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const { jwtVerify } = await loadJose();
    const jwks = await getJwks();
    const { payload } = await jwtVerify(token, jwks, {
      issuer: EXPECTED_ISSUER,
      audience: EXPECTED_AUDIENCE,
    });

    const sub = payload.sub;
    if (typeof sub !== 'string' || !sub) {
      return c.json({ error: 'Token missing subject' }, 401);
    }

    const user: AuthenticatedUser = {
      ...payload,
      sub,
      email: typeof payload.email === 'string' ? payload.email : '',
    };

    c.set('user', user);
    await next();
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
}
