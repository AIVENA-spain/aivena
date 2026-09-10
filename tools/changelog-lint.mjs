#!/usr/bin/env node
/**
 * changelog-lint — keeps the live changelog readable.
 *
 * The changelog reached ~201,000 tokens and 187 entries before anyone noticed, which made the
 * documented session-start protocol impossible to follow. Discipline alone did not hold it: the
 * session that diagnosed the problem had just written the largest recent entry. So the rule is
 * checked, not stated.
 *
 *   node tools/changelog-lint.mjs            # lint the live changelog
 *   node tools/changelog-lint.mjs --file X   # lint a specific file
 *
 * Exit 1 on any failure. Archives are never linted — they are history, frozen as written.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve the AIVENA docs folder WITHOUT hardcoding a personal path.
 * This repository is public: no home-directory paths, no email addresses.
 *   1. $AIVENA_DOCS_DIR if set (preferred — set it in your shell profile)
 *   2. otherwise glob the Google Drive mount, which varies per machine
 */
function resolveDocsDir() {
  if (process.env.AIVENA_DOCS_DIR) return process.env.AIVENA_DOCS_DIR;
  const base = join(homedir(), "Library", "CloudStorage");
  if (existsSync(base)) {
    for (const d of readdirSync(base)) {
      if (!d.startsWith("GoogleDrive-")) continue;
      const p = join(base, d, "My Drive", "aivena docs", "master doc and changelog");
      if (existsSync(p)) return p;
    }
  }
  throw new Error("Cannot find the AIVENA docs folder. Set AIVENA_DOCS_DIR to it.");
}

const MAX_TLDR_BULLETS = 5;
const MAX_TLDR_WORDS   = 120;
const MAX_FILE_TOKENS  = 40_000;   // beyond this, split an archive off

const argIdx = process.argv.indexOf("--file");
const file = argIdx !== -1 ? process.argv[argIdx + 1] : join(resolveDocsDir(), "AIVENA_CHANGELOG.md");

if (!existsSync(file)) {
  console.error(`changelog not found: ${file}`);
  console.error("If the Drive mount is not available, pass --file <path>.");
  process.exit(2);
}

const raw = readFileSync(file, "utf8");
const sepAt = raw.indexOf("-----------------");
const body = sepAt === -1 ? raw : raw.slice(sepAt + 17);

const entries = body
  .split(/(?=^## \d{4}-\d{2}-\d{2})/m)
  .filter((e) => /^## \d{4}-\d{2}-\d{2}/.test(e));

const problems = [];
const fileTokens = Math.round(raw.length / 4);

for (const e of entries) {
  const header = e.split("\n", 1)[0].trim();
  const label = header.slice(0, 72);

  const m = e.match(/\*\*TL;DR\*\*\s*\n([\s\S]*?)(?:\n\s*<details>|\n## |$)/);
  if (!m) {
    problems.push(`MISSING TL;DR   ${label}`);
    continue;
  }
  const tldr = m[1].trim();
  const bullets = tldr.split("\n").filter((l) => l.trim().startsWith("-"));
  const words = tldr.replace(/[`*_\[\]()]/g, " ").split(/\s+/).filter(Boolean).length;

  if (bullets.length === 0) problems.push(`TL;DR HAS NO BULLETS   ${label}`);
  if (bullets.length > MAX_TLDR_BULLETS)
    problems.push(`TL;DR ${bullets.length} bullets (max ${MAX_TLDR_BULLETS})   ${label}`);
  if (words > MAX_TLDR_WORDS)
    problems.push(`TL;DR ${words} words (max ${MAX_TLDR_WORDS})   ${label}`);
  if (!/\[PACKET \d\]/.test(header))
    problems.push(`HEADER missing [PACKET N]   ${label}`);
}

console.log(`linted ${entries.length} entries in ${file.split("/").pop()}  (~${fileTokens.toLocaleString()} tok)`);

if (fileTokens > MAX_FILE_TOKENS) {
  problems.push(
    `FILE TOO LARGE: ~${fileTokens.toLocaleString()} tok (ceiling ${MAX_FILE_TOKENS.toLocaleString()}). ` +
    `Split the older entries into AIVENA_CHANGELOG_ARCHIVE_<range>.md, keeping the same convention ` +
    `and a link from the live file. Never delete an entry.`,
  );
}

if (problems.length === 0) {
  console.log("  OK — every entry has a TL;DR within budget, and the file is within its ceiling.");
  process.exit(0);
}
console.log(`\n  ${problems.length} problem(s):`);
for (const p of problems) console.log(`    ${p}`);
console.log("\n  Format: '## YYYY-MM-DD — [PACKET N] title (commits)', then **TL;DR** with up to");
console.log("  5 bullets / 120 words, then the rest inside <details><summary>Detail</summary>.");
process.exit(1);
