# PROPOSAL — Step 1: apply the Amanda P0 schema migration (7-point, awaiting Christian's go)

**1. Exact action:** Apply migration `supabase/migrations/20260826220000_amanda_automode_p0_schema.sql`
to the production Supabase project `atminvhrybxegpdtnnpl` via `apply_migration`
(name: `amanda_automode_p0_schema`).

**2. Exact SQL:** the migration file, verbatim (repo + this folder's snapshot). Contents:
`btree_gist` extension · 9 new tables (`amanda_inbound_queue`, `amanda_pending_actions`,
`viewing_slot_holds`, `amanda_turn_usage`, `amanda_lead_state`, `agency_amanda_knowledge`,
`amanda_questions`, `amanda_question_events`, `amanda_funnel_events`) all FORCE-RLS
agency-fenced + anon/authenticated revoked · additive columns on `bookings`
(viewing_type + outcome fields), `conversations` (AI disclosure/mute/claim), and
`agency_settings` (`amanda_mode` DEFAULT **'off'**, `amanda_settings`) · the
`booking_slot_range` IMMUTABLE wrapper + the bookings EXCLUDE arbiter · 2 partial/unique
indexes · 3 SECURITY DEFINER functions (`pick_and_claim_amanda_inbound` v2,
`pick_and_mark_viewing_reminders`) granted to aivena_app/service_role only.

**3. Rows/tables affected:** creates objects only; existing rows: ZERO modified
(all column adds have defaults or NULL). The EXCLUDE constraint validates existing
bookings at apply time.

**4. Expected before state (verified live 2026-08-27, all dry-runs GREEN):**
none of the 9 tables exist (0 collisions) · no column collisions on the 3 altered
tables · **0 overlapping active bookings** (the constraint cannot fail validation —
there are currently 0 active bookings at all) · no function-name collisions.

**5. Expected after state:** all objects exist; `agency_settings.amanda_mode = 'off'`
for EVERY agency (nothing behaves differently anywhere — the engine worker isn't
even running until Step 3's env flag, and W4C drafting continues unchanged);
re-running the dry-run queries returns the objects as present.

**6. Rollback:** every object is new → clean drops
(`DROP TABLE … CASCADE` ×9, `ALTER TABLE … DROP COLUMN` ×12, `DROP FUNCTION` ×3,
`ALTER TABLE bookings DROP CONSTRAINT bookings_active_slot_exclusive`,
`DROP FUNCTION booking_slot_range`). No data migration to reverse.

**7. Then wait:** nothing else happens on apply. Steps 2 (EF v3 deploy), 3 (env flag)
and 4 (test-agency full mode) are separate proposals, each with its own go.
