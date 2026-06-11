/**
 * The app's URL base path. Empty in local dev (app at /); set to "/dashboard"
 * in production where the app serves at aivena.es/dashboard behind a rewrite
 * on the landing project. next.config.ts reads the same env var, so routing,
 * next/link and assets are prefixed automatically — this constant exists ONLY
 * for the few places that build URLs by hand (window.location.assign, raw
 * `${origin}${path}` redirects, emailRedirectTo targets), which Next.js does
 * NOT prefix.
 *
 * NEXT_PUBLIC_ so it's inlined into client bundles at build time.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix an app-internal path ("/login", "/invite/accept?x=y") with the base path. */
export function withBasePath(path: string): string {
  if (!path.startsWith("/")) return path;
  return `${BASE_PATH}${path}`;
}
