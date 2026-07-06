import { describe, it, expect } from "vitest";
import { reasonBullets, filterStaleBudgetBullets, nextActionBullets } from "./client-intelligence-lib";

describe("reasonBullets", () => {
  it("splits a clause list into trimmed, capitalised bullets", () => {
    expect(reasonBullets("hot lead, no budget info, wants sea view.")).toEqual([
      "Hot lead",
      "No budget info",
      "Wants sea view",
    ]);
  });
  it("empty/null → []", () => {
    expect(reasonBullets(null)).toEqual([]);
    expect(reasonBullets("")).toEqual([]);
  });
});

describe("filterStaleBudgetBullets — bug 2 guard", () => {
  const bullets = ["Hot lead", "No budget info", "Wants sea view"];
  it("drops budget-unknown clauses when the budget IS known", () => {
    expect(filterStaleBudgetBullets(bullets, true)).toEqual(["Hot lead", "Wants sea view"]);
  });
  it("keeps them when the budget is genuinely unknown", () => {
    expect(filterStaleBudgetBullets(bullets, false)).toEqual(bullets);
  });
  it("matches the common budget-unknown phrasings", () => {
    for (const c of ["No budget info", "Budget not specified", "Budget unknown", "No budget", "Unknown budget", "Budget unclear"]) {
      expect(filterStaleBudgetBullets([c], true)).toEqual([]);
    }
  });
  it("does NOT drop legitimate budget clauses", () => {
    for (const c of ["Budget €500,000", "Within budget", "Budget fits the top match", "Slightly over budget"]) {
      expect(filterStaleBudgetBullets([c], true)).toEqual([c]);
    }
  });
});

describe("nextActionBullets — end to end", () => {
  it("budget present (€500k) removes the contradicting clause", () => {
    expect(nextActionBullets("hot lead, no budget info", 500000)).toEqual(["Hot lead"]);
  });
  it("budget present as string still counts as known", () => {
    expect(nextActionBullets("no budget info, ready to view", "500000")).toEqual(["Ready to view"]);
  });
  it("budget absent keeps the clause (accurate)", () => {
    expect(nextActionBullets("hot lead, no budget info", null)).toEqual(["Hot lead", "No budget info"]);
    expect(nextActionBullets("hot lead, no budget info", "")).toEqual(["Hot lead", "No budget info"]);
  });
});
