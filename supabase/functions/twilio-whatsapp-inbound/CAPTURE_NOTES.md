# twilio-whatsapp-inbound — capture notes + media audit (Amanda P0, 2026-08-26)

## Capture provenance
- `index.ts` is BYTE-EXACT live v10 (ACTIVE), fetched via Supabase MCP 2026-08-26
  (only the repo-capture header comment was prepended).
- ezbr_sha256 `b23cb3e876d1dd6918e3d3d5e78c0df42d83442e3133a065b54310fbb1848089`,
  deployed ~2026-06-08 (created 1781172982426). verify_jwt=false (Twilio posts raw).

## What it does today (v10)
X-Twilio-Signature HMAC vs pinned PUBLIC_URL (auth token via `_get_platform_secret` RPC)
→ resolve agency by To number (`agency_settings.whatsapp_from_number` + provider=twilio)
→ `webhook_events` journal row (full form payload; processing_status lifecycle:
received / unresolved_agency / lead_create_failed / conversation_create_failed /
duplicate_ignored / message_insert_failed / processed)
→ find-or-create lead (opt-in + consent_log on create; 24h-window timestamp
`last_inbound_whatsapp_at` on every inbound)
→ upsert open whatsapp conversation → insert `conversation_messages` (idempotent
on provider_message_id, 23505 → duplicate_ignored)
→ fire-and-forget POST to n8n W4C webhook (Haiku suggested reply → dashboard task).

## MEDIA AUDIT (design doc §1 "Media P0" — the red-team fear is CONFIRMED)
- `NumMedia` is parsed and `message_type` becomes `"media"`, BUT:
  - `MediaUrl0..N` / `MediaContentType0..N` are NOT persisted on the message row —
    they survive ONLY inside `webhook_events.payload` (full form dump). Recoverable
    forensically, invisible to the conversation pipeline.
  - Twilio media URLs require auth and EXPIRE — a later fetch from webhook_events
    may already be dead. Real media handling must fetch at receive time.
- **W4C draft trigger requires `body.trim().length > 0`** → a voice note (or image)
  with no caption is stored and then SILENTLY IGNORED by the AI path. "Voice note
  containing a cancellation" gets no draft, no task, no alert today.

## Planned v3 changes (Amanda P0 — prepared in-repo, deploy is approval-gated)
1. **Outbox**: insert an `amanda_inbound_queue` row after the message insert
   (idempotent on provider_message_id) — the engine consumes the queue; W4C
   fire-and-forget becomes the legacy path, flag-gated per agency so cutover is
   gradual (engine replaces Haiku drafter at P1 SHADOW).
2. **Media Law v0**: persist MediaUrl/ContentType on the message row + enqueue
   media messages TOO (no body-length gate). Engine behavior: never auto-act on
   unparsed media — acknowledge + ask to type it (full STT/vision at the P2 gate).
3. Keep: signature validation, agency resolution, lead/consent creation,
   idempotency, webhook_events journaling — all unchanged (AT-3 discipline:
   empty/no-op cases stay byte-identical).
