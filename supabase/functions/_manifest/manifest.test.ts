import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

/**
 * STATIC repo verification. NO NETWORK, NO SUPABASE — this runs in the normal
 * test suite and must never depend on live access.
 *
 * It answers one question: can any production function be silently "unknown"?
 * The live comparison is a separate, explicit script (drift-check.mjs) because
 * a test that needs credentials is a test that gets skipped.
 */
const ROOT = join(__dirname, "..", "..", "..");
const MANIFEST = join(__dirname, "functions.json");
const MARK = "// ---8<--- CAPTURED SOURCE BELOW — verbatim from production, do not edit ---8<---";

type Entry = {
  function: string; repo_path: string; present_in_repo: boolean;
  deployed_version: number; deployed_bundle_sha256: string;
  captured_source_sha256: string | null; source_hash_covers: string | null;
  verify_jwt: boolean; status: string; difference: string | null;
};
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
  live_function_count: number; functions: Entry[];
};

const KNOWN_STATUSES = new Set([
  "VERIFIED", "REPO_AHEAD_OF_PRODUCTION", "PRODUCTION_ONLY", "UNVERIFIED",
  "BEHAVIOURAL_MISMATCH", "UNCERTAIN",
]);

describe("edge function manifest — every production function is accounted for", () => {
  it("covers exactly the number of live functions recorded at capture", () => {
    expect(manifest.functions.length).toBe(manifest.live_function_count);
  });

  it("has no duplicate function entries", () => {
    const names = manifest.functions.map((f) => f.function);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(manifest.functions.map((f) => [f.function, f] as const))(
    "%s has a repo path, a recognised status, and no silent unknown",
    (_name, e) => {
      expect(e.repo_path, "missing repo_path").toBeTruthy();
      expect(KNOWN_STATUSES.has(e.status), `unrecognised status ${e.status}`).toBe(true);
      expect(e.status, "status must never be blank").not.toBe("");
      // A function may only be UNVERIFIED/UNCERTAIN if that is stated explicitly —
      // it can never be the accidental default.
      if (e.status === "VERIFIED" || e.status === "REPO_AHEAD_OF_PRODUCTION") {
        expect(e.present_in_repo, `${e.function} claims ${e.status} but has no repo file`).toBe(true);
      }
    },
  );

  it("every function the manifest says is present actually exists on disk", () => {
    const missing = manifest.functions
      .filter((e) => e.present_in_repo && !existsSync(join(ROOT, e.repo_path)))
      .map((e) => e.function);
    expect(missing, "manifest claims a file that is not on disk").toEqual([]);
  });

  it("no function directory on disk is absent from the manifest", () => {
    const dir = join(ROOT, "supabase", "functions");
    const onDisk = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "_manifest")
      .map((d) => d.name);
    const known = new Set(manifest.functions.map((f) => f.function));
    expect(onDisk.filter((n) => !known.has(n)), "function on disk with no manifest entry").toEqual([]);
  });

  it("every VERIFIED entry records both hash identities", () => {
    for (const e of manifest.functions.filter((f) => f.status === "VERIFIED")) {
      expect(e.deployed_bundle_sha256, `${e.function} missing deployed bundle hash`).toMatch(/^[0-9a-f]{64}$/);
      expect(e.captured_source_sha256, `${e.function} missing captured source hash`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("THE REAL CHECK — no repo source has drifted since it was captured", () => {
    const drifted: string[] = [];
    for (const e of manifest.functions) {
      if (!e.present_in_repo || !e.captured_source_sha256) continue;
      if (e.status === "REPO_AHEAD_OF_PRODUCTION") continue; // repo intentionally differs from prod, not from itself
      const txt = readFileSync(join(ROOT, e.repo_path), "utf8");
      const body = txt.includes(MARK) ? txt.split(MARK)[1].replace(/^\n/, "") : txt;
      const sha = createHash("sha256").update(body, "utf8").digest("hex");
      if (sha !== e.captured_source_sha256) drifted.push(`${e.function}: repo source edited since capture`);
    }
    expect(drifted, "repo source changed without re-capturing — re-verify against live").toEqual([]);
  });

  it("every non-VERIFIED entry explains itself", () => {
    for (const e of manifest.functions.filter((f) => f.status !== "VERIFIED")) {
      expect(e.difference, `${e.function} is ${e.status} with no explanation`).toBeTruthy();
    }
  });
});
