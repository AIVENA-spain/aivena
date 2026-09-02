#!/usr/bin/env python3
"""
Acceptance tests for the buyer and seller content banks.

These exist because five prose reviews in a row each found what the previous one missed, and two of
them were broken by the repair that followed. Reading carefully is not a control. Every rule below
corresponds to something that actually shipped wrong at least once.

  python3 tools/content-bank/test_content_bank.py            # run everything
  python3 tools/content-bank/test_content_bank.py --quiet     # exit code only

Exit 0 = all rules hold. Exit 1 = at least one violation, printed with its location.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BANKS = [os.path.join(HERE, "seller_bank.json"), os.path.join(HERE, "buyer_bank.json")]
LEDGER = os.path.join(HERE, "ledger.json")
FIXTURES = os.path.join(HERE, "fixtures", "known_failures.json")
LINT = os.path.join(HERE, "lint_banks.py")

# A verdict that may never appear in a production field.
UNPUBLISHABLE = {"CORRECTED", "UNRESOLVED", "NO_PUBLIC_EVIDENCE", "AGENCY_EVIDENCE_REQUIRED"}
# Claim types where a secondary source can never make a fact green.
NEEDS_PRIMARY = {"legislation", "tax_rate", "article_number", "procedure", "deadline", "form_number"}
PRIMARY_CLASSES = {"LAW_PRIMARY", "TAX_PRIMARY", "OFFICIAL_STATISTICS"}
# A hook state that may contribute to a fully green card.
GREEN_HOOKS = {"RETAINED", "REWRITTEN"}

failures = []


def fail(rule, where, detail):
    failures.append((rule, where, detail))


def load(path):
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    if isinstance(d, dict):
        for key in ("topics", "entries"):
            if key in d:
                return d[key]
    return d


def rule_1_coverage(banks):
    """Every production field carries claim ids or is flagged non-factual.

    This is the rule that catches a coverage claim outrunning the evidence: an earlier ledger
    checked 442 assertions while whole hooks had never been extracted at all.
    """
    for path in banks:
        for t in load(path):
            for field in ("production_hook", "current_research_question",
                          "must_establish", "never_assume"):
                val = t.get(field)
                if val is None:
                    continue
                for j, _ in enumerate(val if isinstance(val, list) else [val]):
                    cov = (t.get("coverage") or {}).get(f"{field}[{j}]")
                    if not cov:
                        fail("coverage", f"{os.path.basename(path)} [{t.get('i') or t.get('n')}] {field}[{j}]",
                             "no claim_ids and no non_factual_instruction flag")
                    elif not cov.get("claim_ids") and not cov.get("non_factual_instruction"):
                        fail("coverage", f"{os.path.basename(path)} [{t.get('i') or t.get('n')}] {field}[{j}]",
                             "neither claim_ids nor non_factual_instruction=true")


def rule_2_green_hooks(banks):
    """A fully green card cannot carry an unchecked, superseded or rejected hook."""
    for path in banks:
        for t in load(path):
            if t.get("state") != "verified":
                continue
            if t.get("hook_status") not in GREEN_HOOKS:
                fail("green-hook", f"{os.path.basename(path)} [{t.get('i') or t.get('n')}]",
                     f"state=verified but hook_status={t.get('hook_status')}")


def rule_3_source_class(ledger):
    """A statutory or tax fact cannot be green on a secondary source."""
    for e in ledger:
        if e["verdict"] == "VERIFIED_FACT" and e["claim_type"] in NEEDS_PRIMARY \
                and e.get("source_class") not in PRIMARY_CLASSES:
            fail("source-class", f"ledger #{e['id']}",
                 f"{e['claim_type']} VERIFIED_FACT on {e.get('source_class')}")


def rule_4_unpublishable(banks, ledger):
    """No corrected, unresolved or agency-only claim survives as a production assertion.

    "Survives" means the production text is still the defective wording. A CORRECTED claim whose fix
    was applied is not a survivor — the corrected sentence is what ships. An UNRESOLVED or
    AGENCY_EVIDENCE_REQUIRED claim is likewise fine when the production field is the instruction to
    research or to gate it; the violation is stating it as settled fact.
    """
    import re
    by_id = {e["id"]: e for e in ledger}

    def norm(s):
        return re.sub(r"\s+", " ", str(s or "")).strip()

    for path in banks:
        for t in load(path):
            for key, cov in (t.get("coverage") or {}).items():
                field, _, idx = key.rstrip("]").partition("[")
                val = t.get(field)
                if val is None:
                    continue
                seq = val if isinstance(val, list) else [val]
                try:
                    text = norm(seq[int(idx)])
                except (ValueError, IndexError):
                    continue
                for cid in cov.get("claim_ids", []):
                    e = by_id.get(cid)
                    if not e or e["verdict"] not in UNPUBLISHABLE:
                        continue
                    # A claim later corrections replaced is not a surviving assertion. Without this,
                    # a field corrected twice can never pass: each correction reports the other as
                    # unapplied, and applying either re-breaks the first.
                    if e.get("superseded_by"):
                        continue
                    final = norm(e.get("final_wording"))
                    if final and final not in text and text not in final:
                        fail("unpublishable",
                             f"{os.path.basename(path)} [{t.get('topic_id')}] {key}",
                             f"claim #{cid} is {e['verdict']} and its replacement wording was not applied")


def rule_5_freshness(ledger, today):
    """A time-sensitive claim past its recheck date is not evidence any more."""
    for e in ledger:
        fr = e.get("freshness") or {}
        after = fr.get("recheck_after")
        if e["verdict"] in ("VERIFIED_FACT", "TIME_SENSITIVE") and after and after < today:
            fail("stale", f"ledger #{e['id']}", f"recheck_after {after} has passed")


def rule_6_hook_coverage(banks):
    """Every topic has an explicit hook verdict — silence is not RETAINED."""
    for path in banks:
        for t in load(path):
            if not t.get("hook_status"):
                fail("hook-coverage", f"{os.path.basename(path)} [{t.get('i') or t.get('n')}]",
                     "no hook_status recorded")


def rule_7_agency_provenance(banks):
    """A first-person agency claim needs Agency Evidence provenance."""
    import re
    first_person = re.compile(r"\b(here is ours|what ours actually|our own (completed )?sales|"
                              r"we charge|our clients|this office actually)\b", re.I)
    for path in banks:
        for t in load(path):
            for field in ("production_hook", "current_research_question"):
                val = t.get(field)
                for l in (val if isinstance(val, list) else [val]) if val else []:
                    if first_person.search(str(l)) and not t.get("agency_evidence_required"):
                        fail("agency-provenance", f"{os.path.basename(path)} [{t.get('i') or t.get('n')}] {field}",
                             "first-person agency claim without agency_evidence_required")


def rule_8_lint(banks):
    """The text-integrity lint must pass on the banks."""
    r = subprocess.run([sys.executable, LINT] + banks, capture_output=True, text=True)
    if r.returncode != 0:
        fail("lint", "banks", r.stdout.strip().splitlines()[-1] if r.stdout else "lint failed")


def rule_9_lint_can_fail():
    """The lint must catch every known failure. A lint that cannot fail proves nothing.

    Added after 'lint passes at zero' turned out to mean 'none of the known regexes fired', while
    two of the checks were themselves broken and matched nothing at all.
    """
    r = subprocess.run([sys.executable, LINT, FIXTURES], capture_output=True, text=True)
    with open(FIXTURES, encoding="utf-8") as f:
        expected = {str(x["n"]) for x in json.load(f)}
    caught = {n for n in expected if f"[{n}]" in r.stdout}
    for missed in sorted(expected - caught):
        fail("lint-fixture", f"fixture {missed}", "known failure not detected by the lint")


def main():
    quiet = "--quiet" in sys.argv
    today = os.environ.get("BANK_TODAY", "2026-09-02")
    banks = [p for p in BANKS if os.path.exists(p)]
    if not banks or not os.path.exists(LEDGER):
        print("content bank or ledger not found — nothing to check", file=sys.stderr)
        return 1
    ledger = load(LEDGER)

    rule_1_coverage(banks)
    rule_2_green_hooks(banks)
    rule_3_source_class(ledger)
    rule_4_unpublishable(banks, ledger)
    rule_5_freshness(ledger, today)
    rule_6_hook_coverage(banks)
    rule_7_agency_provenance(banks)
    rule_8_lint(banks)
    rule_9_lint_can_fail()

    if not quiet:
        for rule, where, detail in failures:
            print(f"{rule}: {where}\n  {detail}")
    print(f"{len(failures)} violation(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
