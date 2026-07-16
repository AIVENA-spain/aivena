import { describe, it, expect } from "vitest";
import type { Match } from "@/lib/api/types";
import {
  buildAlternativesBlock,
  appendAlternatives,
  altHeaderForLanguage,
  DEFAULT_ALTERNATIVES,
  type AlternativeLabels,
} from "./composer-alternatives";

const labels: AlternativeLabels = {
  header: "Properties that may suit them:",
  ref: "Ref",
  priceOnRequest: "Price on request",
  bed: "bed",
  bath: "bath",
  studio: "Studio",
};

function match(over: Partial<Match> = {}): Match {
  return {
    rank: 1,
    similarity: 0.6,
    property_id: "p1",
    external_id: "IC-17207",
    title: "3-bedroom villa in Villamartín",
    property_type: "villa",
    price: 385000,
    price_currency: "EUR",
    bedrooms: 3,
    bathrooms: 2,
    area_sqm: 120,
    location_city: "Orihuela Costa",
    location_region: "Alicante",
    source_url: "https://example.com/p1",
    images: [],
    ...over,
  };
}

describe("buildAlternativesBlock", () => {
  it("returns empty string for no matches", () => {
    expect(buildAlternativesBlock([], labels)).toBe("");
  });

  it("returns empty string when limit <= 0", () => {
    expect(buildAlternativesBlock([match()], labels, 0)).toBe("");
    expect(buildAlternativesBlock([match()], labels, -3)).toBe("");
  });

  it("renders a full property with header, meta line and url", () => {
    const out = buildAlternativesBlock([match()], labels);
    expect(out).toBe(
      "Properties that may suit them:\n\n" +
        "1. 3-bedroom villa in Villamartín\n" +
        "   €385,000 · Villa · 3 bed · 2 bath · Orihuela Costa · Ref IC-17207\n" +
        "   https://example.com/p1",
    );
  });

  it("falls back to 'Price on request' when price is null (never €0)", () => {
    const out = buildAlternativesBlock([match({ price: null })], labels);
    expect(out).toContain("Price on request");
    expect(out).not.toContain("€0");
  });

  it("omits beds/baths when both are null", () => {
    const out = buildAlternativesBlock(
      [match({ bedrooms: null, bathrooms: null })],
      labels,
    );
    expect(out).not.toContain(" bed");
    expect(out).not.toContain(" bath");
  });

  it("omits the Ref segment when external_id is null", () => {
    const out = buildAlternativesBlock([match({ external_id: null })], labels);
    expect(out).not.toContain("Ref");
  });

  it("omits the url line when source_url is null", () => {
    const out = buildAlternativesBlock([match({ source_url: null })], labels);
    expect(out.split("\n").filter((l) => l.includes("http"))).toHaveLength(0);
  });

  it("caps at the limit and numbers sequentially", () => {
    const five = [1, 2, 3, 4, 5].map((n) =>
      match({ property_id: `p${n}`, title: `Property ${n}`, external_id: `R${n}` }),
    );
    const out = buildAlternativesBlock(five, labels, DEFAULT_ALTERNATIVES);
    expect(out).toContain("1. Property 1");
    expect(out).toContain("2. Property 2");
    expect(out).toContain("3. Property 3");
    expect(out).not.toContain("4. Property 4");
  });

  it("inserts ONLY facts — no invented match reasons or scores", () => {
    const out = buildAlternativesBlock([match()], labels).toLowerCase();
    for (const banned of ["match", "similar", "because", "recommend", "score", "%"]) {
      expect(out).not.toContain(banned);
    }
  });
});

describe("altHeaderForLanguage", () => {
  it("renders the header in the buyer's language (by language NAME)", () => {
    expect(altHeaderForLanguage("norwegian")).toBe(
      "Noen alternativer som kan passe for deg:",
    );
    expect(altHeaderForLanguage("spanish")).toBe(
      "Algunas opciones que pueden encajarle:",
    );
  });

  it("accepts a locale CODE too (case-insensitive, incl. nb/nn → no)", () => {
    expect(altHeaderForLanguage("NO")).toBe("Noen alternativer som kan passe for deg:");
    expect(altHeaderForLanguage("nb")).toBe("Noen alternativer som kan passe for deg:");
    expect(altHeaderForLanguage("de")).toBe(
      "Einige Optionen, die zu Ihnen passen könnten:",
    );
  });

  it("addresses the client ('you'), never third person ('them')", () => {
    expect(altHeaderForLanguage("english")).toBe("A few options that may suit you:");
    expect(altHeaderForLanguage("english").toLowerCase()).not.toContain("them");
  });

  it("falls back to English for unknown / null language", () => {
    expect(altHeaderForLanguage(null)).toBe("A few options that may suit you:");
    expect(altHeaderForLanguage("")).toBe("A few options that may suit you:");
    expect(altHeaderForLanguage("klingon")).toBe("A few options that may suit you:");
  });
});

describe("appendAlternatives", () => {
  it("returns the block when the draft is empty", () => {
    expect(appendAlternatives("", "BLOCK")).toBe("BLOCK");
    expect(appendAlternatives("   \n ", "BLOCK")).toBe("BLOCK");
  });

  it("separates existing draft and block with a blank line", () => {
    expect(appendAlternatives("Hola, aquí tienes opciones.", "BLOCK")).toBe(
      "Hola, aquí tienes opciones.\n\nBLOCK",
    );
  });

  it("leaves the draft untouched when the block is empty", () => {
    expect(appendAlternatives("Draft stays.", "")).toBe("Draft stays.");
  });
});
