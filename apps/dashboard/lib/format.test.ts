import { describe, expect, it } from "vitest";
import { formatArea, formatPrice } from "./format";
import {
  conversationStateTone,
  leadStatusTone,
  readinessTone,
  temperatureTone,
} from "./ui-tone";

describe("formatPrice", () => {
  it("EUR → € prefix, grouped, no decimals", () => {
    expect(formatPrice(285000, "EUR")).toBe("€285,000");
    expect(formatPrice(285000)).toBe("€285,000"); // default EUR
    expect(formatPrice("285000", "EUR")).toBe("€285,000");
    expect(formatPrice(1250000.9, "EUR")).toBe("€1,250,001");
  });
  it("GBP/USD glyphs, other codes prefixed", () => {
    expect(formatPrice(300000, "GBP")).toBe("£300,000");
    expect(formatPrice(300000, "USD")).toBe("$300,000");
    expect(formatPrice(300000, "AED")).toBe("AED 300,000");
  });
  it("strips embedded currency text from string input", () => {
    expect(formatPrice("285,000 EUR", "EUR")).toBe("€285,000");
  });
  it("null/blank/non-numeric → fallback", () => {
    expect(formatPrice(null)).toBe("—");
    expect(formatPrice("")).toBe("—");
    expect(formatPrice("n/a")).toBe("—");
    expect(formatPrice(null, "EUR", { fallback: "Price on request" })).toBe(
      "Price on request",
    );
  });
});

describe("formatArea", () => {
  it("formats m² or fallback", () => {
    expect(formatArea(120)).toBe("120 m²");
    expect(formatArea("95")).toBe("95 m²");
    expect(formatArea(null)).toBe("—");
  });
});

describe("tone mappers", () => {
  it("temperature: hot→success, warm→warning, cold→neutral, never danger", () => {
    expect(temperatureTone("hot")).toBe("success");
    expect(temperatureTone("super_hot")).toBe("success");
    expect(temperatureTone("warm")).toBe("warning");
    expect(temperatureTone("cold")).toBe("neutral");
    expect(temperatureTone(null)).toBe("neutral");
  });
  it("lead status", () => {
    expect(leadStatusTone("active")).toBe("success");
    expect(leadStatusTone("waiting")).toBe("warning");
    expect(leadStatusTone("auto_handled")).toBe("info");
    expect(leadStatusTone("lost")).toBe("neutral");
  });
  it("conversation state", () => {
    expect(conversationStateTone("needsYou")).toBe("warning");
    expect(conversationStateTone("replied")).toBe("success");
    expect(conversationStateTone("autoHandled")).toBe("info");
  });
  it("readiness: ok→success, pending→warning, blocked→danger", () => {
    expect(readinessTone("ready")).toBe("success");
    expect(readinessTone("pending")).toBe("warning");
    expect(readinessTone("blocked")).toBe("danger");
    expect(readinessTone("missing")).toBe("danger");
    expect(readinessTone("unknown-thing")).toBe("neutral");
  });
});

/**
 * Grouping must follow the reader, not en-GB. In Spanish, German and Norwegian
 * a comma is the DECIMAL separator, so the old hardcoded "€285,000" read as
 * €285 to most of the agents this product is sold to.
 */
describe("price and area grouping follow the agent's language", () => {
  it("groups with a DOT for languages that use a decimal comma", () => {
    expect(formatPrice(285000, "EUR", { locale: "es" })).toBe("€285.000");
    expect(formatPrice(285000, "EUR", { locale: "de" })).toBe("€285.000");
    expect(formatPrice(285000, "EUR", { locale: "it" })).toBe("€285.000");
  });

  it("still groups with a comma for English", () => {
    expect(formatPrice(285000, "EUR", { locale: "en" })).toBe("€285,000");
  });

  it("resolves Norwegian through the catalogue alias, not to English", () => {
    // 'no' is the catalogue code, 'nb' is canonical in storage — both must work,
    // and nb-NO groups with a non-breaking space, never a comma.
    const asNo = formatPrice(285000, "EUR", { locale: "no" });
    const asNb = formatPrice(285000, "EUR", { locale: "nb" });
    expect(asNb).toBe(asNo);
    expect(asNo).not.toBe("€285,000");
  });

  it("falls back to the OLD behaviour when no locale is passed", () => {
    // Every existing call site keeps working exactly as before.
    expect(formatPrice(285000, "EUR")).toBe("€285,000");
    expect(formatArea(120)).toBe("120 m²");
  });

  it("an unknown locale never throws and never changes the number", () => {
    expect(formatPrice(285000, "EUR", { locale: "zz-not-real" })).toBe("€285,000");
  });
});
