import { supabaseAdmin } from './supabase-admin';

// Shared internal-render helpers for the Studio render routes (studio-editable-render, and future kie steps).
// Auth, SSRF screening and photo download are identical across the internal renderers — one source here.

// ── internal secret: read once via Vault RPC, cache for the process lifetime ──
// A transient null (RPC failed) clears the cache so the next request retries instead of caching the failure.
let secretCache: Promise<string | null> | null = null;
async function fetchSecret(): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('_get_platform_secret', { p_name: 'IMAGE_GEN_INTERNAL_SECRET' });
    if (error || !data) {
      console.error('[studio-internal] _get_platform_secret failed:', error?.message);
      return null;
    }
    return String(data);
  } catch (err) {
    console.error('[studio-internal] _get_platform_secret threw:', err);
    return null;
  }
}
export function internalSecret(): Promise<string | null> {
  if (!secretCache) {
    secretCache = fetchSecret().then((s) => {
      if (s === null) secretCache = null; // transient — allow retry
      return s;
    });
  }
  return secretCache;
}

/** Length-checked constant-time string compare. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function toDataUri(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

/**
 * Reject photo URLs that point at internal/loopback/private/link-local targets before fetching them
 * server-side (SSRF defence-in-depth — the input is documented as public/https URLs). Screens literal-target
 * vectors only; it does not follow redirects or resolve DNS — a complete fix is an origin allowlist.
 */
export function isHttpUrlSafe(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (host.startsWith('[')) {
    const ip = host.slice(1, -1);
    if (ip === '::1' || ip === '::' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80') || ip.startsWith('fec')) return false;
    return true;
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127 || a === 10 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

/** Download one photo → raw JPEG/PNG Buffer. `property-images` storage path (service-role) OR any https URL. */
export async function loadPhotoBuffer(ref: string): Promise<Buffer | null> {
  try {
    if (/^https?:\/\//i.test(ref)) {
      if (!isHttpUrlSafe(ref)) return null;
      const r = await fetch(ref);
      if (!r.ok) return null;
      return Buffer.from(await r.arrayBuffer());
    }
    // otherwise treat as a storage path in property-images
    const { data, error } = await supabaseAdmin.storage.from('property-images').download(ref);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
}

export const isStr = (v: unknown): v is string => typeof v === 'string';
