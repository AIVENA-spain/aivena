import fs from "node:fs";
import path from "node:path";
import fontkit from "fontkit";
import { abs } from "../src/lib/paths";
import { loadVault } from "../vault/buildVault";
import { renderStringRGBA, inkBox, regionOf } from "../resolver/glyphMetrics";

// Q8 (partial): confirm the shipping #4 fonts (and all vault fonts) are STATIC files, not variable fonts.
// resvg ignores variable-weight axes (it renders the default instance), so a variable font referenced at a
// non-default weight would silently render wrong. A static file (no `fvar` axes) has no such footgun.
// Scope: the fonts the Engine Spine actually uses. Full catalogue confirmation awaits Q5 (catalogue) -> PARTIAL.

const SHIPPING_04 = new Set(["Poppins", "Prata", "LCText400"]); // #4 uses these families (stats/title/body)

async function main() {
  const vault = loadVault();
  const rows: any[] = [];
  for (const f of vault.fonts) {
    const file = abs(f.file);
    const font = (fontkit as any).openSync(file);
    const axes = font.variationAxes || {};
    const axisTags = Object.keys(axes);
    const isStatic = axisTags.length === 0;
    // resvg render check: probe renders ink by the font's family name (no silent fallback)
    const img = await renderStringRGBA(f.family, "Hamburg 123", 160, 1);
    const ink = inkBox(img, regionOf([0, 0, img.width - 1, img.height - 1]), 60);
    const renders = !!ink && ink.count > 50;
    rows.push({
      id: f.id, family: f.family, display: f.display_name, file: f.file, status: f.status,
      shipping_04: SHIPPING_04.has(f.family), is_static: isStatic, variable_axes: axisTags, renders_ok: renders,
    });
  }

  const shipping = rows.filter((r) => r.shipping_04);
  const shippingOk = shipping.every((r) => r.is_static && r.renders_ok);
  const allOk = rows.every((r) => r.is_static && r.renders_ok);

  const outDir = abs("out/engine");
  fs.mkdirSync(outDir, { recursive: true });
  const report = {
    generated_by: "studio/engine/confirmFonts.ts",
    scope: "vault fonts (Engine Spine); #4 shipping = Poppins/Prata/LCText400. Full catalogue pending Q5.",
    vault_version: vault.vault_version,
    shipping_04_all_static_and_render: shippingOk,
    all_vault_fonts_static_and_render: allOk,
    fonts: rows,
  };
  fs.writeFileSync(path.join(outDir, "font_confirmation.json"), JSON.stringify(report, null, 2) + "\n");

  let md = `# Q8 (partial) — font static-file confirmation\n\nScope: ${report.scope}\n\nshipping #4 all static + render: **${shippingOk}** · all vault fonts static + render: **${allOk}**\n\n`;
  md += `| id | family | shipping #4 | static (no fvar) | variable axes | renders (resvg) | status |\n|---|---|---|---|---|---|---|\n`;
  for (const r of rows) md += `| ${r.id} | ${r.family} | ${r.shipping_04 ? "yes" : "—"} | ${r.is_static ? "yes" : "NO"} | ${r.variable_axes.join(",") || "—"} | ${r.renders_ok ? "yes" : "NO"} | ${r.status} |\n`;
  md += `\nPARTIAL: only the fonts the Engine Spine uses are confirmed. Confirmation across the full shipping catalogue needs Q5 (catalogue) finalized.\n`;
  fs.writeFileSync(path.join(outDir, "font_confirmation.md"), md);

  console.log("== Q8 (partial) font static-file confirmation ==");
  for (const r of rows) console.log(`  ${r.id.padEnd(22)} static=${r.is_static ? "yes" : "NO "} renders=${r.renders_ok ? "yes" : "NO "} ${r.shipping_04 ? "[#4 shipping]" : ""} axes=[${r.variable_axes.join(",")}]`);
  console.log(`\n  shipping #4 fonts static+render: ${shippingOk ? "PASS" : "FAIL"} | all vault fonts: ${allOk ? "PASS" : "FAIL"}`);
  console.log(`  wrote out/engine/font_confirmation.{json,md}`);
  if (!shippingOk) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
