import { describe, expect, it } from "vitest";
import {
  isWhatsappChannel,
  replyWindowState,
} from "./overview-window-model";

describe("isWhatsappChannel", () => {
  it("matches whatsapp case-insensitively with surrounding space", () => {
    expect(isWhatsappChannel("whatsapp")).toBe(true);
    expect(isWhatsappChannel("WhatsApp")).toBe(true);
    expect(isWhatsappChannel(" WHATSAPP ")).toBe(true);
  });
  it("is false for other channels and nullish", () => {
    expect(isWhatsappChannel("email")).toBe(false);
    expect(isWhatsappChannel("web")).toBe(false);
    expect(isWhatsappChannel("phone")).toBe(false);
    expect(isWhatsappChannel(null)).toBe(false);
    expect(isWhatsappChannel(undefined)).toBe(false);
  });
});

describe("replyWindowState", () => {
  it("non-WhatsApp channels always sendable, label none (ignores window flag)", () => {
    expect(replyWindowState("email", false)).toEqual({
      windowClosed: false,
      canSendDraft: true,
      label: "none",
    });
    // Even if the RPC reports whatsapp_window_open=false for a non-WhatsApp lead,
    // we must NOT treat it as a closed WhatsApp window.
    expect(replyWindowState("web", null)).toEqual({
      windowClosed: false,
      canSendDraft: true,
      label: "none",
    });
  });

  it("WhatsApp + window open → sendable, label open", () => {
    expect(replyWindowState("whatsapp", true)).toEqual({
      windowClosed: false,
      canSendDraft: true,
      label: "open",
    });
  });

  it("WhatsApp + window closed → not sendable, label closed", () => {
    expect(replyWindowState("whatsapp", false)).toEqual({
      windowClosed: true,
      canSendDraft: false,
      label: "closed",
    });
  });

  it("WhatsApp + unknown window (null) → fail-safe to closed", () => {
    expect(replyWindowState("whatsapp", null)).toEqual({
      windowClosed: true,
      canSendDraft: false,
      label: "closed",
    });
    expect(replyWindowState("whatsapp", undefined)).toEqual({
      windowClosed: true,
      canSendDraft: false,
      label: "closed",
    });
  });
});
