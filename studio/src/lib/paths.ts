import path from "node:path";

// studio/src/lib -> studio/
export const ROOT = path.resolve(__dirname, "..", "..");
export const FONT_DIR = path.join(ROOT, "fonts");
export const OUT_DIR = path.join(ROOT, "out");

export function abs(p: string): string {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}
