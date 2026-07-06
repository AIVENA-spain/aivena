import { describe, expect, it } from "vitest";
import {
  formatChannel,
  formatLanguage,
  formatLeadType,
  formatSource,
  formatTemperatureScore,
  humanizeToken,
} from "./overview-format";

describe("humanizeToken", () => {
  it("title-cases and fixes acronyms", () => {
    expect(humanizeToken("whatsapp_inbound")).toBe("WhatsApp Inbound");
    expect(humanizeToken("walk_in")).toBe("Walk In");
    expect(humanizeToken("idealista")).toBe("Idealista");
    expect(humanizeToken("SMS")).toBe("SMS");
  });
  it("returns null for nullish/empty", () => {
    expect(humanizeToken(null)).toBeNull();
    expect(humanizeToken(undefined)).toBeNull();
    expect(humanizeToken("  ")).toBeNull();
  });
});

describe("formatChannel", () => {
  it("maps known channels", () => {
    expect(formatChannel("whatsapp")).toBe("WhatsApp");
    expect(formatChannel("WHATSAPP")).toBe("WhatsApp");
    expect(formatChannel("email")).toBe("Email");
    expect(formatChannel("voice")).toBe("Phone");
  });
  it("humanizes unknown + handles null", () => {
    expect(formatChannel("live_chat")).toBe("Live Chat");
    expect(formatChannel(null)).toBeNull();
  });
});

describe("formatSource", () => {
  it("maps the enquiry sources", () => {
    expect(formatSource("whatsapp_inbound")).toBe("WhatsApp enquiry");
    expect(formatSource("email_inbound")).toBe("Email enquiry");
    expect(formatSource("web_form")).toBe("Web form");
    expect(formatSource("referral")).toBe("Referral");
  });
  it("humanizes unknown portal names + handles null", () => {
    expect(formatSource("fotocasa")).toBe("Fotocasa");
    expect(formatSource(null)).toBeNull();
  });
});

describe("formatLeadType", () => {
  it("capitalizes known types", () => {
    expect(formatLeadType("buyer")).toBe("Buyer");
    expect(formatLeadType("seller")).toBe("Seller");
    expect(formatLeadType(null)).toBeNull();
  });
});

describe("formatLanguage", () => {
  it("maps names and ISO codes to English language names", () => {
    expect(formatLanguage("NORWEGIAN")).toBe("Norwegian");
    expect(formatLanguage("norwegian")).toBe("Norwegian");
    expect(formatLanguage("no")).toBe("Norwegian");
    expect(formatLanguage("en")).toBe("English");
    expect(formatLanguage("es")).toBe("Spanish");
    expect(formatLanguage(null)).toBeNull();
  });
  it("humanizes unknown codes", () => {
    expect(formatLanguage("catalan")).toBe("Catalan");
  });
});

describe("formatTemperatureScore", () => {
  it("temperature present → 'Warm · 75'", () => {
    expect(formatTemperatureScore("warm", 75)).toBe("Warm · 75");
    expect(formatTemperatureScore("very_hot", 90)).toBe("Very Hot · 90");
  });
  it("no temperature → uses the (i18n) score label", () => {
    expect(formatTemperatureScore(null, 75)).toBe("Lead score 75");
    expect(formatTemperatureScore(null, 75, "Puntuación")).toBe("Puntuación 75");
  });
  it("temperature only / neither", () => {
    expect(formatTemperatureScore("warm", null)).toBe("Warm");
    expect(formatTemperatureScore(null, null)).toBeNull();
  });
});
