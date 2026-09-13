import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReplyLanes } from "@/lib/api/types";
import { hasAutoSend } from "./automation-safety";

const lanes = (over: Partial<ReplyLanes>): ReplyLanes =>
  ({ default_lane: "review_first", by_temperature: {}, by_channel: {}, by_action: {}, ...over }) as ReplyLanes;

describe("temperature never controls sending, and never appears to (Christian, 2026-09-13)", () => {
  it("a per-temperature auto_send value no longer makes Settings claim automatic sending", () => {
    expect(hasAutoSend(lanes({ by_temperature: { cold: "auto_send", warm: "auto_send", hot: "auto_send", super_hot: "auto_send" } }))).toBe(false);
    expect(hasAutoSend(lanes({ by_temperature: { cold: "auto_send" } }))).toBe(false);
  });
  it("the default lane still counts", () => {
    expect(hasAutoSend(lanes({ default_lane: "auto_send" }))).toBe(true);
    expect(hasAutoSend(lanes({}))).toBe(false);
  });
  it("no lanes: no claim", () => {
    expect(hasAutoSend(undefined)).toBe(false);
  });
  it("the helper does not read by_temperature at all", () => {
    expect(readFileSync(join(__dirname, "automation-safety.ts"), "utf8")).not.toMatch(/lanes\??\.by_temperature|\bTEMPS\b/);
  });
});
