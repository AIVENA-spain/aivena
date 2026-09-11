#!/usr/bin/env node
/**
 * feature-truth-lint — stops a promise being called real without proof.
 *
 * The failure this exists to prevent: on 2026-08-24 an audit correctly recorded that autonomous
 * follow-ups "structurally cannot fire", and for the next seventeen days the dashboard told every
 * agency "Follow-up active". The finding was right; nothing carried it through to the promise.
 *
 * So the register is not prose. Each row must answer the eight audit questions in CLAUDE.md, and
 * A proven label (VERIFIED_REAL_LIVE / LIVE_DEMO_VERIFIED) must be earned: real evidence plus a
 * regression guard, and demo data can never prove real usage. Anything that is NOT live
 * must name what stops the UI overclaiming — because that gap is where the lie lives.
 *
 *   node tools/feature-truth-lint.mjs
 *
 * Exit 1 on any violation.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const REG = join(REPO, "apps/dashboard/lib/feature-truth.json");
const AUTO = join(REPO, "apps/dashboard/lib/automation-status.ts");

const reg = JSON.parse(readFileSync(REG, "utf8"));
const autoSrc = readFileSync(AUTO, "utf8");

const LABELS = new Set(Object.keys(reg.labels));
const REQUIRED = [
  "feature", "promise", "ui_surface", "status", "trigger_expected",
  "trigger_actual", "evidence", "failure_behaviour", "ui_guard",
  "regression_guard", "verified_at",
  // Christian, 2026-09-10: a finding may not be a note. It must name the harm, the
  // immediate truth fix, the REAL feature fix, and who owns it — so "mark not-live"
  // can never be mistaken for done.
  "proven_issue", "product_impact", "immediate_truth_fix", "permanent_product_fix", "owner",
];

/** Labels that assert the product promise actually works. These must be earned. */
const PROVEN = new Set(["VERIFIED_REAL_LIVE", "LIVE_DEMO_VERIFIED"]);
/** CI blocks on these. NOT_YET_AUDITED is backlog, never a permanent build failure. */
const BLOCKING = true;

const problems = [];
const seen = new Set();

for (const f of reg.features) {
  const id = f.feature ?? "(unnamed)";
  if (seen.has(id)) problems.push(`${id}: duplicate entry`);
  seen.add(id);

  // NOT_YET_AUDITED is the honest backlog. Demanding the full eight answers for a row nobody has
  // audited yet would just discourage recording it — and an unrecorded promise is the whole
  // problem. Record it cheaply; the lint still refuses to let it be presented as working.
  const required = f.status === "NOT_YET_AUDITED"
    ? ["feature", "promise", "ui_surface", "status", "owner"]
    : REQUIRED;
  for (const k of required) {
    const v = f[k];
    const empty = v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
    if (empty) problems.push(`${id}: missing or empty "${k}" — one of the eight audit questions is unanswered`);
  }

  if (f.status && !LABELS.has(f.status)) problems.push(`${id}: unknown status "${f.status}"`);

  if (PROVEN.has(f.status)) {
    if (!Array.isArray(f.evidence) || f.evidence.length === 0)
      problems.push(`${id}: ${f.status} with no evidence — "it exists" is not proof`);
    if (/nothing|no caller|not wired|bypass/i.test(String(f.trigger_actual ?? "")))
      problems.push(`${id}: ${f.status} but trigger_actual says nothing calls it`);
    if (f.status === "VERIFIED_REAL_LIVE") {
      // "one demo agency" must never satisfy a check for REAL agency usage — matching the bare
      // word "agency" let exactly that through on the first attempt.
      // Scan every field where a demo caveat can hide, not just `evidence`. Found during the
      // 2026-09-10 self-audit: inbound-whatsapp's demo context sat in trigger_actual, so the
      // demo check missed it and only a second rule caught the relabel — by luck.
      const ev = [f.evidence.join(" "), f.trigger_actual, f.note ?? "", f.product_impact ?? ""].join(" ");
      const demo = ev.match(/\b(demo|test|sandbox|staging|fixture|seed)\b/i);
      if (demo)
        problems.push(`${id}: VERIFIED_REAL_LIVE but the evidence says "${demo[0]}" — demo data cannot prove real usage (use LIVE_DEMO_VERIFIED)`);
      if (!/real (agency|customer|client)|paying|production traffic/i.test(ev))
        problems.push(`${id}: VERIFIED_REAL_LIVE needs evidence naming REAL agency/client usage`);
    }
  } else {
    if (/^(none|n\/a)$/i.test(String(f.ui_guard ?? "").trim()))
      problems.push(`${id}: ${f.status} with no ui_guard — name what stops the UI claiming this works, or say "NONE YET" and carry it as a finding`);
  }

  // Closing rule (C): "not part of AIVENA now" is a decision, so it needs an owner and a revisit status.
  if (f.status === "NOT_LIVE_COMING_LATER" && !String(f.revisit ?? "").trim())
    problems.push(`${id}: NOT_LIVE_COMING_LATER with no revisit status — coming-later needs an owner and a revisit, or it is just parked`);

  // A false claim may never simply sit here. It needs a fix path, immediately.
  if (f.status === "FALSE_UI_CLAIM") {
    const fix = String(f.immediate_truth_fix ?? "");
    if (!fix || /^(none|tbd|todo|owed|later)/i.test(fix))
      problems.push(`${id}: FALSE_UI_CLAIM with no immediate_truth_fix — a false product claim is fixed now, not parked`);
  }

  // "Mark not-live" is a temporary honest state, never the destination.
  if (["EXISTS_BUT_NOT_WIRED", "FALSE_UI_CLAIM", "PARTIAL_UNPROVEN", "MECHANISM_PROVEN"].includes(f.status)) {
    const real = String(f.permanent_product_fix ?? "");
    if (!real || /^(none|n\/a)$/i.test(real.trim()))
      problems.push(`${id}: ${f.status} with no permanent_product_fix — a caption or not-live label is the immediate truth fix, never the permanent one`);
  }
}

// Cross-check: the register cannot declare live what automation-status declares stopped.
const stopped = [...autoSrc.matchAll(/(\w+):\s*"not_running"/g)].map((m) => m[1]);
const DEPENDS = { automaticFollowUps: "automatic-follow-ups", leadScoring: "automatic-lead-scoring" };
for (const engine of stopped) {
  const feat = DEPENDS[engine];
  if (!feat) continue;
  const row = reg.features.find((f) => f.feature === feat);
  // MUST use the PROVEN set, not a hardcoded label. This line read `=== "VERIFIED_LIVE"` after
  // the taxonomy changed, so the most important guard in the file silently stopped firing —
  // found by the 2026-09-10 self-audit. A dead check is worse than no check.
  if (row && PROVEN.has(row.status))
    problems.push(`${feat}: register says ${row.status} but automation-status.ts says ${engine} is "not_running"`);
}

// The API carries its own scoring declaration (it deploys separately). It must agree with the
// dashboard's, or the Brief and the panel beside it can tell two different stories — which is how
// "warm lead (score 75)" survived the 2026-09-10 truth fix.
const API_AUTO = join(REPO, "apps/api/src/lib/automation-status.ts");
try {
  const apiSrc = readFileSync(API_AUTO, "utf8");
  const apiLive = /LEAD_SCORING_LIVE\s*=\s*true/.test(apiSrc);
  const dashLive = /leadScoring:\s*"running"/.test(autoSrc);
  if (apiLive !== dashLive)
    problems.push(`lead scoring: API LEAD_SCORING_LIVE=${apiLive} but dashboard says "${dashLive ? "running" : "not_running"}" — the two declarations must agree`);
} catch {
  problems.push("apps/api/src/lib/automation-status.ts is missing — the API cannot know whether scoring is live");
}

console.log(`feature-truth: ${reg.features.length} features registered`);
const byStatus = {};
for (const f of reg.features) byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;
for (const [k, v] of Object.entries(byStatus).sort()) console.log(`  ${String(v).padStart(2)}  ${k}`);

if (problems.length === 0) {
  console.log("\n  OK — every registered feature answers the eight questions, and nothing claims to be live without proof.");
  process.exit(0);
}
console.log(`\n  ${problems.length} violation(s):`);
for (const p of problems) console.log(`    ${p}`);
process.exit(1);
