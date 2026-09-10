#!/usr/bin/env node
/**
 * state-gen — writes the FACTUAL half of STATE.md.
 *
 * Why this exists: AIVENA's status layer died twice. The Workboard grew to 255 KB and froze at
 * "last grounded 2026-07-02"; the master doc declares itself stale in its own header. Both failed
 * for the same reason — they depended on somebody remembering to update them. A generated block
 * cannot go stale.
 *
 * THE RULE THIS FILE OBEYS: never fake green. Every probe reports OK / UNKNOWN / BLOCKED with the
 * reason and the command that would fix it. A check that could not run is reported as a check that
 * could not run — never omitted, never shown as passing. A doc that lies once is never trusted again.
 *
 *   node tools/state-gen.mjs            # print the generated block
 *   node tools/state-gen.mjs --write    # splice it into STATE.md between the markers
 *
 * Read-only. It never writes to Supabase, n8n, or any provider.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(homedir(), "Library/CloudStorage/GoogleDrive-christian@aivena.es",
                  "My Drive/aivena docs/master doc and changelog");
const STATE = join(DOCS, "STATE.md");
const BEGIN = "<!-- BEGIN GENERATED -->";
const END = "<!-- END GENERATED -->";

const out = [];
const probes = [];   // {name, status, detail}
const say = (s = "") => out.push(s);

function probe(name, fn, need) {
  try {
    const r = fn();
    probes.push({ name, status: "OK" });
    return r;
  } catch (err) {
    const msg = String(err?.message ?? err).split("\n")[0].slice(0, 120);
    probes.push({ name, status: "UNKNOWN", detail: `${msg}${need ? ` — needs: ${need}` : ""}` });
    return null;
  }
}
const sh = (cmd, opts = {}) =>
  execSync(cmd, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000, ...opts }).trim();

// ─── 1. code / deploy ────────────────────────────────────────────────────────
const git = probe("git", () => ({
  branch: sh("git rev-parse --abbrev-ref HEAD"),
  head: sh("git rev-parse --short=7 HEAD"),
  main: sh("git rev-parse --short=7 origin/main"),
  gap: sh("git rev-list --left-right --count HEAD...origin/main"),
  dirty: sh("git status --porcelain").split("\n").filter(Boolean).length,
}));

const health = probe("api /health", () => {
  const r = sh(`curl -s --max-time 10 https://aivena-production.up.railway.app/health`);
  return JSON.parse(r);
}, "network");

// ─── 2. edge functions (local manifest — always available) ───────────────────
const manifest = probe("edge-function manifest", () => {
  const m = JSON.parse(readFileSync(join(REPO, "supabase/functions/_manifest/functions.json"), "utf8"));
  const byStatus = {};
  for (const e of m.functions) byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
  return { total: m.functions.length, byStatus, blocked: m.functions.filter((e) => e.blocks_deploy) };
});

// ─── 3. live database (needs credentials — expected UNKNOWN on most machines) ─
const dbUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
const psql = (sql) => sh(`psql "${dbUrl}" -At -F'|' -c "${sql.replace(/"/g, '\\"')}"`);
const db = dbUrl
  ? probe("supabase (psql)", () => ({
      cron: psql(`select j.jobname, j.schedule, j.active,
                    (select max(d.start_time) from cron.job_run_details d where d.jobid=j.jobid),
                    (select count(*) from cron.job_run_details d where d.jobid=j.jobid and d.status<>'succeeded')
                  from cron.job j order by j.jobname`),
      queue: psql(`select status, count(*) from public.send_queue group by status order by 2 desc`),
      stuck: psql(`select count(*) from public.send_queue where status='processing'`),
      issues: psql(`select count(*) from public.dashboard_tasks where task_type='send_issue' and status='pending'`),
      audit: psql(`select count(*), max(created_at) from public.provider_audit_log where created_at > now() - interval '7 days'`),
      modes: psql(`select agency_id, amanda_mode from public.agency_settings order by agency_id`),
    }))
  : (probes.push({ name: "supabase (psql)", status: "BLOCKED",
      detail: "no DATABASE_URL/SUPABASE_DB_URL in env — cron health, send-queue backlog, stuck rows, send_issue tasks and agency modes are UNKNOWN" }), null);

// ─── 4. n8n (needs API key) ──────────────────────────────────────────────────
if (!process.env.N8N_API_KEY) {
  probes.push({ name: "n8n", status: "BLOCKED",
    detail: "no N8N_API_KEY in env — workflow caller map is UNKNOWN; see the hand-checked map in STATE.md, dated" });
}

// ─── render ──────────────────────────────────────────────────────────────────
const now = new Date().toISOString().replace("T", " ").slice(0, 16);
say(BEGIN);
say(`_Generated ${now} UTC by \`tools/state-gen.mjs\`. Facts below are machine-read._`);
say(`_Anything marked **UNKNOWN** or **BLOCKED** was not verifiable on this machine — treat it as unknown, never as fine._`);
say();

say("### Probe availability");
say("| Check | Result | Note |");
say("|---|---|---|");
for (const p of probes) say(`| ${p.name} | **${p.status}** | ${p.detail ?? ""} |`);
say();

say("### Code and deploy");
if (git) {
  const [ahead, behind] = git.gap.split(/\s+/);
  say(`- branch \`${git.branch}\` at \`${git.head}\`; \`origin/main\` at \`${git.main}\` — **${ahead} ahead, ${behind} behind**`);
  say(`- uncommitted files: **${git.dirty}**`);
} else say("- git: **UNKNOWN**");
if (health) {
  const c = health.commit ?? "unknown";
  say(`- API \`/health\` reports commit **\`${c}\`**${git && c === git.main ? " — matches origin/main" : git ? ` — origin/main is \`${git.main}\`` : ""}`);
} else say("- API `/health`: **UNKNOWN** (no network, or the API did not answer)");
say();

say("### Edge functions");
if (manifest) {
  say(`- **${manifest.total} accounted for.** ` +
      Object.entries(manifest.byStatus).map(([k, v]) => `${v} ${k}`).join(" · "));
  if (manifest.blocked.length) {
    for (const b of manifest.blocked)
      say(`- **DEPLOY BLOCKED — \`${b.function}\`** (live v${b.deployed_version}). ${b.unblocks_when ?? ""}`);
  } else say("- no function is currently marked as blocking deploy");
  say("- _the manifest proves the repo has not drifted; it does NOT prove production has not moved — run `node supabase/functions/_manifest/drift-check.mjs` for that_");
} else say("- manifest: **UNKNOWN**");
say();

say("### Automation and sending");
if (db) {
  say("| pg_cron job | schedule | active | last run | failures |");
  say("|---|---|---|---|---|");
  for (const r of db.cron.split("\n").filter(Boolean)) {
    const [n, s, a, last, fail] = r.split("|");
    say(`| ${n} | \`${s}\` | ${a} | ${last || "never"} | ${fail} |`);
  }
  say();
  say(`- send_queue by status: ${db.queue.split("\n").filter(Boolean).map((r) => r.replace("|", "=")).join(" · ")}`);
  say(`- rows stuck in \`processing\`: **${db.stuck}** _(never re-claimed — claim_send_queue_rows takes only 'queued')_`);
  say(`- open \`send_issue\` tasks: **${db.issues}**`);
  say(`- provider_audit_log, last 7 days: ${db.audit.replace("|", " rows, most recent ")}`);
  say(`- agency Amanda modes: ${db.modes.split("\n").filter(Boolean).map((r) => r.replace("|", "=")).join(" · ")}`);
} else {
  say("- **BLOCKED — cannot read the live database from this machine.**");
  say("  Unknown right now: pg_cron health, send_queue backlog, stuck `processing` rows, open");
  say("  `send_issue` tasks, provider_audit_log activity, and each agency's `amanda_mode`.");
  say("  To make these generate: set `DATABASE_URL` (the `aivena_app` role, never `postgres`) and re-run.");
}
say(END);

const block = out.join("\n");
if (!process.argv.includes("--write")) { console.log(block); process.exit(0); }

if (!existsSync(STATE)) { console.error(`STATE.md not found at ${STATE}`); process.exit(2); }
const cur = readFileSync(STATE, "utf8");
const a = cur.indexOf(BEGIN), b = cur.indexOf(END);
if (a === -1 || b === -1) { console.error("STATE.md is missing the GENERATED markers"); process.exit(2); }
writeFileSync(STATE, cur.slice(0, a) + block + cur.slice(b + END.length));
console.log(`STATE.md updated ${now} UTC`);
for (const p of probes) if (p.status !== "OK") console.log(`  ${p.status}: ${p.name} — ${p.detail ?? ""}`);
