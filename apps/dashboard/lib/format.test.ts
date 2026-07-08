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
