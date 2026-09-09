#!/usr/bin/env node
/**
 * LIVE drift check — deliberately NOT part of the test suite.
 *
 * The static test (manifest.test.ts) proves the repo is internally consistent and
 * unedited since capture. This script answers the other half: has PRODUCTION moved?
 *
 * It is a separate, explicit job because a check that needs credentials is a check
 * that eventually gets skipped, and a skipped check is worse than no check — it
 * looks like coverage.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=... node supabase/functions/_manifest/drift-check.mjs
 *   (add --json for machine output; exit code 1 means drift was found)
 *   node ... --live-json <saved-listing.json>   # compare against a saved listing
 *
 * What it compares: the deployed version + bundle hash Supabase reports NOW against
 * the values recorded when each function was captured. It does NOT re-verify source
 * equivalence — the bundle hash cannot be recomputed from source. A changed bundle
 * hash means "production moved, re-capture and re-diff", which is exactly the alarm
 * that was missing when a stale repo copy of twilio-whatsapp-inbound would have
 * silenced Amanda in production.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_REF = "atminvhrybxegpdtnnpl";
const asJson = process.argv.includes("--json");

// --live-json <path> compares against a saved listing instead of calling the API.
// Same comparison code, different source of "live" — so the logic can be exercised
// (and reviewed) by whoever has Supabase access through some other route.
const fileIdx = process.argv.indexOf("--live-json");
const liveFile = fileIdx !== -1 ? process.argv[fileIdx + 1] : null;

const manifest = JSON.parse(readFileSync(join(HERE, "functions.json"), "utf8"));

let liveList;
if (liveFile) {
  const raw = JSON.parse(readFileSync(liveFile, "utf8"));
  liveList = Array.isArray(raw) ? raw : raw.functions;
  console.log(`source: ${liveFile} (offline snapshot)\n`);
} else {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error("SUPABASE_ACCESS_TOKEN is not set.");
    console.error("Get one at supabase.com/dashboard/account/tokens, then:");
    console.error("  SUPABASE_ACCESS_TOKEN=sbp_... node supabase/functions/_manifest/drift-check.mjs");
    console.error("Or pass a saved listing:  --live-json <path>");
    process.exit(2);
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/functions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`Supabase API returned ${res.status}. Check the token's scope.`);
    process.exit(2);
  }
  liveList = await res.json();
}
if (!Array.isArray(liveList)) {
  console.error("Could not read a function list from the source.");
  process.exit(2);
}
const live = new Map(liveList.map((f) => [f.slug, f]));

const drift = [];
const newFns = [];
const gone = [];

for (const e of manifest.functions) {
  const l = live.get(e.function);
  if (!l) { gone.push(e.function); continue; }
  if (l.ezbr_sha256 !== e.deployed_bundle_sha256 || l.version !== e.deployed_version) {
    drift.push({
      function: e.function,
      captured_version: e.deployed_version, live_version: l.version,
      captured_bundle: e.deployed_bundle_sha256, live_bundle: l.ezbr_sha256,
      status_at_capture: e.status,
    });
  }
}
for (const [slug] of live) {
  if (!manifest.functions.some((e) => e.function === slug)) newFns.push(slug);
}

const parked = manifest.functions.filter((e) => e.status === "REPO_AHEAD_OF_PRODUCTION").map((e) => e.function);

if (asJson) {
  console.log(JSON.stringify({ checked: manifest.functions.length, drift, new_functions: newFns, removed: gone, parked }, null, 2));
} else {
  console.log(`checked ${manifest.functions.length} functions against live\n`);
  if (drift.length === 0 && newFns.length === 0 && gone.length === 0) {
    console.log("  NO DRIFT — every deployed version and bundle hash matches the manifest.");
  }
  for (const d of drift) {
    console.log(`  DRIFT  ${d.function}`);
    console.log(`         captured v${d.captured_version} ${d.captured_bundle.slice(0, 16)}…`);
    console.log(`         live     v${d.live_version} ${d.live_bundle.slice(0, 16)}…`);
    console.log(`         -> production moved. Re-pull the live source, re-diff, re-capture.`);
  }
  for (const n of newFns) console.log(`  NEW    ${n} — deployed but not in the manifest. Capture it.`);
  for (const g of gone) console.log(`  GONE   ${g} — in the manifest but no longer deployed.`);
  if (parked.length) {
    console.log(`\n  note: ${parked.join(", ")} are REPO_AHEAD_OF_PRODUCTION by intent.`);
    console.log(`        Their repo source is meant to differ from live until deployed.`);
  }
}
// A NEW function fails too. An uncaptured production function is exactly the
// condition this manifest exists to catch — printing it while exiting 0 would let
// CI go green on the one thing we are trying to prevent.
process.exit(drift.length || gone.length || newFns.length ? 1 : 0);
