# Content bank

The buyer and seller topic banks the Studio content engine reads, the verification ledger behind
them, and the tests that keep the two honest.

    python3 tools/content-bank/test_content_bank.py     # the gate — exit 0 or a list of violations

## Why this exists as code rather than a document

Five prose reviews in a row each found what the previous one missed, and two of them were broken by
the repair that followed. Reading carefully is not a control:

- a fact-check published unread produced 26 errors in 478 generated instructions;
- applying those corrections pasted the reviewer's own commentary into six live hooks;
- "the lint passes at zero" once meant two of its checks were themselves broken and matched nothing;
- a card was badged green while rendering a hook the audit had rejected, struck through, beneath it.

Every rule in `test_content_bank.py` corresponds to one of those, and `rule_9_lint_can_fail` exists
because a lint that cannot fail proves nothing. `fixtures/known_failures.json` holds one instance of
each real defect; CI fails if the lint stops catching any of them.

## Files

| file | what it is |
|---|---|
| `seller_bank.json`, `buyer_bank.json` | **production**. What the engine reads. No rejected hook, no audit prose. |
| `audit_record.json` | original hooks, findings, superseded wording. For humans and CI, never the writer. |
| `ledger.json` | every checked claim: source opened, locator, as-of date, verdict, freshness. |
| `lint_banks.py` | text-integrity lint. |
| `test_content_bank.py` | the nine acceptance rules. |

## Status model

A card carries three statuses, because the research checking out and the card being publishable are
different facts. The badge is the weakest of them.

- `research_status` — every claim beneath it VERIFIED, none corrected or unresolved.
- `hook_status` — RETAINED · REWRITTEN · SUPERSEDED · REJECTED · AGENCY_REQUIRED · TIME_SENSITIVE.
- `hook_verified` — the text in the bank is the text an audit actually read. A hook edited after its
  audit is not verified, however good the edit.

Only `research_status = VERIFIED` **and** a verified RETAINED/REWRITTEN hook is green, and green is
always dated: for law, tax and market claims, verification without an as-of date is misleading.

A rejected hook has `production_hook: null` and lives only in the audit record. The writer never
receives a line we have rejected — not even struck through, because the engine reads text, not styling.

## Verdicts

`VERIFIED_FACT` · `VERIFIED_GUARDRAIL` · `CORRECTED` · `TIME_SENSITIVE` · `NO_PUBLIC_EVIDENCE` ·
`AGENCY_EVIDENCE_REQUIRED` · `UNRESOLVED` · `NOT_APPLICABLE_NONFACTUAL`

A failed search is never `VERIFIED_FACT`, and a sound prohibition is a guardrail, not a sourced fact.
Source class must match the claim: a statute cannot be green on a press article when BOE or CENDOJ
exists; a portal is authoritative for its own asking-price data and never for tax law.
