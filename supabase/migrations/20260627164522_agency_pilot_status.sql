-- C2 — agency pilot-lifecycle state (Chat 4 readiness / go-live system).
--
-- C1 decision (2026-06-27): a SEPARATE GLOBAL lifecycle column, NOT an overload of
-- agencies.status. agencies.status stays operational (active|paused|archived);
-- pilot_status is the pilot go-live lifecycle, flipped ADMIN-ONLY (future C3
-- SECURITY DEFINER RPC) — never auto-flipped on computed eligibility. Per-gate
-- readiness comes from GET /api/v1/readiness (B2); this column is the single
-- global "where is this agency in its pilot" state.
--
-- Lifecycle values:
--   setup           — onboarding in progress (default for every agency)
--   ready_for_pilot — readiness met + AIVENA-reviewed; not yet flipped live
--   live            — admin flipped it live (pilot active)
--   paused          — pilot temporarily paused (distinct from operational status='paused')
--   blocked         — held on an external/manual gate (autónomo, legal, etc.)
--
-- SAFETY: additive + non-destructive. ADD COLUMN with a CONSTANT default is a
-- metadata-only change in PG11+ (no table rewrite); the 5 existing agencies
-- backfill to 'setup' via the default. agencies.status and its CHECK are untouched.
-- No RLS/grant change here: pilot_status inherits agencies' existing posture
-- (aivena_app has UPDATE, RLS-fenced to the tenant's own row), identical to
-- status/slug — and no agency-facing route writes agencies. The admin-only write
-- hardening (REVOKE UPDATE(pilot_status) FROM aivena_app, so only the C3 SECURITY
-- DEFINER RPC can flip it) ships WITH C3 (the write path), before pilot_status
-- drives any go-live logic.

ALTER TABLE public.agencies
  ADD COLUMN pilot_status text NOT NULL DEFAULT 'setup'
    CHECK (pilot_status IN ('setup', 'ready_for_pilot', 'live', 'paused', 'blocked'));

COMMENT ON COLUMN public.agencies.pilot_status IS
  'Pilot go-live lifecycle (C1/C2 2026-06-27): setup -> ready_for_pilot -> live; paused/blocked as needed. Admin-only writes via the C3 SECURITY DEFINER RPC; NOT the same axis as agencies.status (operational). Readiness eligibility is computed live by GET /api/v1/readiness.';
