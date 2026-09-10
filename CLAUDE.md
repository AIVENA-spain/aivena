# AIVENA — Claude Code working rules

This repo is the AIVENA **dashboard/frontend (Next.js, Vercel)** + **Hono API (Railway)**, with the
Supabase Edge Functions and migrations under `supabase/`.

> **This repository is PUBLIC.** Never commit a secret, a credential, a customer record, or anything
> you would not publish. Scan before you commit, not after.

## Start every session here — and these reads are BOUNDED

The old protocol said "read the master doc, the changelog, the parking lot". Measured, that is
**316,000 tokens — 158% of a context window.** It could not be followed, so every session invented
its own subset. These budgets are the fix; keep them.

1. **`STATE.md`** (in the docs folder) — what is true right now. Its facts are generated; read the
   `generated_at` line and treat anything marked `UNKNOWN` / `BLOCKED` as unknown, not as fine.
2. **The newest 5 entries** of `AIVENA_CHANGELOG.md` — read the **TL;DR blocks**; open a `Detail`
   fold only when that entry is relevant to the task.
3. **The open items** in `AIVENA_Parking_Lot_Open_Threads.md` (skip items struck through or marked
   resolved).
4. **Targeted older evidence — REQUIRED, not optional.** "Newest 5" is a default budget, never a
   blindness rule. If the task touches anything older, **search the changelog and the archives for
   it and read that entry** before acting. Grep beats guessing: the archives are plain files.
   Getting this wrong is how a stale belief survives — a 2026-08-24 note claiming "Send-Pusher has
   no schedule fallback" sat unchallenged until it was measured false, and nearly produced a bogus
   P0 finding.
5. **Verify live state** whenever the task depends on current reality (query Supabase, inspect n8n,
   browser-check the authed app).
   **Hierarchy of truth: live system → `STATE.md` → master doc → changelog → session memory.**
6. Read the **master doc** only when you need design intent. It is **not** current status — its own
   header says it is stale in places.
7. Then write a **short session plan** before building.

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
truth fix · real feature fix · owner · status · regression guard. A `FALSE_UI_CLAIM` is fixed now,
never parked.

Record it in **`apps/dashboard/lib/feature-truth.json`**; `node tools/feature-truth-lint.mjs` enforces
all of the above and runs in CI. It cross-checks `lib/automation-status.ts`, so nothing can be
declared live while the engine behind it is declared stopped.

## Decisions
Default to **research-first**: research → compare options → pick the most maintainable solution →
recommend → build safely → verify → document. Do **not** ask Christian routine technical questions;
ask only for business / product / legal / destructive / live-risk calls. Prefer the maintainable fix
over a fragile shortcut.

## The docs — where they are and which are alive

**Canonical folder:** the AIVENA docs folder configured locally as **`AIVENA_DOCS_DIR`** — a Google
Drive for Desktop mount that auto-syncs to the cloud, where the claude.ai web chats read it via the
connector. **Do not hardcode personal home-directory paths in this repo; it is public.** The tools
resolve it from `AIVENA_DOCS_DIR`, falling back to a glob of the local Drive mount.

**Claude Code is the only writer** — edit the files *there*. Web chats read Drive and *propose*
changes; CC applies them.

| Alive | File | Job |
|---|---|---|
| ✅ | `STATE.md` | What is true now. Facts generated by `tools/state-gen.mjs`. **Rewritten, never appended.** |
| ✅ | `AIVENA_CHANGELOG.md` | What happened. **One unified log, one place every session starts.** TL;DR + optional detail. |
| ✅ | `AIVENA_Parking_Lot_Open_Threads.md` | What is open. Every item carries an unblock condition. |
| 📖 | `AIVENA_Master_Document_v2_0.md` | Design intent only — read on demand, not for status. |
| 🗄️ | `AIVENA_CHANGELOG_ARCHIVE_*.md` | Older entries, same convention. **Search these for older evidence.** |
| 🗄️ | `CC_CHANGELOG.md` | Frozen 2026-09-10 — folded into the unified changelog. Historical reference only. |
| ❄️ | `AIVENA_Master_Execution_Workboard.md`, `_INDEX_READ_FIRST.md`, `README_START_HERE.md` | COLD. Do not start here. |

**Never read or edit `~/Documents/aivena-archive/`** — superseded 2026-06-21. A path containing
`aivena-archive` is the wrong file.

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

## End every session
Produce the **session-end handoff pack**: what changed · verified live · failed/uncertain ·
decisions · **changelog entry written** · `STATE.md` regenerated if live truth moved · parking-lot
additions · open questions · exact next action · **which doc files changed (for Drive sync)** · a
ready-to-paste relay message if the work affects another build session.

**A session is not finished until the changelog entry is written.** If the work is cut short, write
the entry for what was actually done. Never let a Christian comment, idea or concern disappear —
handle it, park it, or say plainly why not. No emojis in product copy.
