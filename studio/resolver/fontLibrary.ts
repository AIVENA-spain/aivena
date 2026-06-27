import fs from "node:fs";
import path from "node:path";
import fontkit from "fontkit";
import { FontLibraryFile, FontEntry } from "./types";
import { renderStringRGBA, inkBox, strokeMetrics, regionOf } from "./glyphMetrics";

const STUDIO = path.resolve(__dirname, "..");
export function abs(p: string): string { return path.isAbsolute(p) ? p : path.join(STUDIO, p); }
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export interface FontMetrics { capRatio: number; xRatio: number; stemRatio: number; contrast: number; }
export interface LibFont extends FontEntry { verified_family: string; metrics: FontMetrics; }
export interface LoadedLibrary { library_version: string; fonts: LibFont[]; warnings: string[]; excluded: { id: string; reason: string }[]; }

export const METRIC_REF = 220;
const REF = METRIC_REF;
// Exported for reuse by the Font Vault builder (Stage 1) so vault metrics are computed by the EXACT
// v1 method — never a second implementation (keeps the frozen calibration intact).
export async function computeMetrics(family: string): Promise<FontMetrics> {
  const capImg = await renderStringRGBA(family, "H", REF);
  const cap = inkBox(capImg, regionOf([0, 0, capImg.width - 1, capImg.height - 1]), 60);
  const xImg = await renderStringRGBA(family, "x", REF);
  const xb = inkBox(xImg, regionOf([0, 0, xImg.width - 1, xImg.height - 1]), 60);
  const probe = await renderStringRGBA(family, "Hamburgevons", REF);
  const pb = inkBox(probe, regionOf([0, 0, probe.width - 1, probe.height - 1]), 60);
  const capH = cap ? cap.height : REF * 0.7;
  const sm = pb ? strokeMetrics(probe, regionOf([pb.left, pb.top, pb.right, pb.bottom]), 60) : { stem: 1, horiz: 1, contrast: 1 };
  return {
    capRatio: capH / REF,
    xRatio: xb && cap ? xb.height / cap.height : 0.5,
    stemRatio: sm.stem / capH,
    contrast: sm.contrast,
  };
}

export async function loadLibrary(libPath: string, extra: FontEntry[] = []): Promise<LoadedLibrary> {
  const parsed = FontLibraryFile.parse(JSON.parse(fs.readFileSync(abs(libPath), "utf8")));
  const all = [...parsed.fonts, ...extra];
  const fonts: LibFont[] = [];
  const warnings: string[] = [];
  const excluded: { id: string; reason: string }[] = [];

  for (const e of all) {
    const file = abs(e.file);
    if (!fs.existsSync(file)) { excluded.push({ id: e.id, reason: `font file missing: ${e.file}` }); warnings.push(`[${e.id}] file missing -> excluded`); continue; }
    let verified: string;
    try { verified = (fontkit as any).openSync(file).familyName; }
    catch (err: any) { excluded.push({ id: e.id, reason: `unreadable font: ${err.message}` }); warnings.push(`[${e.id}] unreadable -> excluded`); continue; }

    // name-table footgun: declared_family must equal the TTF internal family name, else exclude.
    if (norm(e.declared_family) !== norm(verified)) {
      excluded.push({ id: e.id, reason: `declared_family "${e.declared_family}" != verified TTF family "${verified}"` });
      warnings.push(`[${e.id}] NAME MISMATCH: declared "${e.declared_family}" != verified "${verified}" -> excluded (would silently fall back)`);
      continue;
    }
    // fallback guard: render a probe with the family that WOULD be used; if no ink -> excluded.
    const renderBy = e.force_render_by_declared ? e.declared_family : verified;
    const probe = await renderStringRGBA(renderBy, "Hg", 120);
    const ink = inkBox(probe, regionOf([0, 0, probe.width - 1, probe.height - 1]), 60);
    if (!ink || ink.count < 20) {
      excluded.push({ id: e.id, reason: `render fell back (no ink) using family "${renderBy}"` });
      warnings.push(`[${e.id}] fallback (no ink) rendering by "${renderBy}" -> excluded`);
      continue;
    }
    if (!e.license_ok) { excluded.push({ id: e.id, reason: "license_ok=false" }); continue; }
    fonts.push({ ...e, verified_family: verified, metrics: await computeMetrics(verified) });
  }
  return { library_version: parsed.library_version, fonts, warnings, excluded };
}
