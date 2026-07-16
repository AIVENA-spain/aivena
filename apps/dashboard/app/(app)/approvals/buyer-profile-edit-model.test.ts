import { describe, it, expect } from "vitest";
import {
  formFromPrefs,
  buildPrefPatch,
  hasChanges,
  type EditablePrefs,
  type PrefForm,
} from "./buyer-profile-edit-model";

const original: EditablePrefs = {
  location_interest_extracted: "Guardamar",
  budget_extracted: 500000,
  property_type_pref: "house",
  bedrooms_min: 2,
  bedrooms_max: 3,
  bathrooms_min: 2,
};

function form(over: Partial<PrefForm> = {}): PrefForm {
  return { ...formFromPrefs(original), ...over };
}

describe("formFromPrefs", () => {
  it("pre-fills strings from saved values, null → empty string", () => {
    expect(formFromPrefs(original)).toEqual({
      location: "Guardamar",
      budget: "500000",
      propertyType: "house",
      bedroomsMin: "2",
      bedroomsMax: "3",
      bathroomsMin: "2",
    });
    expect(
      formFromPrefs({
        location_interest_extracted: null,
        budget_extracted: null,
        property_type_pref: null,
        bedrooms_min: null,
        bedrooms_max: null,
        bathrooms_min: null,
      }).budget,
    ).toBe("");
  });
});

describe("buildPrefPatch — diff", () => {
  it("no edits → empty patch (nothing to save)", () => {
    const r = buildPrefPatch(form(), original);
    expect(r).toEqual({ ok: true, patch: {} });
    expect(hasChanges((r as { patch: object }).patch)).toBe(false);
  });

  it("changes only the edited field", () => {
    const r = buildPrefPatch(form({ location: "Ciudad Quesada" }), original);
    expect(r).toEqual({ ok: true, patch: { location_interest_extracted: "Ciudad Quesada" } });
    expect(hasChanges((r as { patch: object }).patch)).toBe(true);
  });

  it("clears a field when emptied (→ null)", () => {
    const r = buildPrefPatch(form({ location: "  " }), original);
    expect(r).toEqual({ ok: true, patch: { location_interest_extracted: null } });
  });

  it("parses a formatted budget (€, commas, spaces)", () => {
    const r = buildPrefPatch(form({ budget: "€620,000" }), original);
    expect(r).toEqual({ ok: true, patch: { budget_extracted: 620000 } });
  });

  it("batches multiple changes", () => {
    const r = buildPrefPatch(
      form({ budget: "600000", bedroomsMin: "3", bathroomsMin: "1" }),
      original,
    );
    expect(r).toEqual({
      ok: true,
      patch: { budget_extracted: 600000, bedrooms_min: 3, bathrooms_min: 1 },
    });
  });
});

describe("buildPrefPatch — validation (mirrors the API rules)", () => {
  it("rejects a non-numeric budget", () => {
    expect(buildPrefPatch(form({ budget: "cheap" }), original)).toEqual({
      ok: false,
      error: "invalid_budget",
    });
  });

  it("rejects non-integer bedrooms/bathrooms", () => {
    expect(buildPrefPatch(form({ bedroomsMin: "2.5" }), original)).toEqual({
      ok: false,
      error: "invalid_number",
    });
    expect(buildPrefPatch(form({ bathroomsMin: "-1" }), original)).toEqual({
      ok: false,
      error: "invalid_number",
    });
  });

  it("rejects min bedrooms greater than max", () => {
    expect(buildPrefPatch(form({ bedroomsMin: "4", bedroomsMax: "2" }), original)).toEqual({
      ok: false,
      error: "invalid_bedrooms_range",
    });
  });

  it("allows an empty budget/beds (clears them, still valid)", () => {
    const r = buildPrefPatch(
      form({ budget: "", bedroomsMin: "", bedroomsMax: "", bathroomsMin: "" }),
      original,
    );
    expect(r).toEqual({
      ok: true,
      patch: {
        budget_extracted: null,
        bedrooms_min: null,
        bedrooms_max: null,
        bathrooms_min: null,
      },
    });
  });
});
