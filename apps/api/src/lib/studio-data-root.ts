import path from 'node:path';

// The Studio template-data root (fonts/, manifest/, assets/, intake/) = <repo>/studio. Railway (start:
// `node dist/apps/api/src/index.js`) and local dev both run from the repo root, so process.cwd()/studio is
// correct. We set the env the engine reads (studio/src/lib/paths.ts resolves ROOT from STUDIO_DATA_ROOT at
// import) — importing this module BEFORE the engine guarantees the engine sees the right root even after tsc
// compiles to dist/ (where the engine's __dirname no longer points at studio/). Overridable via the env.
export const STUDIO_ROOT = process.env.STUDIO_DATA_ROOT || path.join(process.cwd(), 'studio');
process.env.STUDIO_DATA_ROOT = STUDIO_ROOT;
