import fs from "node:fs";
import { abs } from "./paths";

const TEMPLATE_FILES: Record<string, string> = {
  "04": "manifest/templates/04_luxury_apartment.json",
};

export function manifestPath(template: string): string {
  const rel = TEMPLATE_FILES[template];
  if (!rel) throw new Error(`Unknown template '${template}'`);
  return abs(rel);
}

export function loadManifest(template: string): any {
  const p = manifestPath(template);
  if (!fs.existsSync(p)) throw new Error(`Manifest not found: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function saveManifest(template: string, manifest: any): void {
  fs.writeFileSync(manifestPath(template), JSON.stringify(manifest, null, 2) + "\n");
}

export function layerById(manifest: any, id: string): any {
  const L = manifest.layers.find((l: any) => l.id === id);
  if (!L) throw new Error(`Layer '${id}' not found in manifest`);
  return L;
}

export function loadValues(relOrPath: string): any {
  const p = abs(relOrPath);
  if (!fs.existsSync(p)) throw new Error(`Values file not found: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function loadFixture(name: string): any {
  const p = abs(`fixtures/${name}.json`);
  if (!fs.existsSync(p)) throw new Error(`Fixture not found: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function deepMerge(target: any, patch: any): void {
  for (const k of Object.keys(patch)) {
    if (patch[k] && typeof patch[k] === "object" && !Array.isArray(patch[k]) && target[k] && typeof target[k] === "object") {
      deepMerge(target[k], patch[k]);
    } else {
      target[k] = patch[k];
    }
  }
}

function addDelta(target: any, delta: any): void {
  for (const k of Object.keys(delta)) {
    if (delta[k] && typeof delta[k] === "object" && !Array.isArray(delta[k])) {
      if (!target[k]) target[k] = {};
      addDelta(target[k], delta[k]);
    } else if (typeof delta[k] === "number") {
      target[k] = (typeof target[k] === "number" ? target[k] : 0) + delta[k];
    } else {
      target[k] = delta[k];
    }
  }
}

// Apply a fixture (absolute patches + additive deltas) to a CLONE of the manifest. Never mutates the input.
export function applyFixture(manifest: any, fixture: any): any {
  const m = JSON.parse(JSON.stringify(manifest));
  if (fixture.manifest_patch) {
    if (fixture.manifest_patch.fonts) Object.assign(m.fonts, fixture.manifest_patch.fonts);
    const lp = fixture.manifest_patch.layers || {};
    for (const id of Object.keys(lp)) deepMerge(layerById(m, id), lp[id]);
  }
  if (fixture.manifest_delta) {
    const ld = fixture.manifest_delta.layers || {};
    for (const id of Object.keys(ld)) addDelta(layerById(m, id), ld[id]);
  }
  return m;
}

export const TEXT_TYPES = ["editable_text", "editable_text_block"];
export function isTextLayer(L: any): boolean { return TEXT_TYPES.includes(L.type); }
