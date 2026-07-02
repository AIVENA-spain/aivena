import { describe, it, expect } from "vitest";
import { expandSearchTerms, TOWN_ALIASES } from "./town-aliases";

describe("expandSearchTerms", () => {
  it("expands a town to include its districts (Torrevieja → La Mata etc.)", () => {
    const terms = expandSearchTerms("Torrevieja");
    expect(terms).toContain("torrevieja"); // still matches literal Torrevieja rows
    expect(terms).toContain("la mata");
    expect(terms).toContain("playa del cura");
    expect(terms).toContain("los locos");
  });

  it("expands on a ≥3-char town prefix (tor → Torrevieja districts)", () => {
    expect(expandSearchTerms("tor")).toContain("la mata");
    expect(expandSearchTerms("guardamar")).toContain("el raso");
  });

  it("a district query stays literal (no reverse expansion)", () => {
    expect(expandSearchTerms("La Mata")).toEqual(["la mata"]);
  });

  it("a non-town query (a person's name) expands to just itself", () => {
    // Marte is a lead, not a place — must not pull in unrelated listings.
    expect(expandSearchTerms("marte")).toEqual(["marte"]);
  });

  it("short / empty queries never trigger town expansion", () => {
    expect(expandSearchTerms("")).toEqual([]);
    expect(expandSearchTerms("la")).toEqual(["la"]); // 2 chars → no expansion
  });

  it("every alias key is lowercase and maps to lowercase districts", () => {
    for (const [town, districts] of Object.entries(TOWN_ALIASES)) {
      expect(town).toBe(town.toLowerCase());
      for (const d of districts) expect(d).toBe(d.toLowerCase());
    }
  });
});
