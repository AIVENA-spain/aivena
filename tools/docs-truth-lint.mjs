#!/usr/bin/env node
/**
 * docs-truth-lint — objective, exhaustive invariants for the AIVENA control docs.
 *
 * Companion to changelog-lint (the changelog TL;DR budget) and feature-truth-lint (the register
 * truth). Kept SEPARATE on purpose: different responsibilities, different corpora.
 *
 * The control docs live in Google Drive, NOT in this repo, so this lints the LIVE files locally
 * after a control-doc change (it resolves the Drive folder the way changelog-lint does). CI cannot
 * see those files, so CI runs only `--selftest` against committed fixtures — which proves the
 * checker itself works and cannot silently rot.
 *
 *   node tools/docs-truth-lint.mjs              # lint the live Drive control docs + active memory
 *   node tools/docs-truth-lint.mjs --docs-only  # skip the memory scan
 *   node tools/docs-truth-lint.mjs --root DIR   # lint an explicit docs root
 *   node tools/docs-truth-lint.mjs --memory DIR # scan an explicit memory dir
 *   node tools/docs-truth-lint.mjs --selftest   # run the fixtures and assert each expectation
 *
 * Exit 1 on any violation. FAILS CLOSED: a corpus that cannot be found, a required doc that is
 * missing, or an unexpectedly empty corpus is a FAILURE — never a silent green.
 *
 * What this canNOT do (by design; do not pretend otherwise): it cannot judge whether a claim is
 * TRUE, whether a label matches its evidence, or whether two decisions are semantically
 * contradictory. Without an explicit machine-readable Status/Supersedes schema it cannot prove
 * arbitrary contradiction. Those stay judgment + truth-ownership (invariants 1-3 in CLAUDE.md).
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, basename, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- corpus discovery (fails closed)
function resolveDocsRoot(explicit) {
  const fromEnv = explicit || process.env.AIVENA_DOCS_DIR;
  if (fromEnv) {
    if (basename(fromEnv) === "master doc and changelog") return dirname(fromEnv);
    if (existsSync(join(fromEnv, "master doc and changelog"))) return fromEnv;
    return fromEnv; // assume it already is the "aivena docs" root
  }
  const base = join(homedir(), "Library", "CloudStorage");
  if (existsSync(base)) {
    for (const d of readdirSync(base)) {
      if (!d.startsWith("GoogleDrive-")) continue;
      const p = join(base, d, "My Drive", "aivena docs");
      if (existsSync(join(p, "master doc and changelog"))) return p;
    }
  }
  return null; // caller turns this into a hard failure
}

function resolveMemoryDir(explicit) {
  const fromEnv = explicit || process.env.AIVENA_MEMORY_DIR;
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
  const projects = join(homedir(), ".claude", "projects");
  if (existsSync(projects)) {
    for (const d of readdirSync(projects)) {
      if (!/aivena/i.test(d)) continue;
      const p = join(projects, d, "memory");
      if (existsSync(p)) return p;
    }
  }
  return null;
}

function loadManifest(root) {
  const p = join(root, "docs-truth.manifest.json");
  if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")); // fixture-local manifest
  return JSON.parse(readFileSync(join(HERE, "docs-truth.manifest.json"), "utf8")); // repo manifest
}

// ------------------------------------------------------------------------------- small md helpers
function readIfExists(p) { return existsSync(p) ? readFileSync(p, "utf8") : null; }
function lines(text) { return text.split("\n"); }
function tableRows(text) {
  // Returns [{cells, lineNo}] for every data row of every pipe table in the text.
  const out = [];
  const ls = lines(text);
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i].trim();
    if (!l.startsWith("|")) continue;
    const next = (ls[i + 1] || "").trim();
    if (!/^\|[\s:|-]*\|?$/.test(next) || !next.includes("-")) continue; // header must be followed by a |---| rule
    const header = l.split("|").slice(1, -1).map((c) => c.trim());
    let j = i + 2;
    while (j < ls.length && ls[j].trim().startsWith("|")) {
      const cells = ls[j].split("|").slice(1, -1).map((c) => c.trim());
      out.push({ header, cells, lineNo: j + 1 });
      j++;
    }
    i = j;
  }
  return out;
}

// ------------------------------------------------------------------------------- the doc corpus
function loadDocsCorpus(root, manifest) {
  const files = [];
  const required = manifest.current_required || [];
  for (const rel of required) {
    const text = readIfExists(join(root, rel));
    if (text != null) files.push({ rel, text });
  }
  return { root, manifest, files };
}

// ------------------------------------------------------------------------------------- the checks
function checkC0(root, manifest, corpus, problems) {
  if (!root) { problems.push("C0 corpus: docs root could not be resolved (Drive unavailable or AIVENA_DOCS_DIR unset) — refusing to pass"); return false; }
  const state = manifest.stateFile;
  if (!state || !existsSync(join(root, state))) { problems.push(`C0 corpus: STATE file missing (${state}) under ${root}`); }
  for (const rel of manifest.current_required || []) {
    if (!existsSync(join(root, rel))) problems.push(`C0 corpus: required control doc missing: ${rel}`);
  }
  if (corpus.files.length === 0) { problems.push("C0 corpus: examined ZERO files — refusing to pass"); return false; }
  return true;
}

function knownDocSets(manifest) {
  const rels = new Set([...(manifest.current_required || []), ...(manifest.planned || [])]);
  const bases = new Set([...rels].map((r) => basename(r)));
  return { rels, bases };
}

function checkC1_references(corpus, problems) {
  const { rels, bases } = knownDocSets(corpus.manifest);
  const resolves = (p) => {
    const clean = p.split("#")[0].trim();
    if (!clean.endsWith(".md")) return true; // not a doc link
    if (rels.has(clean) || bases.has(basename(clean))) return true;
    if (existsSync(join(corpus.root, clean))) return true;
    return false;
  };
  for (const f of corpus.files) {
    // (a) real markdown links to a .md
    for (const m of f.text.matchAll(/\[[^\]]*\]\(([^)]+\.md[^)]*)\)/g)) {
      if (!resolves(m[1])) problems.push(`C1 ref: ${f.rel} links to missing doc "${m[1]}"`);
    }
    // (b) explicit control/… references (backticked or bare)
    for (const m of f.text.matchAll(/control\/[A-Za-z0-9_.\/-]+\.md/g)) {
      if (!resolves(m[0])) problems.push(`C1 ref: ${f.rel} names missing control doc "${m[0]}"`);
    }
    // (c) bare backticked X.md — only judged when X.md is a KNOWN control-doc basename
    for (const m of f.text.matchAll(/`([A-Za-z0-9_.-]+\.md)`/g)) {
      if (bases.has(m[1]) && !resolves(m[1])) problems.push(`C1 ref: ${f.rel} names known control doc "${m[1]}" that does not resolve`);
    }
  }
}

const PROVENANCE_MARK = "docs-truth: provenance";
function checkC2_stagingLinks(corpus, problems) {
  const stagingRe = /[A-Za-z0-9_.\/-]*_draft\.md|_DOCS_RESET_2026-09|\baudit\/[A-Za-z0-9_.-]+\.md/;
  for (const f of corpus.files) {
    lines(f.text).forEach((l, i) => {
      if (!stagingRe.test(l)) return;
      if (l.includes(PROVENANCE_MARK)) return; // explicit, machine-readable clearance only
      problems.push(`C2 staging-link: ${f.rel}:${i + 1} references a staging/draft path with no "${PROVENANCE_MARK}" marker`);
    });
  }
}

const PARKING_STATUS = new Set(["open", "parked", "unknown", "struck"]);
function checkC3_parkingLot(corpus, problems) {
  const f = corpus.files.find((x) => basename(x.rel) === "PARKING_LOT.md");
  if (!f) return; // C0 already flags a missing required doc
  const body = f.text.split(/^## 2\./m)[0]; // section 1 open-item tables only
  const rows = tableRows(body).filter((r) => r.header[0] === "Item" && r.header.includes("Owner"));
  let n = 0;
  for (const r of rows) {
    n++;
    if (r.cells.length !== 6) { problems.push(`C3 parking-row: PARKING_LOT.md:${r.lineNo} has ${r.cells.length} cells, expected 6`); continue; }
    const [, owner, status, , review, close] = r.cells;
    if (!owner) problems.push(`C3 parking-row: PARKING_LOT.md:${r.lineNo} empty Owner`);
    if (!PARKING_STATUS.has(status)) problems.push(`C3 parking-row: PARKING_LOT.md:${r.lineNo} invalid Status "${status}"`);
    if (!review) problems.push(`C3 parking-row: PARKING_LOT.md:${r.lineNo} empty Review point`);
    if (!close) problems.push(`C3 parking-row: PARKING_LOT.md:${r.lineNo} empty Close/strike condition`);
  }
  if (n === 0) problems.push("C3 parking-row: no open-item rows parsed (structure changed?)");
}

function checkC4_decisions(corpus, problems) {
  const f = corpus.files.find((x) => basename(x.rel) === "LAUNCH_READINESS.md");
  if (!f) return;
  const rows = tableRows(f.text).filter((r) => /^D-\d+$/.test((r.cells[0] || "").trim()));
  const seen = new Map();
  let n = 0;
  for (const r of rows) {
    n++;
    const id = r.cells[0].trim();
    if (r.cells.length < 4) problems.push(`C4 decision: LAUNCH_READINESS.md:${r.lineNo} ${id} has ${r.cells.length} cells, expected ID|Decision|Date|Consequence`);
    if (seen.has(id)) problems.push(`C4 decision: duplicate decision id ${id} (also line ${seen.get(id)})`);
    else seen.set(id, r.lineNo);
    const decision = r.cells[1] || "";
    const date = r.cells[2] || "";
    if (!date.trim()) problems.push(`C4 decision: ${id} missing Date cell`);
    if (!decision.trim()) problems.push(`C4 decision: ${id} missing Decision cell`);
    // A decision that supersedes ANOTHER DECISION must name it. Trigger only on the relational
    // forms ("supersedes X" / "superseded by X") — not on "is superseded/historical" used as a
    // status adjective about a real-world thing (e.g. a provider account), which names no D-id.
    if ((/\bsupersedes\b/i.test(decision) || /\bsuperseded by\b/i.test(decision)) && !/D-\d+/.test(decision)) {
      problems.push(`C4 decision: ${id} supersedes a decision but names no D-NN reference`);
    }
  }
  if (n === 0) problems.push("C4 decision: no D-NN register rows parsed (structure changed?)");
}

function checkC5_structure(corpus, problems) {
  for (const f of corpus.files) {
    const head = lines(f.text).slice(0, 8);
    if (!/^#\s+\S/.test(f.text)) problems.push(`C5 structure: ${f.rel} has no top-level "# Title"`);
    // Control docs open with a provenance blockquote; STATE.md legitimately opens with its own
    // "what is true right now" preamble instead, so it is exempt from this one check.
    if (basename(f.rel) !== "STATE.md" && !head.some((l) => l.trim().startsWith(">"))) {
      problems.push(`C5 structure: ${f.rel} has no provenance blockquote near the top`);
    }
    if (basename(f.rel) === "PARKING_LOT.md") {
      if (!/^## 0\./m.test(f.text) || !/^## 1\./m.test(f.text)) problems.push("C5 structure: PARKING_LOT.md missing its §0/§1 sections");
    }
    if (basename(f.rel) === "LAUNCH_READINESS.md") {
      if (!/^## 1\. Decisions register/m.test(f.text)) problems.push("C5 structure: LAUNCH_READINESS.md missing its Decisions register heading");
    }
  }
}

const SNAP_MARK = /docs-truth:\s*snapshot=(CURRENT|STALE|FROZEN|UNKNOWN)\b/;
function checkC6_snapshot(corpus, problems) {
  const f = corpus.files.find((x) => basename(x.rel) === "STATE.md");
  if (!f) return;
  const ls = lines(f.text);
  const begin = ls.findIndex((l) => l.trim() === "<!-- BEGIN GENERATED -->");
  if (begin === -1) return; // no generated block is allowed
  const window = ls.slice(Math.max(0, begin - 6), begin + 6).join("\n");
  const hasDate = /Generated\s+\d{4}-\d{2}-\d{2}/.test(f.text);
  const hasState = SNAP_MARK.test(window);
  if (!hasDate) problems.push("C6 snapshot: STATE.md generated block has no 'Generated <date>' line");
  if (!hasState) problems.push(`C6 snapshot: STATE.md generated block lacks a machine-readable currency marker near it (docs-truth: snapshot=CURRENT|STALE|FROZEN|UNKNOWN)`);
}

// ------------------------------------------------------------------- C7 privacy / secret patterns
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key block"],
  [/\bAC[0-9a-f]{32}\b/, "Twilio Account SID"],
  [/\bSK[0-9a-f]{32}\b/, "Twilio API key SID"],
  [/\bsk-[A-Za-z0-9]{15,}\b/, "sk- API key"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/, "JWT / service_role token"],
];
const IDENTITY_PATTERNS = [
  [/\b[XYZ]\d{7}[A-Z]\b/, "NIE number"],
  [/\b\d{8}[A-Z]\b/, "DNI number"],
];
const CONTACT_PATTERNS = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "email"],
  [/\+34[\d ]{6,}\d/g, "phone"],
  [/\b(?:Calle|Avenida|Avda|Carrer|C\/)\s+[A-Z]/g, "street address"],
];
function scanPrivacy(fileLabel, text, profile, problems) {
  for (const [re, what] of SECRET_PATTERNS) if (re.test(text)) problems.push(`C7 secret: ${fileLabel} contains a ${what} — never allowed`);
  for (const [re, what] of IDENTITY_PATTERNS) if (re.test(text)) problems.push(`C7 identity: ${fileLabel} contains a ${what} — never allowed`);
  const allow = profile.allow || [];
  for (const [re, what] of CONTACT_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const hit = m[0];
      if (allow.includes(hit)) continue; // allowlist applies to contact patterns only, never to secrets/identity
      problems.push(`C7 ${what}: ${fileLabel} contains "${hit}"${profile.strict ? "" : " (not in the memory allowlist)"}`);
    }
  }
}
function checkC7_docs(corpus, problems) {
  for (const f of corpus.files) scanPrivacy(f.rel, f.text, { strict: true, allow: [] }, problems);
}

// ------------------------------------------------------------------------------------ memory scan
function lintMemory(memRoot, allow, problems) {
  if (!memRoot) { problems.push("C0 memory: memory dir could not be resolved — refusing to pass (pass --docs-only to skip on purpose)"); return; }
  const mdFiles = readdirSync(memRoot).filter((n) => n.endsWith(".md"));
  if (mdFiles.length === 0) { problems.push("C0 memory: examined ZERO memory files — refusing to pass"); return; }
  for (const n of mdFiles) scanPrivacy(`memory/${n}`, readFileSync(join(memRoot, n), "utf8"), { strict: false, allow }, problems);
}

// ---------------------------------------------------------------------------------- orchestration
function lintDocsRoot(root, manifest) {
  const problems = [];
  const corpus = loadDocsCorpus(root, manifest);
  if (!checkC0(root, manifest, corpus, problems)) return problems;
  checkC1_references(corpus, problems);
  checkC2_stagingLinks(corpus, problems);
  checkC3_parkingLot(corpus, problems);
  checkC4_decisions(corpus, problems);
  checkC5_structure(corpus, problems);
  checkC6_snapshot(corpus, problems);
  checkC7_docs(corpus, problems);
  return problems;
}

// -------------------------------------------------------------------------------------- self-test
function selftest() {
  const verbose = process.argv.includes("--verbose");
  const fixRoot = join(HERE, "__fixtures__", "docs-truth");
  const dirs = readdirSync(fixRoot).filter((d) => statSync(join(fixRoot, d)).isDirectory());
  let failed = 0;
  for (const d of dirs.sort()) {
    const dir = join(fixRoot, d);
    const spec = JSON.parse(readFileSync(join(dir, "_expect.json"), "utf8")); // {mode, expect, note}
    let problems = [];
    if (spec.mode === "docs") {
      const manifest = loadManifest(dir);
      problems = lintDocsRoot(dir, manifest);
    } else if (spec.mode === "docs-missing") {
      const manifest = existsSync(join(dir, "docs-truth.manifest.json")) ? loadManifest(dir) : { current_required: [], stateFile: "STATE.md" };
      problems = lintDocsRoot(join(dir, "no-such-root"), manifest); // force unresolved root
    } else if (spec.mode === "memory") {
      lintMemory(join(dir, "memory"), spec.allow || [], problems);
    } else if (spec.mode === "memory-missing") {
      lintMemory(join(dir, "no-such-memory"), [], problems);
    }
    const got = problems.length > 0 ? "fail" : "pass";
    const ok = got === spec.expect;
    if (!ok) failed++;
    console.log(`${ok ? "OK  " : "MISS"}  ${d}  expect=${spec.expect} got=${got}${ok ? "" : "  <-- " + (problems[0] || "(no problem raised)")}`);
    if (verbose && problems.length) for (const p of problems) console.log(`         · ${p}`);
  }
  if (failed) { console.error(`\nself-test: ${failed} fixture(s) did not meet expectation`); process.exit(1); }
  console.log(`\nself-test: all ${dirs.length} fixtures meet expectation`);
}

// --------------------------------------------------------------------------------------- main CLI
function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--selftest")) return selftest();

  const rootArg = argv.includes("--root") ? argv[argv.indexOf("--root") + 1] : undefined;
  const memArg = argv.includes("--memory") ? argv[argv.indexOf("--memory") + 1] : undefined;
  const docsOnly = argv.includes("--docs-only");

  const root = resolveDocsRoot(rootArg);
  const manifest = loadManifest(HERE); // real repo manifest lives next to this file
  const problems = lintDocsRoot(root, manifest);

  if (!docsOnly) {
    const memAllow = manifest.memory_allow || [];
    lintMemory(resolveMemoryDir(memArg), memAllow, problems);
  }

  if (problems.length) {
    console.error(`docs-truth-lint: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error("  " + p);
    process.exit(1);
  }
  console.log(`docs-truth-lint: clean (${root})`);
}

main();
