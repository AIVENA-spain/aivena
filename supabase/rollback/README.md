# Rollback artefacts — NOT deploy sources

Files here are verbatim copies of what was running in production immediately
before a deployment. They exist so a deploy is never a one-way door.

**Do not edit them, and do not deploy from here as part of normal work.**
The current intended implementation of every function lives under
`supabase/functions/<slug>/`. This directory is deliberately outside
`supabase/functions/` so nothing here can be mistaken for a function, picked up
by a deploy, or counted by the function manifest.

Supabase does not keep previous Edge Function versions retrievable — the
Management API exposes only the currently deployed body, and there is no
documented rollback endpoint. Once a new version is deployed, the previous
source is gone unless it was captured first. That is why these files exist.

| file | function | version | captured | sha256 |
|---|---|---|---|---|
| `property-valuation.v10.PRODUCTION.ts` | `property-valuation` | v10 | 2026-09-09 | `ca2254fd0d810463d27cb478eb5d3debe04a96ae47d18f3818bf977e28b6da7b` |

## How a rollback would work

1. Confirm the problem is the new version, not the environment.
2. Redeploy the file above as `index.ts` for that function slug, passing
   `verify_jwt` explicitly (`false` for `property-valuation`) so the setting
   cannot silently change during a rollback.
3. Verify with the same safe smoke used for the deploy.

## Functions with no artefact here

`whatsapp-send-execute` v20 is deliberately absent. Its deployed source contains
the Twilio Account SID as a literal, so copying it into git would put a live
credential in version control. Its rollback route is recorded in the deployment
notes instead.
