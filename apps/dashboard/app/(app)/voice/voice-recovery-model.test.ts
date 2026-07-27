import { describe, it, expect } from "vitest";
import {
  computeRecoveryReadiness,
  callRecoveryState,
  isMissed,
  type RecoveryFacts,
  type VoiceCall,
  type RecoveryReadiness,
} from "./voice-recovery-model";

function facts(over: Partial<RecoveryFacts> = {}): RecoveryFacts {
  return {
    flag_enabled: true,
    template_key: "voice_recovery",
    auto_toggle: "false",
    whatsapp_lane: "review_first",
    template_approved: true,
    provider_live: true,
    ...over,
  };
}

describe("computeRecoveryReadiness", () => {
  it("all prerequisites met + approval-first posture → ready_approval", () => {
    const r = computeRecoveryReadiness(facts());
    expect(r.canSend).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.headline).toBe("ready_approval");
    expect(r.autoSend).toBe(false);
  });

  it("K2 auto only when toggle ON *and* lane not review_first", () => {
    // toggle on but lane review_first → still approval-first (strictest wins)
    expect(computeRecoveryReadiness(facts({ auto_toggle: "true" })).autoSend).toBe(false);
    // toggle on + auto_send lane → auto
    const r = computeRecoveryReadiness(facts({ auto_toggle: "true", whatsapp_lane: "auto_send" }));
    expect(r.autoSend).toBe(true);
    expect(r.headline).toBe("ready_auto");
  });

  it("accepts a real boolean auto_toggle too", () => {
    expect(computeRecoveryReadiness(facts({ auto_toggle: true, whatsapp_lane: "auto_send" })).autoSend).toBe(true);
  });

  it("switched on but missing template → waiting, missing=['template']", () => {
    const r = computeRecoveryReadiness(facts({ template_approved: false }));
    expect(r.canSend).toBe(false);
    expect(r.headline).toBe("waiting");
    expect(r.missing).toEqual(["template"]);
  });

  it("switched on but missing provider → waiting, missing=['provider']", () => {
    const r = computeRecoveryReadiness(facts({ provider_live: false }));
    expect(r.headline).toBe("waiting");
    expect(r.missing).toEqual(["provider"]);
  });

  it("switched off → off, and lists everything still needed in order", () => {
    const r = computeRecoveryReadiness(
      facts({ flag_enabled: false, template_approved: false, provider_live: false }),
    );
    expect(r.headline).toBe("off");
    expect(r.missing).toEqual(["enable", "template", "provider"]);
    expect(r.canSend).toBe(false);
  });
});

const ready: RecoveryReadiness = computeRecoveryReadiness(facts());
const notReady: RecoveryReadiness = computeRecoveryReadiness(facts({ provider_live: false }));
const readyAuto: RecoveryReadiness = computeRecoveryReadiness(
  facts({ auto_toggle: "true", whatsapp_lane: "auto_send" }),
);

function call(over: Partial<VoiceCall> = {}): VoiceCall {
  return {
    id: "c1",
    status: "no_answer",
    from_number: "+34600000000",
    lead_id: "l1",
    lead_name: "Test",
    lead_opt_in: "pending",
    recovery_sent: false,
    ...over,
  };
}

describe("isMissed", () => {
  it("only no_answer + voicemail are missed", () => {
    expect(isMissed("no_answer")).toBe(true);
    expect(isMissed("voicemail")).toBe(true);
    expect(isMissed("answered")).toBe(false);
    expect(isMissed("busy")).toBe(false);
  });
});

describe("callRecoveryState", () => {
  it("answered call → not_applicable", () => {
    expect(callRecoveryState(call({ status: "answered" }), ready)).toBe("not_applicable");
  });
  it("already sent → sent", () => {
    expect(callRecoveryState(call({ recovery_sent: true }), ready)).toBe("sent");
  });
  it("missed with no lead/number → no_contact", () => {
    expect(callRecoveryState(call({ lead_id: null }), ready)).toBe("no_contact");
    expect(callRecoveryState(call({ from_number: "  " }), ready)).toBe("no_contact");
  });
  it("opted out → opted_out", () => {
    expect(callRecoveryState(call({ lead_opt_in: "opted_out" }), ready)).toBe("opted_out");
  });
  it("recoverable but setup incomplete → waiting_setup", () => {
    expect(callRecoveryState(call(), notReady)).toBe("waiting_setup");
  });
  it("recoverable + ready + approval-first → pending_approval", () => {
    expect(callRecoveryState(call(), ready)).toBe("pending_approval");
  });
  it("recoverable + ready + auto → pending_auto", () => {
    expect(callRecoveryState(call(), readyAuto)).toBe("pending_auto");
  });
});
