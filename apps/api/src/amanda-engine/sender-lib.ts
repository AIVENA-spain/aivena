// Amanda engine — pure sender classification (house pattern: importable
// without a database so tests need no env). process-turn-db re-exports it.

// "Did a HUMAN operator write this outbound?" — POSITIVE and fail-CLOSED.
// The old denylist (anything not amanda/engine/system) was wrong in the worst
// direction: EVERY outbound WhatsApp lands as sent_by='send-pusher' (the
// executor's caller tag) whether Amanda or an agent triggered it, so Amanda's
// OWN replies read as a colleague's. Live consequences (demo 2026-08-28):
// her open office questions were auto-closed as 'answered by a human',
// leaving dashboard tasks the agent could never answer (the answer endpoint
// 409s on a closed question); her "still waiting on the office" note was
// suppressed; and her own words were fed back to her as [agent] turns.
// A human is only ever an explicit identity (operator email or agent/operator
// marker). Unknown → NOT human: tickets stay open and answerable.
const AUTOMATION_SENDER_RE = /^(system|send-pusher|amanda|engine|worker|n8n|api)/i;
export function isHumanSender(sentBy: string | null | undefined): boolean {
  if (!sentBy) return false;
  if (AUTOMATION_SENDER_RE.test(sentBy.trim())) return false;
  return sentBy.includes('@') || /^(agent|operator|human)\b/i.test(sentBy.trim());
}

