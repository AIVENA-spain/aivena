"use server";

import { apiFetch } from "@/lib/api/client";

/**
 * Per-conversation automation switch (Christian 2026-08-29: "turn off automation
 * on one person fully or turn on automation fully on one person, maybe like a
 * switch and then it changes mode in a way you can see it").
 *
 * `effective` is what the ENGINE will do on the next inbound message — not what
 * was chosen. Agency-off and a live handoff both force it to "off", so the pill
 * can never claim Amanda is answering when she is not.
 */
export type ConversationMode = {
  agency_mode: "off" | "shadow" | "approval" | "assisted" | "full";
  override: "off" | "shadow" | "approval" | "assisted" | "full" | null;
  paused: boolean;
  effective: "off" | "shadow" | "approval" | "assisted" | "full";
};

export async function getConversationModeAction(
  conversationId: string,
): Promise<ConversationMode | null> {
  try {
    return await apiFetch<ConversationMode>(
      `/api/v1/amanda/conversations/${conversationId}/mode`,
    );
  } catch {
    // A missing mode must never break the thread view — the pill just hides.
    return null;
  }
}

export async function setConversationModeAction(
  conversationId: string,
  mode: "inherit" | "off" | "shadow" | "approval" | "assisted" | "full",
): Promise<{ ok: boolean; error?: string }> {
  try {
    await apiFetch(`/api/v1/amanda/conversations/${conversationId}/mode`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "save_failed" };
  }
}
