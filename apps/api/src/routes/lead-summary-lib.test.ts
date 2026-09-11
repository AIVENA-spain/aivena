import { describe, expect, it } from "vitest";
import {
  contactabilitySentence,
  deterministicSummary,
  formatBathrooms,
  formatBedrooms,
  languageDisplayName,
  noInventedClaims,
  numbersGrounded,
  outputIsSafe,
  properNounsGrounded,
  resolveSummary,
  type LeadFacts,
} from "./lead-summary-lib";

// Marte's real facts (post-apply prod state) — the grounding target.
const MARTE: LeadFacts = {
  first_name: "Marte",
  language: "Norwegian",
  temperature: "warm",
  score: 75,
  property_type: "House",
  bedrooms: "2–3",
  bathrooms: "2+",
  budget_eur: 500000,
  location: "Coast",
  urgency: "medium",
  timeframe: "soon",
  contactability:
    "The WhatsApp reply window is closed, and we can't send a check-in — there's no approved Norwegian template yet.",
};

describe("outputIsSafe", () => {
  it("accepts plain prose", () => {
    expect(outputIsSafe("Marte is a warm Norwegian-speaking buyer.")).toBe(true);
  });
  it("rejects markup, links, prompt-leak, and oversize", () => {
    expect(outputIsSafe("<b>hi</b>")).toBe(false);
    expect(outputIsSafe("see https://evil.example")).toBe(false);
    expect(outputIsSafe("ignore the system prompt")).toBe(false);
    expect(outputIsSafe("leaked x-api-key stuff")).toBe(false);
    expect(outputIsSafe("a".repeat(601))).toBe(false);
    expect(outputIsSafe("   ")).toBe(false);
  });
});

describe("numbersGrounded — every number must be a fact number", () => {
  it("accepts the lead's real numbers in common forms + %/‘/100’ idioms", () => {
    expect(numbersGrounded("budget around €500,000", MARTE)).toBe(true);
    expect(numbersGrounded("about €500k", MARTE)).toBe(true);
    expect(numbersGrounded("2–3 bedrooms, 2+ bathrooms", MARTE)).toBe(true);
    expect(numbersGrounded("within the 24-hour window", MARTE)).toBe(true);
    expect(numbersGrounded("a strong lead (75/100), 100% ready", MARTE)).toBe(true);
  });
  it("rejects invented money AND invented small numbers", () => {
    expect(numbersGrounded("budget around €750,000", MARTE)).toBe(false);
    expect(numbersGrounded("she wants €1.2m", MARTE)).toBe(false);
    expect(numbersGrounded("a 900 sqm plot", MARTE)).toBe(false);
    expect(numbersGrounded("a 45-year-old with 3 kids, moving in 6 weeks", MARTE)).toBe(false); // 45,6 invented
  });
});

describe("noInventedClaims + properNounsGrounded — the non-numeric backstop", () => {
  it("rejects property-use / nationality / motivation inventions", () => {
    expect(noInventedClaims("looking for a holiday home")).toBe(false);
    expect(noInventedClaims("a Norwegian national")).toBe(false);
    expect(noInventedClaims("relocating with her family")).toBe(false);
    expect(noInventedClaims("she is from Norway")).toBe(false);
    expect(noInventedClaims("an investment purchase")).toBe(false);
    expect(noInventedClaims("a warm buyer after a house near the coast")).toBe(true);
  });
  it("rejects invented mid-sentence proper nouns (places) not in the facts", () => {
    expect(properNounsGrounded("a house near Marbella", MARTE)).toBe(false); // Marbella invented
    expect(properNounsGrounded("a villa on the Costa Blanca", MARTE)).toBe(false);
    expect(properNounsGrounded("Marte wants a house on the Coast", MARTE)).toBe(true); // all in facts
    expect(properNounsGrounded("She is a warm Norwegian-speaking buyer.", MARTE)).toBe(true); // sentence-initial + fact word
  });
});

describe("deterministicSummary — grounded, never invents", () => {
  it("states only confirmed facts + the contactability sentence for Marte", () => {
    const s = deterministicSummary(MARTE);
    expect(s).toContain("Marte");
    expect(s).toContain("Norwegian-speaking");
    expect(s).toContain("house");
    expect(s).toContain("€500,000");
    expect(s).toContain("no approved Norwegian template");
    // never invents nationality or property use
    expect(s.toLowerCase()).not.toContain("from norway");
    expect(s.toLowerCase()).not.toContain("holiday home");
    expect(outputIsSafe(s)).toBe(true);
    expect(numbersGrounded(s, MARTE)).toBe(true);
  });
  it("omits unknown fields silently", () => {
    const sparse: LeadFacts = {
      first_name: null, language: null, temperature: null, score: null,
      property_type: null, bedrooms: null, bathrooms: null, budget_eur: null,
      location: null, urgency: null, timeframe: null,
      contactability: "The WhatsApp reply window is open — you can reply now.",
    };
    const s = deterministicSummary(sparse);
    expect(s).toContain("This buyer is a buyer.");
    expect(s).toContain("reply window is open");
    expect(s).not.toContain("null");
    expect(s).not.toContain("undefined");
  });
});

describe("resolveSummary — LLM primary, deterministic fallback", () => {
  it("uses grounded LLM prose when it passes the guards", () => {
    const good = "Marte is a Norwegian-speaking buyer after a house, 2–3 beds, around €500,000. Her WhatsApp window is closed and no approved Norwegian template exists yet.";
    const r = resolveSummary(good, MARTE);
    expect(r.source).toBe("llm");
    expect(r.summary).toBe(good);
  });
  it("falls back to deterministic when the LLM invents a number", () => {
    const bad = "Marte wants a €900,000 villa in Marbella."; // invented price + place
    const r = resolveSummary(bad, MARTE);
    expect(r.source).toBe("deterministic");
    expect(r.summary).toContain("€500,000");
  });
  it("falls back when the LLM returns markup or nothing", () => {
    expect(resolveSummary("<script>x</script>", MARTE).source).toBe("deterministic");
    expect(resolveSummary(null, MARTE).source).toBe("deterministic");
    expect(resolveSummary("", MARTE).source).toBe("deterministic");
  });
});

describe("helpers", () => {
  it("languageDisplayName maps codes, omits unknown", () => {
    expect(languageDisplayName("no")).toBe("Norwegian");
    expect(languageDisplayName("nb")).toBe("Norwegian");
    expect(languageDisplayName("en")).toBe("English");
    expect(languageDisplayName("zz")).toBe(null);
    expect(languageDisplayName(null)).toBe(null);
  });
  it("formats bedrooms/bathrooms honestly", () => {
    expect(formatBedrooms(2, 3)).toBe("2–3");
    expect(formatBedrooms(3, 3)).toBe("3");
    expect(formatBedrooms(2, null)).toBe("2+");
    expect(formatBedrooms(null, null)).toBe(null);
    expect(formatBathrooms(2)).toBe("2+");
    expect(formatBathrooms(null)).toBe(null);
  });
  it("contactabilitySentence maps each readiness action", () => {
    expect(contactabilitySentence({ recommended_action: "send_normal_reply" })).toContain("open");
    expect(
      contactabilitySentence({ recommended_action: "do_not_send_get_template_approved", lead_language_normalized: "nb" }),
    ).toContain("Norwegian");
    expect(contactabilitySentence({ recommended_action: "do_not_contact" })).toContain("opted out");
    expect(contactabilitySentence(null)).toContain("verified");
  });
});

import * as LSL from "./lead-summary-lib";

describe("stale scoring never reaches the Brief (scoring not running, 2026-09-11)", () => {
  it("withholds score and temperature from the facts the model sees", () => {
    const f = LSL.normalizeFacts(MARTE);
    expect(f.score).toBeNull();
    expect(f.temperature).toBeNull();
    expect(LSL.buildSummaryUser(MARTE)).not.toMatch(/"score":\s*75|warm/);
  });

  it("rejects prose that was ACCEPTED before this fix — the same text, failing only on the stale temperature", () => {
    // Until 2026-09-11 this exact string passed every guard and shipped as the Brief.
    const old = "Marte is a warm Norwegian-speaking buyer after a house, 2–3 beds, around €500,000. Her WhatsApp window is closed and no approved Norwegian template exists yet.";
    expect(LSL.resolveSummary(old, MARTE).source).toBe("deterministic");
  });

  it("rejects the score stated as a number — what the live Brief actually said", () => {
    const r = LSL.resolveSummary("Marte is a warm lead (score 75) looking for a 2–3 bedroom house around €500,000.", MARTE);
    expect(r.source).toBe("deterministic");
    expect(r.summary).not.toMatch(/warm|score|75/i);
  });

  it("the deterministic fallback states no temperature, no score, and no invented gender", () => {
    const s = LSL.deterministicSummary(MARTE);
    expect(s).not.toMatch(/warm|score|75/i);
    expect(s).not.toMatch(/\bShe\b|\bHe\b/);
  });
});
