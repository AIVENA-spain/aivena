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

/**
 * A VARIABLE is an identifier immediately followed by ',' or '}' — `{name}` or
 * the argument of an ICU construct, `{count, plural, ...}`.
 *
 * A naive /\{[^}]+\}/ does NOT work here: ICU plurals nest braces, so in the
 * Polish `{count, plural, one {zapisano # notatkę} ...}` it would read
 * "zapisano # notatkę" as a placeholder and report drift on a perfectly correct
 * translation. That false positive is exactly what this pattern avoids.
 */
const VARIABLE = /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,}]/g;

function variablesOf(value: string): string[] {
  return [...value.matchAll(VARIABLE)].map((m) => m[1]).sort();
}

/** ICU only survives if the braces balance. */
function bracesBalanced(value: string): boolean {
  let depth = 0;
  for (const ch of value) {
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth < 0) return false; }
  }
  return depth === 0;
}

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

  it.each(langs)("%s uses exactly the same variables as en, per key", (lang) => {
    const other = load(lang);
    const broken: string[] = [];
    for (const [key, value] of Object.entries(en)) {
      const want = variablesOf(value);
      const got = variablesOf(other[key] ?? "");
      if (JSON.stringify(want) !== JSON.stringify(got)) {
        broken.push(`${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
      }
    }
    expect(broken, `${lang} variable drift`).toEqual([]);
  });

  it.each(langs)("%s has balanced braces, so every ICU string parses", (lang) => {
    const other = load(lang);
    const broken = Object.entries(other)
      .filter(([, v]) => !bracesBalanced(v))
      .map(([k]) => k);
    expect(broken, `${lang} has unbalanced braces`).toEqual([]);
  });
});
