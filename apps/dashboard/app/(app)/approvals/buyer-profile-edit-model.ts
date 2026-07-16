/**
 * Pure model for the "edit buyer profile" form (Client-Intelligence rail). Turns
 * the six agent-editable preference fields into a MINIMAL patch — only the fields
 * that actually changed — and validates locally with the SAME rules the API/RPC
 * enforce (mirrors `EDITABLE_PREF_KEYS` + the PREF_ERROR_MAP in apps/api). Kept
 * pure + dependency-free so it's unit-tested without React or the network.
 *
 * The endpoint semantics: a present key sets the field (null clears it); an absent
 * key is left unchanged. So the patch must contain ONLY changed fields, and an
 * empty patch means "nothing to save".
 */

export type EditablePrefs = {
  location_interest_extracted: string | null;
  budget_extracted: number | null;
  property_type_pref: string | null;
  bedrooms_min: number | null;
  bedrooms_max: number | null;
  bathrooms_min: number | null;
};

/** The form's raw string state (what the inputs hold). */
export type PrefForm = {
  location: string;
  budget: string;
  propertyType: string;
  bedroomsMin: string;
  bedroomsMax: string;
  bathroomsMin: string;
};

export type PrefPatch = Partial<EditablePrefs>;

/** Local validation error codes — the UI translates these (they never hit the API). */
export type PrefError = "invalid_budget" | "invalid_number" | "invalid_bedrooms_range";

export type BuildResult =
  | { ok: true; patch: PrefPatch } // an empty patch means nothing changed
  | { ok: false; error: PrefError };

/** Pre-fill the form strings from the current saved values. */
export function formFromPrefs(p: EditablePrefs): PrefForm {
  return {
    location: p.location_interest_extracted ?? "",
    budget: p.budget_extracted != null ? String(p.budget_extracted) : "",
    propertyType: p.property_type_pref ?? "",
    bedroomsMin: p.bedrooms_min != null ? String(p.bedrooms_min) : "",
    bedroomsMax: p.bedrooms_max != null ? String(p.bedrooms_max) : "",
    bathroomsMin: p.bathrooms_min != null ? String(p.bathrooms_min) : "",
  };
}

type Parsed = { ok: true; value: number | null } | { ok: false };

// Budget: accept "€285,000", "285000", " 285.000 " → 285000; empty → null (clear).
function parseBudget(s: string): Parsed {
  const t = s.trim();
  if (t === "") return { ok: true, value: null };
  const digits = t.replace(/[^\d]/g, "");
  if (digits === "") return { ok: false };
  const n = Number(digits);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
}

// Whole-number field (beds/baths): digits only; empty → null (clear).
function parseWhole(s: string): Parsed {
  const t = s.trim();
  if (t === "") return { ok: true, value: null };
  if (!/^\d+$/.test(t)) return { ok: false };
  return { ok: true, value: Number(t) };
}

function strOrNull(s: string): string | null {
  const t = s.trim();
  return t === "" ? null : t;
}

/**
 * Validate the form and diff it against the saved prefs → the minimal patch.
 * `{ ok: true, patch: {} }` = valid but nothing changed (caller disables save).
 */
export function buildPrefPatch(form: PrefForm, original: EditablePrefs): BuildResult {
  const budget = parseBudget(form.budget);
  if (!budget.ok) return { ok: false, error: "invalid_budget" };
  const bedsMin = parseWhole(form.bedroomsMin);
  const bedsMax = parseWhole(form.bedroomsMax);
  const bathsMin = parseWhole(form.bathroomsMin);
  if (!bedsMin.ok || !bedsMax.ok || !bathsMin.ok) {
    return { ok: false, error: "invalid_number" };
  }
  if (bedsMin.value != null && bedsMax.value != null && bedsMin.value > bedsMax.value) {
    return { ok: false, error: "invalid_bedrooms_range" };
  }

  const next: EditablePrefs = {
    location_interest_extracted: strOrNull(form.location),
    budget_extracted: budget.value,
    property_type_pref: strOrNull(form.propertyType),
    bedrooms_min: bedsMin.value,
    bedrooms_max: bedsMax.value,
    bathrooms_min: bathsMin.value,
  };

  const patch: PrefPatch = {};
  if (next.location_interest_extracted !== original.location_interest_extracted)
    patch.location_interest_extracted = next.location_interest_extracted;
  if (next.budget_extracted !== original.budget_extracted)
    patch.budget_extracted = next.budget_extracted;
  if (next.property_type_pref !== original.property_type_pref)
    patch.property_type_pref = next.property_type_pref;
  if (next.bedrooms_min !== original.bedrooms_min) patch.bedrooms_min = next.bedrooms_min;
  if (next.bedrooms_max !== original.bedrooms_max) patch.bedrooms_max = next.bedrooms_max;
  if (next.bathrooms_min !== original.bathrooms_min) patch.bathrooms_min = next.bathrooms_min;

  return { ok: true, patch };
}

/** True when the patch has at least one field to save. */
export function hasChanges(patch: PrefPatch): boolean {
  return Object.keys(patch).length > 0;
}
