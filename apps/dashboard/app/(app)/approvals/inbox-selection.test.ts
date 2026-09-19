import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  directTaskId,
  inboxUrlFor,
  isDirectTaskId,
  resolveInitialSelection,
} from "./inbox-selection";

// 2026-09-18: /approvals?leadId=<id> for a lead not in the list opened the first
// buyer instead — another person's WhatsApp conversation, under a Send button.
const rows = [
  { taskId: "t-norwegian", leadId: "lead-norwegian" },
  { taskId: "t-other", leadId: "lead-other" },
];

describe("resolveInitialSelection — a named lead or task opens exactly that one, or nothing", () => {
  it("a named lead in the list opens its row", () => {
    expect(resolveInitialSelection(rows, undefined, "lead-other")).toEqual({ kind: "open", taskId: "t-other" });
  });

  it("a named lead NOT in the list opens nothing — never the first row", () => {
    expect(resolveInitialSelection(rows, undefined, "lead-missing")).toEqual({ kind: "unresolved" });
  });

  it("a named task NOT in the list opens nothing — never the first row", () => {
    expect(resolveInitialSelection(rows, "t-gone", undefined)).toEqual({ kind: "unresolved" });
  });

  it("a direct row for the named lead is opened", () => {
    const withDirect = [{ taskId: directTaskId("lead-new"), leadId: "lead-new" }, ...rows];
    expect(resolveInitialSelection(withDirect, undefined, "lead-new")).toEqual({ kind: "open", taskId: "lead:lead-new" });
  });

  it("only a bare /approvals falls back to the default", () => {
    expect(resolveInitialSelection(rows, undefined, undefined)).toEqual({ kind: "default" });
  });
});

describe("inboxUrlFor — a reload reopens the same client", () => {
  it("a direct row reloads by its lead, a task row by its task", () => {
    expect(inboxUrlFor(directTaskId("abc"))).toBe("/approvals?leadId=abc");
    expect(inboxUrlFor("t-1")).toBe("/approvals?lead=t-1");
    expect(isDirectTaskId("lead:abc")).toBe(true);
    expect(isDirectTaskId("t-1")).toBe(false);
  });
});

describe("the workspace uses this rule and no longer defaults when a link named someone", () => {
  const src = readFileSync(join(__dirname, "inbox-workspace.tsx"), "utf8");
  it("resolves the initial selection through resolveInitialSelection", () => {
    expect(src).toMatch(/resolveInitialSelection\(/);
  });
  it("never builds the reload URL by hand (a direct row would reload as a task)", () => {
    expect(src).not.toMatch(/`\/approvals\?lead=\$\{/);
  });
});
