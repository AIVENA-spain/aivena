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
Behavior change matrix: amanda_mode 'off' → IDENTICAL to v10 (W4C drafts, NO queue
rows — an off agency's rows would accumulate with nothing draining them);
'shadow' → v10 behavior + queue rows written (engine runs silently);
approval+ → engine is the drafter, W4C skipped. Note: the message insert and the
queue insert are two sequential API calls, not one transaction — a failed queue
insert is logged on webhook_events (message safe, engine turn missed); the P1
sweep should diff conversation_messages vs the queue for on-dial agencies.
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
send_queue freeform relays ride the LIVE executor (opt-out law there; the engine pre-checks the 24h window at enqueue).
DEPENDENCY TO VERIFY on first demo: the n8n Send-Pusher drains engine-authored
freeform rows the same as approval-authored ones (same table, same shape,
requested_by='amanda_engine').
DEMO NUANCE (be ready for it): when asked "is the price negotiable?", Amanda
files the ticket and SAYS she'll come back with the office's answer — the
automatic relay is the P2 ping spine, so in this demo the agent answers the
buyer manually from the Inbox (Amanda then treats that human reply as ground
truth and the ticket auto-closes as 'handoff').

## Step 5 — P1 SHADOW on the real pilot posture
Per-agency: amanda_mode='shadow' → engine runs silently on real inbound (zero
effects — structurally), W4C keeps drafting; turn_usage accumulates real cost +
escalation calibration. Promotion to 'approval' = engine becomes the drafter.

## Meta templates — AUDITED against the live approved set (read-only, 2026-08-26)
The live 13-language approved set ALREADY covers most of the viewing lifecycle —
reuse, never duplicate:
- viewing confirm → **viewing_confirmation_v1** (approved, 13 langs; vars {{1}} name {{2}} agency {{3}} date {{4}} time {{5}} property) ✓
- day-before reminder → **viewing_reminder_v1** (approved, 13 langs) ✓
- post-viewing follow-up → **viewing_followup_v1** (approved, 13 langs) ✓
- missed-call first touch → **missed_call_recovery_v1** (approved, 13 langs) ✓

GENUINELY NEW (submit at build start of their phase; English masters below, 12-language
versions through the proven translation pipeline + Christian's line-by-line review first):
1. `amanda_answer_relay_v1` (UTILITY, needed by P2 ask-agency relay): "Hi {{1}}, about {{2}}: I checked with the office — {{3}}. Reply here if you'd like to talk it through."
2. `first_touch_lead_v1` (UTILITY, needed by the P2 entry kit): "Hi {{1}}, thanks for your enquiry about {{2}} — I'm Amanda from {{3}}. What would you like to know?"
3. Optional: `viewing_morning_of_v1` (UTILITY, morning-of logistics — the approved reminder is day-before only): "Hi {{1}}, see you today at {{3}} for {{2}}. {{4}} will meet you there."
4. Agent-facing ticket templates (ES/EN only, P2 ping spine): question ping + reminder + confirmation.

## Review status + rollout laws (added after the 43-agent adversarial verify pass)
The P0 build was adversarially reviewed (4 lenses, every finding independently
verified against code AND the live DB): 39 findings raised, 38 confirmed, ALL 38
fixed in commit 8f01fac (findings JSON: docs/amanda-automode/v1.3_p0_code_review.json).
Laws that came out of it:
- **ROLLOUT ORDER IS LAW:** Railway `AMANDA_ENGINE_ENABLED=true` BEFORE any agency's
  amanda_mode leaves off/shadow — EF v3 suppresses W4C for approval+ agencies, so
  flipping an agency first = nobody drafts (silent zero-draft state).
- The one-tap booking EXECUTE endpoint does not exist yet (P2): below FULL mode a
  buyer-confirmed booking files an `amanda_booking_confirm` task (visible on /tasks)
  and the agent books via /viewings; FULL mode books autonomously (P0.5 demo path).
- The full atomic send gate (window/mute/disclosure re-check at the moment of send)
  moves INTO whatsapp-send-execute before P2 assisted-auto; today the engine
  pre-checks the 24h window at enqueue and the executor enforces opt-out.

## Deferral ledger — UPDATED after the 2026-08-27 build block (no gap is silent)
BUILT during the block (were deferrals, now live code on the branch):
- ✅ Ask-agency answer→relay loop (one-box answer on /tasks → engine relays, mode-governed)
- ✅ One-tap booking execute (`POST /tasks/:id/execute-booking` + Confirm-booking box)
- ✅ cancel_viewing tool (exactly-one law; human task below FULL; shadow zero-write)
- ✅ Conversation ordering machinery (claim RPC v2: per-conversation serialization + 12s burst debounce + folding)
- ✅ Circuit breaker (per-agency drain pause + one alert task; mode untouched)
- ✅ Property staleness hedge (45-day note riding get_property_details)
- ✅ Agency settings card + knowledge write surface + deterministic §5 save-time scrubber
- ✅ Day-one calibration columns (turn_class / gate_failures / cannot_answer in turn_usage)

STILL DEFERRED, on purpose, with phase:
- **WhatsApp agent pings (ping spine v1)**: P2, after the sit-down with Christian (second sender, cadence, quiet hours) — the dashboard ticket surface covers P0.5/P1.
- **STT/vision (Media Law v1)**: P2 gate (keeps the STT vendor out of the DPA annex until then).
- **Atomic send gate INSIDE whatsapp-send-execute** (window/mute/disclosure re-check at send moment): before P2 assisted-auto on real traffic; today = engine 23h pre-check + executor opt-out law.
- **PATCH-reschedule** (move the calendar event instead of cancel+create): P2 polish.
- **Episodic memory (layer 3)** + per-agency euro hard-degrade + cross-channel identity linking + typing indicator: per the §11b trigger ledger.
- **cannot_answer routing** (ticket vs handoff): wired after P1-shadow calibration; persisted per turn since the conformance pass.
- **consent_service/consent_marketing split columns**: P2 with Christian's marketing-consent decision.
- **Funnel events not yet emitted**: engaged / attended / no_show / post_viewing / offer / dormant / reactivated / alert_opt_in — land with their features (viewing lifecycle outcome capture + entry kit, P2). Emitted today: lead_created, intel_captured, question_ticket, viewing_booked, handoff.

## What stays OFF regardless (standing orders intact)
Valuation gate untouched · no real-lead traffic in FULL mode (test agency only until P2/P3 gates) ·
whatsapp-send-execute v6.7 repo/live divergence unchanged (engine rides the LIVE v20 executor) ·
no Twilio SID anywhere in code or logs.
