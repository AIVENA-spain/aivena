import { apiFetch, ApiError } from "@/lib/api/client";
import { PageLoadError } from "@/components/shell/page-error";
import type { VoiceRecoveryStatusResponse } from "@/lib/api/types";

import { CallsWorkspace } from "./voice-workspace";

export const dynamic = "force-dynamic";

/**
 * Calls — missed-call recovery (P2-A). Shows the honest readiness of the WhatsApp
 * text-back (the exact prerequisites the engine gates on) and the recent call log
 * with per-call recovery status. Read-only: this page never sends or enables
 * anything — the actual text-back fires server-side once a live provider + approved
 * template exist and the agency has enabled it.
 */
export default async function VoicePage() {
  let data: VoiceRecoveryStatusResponse;
  try {
    data = await apiFetch<VoiceRecoveryStatusResponse>("/api/v1/voice/recovery-status");
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[/voice] load failed:", detail);
    return <PageLoadError />;
  }

  return <CallsWorkspace readiness={data.readiness} calls={data.calls} />;
}
