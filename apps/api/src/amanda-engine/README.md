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

## Next (in order)
1. Golden-suite harness skeleton (25–30 core scenarios, one command, test agency).
2. Turn orchestrator: debounce → conversation lease → agentic loop (sonnet-5) →
   gates → mode dispatch → send. The web-Amanda brain (`routes/amanda-llm.ts`)
   is the promotion source.
3. Inbound EF v3 prepared in-repo (outbox insert + media persistence) — deploy gated.
4. P0.5: is_test full-loop demo with seeded slots + Christian's phone.
