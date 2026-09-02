import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Structural guards for the 13 UI catalogues. Translation work is bulk editing
 * of 13 JSON files at once, and the two ways it goes wrong silently are a
 * dropped key (the user sees a raw key like "inbox.thread.failedWindow") and a
 * mangled placeholder (the user sees a literal "{name}", or the string throws).
 * Neither shows up in a typecheck.
 */
const DIR = __dirname;
const PLACEHOLDER = /\{[^}]+\}/g;

function flatten(obj: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (obj !== null && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
    }
  } else if (typeof obj === "string") {
    out[prefix] = obj;
  }
  return out;
}

const load = (lang: string) =>
  flatten(JSON.parse(readFileSync(join(DIR, `${lang}.json`), "utf8")));

const langs = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(".json", ""))
  .filter((l) => l !== "en");

const en = load("en");

describe("UI catalogues stay structurally identical to English", () => {
  it.each(langs)("%s has exactly the same keys as en", (lang) => {
    const other = load(lang);
    const missing = Object.keys(en).filter((k) => !(k in other));
    const extra = Object.keys(other).filter((k) => !(k in en));
    expect(missing, `${lang} is MISSING keys — users would see raw key names`).toEqual([]);
    expect(extra, `${lang} has keys en does not`).toEqual([]);
  });

  it.each(langs)("%s uses exactly the same placeholders as en, per key", (lang) => {
    const other = load(lang);
    const broken: string[] = [];
    for (const [key, value] of Object.entries(en)) {
      const want = (value.match(PLACEHOLDER) ?? []).sort();
      const got = (other[key]?.match(PLACEHOLDER) ?? []).sort();
      if (JSON.stringify(want) !== JSON.stringify(got)) {
        broken.push(`${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
      }
    }
    expect(broken, `${lang} placeholder drift`).toEqual([]);
  });
});
