import fs from "node:fs";
import path from "node:path";
import fontkit from "fontkit";
import { computeMetrics, abs, loadLibrary } from "../resolver/fontLibrary";
import {
  VaultEntry, VaultFile, VaultMetrics, LANG_ORDER, Lang, REQUIRED_CHARS, EXT_PROBE, LATIN_EXT_A_PROBE,
} from "./vaultTypes";

const VAULT_VERSION = "v1-2026-06-26";
const FONTS_DIR = abs("fonts");
const OUT_JSON = abs("vault/fontVault.json");
const OUT_COVERAGE = abs("vault/coverage.md");

// Curated per-file metadata: license/source/category/status/display name. Categories match the frozen v1
// calibration exactly (Prata=display, Poppins=sans, Libre Caslon Text/Display=serif). Tinos is seed_only.
// Unknown files fall through to a conservative default (license unverified -> NOT production_safe -> seed_only).
interface KnownMeta { display: string; category: VaultEntry["category"]; license: string; source: string; production_safe: boolean; status: VaultEntry["status"]; status_reason: string | null; }
const KNOWN_META: Record<string, KnownMeta> = {
  "Poppins-Regular.ttf": { display: "Poppins", category: "sans", license: "OFL-1.1", source: "google-fonts", production_safe: true, status: "active", status_reason: null },
  "Prata-Regular.ttf": { display: "Prata", category: "display", license: "OFL-1.1", source: "google-fonts", production_safe: true, status: "active", status_reason: null },
  "LibreCaslonText-Regular.ttf": { display: "Libre Caslon Text", category: "serif", license: "OFL-1.1", source: "google-fonts", production_safe: true, status: "active", status_reason: null },
  "LibreCaslonDisplay-Regular.ttf": { display: "Libre Caslon Display", category: "serif", license: "OFL-1.1", source: "google-fonts", production_safe: true, status: "active", status_reason: null },
  "Tinos-Regular.ttf": {
    display: "Tinos", category: "serif", license: "OFL-1.1", source: "google-fonts (googlefonts/tinos, provided seed)", production_safe: true,
    status: "seed_only",
    status_reason: "TNR clone; reached only 0.667 on #4 title and created cross-layer body ambiguity; inactive, available only for explicit seed tests.",
  },
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function langCoverage(font: any): { languages: Lang[]; covers: string[] } {
  const languages: Lang[] = [];
  for (const lang of LANG_ORDER) {
    const req = REQUIRED_CHARS[lang];
    let ok = true;
    for (const ch of req) { if (!font.hasGlyphForCodePoint(ch.codePointAt(0)!)) { ok = false; break; } }
    if (ok) languages.push(lang);
  }
  const covers = EXT_PROBE.filter((ch) => font.hasGlyphForCodePoint(ch.codePointAt(0)!));
  return { languages, covers };
}

function avgWidthEm(font: any): number {
  // mean lowercase advance width / em (descriptive only). fontkit advanceWidth is in font units.
  try {
    const run = font.layout("abcdefghijklmnopqrstuvwxyz");
    const ws = run.glyphs.map((g: any) => g.advanceWidth).filter((w: number) => w > 0);
    if (!ws.length) return 0;
    const mean = ws.reduce((a: number, b: number) => a + b, 0) / ws.length;
    return Math.round((mean / font.unitsPerEm) * 1000) / 1000;
  } catch { return 0; }
}

// contrast-driven category heuristic for fonts NOT in KNOWN_META (never triggers for the current 5).
function heuristicCategory(contrast: number): VaultEntry["category"] {
  if (contrast < 1.35) return "sans";
  if (contrast >= 2.4) return "display";
  return "serif";
}

export async function buildVault(): Promise<VaultFile> {
  const files = fs.readdirSync(FONTS_DIR).filter((f) => /\.(ttf|otf)$/i.test(f)).sort();
  const fonts: VaultEntry[] = [];
  for (const file of files) {
    const full = path.join(FONTS_DIR, file);
    const font = (fontkit as any).openSync(full);
    const family: string = font.familyName; // name-table read (typographic family / fallback family)
    const v1 = await computeMetrics(family);  // EXACT v1 metric code path -> no calibration drift
    const metrics: VaultMetrics = {
      cap_height: v1.capRatio, x_height: v1.xRatio, avg_width: avgWidthEm(font), contrast: v1.contrast, stem: v1.stemRatio,
    };
    const km = KNOWN_META[file];
    const display = km?.display ?? family;
    const category = km?.category ?? heuristicCategory(v1.contrast);
    const license = km?.license ?? "unverified";
    const source = km?.source ?? "local (provenance unrecorded)";
    const production_safe = km ? km.production_safe : false; // never silently mark unknown licenses safe
    const status = km?.status ?? "seed_only";
    const status_reason = km ? km.status_reason : "license unverified; not production-safe until confirmed";
    const { languages, covers } = langCoverage(font);
    const latin_basic = "AZaz09".split("").every((c) => font.hasGlyphForCodePoint(c.codePointAt(0)!));
    const latin_ext_a = LATIN_EXT_A_PROBE.every((c) => font.hasGlyphForCodePoint(c.codePointAt(0)!));
    const entry: VaultEntry = VaultEntry.parse({
      id: `${slug(display)}-400`, // weight 400 (Regular files)
      file: `fonts/${file}`,
      family, display_name: display, weight: 400, style: "normal", category,
      license, source, production_safe, status, status_reason,
      languages, characters: { latin_basic, latin_ext_a, covers }, metrics,
    });
    fonts.push(entry);
  }
  fonts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const vault: VaultFile = VaultFile.parse({
    vault_version: VAULT_VERSION,
    generated_by: "studio/vault/buildVault.ts (reuses resolver v1 computeMetrics; no downloads)",
    languages_tested: [...LANG_ORDER],
    fonts,
  });
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(vault, null, 2) + "\n");
  fs.writeFileSync(OUT_COVERAGE, coverageMd(vault));
  return vault;
}

// ---- query helper (Stage 1 acceptance: "active fonts in category X that cover language Y") ----
export function activeFontsCovering(vault: VaultFile, category: VaultEntry["category"], lang: string): VaultEntry[] {
  return vault.fonts.filter((f) => f.status === "active" && f.category === category && f.languages.includes(lang));
}

export function loadVault(p = OUT_JSON): VaultFile {
  return VaultFile.parse(JSON.parse(fs.readFileSync(p, "utf8")));
}

function coverageMd(v: VaultFile): string {
  const byCat: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byLang: Record<string, number> = {};
  for (const f of v.fonts) {
    byCat[f.category] = (byCat[f.category] || 0) + 1;
    byStatus[f.status] = (byStatus[f.status] || 0) + 1;
    for (const l of f.languages) byLang[l] = (byLang[l] || 0) + 1;
  }
  let s = `# Font Vault — Coverage Report\n\nVault version: \`${v.vault_version}\`  ·  fonts: ${v.fonts.length}  ·  languages tested: ${v.languages_tested.join(", ")}\n\n`;
  s += `## Status breakdown\n\n`;
  for (const k of ["active", "seed_only", "rejected"]) if (byStatus[k]) s += `- ${k}: ${byStatus[k]}\n`;
  s += `\n## Category breakdown\n\n`;
  for (const k of Object.keys(byCat).sort()) s += `- ${k}: ${byCat[k]}\n`;
  s += `\n## Language coverage (fonts covering each language)\n\n`;
  for (const l of v.languages_tested) s += `- ${l}: ${byLang[l] || 0} / ${v.fonts.length}\n`;
  s += `\n## Fonts\n\n`;
  s += `| id | display | family (name-table) | category | status | license | prod-safe | languages |\n`;
  s += `|----|---------|---------------------|----------|--------|---------|-----------|-----------|\n`;
  for (const f of v.fonts) {
    s += `| ${f.id} | ${f.display_name} | ${f.family} | ${f.category} | ${f.status} | ${f.license} | ${f.production_safe} | ${f.languages.join(" ")} |\n`;
  }
  s += `\n## seed_only / rejected reasons\n\n`;
  for (const f of v.fonts) if (f.status !== "active") s += `- **${f.display_name}** (${f.status}): ${f.status_reason}\n`;
  return s + "\n";
}

// ---- Stage 1 acceptance verification ----
async function verify(vault: VaultFile): Promise<boolean> {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const add = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });

  // schema already enforced by VaultFile.parse in buildVault; re-validate the written file.
  let parsed: VaultFile | null = null;
  try { parsed = loadVault(); add("fontVault.json validates against schema", true); }
  catch (e: any) { add("fontVault.json validates against schema", false, e.message); }

  // every entry has a name-table family, license, status, language coverage, metrics
  const complete = vault.fonts.every((f) => f.family && f.license && f.status && Array.isArray(f.languages) && f.metrics);
  add("every entry: family + license + status + languages + metrics", complete);

  // Tinos present, seed_only, with reason
  const tinos = vault.fonts.find((f) => /tinos/i.test(f.id));
  add("Tinos present with status seed_only + reason", !!tinos && tinos.status === "seed_only" && !!tinos.status_reason, tinos ? `${tinos.status} :: ${tinos.status_reason}` : "Tinos missing");

  // coverage.md generated
  add("coverage.md generated", fs.existsSync(OUT_COVERAGE));

  // query helper returns active fonts in category serif covering ES
  const q = activeFontsCovering(vault, "serif", "es");
  add("query helper: active serif fonts covering 'es'", q.length >= 1, q.map((f) => f.display_name).join(", "));

  // metrics reproduce v1 EXACTLY for the shared active fonts (no calibration drift)
  let drift = "";
  try {
    const lib = await loadLibrary("resolver/fontLibrary.json");
    for (const lf of lib.fonts) {
      const v = vault.fonts.find((x) => x.id === lf.id);
      if (!v) { drift += `${lf.id} missing in vault; `; continue; }
      const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;
      if (!eq(v.metrics.cap_height, lf.metrics.capRatio) || !eq(v.metrics.x_height, lf.metrics.xRatio) ||
          !eq(v.metrics.stem, lf.metrics.stemRatio) || !eq(v.metrics.contrast, lf.metrics.contrast)) {
        drift += `${lf.id} drift{vault cap=${v.metrics.cap_height} x=${v.metrics.x_height} stem=${v.metrics.stem} contr=${v.metrics.contrast} vs v1 cap=${lf.metrics.capRatio} x=${lf.metrics.xRatio} stem=${lf.metrics.stemRatio} contr=${lf.metrics.contrast}}; `;
      }
    }
    add("vault metrics reproduce v1 resolver exactly", drift === "", drift || "all shared active fonts identical");
  } catch (e: any) { add("vault metrics reproduce v1 resolver exactly", false, e.message); }

  console.log("\n== STAGE 1 ACCEPTANCE ==");
  let allOk = true;
  for (const c of checks) { console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? "  — " + c.detail : ""}`); allOk = allOk && c.ok; }
  console.log(`\nSTAGE 1: ${allOk ? "PASS" : "FAIL"}`);
  return allOk;
}

async function main() {
  console.log("== build font vault (from studio/fonts; no downloads) ==");
  const vault = await buildVault();
  for (const f of vault.fonts) console.log(`  ${f.status.padEnd(9)} ${f.id.padEnd(22)} family=${JSON.stringify(f.family).padEnd(24)} cat=${f.category.padEnd(7)} langs=[${f.languages.join(",")}]`);
  console.log(`\nwrote ${path.relative(abs("."), OUT_JSON)} + ${path.relative(abs("."), OUT_COVERAGE)}`);
  const ok = await verify(vault);
  if (!ok) process.exit(1);
}

if (require.main === module) main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
