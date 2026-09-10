#!/usr/bin/env node
/**
 * feature-truth-lint — stops a promise being called real without proof.
 *
 * The failure this exists to prevent: on 2026-08-24 an audit correctly recorded that autonomous
 * follow-ups "structurally cannot fire", and for the next seventeen days the dashboard told every
 * agency "Follow-up active". The finding was right; nothing carried it through to the promise.
 *
 * So the register is not prose. Each row must answer the eight audit questions in CLAUDE.md, and
 * VERIFIED_LIVE must be earned: real evidence plus a regression guard. Anything that is NOT live
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
];

const problems = [];
const seen = new Set();

for (const f of reg.features) {
  const id = f.feature ?? "(unnamed)";
  if (seen.has(id)) problems.push(`${id}: duplicate entry`);
  seen.add(id);

  for (const k of REQUIRED) {
    const v = f[k];
    const empty = v == null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
    if (empty) problems.push(`${id}: missing or empty "${k}" — one of the eight audit questions is unanswered`);
  }

  if (f.status && !LABELS.has(f.status)) problems.push(`${id}: unknown status "${f.status}"`);

  if (f.status === "VERIFIED_LIVE") {
    if (!Array.isArray(f.evidence) || f.evidence.length === 0)
      problems.push(`${id}: VERIFIED_LIVE with no evidence — "it exists" is not proof`);
    if (/^(none|n\/a|missing|todo|partial|tbd|gap)/i.test(String(f.regression_guard ?? "")))
      problems.push(`${id}: VERIFIED_LIVE whose regression_guard is "${String(f.regression_guard).slice(0, 40)}…" — a partial or absent guard does not earn VERIFIED_LIVE`);
    if (/nothing|no caller|not wired|bypass/i.test(String(f.trigger_actual ?? "")))
      problems.push(`${id}: VERIFIED_LIVE but trigger_actual says nothing calls it`);
  } else {
    if (/^(none|n\/a)$/i.test(String(f.ui_guard ?? "").trim()))
      problems.push(`${id}: ${f.status} with no ui_guard — name what stops the UI claiming this works, or say "NONE YET" and carry it as a finding`);
  }

  if (f.status === "FALSE_UI_CLAIM")
    problems.push(`${id}: FALSE_UI_CLAIM must be FIXED, not parked in the register`);
}

// Cross-check: the register cannot declare live what automation-status declares stopped.
const stopped = [...autoSrc.matchAll(/(\w+):\s*"not_running"/g)].map((m) => m[1]);
const DEPENDS = { automaticFollowUps: "automatic-follow-ups", leadScoring: "automatic-lead-scoring" };
for (const engine of stopped) {
  const feat = DEPENDS[engine];
  if (!feat) continue;
  const row = reg.features.find((f) => f.feature === feat);
  if (row && row.status === "VERIFIED_LIVE")
    problems.push(`${feat}: register says VERIFIED_LIVE but automation-status.ts says ${engine} is "not_running"`);
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
