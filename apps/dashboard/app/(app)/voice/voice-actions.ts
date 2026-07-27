"use server";

import { apiFetch, ApiError } from "@/lib/api/client";

/**
 * Approval-first "send text-back" for a missed call. POSTs to
 * /voice/calls/:id/send-recovery, which calls the agent-authorized
 * agent_send_voice_recovery RPC. When the WhatsApp provider + approved template
 * exist it enqueues the send; otherwise it returns the exact friendly reason
 * (e.g. "WhatsApp sending isn't connected yet"). Never sends directly.
 */
type Ok = { ok: true };
type Err = { ok: false; error: string };

export async function sendRecoveryAction(callId: string): Promise<Ok | Err> {
  try {
    await apiFetch(
      `/api/v1/voice/calls/${encodeURIComponent(callId)}/send-recovery`,
      { method: "POST" },
    );
    return { ok: true };
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[voice] send-recovery failed:", callId, detail);
    // API-supplied friendly 4xx text passes through (incl. the "not connected yet"
    // reasons); anything else collapses to the calm generic line.
    if (err instanceof ApiError && err.status < 500 && err.message) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: "Something went wrong — please try again." };
  }
}
