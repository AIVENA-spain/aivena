# Amanda engine — incident one-pager (P1, design §11.15)

Written for Christian (non-coder). Every action here is copy-paste or click-level.
When in doubt: **Step 0 stops everything safely** — Amanda off is always a safe state
(agents keep working exactly as before her).

## Step 0 — THE BIG RED SWITCH (always safe)
Turn Amanda off for ONE agency (Supabase Dashboard → SQL editor):
```sql
UPDATE agency_settings SET amanda_mode = 'off' WHERE agency_id = '<AGENCY_ID>';
```
Turn the whole engine off (Railway → aivena-production → Variables):
set `AMANDA_ENGINE_ENABLED` to `false` → redeploy. Inbound messages still arrive,
are stored, and queue up; agents still see everything in the Inbox; W4C drafting
continues for off/shadow agencies. NOTHING is lost — the queue is durable and
processing resumes where it stopped when re-enabled.
**But note:** any agency at approval or higher gets NO drafts while the global
switch is off (W4C stays suppressed for them) — for those agencies also run the
per-agency Step 0 above, or accept draft-less inbox until re-enable. Also: while
an agency is per-agency 'off', its inbound is NOT queued for Amanda — re-enabling
does not back-process the gap (agents saw everything in the Inbox regardless).

## Symptom → action
| Symptom | Likely cause | Action |
|---|---|---|
| Amanda replied something wrong/weird to a buyer | model quality | Step 0 for that agency → tell CC with the conversation link; the transcript + turn_usage row identify the turn; CC adds it to the golden suite within 48h (§11 rule) |
| Amanda stopped replying (assisted/full agency) | engine tick failing / queue stuck | Railway logs, search `[amanda-engine]`; if errors repeat → Step 0 global, tell CC. Buyers are NOT lost: rows wait in amanda_inbound_queue |
| Same message answered twice | idempotency breach (should be impossible) | Step 0 for the agency; keep the two message timestamps; tell CC — this is a critical bug |
| Booking at a wrong/duplicate time | constraint breach (should be impossible — DB enforced) | Step 0; fix the booking by hand in /viewings (reschedule/cancel — calendar follows); tell CC with the booking id |
| Buyer says "stop"/opted out but still got a message | executor gate breach | Step 0 GLOBAL immediately; tell CC — compliance-critical |
| Costs look high | runaway loop | Supabase SQL: `SELECT date_trunc('day', created_at) d, count(*), sum(input_tokens+output_tokens) FROM amanda_turn_usage GROUP BY 1 ORDER BY 1 DESC LIMIT 7;` → if one day explodes, Step 0 + tell CC |
| "Amanda paused herself after repeated errors" task appeared | circuit breaker tripped (5 errors in 10 min) | Nothing urgent: her drain is paused 15 min for that agency and resumes alone; messages are safe in the queue. If it re-trips, Step 0 + tell CC with the task's last_error |
| Buyer says they never got the viewing reminder | reminder rung | Check send_queue for idempotency_key 'viewing-reminder:<booking_id>'; the Google Calendar 24h/2h popups are the belt — the viewing itself was never at risk |
| Ticket (Q to office) never answered, buyer waiting | agent missed it | Open the conversation in the Inbox and answer the buyer YOURSELF (Amanda sees your reply as ground truth and stops saying she's waiting; the ticket auto-closes). Automatic relay of office answers arrives with the P2 ping spine. |

## What can NEVER happen by construction (if it does, it's a code bug — tell CC verbatim)
- Shadow/off agency: any buyer-visible message or booking from the engine.
- A send to an opted-out lead (the executor refuses) or outside the 24h WhatsApp window (the engine refuses to enqueue in the last hour of the window; Twilio rejects anything out-of-window; the full atomic executor-side gate lands before P2).
- A booking without the buyer's explicit confirmation of an exact proposed slot.
- Overlapping viewings for the same agent (Postgres EXCLUDE constraint refuses).
- An IBAN/account number in an Amanda message (send-path law blocks + escalates).

## After any incident
1. Leave the mode where you set it (off is fine indefinitely).
2. Paste CC: what you saw, when, which lead/agency, screenshots.
3. CC's contract: root-cause in the transcript/journal, fix, add the case to the
   golden suite, and only then propose re-enabling.
