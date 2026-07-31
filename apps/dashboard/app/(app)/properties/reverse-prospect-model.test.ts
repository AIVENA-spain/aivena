import { describe, it, expect } from "vitest";
import {
  buyerMatchReasons,
  fitLabel,
  buyerName,
  type MatchingBuyer,
} from "./reverse-prospect-model";

function buyer(over: Partial<MatchingBuyer> = {}): MatchingBuyer {
  return {
    lead_id: "l1",
    full_name: "Sarah Whitcombe",
    language: "en",
    budget_extracted: 320000,
    location_interest_extracted: "Cabo Roig",
    bedrooms_min: 2,
    bedrooms_max: 3,
    bathrooms_min: 1,
    property_type_pref: "villa",
    similarity: 0.53,
    ...over,
  };
}

describe("buyerMatchReasons", () => {
  it("lists a reason for each stated criterion", () => {
    expect(buyerMatchReasons(buyer())).toEqual(["budget", "area", "beds", "baths", "type"]);
  });

  it("a buyer with no stated area shows 'open_area', not a faked area", () => {
    const r = buyerMatchReasons(buyer({ location_interest_extracted: null }));
    expect(r).toContain("open_area");
    expect(r).not.toContain("area");
  });

  it("omits reasons the buyer didn't state (never invented)", () => {
    const r = buyerMatchReasons(
      buyer({
        budget_extracted: null,
        location_interest_extracted: null,
        bedrooms_min: null,
        bedrooms_max: null,
        bathrooms_min: null,
        property_type_pref: null,
      }),
    );
    expect(r).toEqual(["open_area"]); // only the honest open-area line remains
  });

  it("beds reason shows when either min OR max is set", () => {
    expect(buyerMatchReasons(buyer({ bedrooms_min: null, bedrooms_max: 3 }))).toContain("beds");
    expect(buyerMatchReasons(buyer({ bedrooms_min: 2, bedrooms_max: null }))).toContain("beds");
  });
});

describe("fitLabel", () => {
  it("bands similarity", () => {
    expect(fitLabel(0.6)).toBe("strong");
    expect(fitLabel(0.5)).toBe("good");
    expect(fitLabel(0.3)).toBe("fair");
  });
});

describe("buyerName", () => {
  it("falls back when name is blank", () => {
    expect(buyerName(buyer({ full_name: "  " }), "Buyer")).toBe("Buyer");
    expect(buyerName(buyer(), "Buyer")).toBe("Sarah Whitcombe");
  });
});
