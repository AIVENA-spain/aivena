# Amanda auto-mode — go-live pack (P0 → P0.5 → P1)

Everything below is PREPARED; each numbered step is an approval-gated prod write
that will be proposed to Christian individually (7-point proposal per house rule).
Code is committed on `p2-amanda-answer-first`; nothing activates until these land.

## Step 1 — Apply the P0 schema migration
File: `supabase/migrations/20260826220000_amanda_automode_p0_schema.sql`

Dry-run checks to run (read-only) BEFORE apply:
```sql
-- 1a. The bookings EXCLUDE constraint must be satisfiable by existing rows:
SELECT b1.id, b2.id FROM bookings b1 JOIN bookings b2
  ON b1.agency_id = b2.agency_id AND b1.id < b2.id
 AND COALESCE(b1.agent_id, b1.agent_name, 'agency') = COALESCE(b2.agent_id, b2.agent_name, 'agency')
 AND b1.status IN ('requested','confirmed','rescheduled') AND b2.status IN ('requested','confirmed','rescheduled')
 AND tstzrange(b1.scheduled_at, b1.scheduled_at + make_interval(mins => COALESCE(b1.duration_minutes,60)), '[)')
     && tstzrange(b2.scheduled_at, b2.scheduled_at + make_interval(mins => COALESCE(b2.duration_minutes,60)), '[)');
-- expected: 0 rows. Any overlap → cancel/adjust those test bookings first.

-- 1b. Confirm none of the new table/column names collide:
SELECT table_name FROM information_schema.tables WHERE table_schema='public'
 AND table_name IN ('amanda_inbound_queue','amanda_pending_actions','viewing_slot_holds','amanda_turn_usage','amanda_lead_state','agency_amanda_knowledge','amanda_questions','amanda_question_events','amanda_funnel_events');
-- expected: 0 rows.
```
Rollback: every object is new (drops cleanly); the bookings/conversations/agency_settings
column adds are additive with defaults; the EXCLUDE constraint can be dropped standalone.

## Step 2 — Deploy inbound EF v3
File: `supabase/functions/twilio-whatsapp-inbound/index.v3-proposed.ts` (rename to index.ts at deploy).
Requires Step 1 (amanda_inbound_queue + agency_settings.amanda_mode must exist).
Behavior change matrix: agencies amanda_mode off/shadow → IDENTICAL behavior to v10
(W4C keeps drafting) + queue rows written; approval+ → engine is the drafter, W4C skipped.
Rollback: redeploy the captured v10 (`index.ts`).

## Step 3 — Set Railway env `AMANDA_ENGINE_ENABLED=true`
Starts the 20s outbox drain. Still inert per agency until amanda_mode leaves 'off'.

## Step 4 — P0.5 Live Demo Track (test agency only)
```sql
UPDATE agency_settings SET amanda_mode = 'full'
 WHERE agency_id = '<TEST_AGENCY_ID>';   -- is_test agency only; Christian's phone plays the buyer
```
Demo script: Christian messages the test agency number → Amanda answers property
questions (grounded) → "is the price negotiable?" → ticket appears on /tasks (+
amanda_questions row) → viewing offered with two explicit slots → Christian
confirms → booking lands in bookings + Google Calendar (existing sync) →
send_queue freeform relays ride the LIVE executor (opt-out/window law enforced there).
DEPENDENCY TO VERIFY on first demo: the n8n Send-Pusher drains engine-authored
freeform rows the same as approval-authored ones (same table, same shape,
requested_by='amanda_engine').

## Step 5 — P1 SHADOW on the real pilot posture
Per-agency: amanda_mode='shadow' → engine runs silently on real inbound (zero
effects — structurally), W4C keeps drafting; turn_usage accumulates real cost +
escalation calibration. Promotion to 'approval' = engine becomes the drafter.

## Meta templates to submit (Step 6, own approval — English masters below, the
## 12-language versions go through the proven translation pipeline first)
1. `amanda_answer_relay_v1` (UTILITY) — §3b window-expired relay:
   "Hi {{1}}, about {{2}}: I checked with the office — {{3}}. Reply here if you'd like to talk it through."
2. `viewing_confirm_v1` (UTILITY): "Hi {{1}}, your viewing of {{2}} is set for {{3}}. Reply CHANGE if you need another time."
3. `viewing_reminder_daybefore_v1` (UTILITY): "Hi {{1}}, a reminder: your viewing of {{2}} is tomorrow at {{3}}. See you there! Reply CHANGE if you need another time."
4. `viewing_morning_of_v1` (UTILITY): "Hi {{1}}, see you today at {{3}} for {{2}}. {{4}} will meet you there."
5. `post_viewing_followup_v1` (UTILITY): "Hi {{1}}, thanks for visiting {{2}} today. How did it feel? I'd love to hear your impressions."
6. `first_touch_lead_v1` (UTILITY): "Hi {{1}}, thanks for your enquiry about {{2}} — I'm Amanda from {{3}}. What would you like to know?"
   (NOTE: existing approved viewing_confirmation/viewing_reminder/viewing_followup/missed_call_recovery
   templates may already cover 2/3/5 — AUDIT the live 13-language set first and only create
   what's genuinely missing; never duplicate an approved template.)
7. Agent-facing ticket templates (ES/EN only, P2 ping spine): question ping + reminder + confirmation.

## What stays OFF regardless (standing orders intact)
Valuation gate untouched · no real-lead traffic in FULL mode (test agency only until P2/P3 gates) ·
whatsapp-send-execute v6.7 repo/live divergence unchanged (engine rides the LIVE v20 executor) ·
no Twilio SID anywhere in code or logs.
