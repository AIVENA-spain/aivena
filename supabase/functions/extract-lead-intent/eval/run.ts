// AIVENA — extract-lead-intent EVAL HARNESS (runner)
// ---------------------------------------------------------------------------
// SYNTHETIC-ONLY. This runner NEVER writes to the database and NEVER targets a
// real lead. It POSTs each synthetic case (cases.json) to the extract-lead-intent
// Edge Function with dry_run:true (which returns { ok:true, intent } and writes
// NOTHING), then asserts the per-case expected fields AND the four guarantees.
//
// Run (against a TEST project only):
//   EVAL_EF_URL="https://<ref>.supabase.co/functions/v1/extract-lead-intent" \
//   EVAL_INTERNAL_SECRET="<EXTRACT_LEAD_INTENT_INTERNAL_SECRET>" \
//   deno run --allow-net --allow-env --allow-read \
//     supabase/functions/extract-lead-intent/eval/run.ts
//
// Env:
//   EVAL_EF_URL           (required) full URL of the deployed extract-lead-intent EF
//   EVAL_INTERNAL_SECRET  (required) value of x-internal-secret the EF gate expects
//   EVAL_AGENCY_ID        (optional) defaults to the test agency
//   EVAL_ALLOW_NONTEST=1  (optional) required to use a non-test agency id (still dry_run)
//
// Exit code: 0 = all cases passed; 1 = any case failed or errored (or misconfig).
// ---------------------------------------------------------------------------

const TEST_AGENCY_ID = "wf1v2-test-agency-aaaaaaaaaaaa";
// Zero sentinel ids — deliberately NOT a real lead/message. dry_run means the EF
// returns before any lookup/write, so these are never dereferenced; they exist so
// that even a future bug could not attach this synthetic run to real data.
const SENTINEL_LEAD_ID = "00000000-0000-0000-0000-000000000000";
const SENTINEL_MESSAGE_ID = "00000000-0000-0000-0000-000000000000";

type Expected = {
  areas_add?: string[];
  areas_exclude?: string[];
  areas_add_not?: string[];
  areas_exclude_not?: string[];
  open_to_nearby?: boolean;
  budget_max?: number | null;
  property_type?: string | null;
  property_type_any?: string[];
  bedrooms_min?: number | null;
  bedrooms_max?: number | null;
  bathrooms_min?: number | null;
  must_haves_include?: string[];
  all_empty?: boolean;
};

type Case = { id: string; lang: string; text: string; expected: Expected };

// Full contract shape, coerced with safe defaults so a missing/garbage field can
// never throw and is always testable.
type Contract = {
  areas_add: string[];
  areas_exclude: string[];
  open_to_nearby: boolean;
  budget_max: number | null;
  property_type: string | null;
  bedrooms_min: number | null;
  bedrooms_max: number | null;
  bathrooms_min: number | null;
  must_haves: string[];
  confidence: number | null;
  summary: string | null;
};

function norm(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function asStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") as string[] : [];
}
function asNumOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function asStrOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function coerce(intent: Record<string, unknown> | null | undefined): Contract {
  const i = intent ?? {};
  return {
    areas_add: asStrArray(i.areas_add),
    areas_exclude: asStrArray(i.areas_exclude),
    open_to_nearby: i.open_to_nearby === true,
    budget_max: asNumOrNull(i.budget_max),
    property_type: asStrOrNull(i.property_type),
    bedrooms_min: asNumOrNull(i.bedrooms_min),
    bedrooms_max: asNumOrNull(i.bedrooms_max),
    bathrooms_min: asNumOrNull(i.bathrooms_min),
    must_haves: asStrArray(i.must_haves),
    confidence: asNumOrNull(i.confidence),
    summary: asStrOrNull(i.summary),
  };
}

const EMPTY_CONTRACT: Contract = {
  areas_add: [], areas_exclude: [], open_to_nearby: false, budget_max: null,
  property_type: null, bedrooms_min: null, bedrooms_max: null, bathrooms_min: null,
  must_haves: [], confidence: null, summary: null,
};

function setEqCI(actual: string[], expected: string[]): boolean {
  const a = new Set(actual.map(norm));
  const e = new Set(expected.map(norm));
  if (a.size !== e.size) return false;
  for (const x of e) if (!a.has(x)) return false;
  return true;
}
function noneCI(actual: string[], banned: string[]): boolean {
  const a = new Set(actual.map(norm));
  return banned.every((b) => !a.has(norm(b)));
}
function includesAllCI(actual: string[], needles: string[]): boolean {
  const a = actual.map(norm);
  return needles.every((n) => a.some((x) => x.includes(norm(n))));
}

// Returns the list of failed-check descriptions for one case ([] == pass).
function checkCase(c: Case, got: Contract, wasSkipped: boolean): string[] {
  const fails: string[] = [];
  const exp = c.expected;

  // ---- Per-case expected fields ----
  if (exp.all_empty) {
    const okEmpty =
      got.areas_add.length === 0 && got.areas_exclude.length === 0 &&
      got.must_haves.length === 0 && got.open_to_nearby === false &&
      got.budget_max === null && got.property_type === null &&
      got.bedrooms_min === null && got.bedrooms_max === null && got.bathrooms_min === null;
    if (!okEmpty) fails.push(`all_empty violated -> ${JSON.stringify(got)}`);
  }
  if (exp.areas_add !== undefined && !setEqCI(got.areas_add, exp.areas_add)) {
    fails.push(`areas_add expected ${JSON.stringify(exp.areas_add)} got ${JSON.stringify(got.areas_add)}`);
  }
  if (exp.areas_exclude !== undefined && !setEqCI(got.areas_exclude, exp.areas_exclude)) {
    fails.push(`areas_exclude expected ${JSON.stringify(exp.areas_exclude)} got ${JSON.stringify(got.areas_exclude)}`);
  }
  if (exp.areas_add_not !== undefined && !noneCI(got.areas_add, exp.areas_add_not)) {
    fails.push(`GUARANTEE 1: areas_add must not contain ${JSON.stringify(exp.areas_add_not)} — got ${JSON.stringify(got.areas_add)}`);
  }
  if (exp.areas_exclude_not !== undefined && !noneCI(got.areas_exclude, exp.areas_exclude_not)) {
    fails.push(`GUARANTEE 3: areas_exclude must not contain ${JSON.stringify(exp.areas_exclude_not)} — got ${JSON.stringify(got.areas_exclude)}`);
  }
  if (exp.open_to_nearby !== undefined && got.open_to_nearby !== exp.open_to_nearby) {
    fails.push(`open_to_nearby expected ${exp.open_to_nearby} got ${got.open_to_nearby}`);
  }
  if (exp.budget_max !== undefined && got.budget_max !== exp.budget_max) {
    fails.push(`budget_max expected ${exp.budget_max} got ${got.budget_max}`);
  }
  if (exp.property_type !== undefined && norm(got.property_type) !== norm(exp.property_type)) {
    fails.push(`property_type expected ${JSON.stringify(exp.property_type)} got ${JSON.stringify(got.property_type)}`);
  }
  if (exp.property_type_any !== undefined) {
    const ok = got.property_type !== null && exp.property_type_any.map(norm).includes(norm(got.property_type));
    if (!ok) fails.push(`property_type expected one of ${JSON.stringify(exp.property_type_any)} got ${JSON.stringify(got.property_type)}`);
  }
  if (exp.bedrooms_min !== undefined && got.bedrooms_min !== exp.bedrooms_min) {
    fails.push(`bedrooms_min expected ${exp.bedrooms_min} got ${got.bedrooms_min}`);
  }
  if (exp.bedrooms_max !== undefined && got.bedrooms_max !== exp.bedrooms_max) {
    fails.push(`bedrooms_max expected ${exp.bedrooms_max} got ${got.bedrooms_max}`);
  }
  if (exp.bathrooms_min !== undefined && got.bathrooms_min !== exp.bathrooms_min) {
    fails.push(`bathrooms_min expected ${exp.bathrooms_min} got ${got.bathrooms_min}`);
  }
  if (exp.must_haves_include !== undefined && !includesAllCI(got.must_haves, exp.must_haves_include)) {
    fails.push(`must_haves expected to include ${JSON.stringify(exp.must_haves_include)} got ${JSON.stringify(got.must_haves)}`);
  }

  // ---- Universal guarantees (every case) ----
  // The 'not X -> X' bug: no area may be both added and excluded.
  const addN = new Set(got.areas_add.map(norm));
  const overlap = got.areas_exclude.map(norm).filter((x) => addN.has(x));
  if (overlap.length > 0) {
    fails.push(`GUARANTEE 1 (universal): area(s) in BOTH add and exclude -> ${JSON.stringify(overlap)}`);
  }
  // No hallucinated empties.
  if ([...got.areas_add, ...got.areas_exclude].some((s) => norm(s) === "")) {
    fails.push(`empty/whitespace area entry present -> add=${JSON.stringify(got.areas_add)} exclude=${JSON.stringify(got.areas_exclude)}`);
  }
  // confidence range.
  if (got.confidence !== null && (got.confidence < 0 || got.confidence > 1)) {
    fails.push(`confidence out of [0,1] -> ${got.confidence}`);
  }
  // A non-greeting case that produced a real intent should carry a summary.
  if (!exp.all_empty && !wasSkipped && got.summary === null) {
    fails.push(`summary missing (expected one plain sentence in the buyer's language)`);
  }

  // NOTE (guarantee 4 — contradiction/last-affirmative-wins): no SPEC case
  // exercises it directly; it is covered structurally by the universal
  // no-overlap invariant above. Add a dedicated case to cases.json if desired.
  return fails;
}

async function runCase(url: string, secret: string, agencyId: string, c: Case) {
  const body = {
    lead_id: SENTINEL_LEAD_ID,
    agency_id: agencyId,
    message_id: SENTINEL_MESSAGE_ID,
    text: c.text,
    dry_run: true, // HARD-CODED: this harness never writes.
  };
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { status: "ERROR" as const, fails: [`network error: ${(e as Error).message}`] };
  }
  let json: Record<string, unknown>;
  try {
    json = await resp.json();
  } catch {
    return { status: "ERROR" as const, fails: [`non-JSON response (HTTP ${resp.status})`] };
  }
  if (resp.status !== 200) {
    return { status: "ERROR" as const, fails: [`HTTP ${resp.status}: ${JSON.stringify(json)}`] };
  }

  const ok = json.ok === true;
  const skipped = typeof json.skipped === "string" ? json.skipped : null;

  // Trivial prefilter (empty/greeting/too-short) == an all-empty contract.
  if (ok && skipped === "trivial") {
    const fails = checkCase(c, EMPTY_CONTRACT, true);
    return { status: (fails.length ? "FAIL" : "PASS") as const, fails };
  }
  if (!ok) {
    // no_key, or any other non-fatal EF error — we could NOT validate extraction.
    return { status: "ERROR" as const, fails: [`EF returned ok:false -> ${JSON.stringify(json)}`] };
  }
  if (!json.intent || typeof json.intent !== "object") {
    return { status: "ERROR" as const, fails: [`ok:true but no intent object -> ${JSON.stringify(json)}`] };
  }

  const got = coerce(json.intent as Record<string, unknown>);
  const fails = checkCase(c, got, false);
  return { status: (fails.length ? "FAIL" : "PASS") as const, fails };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function main() {
  const url = Deno.env.get("EVAL_EF_URL");
  const secret = Deno.env.get("EVAL_INTERNAL_SECRET");
  const agencyId = Deno.env.get("EVAL_AGENCY_ID") ?? TEST_AGENCY_ID;
  const allowNonTest = Deno.env.get("EVAL_ALLOW_NONTEST") === "1";

  console.log("=".repeat(72));
  console.log("  extract-lead-intent EVAL — SYNTHETIC ONLY · dry_run · no DB writes");
  console.log("  (invented test copy; never point this at real buyer messages)");
  console.log("=".repeat(72));

  if (!url) { console.error("FATAL: EVAL_EF_URL is required."); Deno.exit(1); }
  if (!secret) { console.error("FATAL: EVAL_INTERNAL_SECRET is required."); Deno.exit(1); }
  if (agencyId !== TEST_AGENCY_ID && !allowNonTest) {
    console.error(`FATAL: refusing agency ${agencyId} (not the test agency). Set EVAL_ALLOW_NONTEST=1 to override.`);
    Deno.exit(1);
  }
  console.log(`  target : ${url}`);
  console.log(`  agency : ${agencyId}${agencyId === TEST_AGENCY_ID ? " (test)" : " (NON-TEST — dry_run still enforced)"}`);
  console.log("");

  const casesUrl = new URL("./cases.json", import.meta.url);
  const raw = await Deno.readTextFile(casesUrl);
  const parsed = JSON.parse(raw) as { cases: Case[] };
  const cases = parsed.cases ?? [];

  let passed = 0, failed = 0, errored = 0;
  const rows: Array<{ id: string; lang: string; status: string; fails: string[] }> = [];

  for (const c of cases) {
    const { status, fails } = await runCase(url, secret, agencyId, c);
    if (status === "PASS") passed++;
    else if (status === "FAIL") failed++;
    else errored++;
    rows.push({ id: c.id, lang: c.lang, status, fails });
  }

  console.log(pad("CASE", 22) + pad("LANG", 8) + "RESULT");
  console.log("-".repeat(48));
  for (const r of rows) {
    const mark = r.status === "PASS" ? "PASS" : r.status === "FAIL" ? "FAIL" : "ERROR";
    console.log(pad(r.id, 22) + pad(r.lang, 8) + mark);
    for (const f of r.fails) console.log("    - " + f);
  }
  console.log("-".repeat(48));
  console.log(`  ${passed} passed · ${failed} failed · ${errored} errored · ${cases.length} total`);

  Deno.exit(failed > 0 || errored > 0 ? 1 : 0);
}

if (import.meta.main) {
  await main();
}
