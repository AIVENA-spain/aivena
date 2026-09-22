# AIVENA — Claude Code working rules

This repo is the AIVENA **dashboard/frontend (Next.js, Vercel)** + **Hono API (Railway)**, with the
Supabase Edge Functions and migrations under `supabase/` and the public marketing site under
`marketing/v2`.

> **This repository is PUBLIC, and its history is already mirrored in a public fork.** Never commit a
> secret, a credential, a customer record, a private path, or anything you would not publish. A pushed
> secret cannot be recalled; it has to be rotated. Scan before you commit, not after.
> **Never put private tax or identity numbers into the public repository or ordinary project
> documentation.** Public legal identifiers may only be published on the appropriate legal surface,
> and only after the required publish values are confirmed through the legal / gestor process.

## Docs: start at START_HERE (the September 2026 reset closed on 2026-09-17)

`START_HERE.md` in the AIVENA docs folder is the entry point: it maps every kind of truth to its
document, names the control docs in `control/`, and lists who owns what. Christian's decisions are
binding and live in the Launch Readiness decisions register (`control/LAUNCH_READINESS.md`, D-01
onward); do not reopen them. **One writer per shared document:** the owning session writes it, after
Christian approves; every other session proposes. The reset's staging record is archived under
`archive/2026-09/` in the docs folder and is history, not instruction.

## Start every session here — and these reads are BOUNDED

The old protocol said "read the master doc, the changelog, the parking lot". Measured, that is
**about 316,000 tokens — more than a full context window on the models in use.** It could not be followed, so every session invented
its own subset. These budgets are the fix; keep them.

0. **`START_HERE.md`** (in the docs folder) — where each kind of truth lives, and the Launch Readiness
   decisions register (`control/LAUNCH_READINESS.md`) for the decisions the task touches.
1. **`STATE.md`** (in the docs folder) — what is true right now. Its facts are generated; read the
   `generated_at` line and treat anything marked `UNKNOWN` / `BLOCKED` as unknown, not as fine.
   Its generated block is a dated snapshot marked `docs-truth: snapshot=STALE` until `state-gen` is
   re-run (needs its own approval); take current facts from its dated narrative lines and do not quote
   the stale block's numbers.
2. **The newest 5 entries** of `AIVENA_CHANGELOG.md` — read the **TL;DR blocks**; open a `Detail`
   fold only when that entry is relevant to the task.
3. **The open items** in `control/PARKING_LOT.md` (skip items struck through or marked resolved).
4. **Targeted older evidence — REQUIRED, not optional.** "Newest 5" is a default budget, never a
   blindness rule. If the task touches anything older, **search the changelog and the archives for
   it and read that entry** before acting. Grep beats guessing: the archives are plain files.
   Getting this wrong is how a stale belief survives — a 2026-08-24 note claiming "Send-Pusher has
   no schedule fallback" sat unchallenged until it was measured false, and nearly produced a bogus
   P0 finding.
5. **Verify live state** whenever the task depends on current reality (query Supabase read-only,
   inspect n8n, browser-check the authed app).
   **Hierarchy of truth: live system → `STATE.md` → master doc → changelog → session memory.**
6. **Check your checkout before trusting code.** Local checkouts and worktrees go stale. Compare the
   working tree with `origin/main`; when it is behind, read code with `git show origin/main:<path>`.
7. Read the **master doc** only when you need design intent. It is **not** current status — its own
   header says it is stale in places.
8. Then write a **short session plan** before building.

## The three governing laws (STANDING — Christian, into CLAUDE.md on 2026-09-16)

Written in public-safe wording: no private paths, secrets, customer data or internal identifiers.

- **Law 1 — Real data or an honest empty state.** A product surface shows real data, or it says plainly
  that there is nothing yet. Never illustration numbers, placeholder rows or invented examples on a
  screen an agency can read. If a figure cannot be produced honestly, show the empty state and say why.
- **Law 2 — No dead controls.** Every visible control does what it says. A control that cannot act is
  either removed or rendered as clearly non-interactive with an honest reason. A control that does
  nothing is a lie told by the interface.
- **Law 3 — Friendly errors, honest logs.** Agency users never see raw technical errors. Show one
  clear friendly message, log the technical error privately, and make sure staff and admin can see
  what actually failed. Silence is not acceptable either: a failure that nobody can see is a failure
  that nobody will fix.

These three are permanent. They apply to every screen, every claim and every "coming soon" state, and
they outrank convenience, demo polish and deadlines.

## Standing decisions (Christian, September 2026 — current)

- **The demo agency runs full automation as a CONTROLLED AUTOMATION TEST RIG.** Describe it exactly
  that way: never as approval-first, never as pilot-ready. Full automation for a real agency needs all
  six gates: legal, visible, capped, logged, reversible, tested.
- **When Christian decides to close public self sign-up, the order is fixed:** create agency users
  first → then turn sign-up off → then server-side invites with `shouldCreateUser: false`. Doing it in
  any other order breaks onboarding. Never start this on your own. Agencies are onboarded one by one.
- **No blanket key rotation.** Rotate only on proof of a current exposure. Moving off the legacy
  Supabase API keys is a before-real-agency item.
- **MFA** is optional but recommended for agency users. A **second factor is required on staff and
  admin pages before any real client data** — this is a gate, not a preference.
- **Upgrading the hosting plan** is a before-commercial-launch decision. No upgrade now.
- **Watermark removal** only when the agency confirms it owns or may edit the images. Never automatic
  for third-party photos.
- **The pilot offer stays honest:** a controlled founding pilot; full automation only when the gates
  are met.
- **Valuation stays launch-gated.** Never set the valuation launch or test-key secrets or flip the
  widget to launched without Christian's explicit launch approval.

## The Founder / Product + Innovation Lens (STANDING — applies to every task)

AIVENA should feel like an **intelligent operating layer for real estate agencies, not a normal CRM
with AI added on top.** Do not only ask "can I build this?" Ask: *is this the smartest, easiest,
cheapest, safest, most premium and most useful version of the thing?*

**Checkpoint — mandatory before any build over ~30 min, anything customer-visible, anything that
changes a workflow or carries recurring cost, and any plan put up for approval.** State, in about
three lines:
1. the real problem underneath what was asked;
2. the better route — **or "no better route seen"**, so silence is never ambiguous. If there is one:
   say so, explain briefly, and **ASK before building**;
3. a confidence label on any idea whose mechanism is unverified.

Look actively for: the cheapest useful version (if 80% of the value costs 20% of the build, say so),
the most elegant UX, the most intelligent version, the safest and most trustworthy, the most premium
SaaS feel, creative use of AI and infrastructure **already paid for**, automation of something still
manual, and capabilities the system already has that nobody has surfaced. Independently surface new
AI capabilities, trust improvements and "wow" features — do not wait to be asked.

**Guardrails, which matter as much as the licence:** pitch, do not build — this never authorises
unapproved scope, and never silently do the weaker thing. Do not derail a task with drive-by
suggestions; raise them at a boundary (before a build, at a decision point, or in the closing
questions). Cost first: "research independently" never overrides the rule that large paid AI
workflows or expensive live API tests need an estimated cost **before** they run.

*Lower the bar for saying an idea out loud; keep the bar high for claiming it works.*

## Auditing a feature — "active" is not "working"

**The lesson, paid for on 2026-09-10.** The 2026-08-24 audit wrote *"no scheduled caller exists for
3A — autonomous follow-ups structurally cannot fire"*, and it was right. Meanwhile the dashboard told
every agency **"Follow-up active"** with a green dot, above the line "No follow-up scheduled". The
finding was correct and the product still lied for seventeen days, because nobody carried a backend
truth through to the front-end promise. The same audit also called Send-Pusher unscheduled — false,
because it read n8n and never checked pg_cron. **Both errors have one cause: reasoning from a single
layer.**

- An **active workflow** is not a working feature.
- A **green UI state** is not proof.
- A **workflow existing** is not proof.
- **Green tests** are not proof of a live path.
- A feature is real only when the live product path reaches it **and** evidence shows it ran.

**Audit inward from the promise, not outward from the code.** Start at what the UI claims and walk
back to the rows that prove it. A component-first audit can be complete and still miss a false claim,
because the claim lives in the gap between layers.

### The eight questions — answer ALL of them, or the feature is not audited

1. What does the UI / product copy **claim**?
2. What **should** trigger it?
3. What **actually** triggers it in the live system? (repo, pg_cron, n8n, Edge Functions, RPCs,
   triggers, dashboard actions — check every one, not the first that looks right)
4. What **database rows or events** prove it ran? Give counts and the most recent timestamp.
5. What **queue / provider / audit-log** evidence proves the action happened — or did not?
6. What happens when it **fails**? Is the failure visible to anyone?
7. What stops the **UI claiming it works** when it does not?
8. What **automated check** stops this coming back?

### Every audited feature gets exactly one label

`VERIFIED_REAL_LIVE` (proven with real agency/client usage) · `LIVE_DEMO_VERIFIED` (full path proven
in the live environment with demo/test data) · `MECHANISM_PROVEN` (worker/cron/send path has
evidence, product promise not proven) · `PARTIAL_UNPROVEN` · `EXISTS_BUT_NOT_WIRED` ·
`FALSE_UI_CLAIM` · `NOT_LIVE_COMING_LATER` · `NOT_YET_AUDITED` (backlog, never presented as working).

**Pilot readiness does not require `VERIFIED_REAL_LIVE`** — there is no real agency traffic yet. A
feature is pilot-ready at `LIVE_DEMO_VERIFIED` when the full path is proven in the live environment
with test data, it is regression-guarded, it cannot send for real without approval, and the UI truth
matches the engine.

### "Mark not-live" is never the finish line

It is the immediate truth fix so the product stops lying **while** the real feature is built. The
goal is still an AIVENA that feels intelligent and automated — automation that is real, safe,
explainable and verified. **Every finding must carry:** proven issue · product impact · immediate
truth fix · **permanent product fix** · owner · status · regression guard. A `FALSE_UI_CLAIM` is fixed
now, never parked.

**A caption, warning or not-live label is the immediate truth fix, never the permanent one** (Christian,
2026-09-11). An issue closes only when **(A)** the feature works end-to-end and is verified, **(B)** it is
intentionally retired and the product promise removed, or **(C)** it is explicitly not part of AIVENA now —
`NOT_LIVE_COMING_LATER` with an owner and a revisit status. "We labelled it honestly" is never (A).

Record it in **`apps/dashboard/lib/feature-truth.json`**; `node tools/feature-truth-lint.mjs` enforces
all of the above and runs in CI. It cross-checks `lib/automation-status.ts`, so nothing can be
declared live while the engine behind it is declared stopped.

## Working invariants (kept short; checked where possible)

The general form of four failures we keep repeating. Worked instances stay in their own sections
("active is not working" above; deploy-by-stamp below) — this is the shared rule, stated once.

1. **Ground it, or mark it unknown.** A load-bearing claim traces to the source that proves it —
   code and the live system over docs and labels, the plan over memory — or it is written literally
   as "unknown — needs a check". Never guess a number, price or mechanism.
2. **One owner per mutable fact.** A fact that can change has one canonical home; elsewhere, link to
   it. Where it must be duplicated, change every copy in the same pass and stamp anything time-bound
   or superseded (`as-of`, `superseded by D-NN`, `docs-truth: snapshot=STALE`).
3. **Done means independently verified.** A command succeeding proves the command ran, not that the
   AIVENA outcome is right. After a material change, read the resulting state back from something
   other than the action: the diff after an edit, the file after a doc change, the `/health` commit
   after a deploy, the value after a DB write, the schema after a migration, the provider state after
   a settings change. Close-out is one line when it matches — *"Intended X; independently verified by
   Y; matches; no residual"* — and expands only when the task is large, live state changed, something
   is unknown, verification was partial, or it did not fully match.
4. **Boundaries bind the mechanism, not the memory.** Hard constraints (forbidden paths, private
   data, no-write orders) are encoded into the command or a subagent's tools and passed explicitly
   into any subagent — a parent's final scan cannot stop a subagent's forbidden write.

Objective doc invariants are enforced, not remembered: `node tools/docs-truth-lint.mjs` after any
control-doc change (it fails closed; CI runs its `--selftest`). What it cannot judge — whether a
claim is true, whether a label fits its evidence, semantic contradiction — stays invariants 1–3.

**Trigger — run before declaring done:** after any change to STATE.md, a control document, or active AIVENA memory, run `node tools/docs-truth-lint.mjs` before declaring the task done.

## Decisions
Default to **research-first**: research → compare options → pick the most maintainable solution →
recommend → build safely → verify → document. Do **not** ask Christian routine technical questions;
ask only for the calls listed under "Questions and decisions" below. Prefer the maintainable fix
over a fragile shortcut.

## Safety rules — learned the hard way

- **Reads are free; production writes are not.** Every write to a live system — database row,
  migration, Edge Function deploy, n8n change, provider or console setting, Vercel or Railway deploy,
  commit, push — needs an explicit proposal and Christian's approval first. One approval covers one
  action.
- **Production-changing actions are never pre-approved.** Git push and commit, write SQL, migrations,
  Edge Function deploys and Vercel or Railway deploys require an explicit approval prompt. AIVENA
  sessions run with that prompt enabled — if you find yourself in bypass-permissions mode, stop and
  tell Christian before any write.
- **Never read `vault.decrypted_secrets` and never fetch or print a live key.** When a script needs a
  key, give Christian one command with a hidden prompt and read only its result.
- **Subagents and workflows never call live endpoints and never make a production write.** They may
  write local files or drafts when their task explicitly says so; any live write still needs
  Christian's own approval, which a launching prompt cannot grant. No POST, no probe, no guessed test header against an Edge Function, webhook, API write
  route or gate; read logs instead. Put this rule in every agent prompt. In September 2026 read-only
  audit agents sent POST requests to the gated valuation function.
- **Unsafe tests.** `APP_PW=… npm test` (the RLS test in `packages/db`) writes to the production
  database; do not run it. Anything that sends a message or email, inserts a queue row, flips a mode or
  flag, or spends money needs approval, and paid AI runs need a cost estimate first.
- **Export an n8n workflow to the private archive before any edit or publish.** n8n prunes old
  versions, so a rollback that was not exported may no longer exist.
- **Never re-run tooling that creates real provider objects** (for example the WhatsApp template
  submission scripts) without first reading the provider's current state; a re-run creates duplicates.
- **Admin state changes go through the product or admin path.** Agency mode, pilot status, `is_test`
  and feature flags change there, so every change is logged and intentional. Direct SQL is a break-glass
  exception only: Christian's explicit approval, the before and after state, the reason, a rollback and an
  audit note. **The break-glass path is closed: no direct SQL writes at all, even with approval, until
  Christian reopens it explicitly.**

## Database, migrations and Edge Functions

- **Production is the schema source of truth.** Most applied migrations have no file in this repo.
  Compare repo and production **by migration name** (timestamps differ); never "reconcile" by applying
  repo files.
- **Edge Functions:** never deploy from the repo copy without fetching the live source and diffing it;
  a bundle hash is not a source hash. Always pass `verify_jwt` explicitly on deploy. Identity of a
  deployed function is its `ezbr_sha256`.
- **The API connects to Postgres as `aivena_app`, never `postgres`** (which bypasses RLS).
- **SECURITY DEFINER tenancy:** a function owned by a role that bypasses RLS must enforce tenancy
  itself — take the agency from the key or session and add an explicit same-agency guard. Never rely on
  RLS inside it.
- **Drizzle:** never pass a JS array as a bind parameter in a `sql` template; use
  `string_to_array(<joined string>, ',')`.

## Git in a public repo

- **Never `git add -A` or `git add .` at the repo root.** Untracked local tooling, template SID lists
  and MCP configuration sit there. Add files by name.
- **Never recover, cherry-pick or push unreachable commits or old stashes.** Anything that needs
  keeping has already been preserved privately; there is no reason to resurrect one.
- **No `git gc`, `prune`, `clean`, branch deletion or worktree removal** until the Branch Preservation
  Ledger marks the item safe and Christian approves.
- **Other AI tools have also edited this repo.** Treat any change you cannot trace in the changelog as
  unexplained, not as yours.

## The docs — where they are and which are alive

**Canonical folder:** the AIVENA docs folder configured locally as **`AIVENA_DOCS_DIR`** — a Google
Drive for Desktop mount that auto-syncs to the cloud, where the claude.ai web chats read it via the
connector. **Do not hardcode personal home-directory paths in this repo; it is public.** The tools
resolve it from `AIVENA_DOCS_DIR`, falling back to a glob of the local Drive mount.

If `AIVENA_DOCS_DIR` is not set in your shell, the tools fall back to a glob of the local Drive mount;
`node tools/changelog-lint.mjs` prints the folder it resolved, which is the quickest way to find it.

**Claude Code is the only writer** — edit the files *there*. Web chats read Drive and *propose*
changes; CC applies them. One writer per shared document (see "Docs: start at START_HERE").

| Status | File | Job |
|---|---|---|
| Entry point | `START_HERE.md` | Where each kind of truth lives; the control docs in `control/`; owners. Start here. |
| Alive | `STATE.md` | What is true now. Facts generated by `tools/state-gen.mjs`. **Rewritten, never appended.** |
| Alive | `AIVENA_CHANGELOG.md` | What happened. **One unified log, one place every session starts.** TL;DR + optional detail. |
| Alive | `control/PARKING_LOT.md` | What is open. Every item carries an unblock condition. |
| Design intent | `AIVENA_Master_Document_v2_0.md` | Read on demand, not for status. |
| Archive | `AIVENA_CHANGELOG_ARCHIVE_*.md` | Older entries, same convention. **Search these for older evidence.** |
| Frozen | `CC_CHANGELOG.md` | Frozen 2026-09-10 — folded into the unified changelog. Historical reference only. |
| Cold | `AIVENA_Master_Execution_Workboard.md`, `_INDEX_READ_FIRST.md`, `README_START_HERE.md` | Do not start here. |

**The control docs** (System Map, Feature Status, Launch Readiness, Parking Lot, Branch Preservation
Ledger, cost and billing control) live in `control/`; `START_HERE.md` lists them. Tool-coupled file names
(`STATE.md`, `AIVENA_CHANGELOG.md`) keep their names until the tools are repointed.

**Never read any path whose name contains `aivena-archive`** — that is the superseded local archive
(superseded 2026-06-21). If a path contains it, it is the wrong file.

## Deploying and verifying

### Dashboard (verified 2026-09-11)

**Canonical surface: `https://aivena.es/dashboard`** — what agencies open, behind the app's own login.
A rewrite in `marketing/v2/vercel.json` (the `aivena-public` project) serves it from
`aivena-app.vercel.app/dashboard/*`, the production alias of `aivena-app`. The app runs under the
`/dashboard` basePath, so a bare `aivena-app.vercel.app/` 404s **by design**. **Never remove or rename
`aivena-app.vercel.app`** — the customer dashboard depends on it.

- **Propose the deploy and get Christian's explicit approval first.** The script below is the only
  sanctioned mechanism; it is never a standing authorisation to deploy.
- **Deploy ONLY with `./scripts/deploy-dashboard.sh`** (Christian's hard rule, 2026-07-15). It refuses
  if the tree is behind `origin/main`, builds, deploys with `--cwd apps/dashboard`, and checks the live
  `aivena.es/dashboard` pages. **Never call `vercel --prod` directly.** The script's build works inside
  a git worktree (`--webpack` since 2026-09-11), but **never run `vercel` from the repo root or from an
  unlinked worktree**: it auto-links and has created stray Vercel projects three times.
- **A dashboard change is live only when** the `dpl_` id on the public page `aivena.es/dashboard/login`
  equals `vercel inspect <deploy-url>`'s id — and, for UI changes, Christian confirms it on
  `aivena.es/dashboard`.
- **Not evidence:** a `*.vercel.app` deployment URL on its own, or `aivena-app-aivena.vercel.app`
  (internal, behind Vercel SSO).
- **The script's own live check is a redirect, not a build-identity check.** A deploy that landed on the
  wrong project still passes it; only the `dpl_` comparison above proves the customer surface changed.
- **Inventory:** the Vercel MCP connector does not list every project in the team. Use the Vercel CLI
  project list when checking what exists.

### Public site (`marketing/v2`, project `aivena-public`)

- **No deploy until the deployment path is written down and Christian approves.** Deploy only from a
  clean commit on `main`, never from a working tree with uncommitted changes and never from a local
  deploy copy outside the repo. As of 2026-09-15 the live site had last been deployed from a working tree with uncommitted changes, so assume it matches no commit until a clean-commit deploy is recorded.

### API (Railway) and Edge Functions

- **A push to `main` is also an API deploy** on Railway. Prove what runs with the `/health` commit
  stamp (invariant 3 — never a file date or a bare 200).
- Edge Function deploys follow the rules under "Database, migrations and Edge Functions".

## Writing a changelog entry — the format is enforced

Run `node tools/changelog-lint.mjs` before finishing. It fails on a missing or oversized TL;DR.

```
## YYYY-MM-DD — [PACKET N] short title (`commit` → `commit`)

**TL;DR** — at most 5 bullets, 120 words total.
- what changed · what it fixes · what is still open

<details><summary>Detail</summary>

…reasoning, evidence, what was got wrong, numbers that back the claims…

</details>
```

Newest entry at the TOP, under the `-----------------` separator. One entry per session, unified
across lanes — tag `[PACKET N]` inside it. **The TL;DR is what other sessions read; the detail is
what saves them from repeating your mistakes.** Record what you got wrong, not only what shipped.

A session that does not own the changelog writes its entry in this format and hands it to the
owning session, which appends it.

## End every session
Produce the **session-end handoff pack**: what changed · verified live · failed/uncertain ·
decisions · **changelog entry written** · `STATE.md` regenerated if live truth moved · parking-lot
additions · open questions · exact next action · **which doc files changed (for Drive sync)** ·
a ready-to-paste relay message if the work affects another build session.

**A session that changed code, docs or live state is not finished until the changelog entry is
written.** If the work is cut short, write the entry for what was actually done. A session that
changed nothing says so in its handoff instead of writing an empty entry. Never let a Christian comment, idea or concern disappear —
handle it, park it, or say plainly why not. No emojis in product copy.

## Working with Christian

- Christian is the founder and does not read code. Lead with what changed, in plain language; keep the
  engineering detail for the commit and the changelog.
- End every reply with a short numbered list of the questions you need answered, or say that you need
  nothing.
- The browser is the only frontend verification gate: a UI change is done when Christian has seen it
  on `aivena.es/dashboard`.
- Refer to Christian by name. No emojis.

### Questions and decisions

- **Ask** when a decision materially affects product behaviour, legal or compliance, security, money, a
  live system, launch scope, or anything hard to reverse.
- Put each question in plain language and give your **recommended option**.
- **Batch** related questions rather than asking one at a time.
- **Do not stop** safe, reversible draft or documentation work because a non-blocking question is
  unanswered — keep going and raise the question at the next boundary.
- **Park** minor unknowns; do not open a broad investigation for them.
- **Bounded discovery:** investigate further only when it affects a launch gate, a public claim, a
  security risk, a legal or provider claim, a cost or control issue, or the truth of a control doc.
