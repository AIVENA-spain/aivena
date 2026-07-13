import path from "node:path";

// Template-data root (fonts/, manifest/, assets/, intake/). Dev harness: studio/src/lib -> studio/ via
// __dirname. Production (apps/api compiled to dist/, where __dirname no longer points at studio/): set
// STUDIO_DATA_ROOT to the repo's studio/ dir so fonts/manifests/assets still resolve. Backward-compatible —
// env unset keeps the exact dev behaviour.
export const ROOT = process.env.STUDIO_DATA_ROOT || path.resolve(__dirname, "..", "..");
export const FONT_DIR = path.join(ROOT, "fonts");
export const OUT_DIR = path.join(ROOT, "out");

export function abs(p: string): string {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}
