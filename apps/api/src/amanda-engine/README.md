# amanda-engine — auto-mode conversation engine (P0)

Build contract: `docs/amanda-automode/DESIGN_v1.2_2026-08-26.md` (canonical copy in
the Drive docs folder). Build go: 2026-08-26. Sequence: lean P0 → P0.5 Live Demo
Track (is_test agencies, FULL mode) → P1 SHADOW → P2 → P3.

## State (P0, in progress)
- `modes.ts` — tool-layer mode enforcement (the dial: off/shadow/approval/assisted/full).
  SHADOW is defanged BY CONSTRUCTION: `runActionTool` never invokes the real effect
  for non-read tools; `modes.test.ts` pins that structurally. Unknown mode fails closed.
- `turn-id.ts` — deterministic idempotency key f(conversation, MessageSid).
- `outbox-worker.ts` — queue drain skeleton (claim via SECURITY DEFINER RPC, lease
  steal, bounded backoff). NOT wired into index.ts yet — activation requires the
  P0 schema apply (approval-gated) + `AMANDA_ENGINE_ENABLED=true`.
- Schema: `supabase/migrations/20260826220000_amanda_automode_p0_schema.sql`
  (PREPARED, NOT APPLIED — apply gets its own proposal + dry-run, incl. checking
  existing bookings against the EXCLUDE constraint).
- Inbound EF v10 captured byte-exact: `supabase/functions/twilio-whatsapp-inbound/`
  (+ CAPTURE_NOTES.md media audit — voice notes are currently stored but silently
  skipped by the AI path; fixed by the planned v3 outbox+Media-Law changes).

## State (P0 CODE-COMPLETE, 2026-08-26 late)
Everything above plus: validators/datetime/lead-state/confirmation law,
agentic loop + tools + prompt + gates (typed grounding), turn orchestrator,
db backends + processTurnDb, EF v3 proposed, golden suite (32 scenarios, one
command: `npx vitest run apps/api/src/amanda-engine/golden/`), 411 tests green.
Adversarially reviewed (43 agents, 4 lenses + per-finding verification vs the
LIVE DB): 38/38 confirmed findings fixed (docs/amanda-automode/v1.3_p0_code_review.json).

## Next (all approval-gated — see docs/amanda-automode/GO_LIVE_PACK.md)
1. Apply the P0 migration (dry-runs in the pack) → 2. Deploy EF v3 →
3. Railway AMANDA_ENGINE_ENABLED=true (ROLLOUT ORDER IS LAW — env before any
   agency leaves off/shadow) → 4. P0.5 full-mode demo on the is_test agency →
5. P1 SHADOW per real agency → 6. Meta template submissions.
P2 build starts with: one-tap booking execute endpoint, ping spine v0, atomic
send gate inside whatsapp-send-execute, STT/vision Media Law v1.
