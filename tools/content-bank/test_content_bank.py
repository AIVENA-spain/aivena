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
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BANKS = [os.path.join(HERE, "seller_bank.json"), os.path.join(HERE, "buyer_bank.json")]
LEDGER = os.path.join(HERE, "ledger.json")
FIXTURES = os.path.join(HERE, "fixtures", "known_failures.json")
LINT = os.path.join(HERE, "lint_banks.py")
STRUCT_FIXTURES = os.path.join(HERE, "fixtures", "structural_failures.json")
RENDERED = [os.path.join(HERE, "seller-bank.html"), os.path.join(HERE, "buyer-bank.html"),
            os.path.join(HERE, "seller-bank.md"), os.path.join(HERE, "buyer-bank.md")]
# Text that must never appear in a production field, whatever the source JSON says.
PLACEHOLDER = re.compile(r"\[(NAME|TOWN|FIGURE|INSERT|TODO|XX)\b[^\]]*\]", re.I)
# A replacement pasted over its own target leaves the join visible.
# The real signature is a word running straight into a stray digit from a replacement that was
# pasted over its own target: "official statistic.2 of notarised sales". Spanish thousands
# separators (25.000) and article citations (Art. 4.1) are not that, and a looser pattern flagged
# dozens of them.
OVERLAP = re.compile(r"[a-z]{4,}\.\d{1,2}\s+[a-z]{2,}")

# A verdict that may never support a live production field. CORRECTED is historical audit state:
# applying a correction does not verify it, so the replacement becomes a NEW claim that is checked
# on its own and production points only at that.
UNPUBLISHABLE = {"CORRECTED", "UNRESOLVED", "NO_PUBLIC_EVIDENCE", "AGENCY_EVIDENCE_REQUIRED"}
ELIGIBLE = {"VERIFIED_FACT", "VERIFIED_GUARDRAIL", "TIME_SENSITIVE", "NOT_APPLICABLE_NONFACTUAL"}
# Which source classes can carry which claim.
CLAIM_SOURCE_OK = {
    "legislation": {"LAW_PRIMARY"},
    "article_number": {"LAW_PRIMARY"},
    "procedure": {"LAW_PRIMARY", "TAX_PRIMARY", "FIRST_PARTY_ORGANISATION"},
    "tax_rate": {"LAW_PRIMARY", "TAX_PRIMARY"},
    "deadline": {"LAW_PRIMARY", "TAX_PRIMARY"},
    "form_number": {"LAW_PRIMARY", "TAX_PRIMARY"},
    "statistic": {"OFFICIAL_STATISTICS", "FIRST_PARTY_ORGANISATION", "FIRST_PARTY_COMMERCIAL"},
}
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


def rule_2_hook_nullity(banks):
    """Non-green means no production hook. No exceptions.

    A grey or violet badge does not make a live factual hook safe: the writer reads text, not badges.
    A hook may exist only on a card that is verified, whose hook was itself checked, and whose text
    is the text that was checked.
    """
    for path in banks:
        for t in load(path):
            green = (t.get("state") == "verified"
                     and t.get("hook_verified") is True
                     and t.get("hook_status") in GREEN_HOOKS)
            if t.get("production_hook") and not green:
                fail("non-green-hook", f"{os.path.basename(path)} [{t.get('topic_id')}]",
                     f"state={t.get('state')} hook_verified={t.get('hook_verified')} but a hook is stored")


def rule_3_active_claims(banks, ledger):
    """Production may only point at claims that are eligible and active.

    CORRECTED rows stay in the ledger as history and are superseded by a new, independently checked
    row. "The correction was applied, therefore green" is the shortcut that put new errors into two
    earlier repairs.
    """
    by_id = {e["id"]: e for e in ledger}
    for path in banks:
        for t in load(path):
            for key, cov in (t.get("coverage") or {}).items():
                # A claim cannot survive in a field that no longer has text. Rule 1 nulls the hook on
                # every non-green card, and its coverage entry outlives it.
                field, _, idx = key.rstrip("]").partition("[")
                val = t.get(field)
                seq = val if isinstance(val, list) else [val]
                try:
                    if not str(seq[int(idx)] or "").strip():
                        continue
                except (ValueError, IndexError):
                    continue
                for cid in cov.get("claim_ids", []):
                    e = by_id.get(cid) if isinstance(cid, int) else None
                    if not e:
                        continue
                    if not e.get("active"):
                        fail("inactive-claim", f"{os.path.basename(path)} [{t.get('topic_id')}] {key}",
                             f"claim #{cid} is superseded by #{e.get('superseded_by')}")
                    elif e["verdict"] not in ELIGIBLE:
                        fail("ineligible-claim", f"{os.path.basename(path)} [{t.get('topic_id')}] {key}",
                             f"claim #{cid} is {e['verdict']}")


def rule_4_ledger_mapping(ledger):
    """Every ledger row is traceable on its own, without reconstructing the link from elsewhere."""
    for e in ledger:
        for field in ("bank", "topic", "field", "production_field_id"):
            if e.get(field) in ("", None):
                fail("ledger-mapping", f"ledger #{e['id']}", f"blank {field}")
        if "active" not in e:
            fail("ledger-mapping", f"ledger #{e['id']}", "no active flag")


def rule_4b_source_class(ledger):
    """Sources are classed individually, and the class must be able to carry the claim."""
    for e in ledger:
        srcs = e.get("sources")
        if srcs is None:
            fail("source-shape", f"ledger #{e['id']}", "no sources[] array")
            continue
        for s in srcs:
            if not s.get("source_class"):
                fail("source-shape", f"ledger #{e['id']}", "a source has no class")
        if e["verdict"] != "VERIFIED_FACT":
            continue
        allowed = CLAIM_SOURCE_OK.get(e["claim_type"])
        if allowed and not any(s.get("source_class") in allowed for s in srcs):
            fail("source-class", f"ledger #{e['id']}",
                 f"{e['claim_type']} VERIFIED_FACT with no source in {sorted(allowed)}")


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


def rule_12_rendered_artifact(rendered):
    """CI must test the page, not only the JSON behind it.

    Every defect this rule catches was present in a frozen, published bank while the source-JSON suite
    reported zero violations: two status summaries on one header line, a stale fixture count in the
    footer, a template placeholder, and a replacement pasted over its own target. A gate that never
    looks at the artifact is not a gate on the artifact.
    """
    text_fx = len(json.load(open(FIXTURES, encoding="utf-8")))
    struct_fx = len(json.load(open(STRUCT_FIXTURES, encoding="utf-8"))["cases"])
    for path in rendered:
        if not os.path.exists(path):
            fail("rendered", os.path.basename(path), "not rendered")
            continue
        page = open(path, encoding="utf-8").read()
        name = os.path.basename(path)

        # exactly one status summary, in whichever wrapper the format uses
        pattern = (r"\*\*((?:Verified|Research verified|Needs review|Blocked) \d+[^*]*)\*\*"
                   if path.endswith(".md") else
                   r"<span>((?:Verified|Research verified|Needs review|Blocked) \d+[^<]*)</span>")
        summaries = re.findall(pattern, page)
        if len(summaries) != 1:
            fail("duplicate-status-summary", name,
                 f"{len(summaries)} status summaries on the page: {summaries}")

        # the footer count must come from the registry
        shown = re.search(r"(\d+) text and (\d+) structural known-failure fixtures", page)
        if not shown:
            fail("fixture-count", name, "no fixture count rendered")
        elif (int(shown.group(1)), int(shown.group(2))) != (text_fx, struct_fx):
            fail("fixture-count", name,
                 f"page says {shown.group(1)}+{shown.group(2)}, registry has {text_fx}+{struct_fx}")

        for m in PLACEHOLDER.finditer(page):
            fail("template-placeholder", name, m.group(0))
        for m in OVERLAP.finditer(page):
            fail("replacement-overlap", name, page[max(0, m.start() - 40):m.end() + 30])
        if re.search(r"ECLI\\+:", page):
            fail("malformed-citation", name, "backslash-escaped ECLI")


def rule_13_green_needs_no_agency_data(banks):
    """A public card cannot be green while its mandatory research requires the agency's own figures."""
    needs = re.compile(r"(this|the) agency'?s own|this office actually|pull the agency'?s own", re.I)
    for path in banks:
        for t in load(path):
            if t.get("state") != "verified" or t.get("agency_evidence_required"):
                continue
            fields = [t.get("current_research_question") or ""] + list(t.get("must_establish") or [])
            for f in fields:
                if needs.search(str(f)) and "OPTIONAL AGENCY ADDENDUM" not in str(f).upper():
                    fail("green-needs-agency-data", f"{os.path.basename(path)} [{t.get('topic_id')}]",
                         str(f)[:110])


def rule_10_provenance(banks):
    """Every card renders provenance. Nine did not, and the claim that all did was simply untrue."""
    total = 0
    for path in banks:
        for t in load(path):
            total += 1
            prov = t.get("provenance") or {}
            if not prov.get("has_provenance"):
                fail("provenance", f"{os.path.basename(path)} [{t.get('topic_id')}]",
                     "renders no provenance line — neither claims nor a non-factual declaration")
    if total != 120:
        fail("provenance", "banks", f"expected 120 cards, found {total}")


def rule_8_lint(banks):
    """The text-integrity lint must pass on the banks."""
    r = subprocess.run([sys.executable, LINT] + banks, capture_output=True, text=True)
    if r.returncode != 0:
        fail("lint", "banks", r.stdout.strip().splitlines()[-1] if r.stdout else "lint failed")


def rule_11_structural_fixtures():
    """Each structural defect must still make its rule fail.

    The text lint cannot see a hook on a non-green card, or production pointing at a corrected claim.
    Those rules need their own deliberately broken inputs, or "CI passes" only means the text was tidy.
    """
    import tempfile
    path = os.path.join(HERE, "fixtures", "structural_failures.json")
    if not os.path.exists(path):
        fail("structural-fixture", "fixtures", "structural_failures.json missing")
        return
    with open(path, encoding="utf-8") as f:
        cases = json.load(f)["cases"]
    for c in cases:
        before = len(failures)
        with tempfile.TemporaryDirectory() as d:
            bp = os.path.join(d, "bank.json")
            lp = os.path.join(d, "ledger.json")
            json.dump(c["bank"], open(bp, "w", encoding="utf-8"))
            json.dump({"entries": c["ledger"]}, open(lp, "w", encoding="utf-8"))
            led = c["ledger"]
            rule_2_hook_nullity([bp])
            rule_3_active_claims([bp], led)
            rule_4_ledger_mapping(led)
            rule_4b_source_class(led)
            rule_13_green_needs_no_agency_data([bp])
        caught = [f for f in failures[before:] if f[0] == c["rule"]]
        del failures[before:]
        if not caught:
            fail("structural-fixture", c["id"], f"did not trigger rule '{c['rule']}'")


def rule_14_rendered_fixtures():
    """The rendered-artifact rule must be able to fail on a rendered artifact.

    rule_12 was written after a frozen page shipped with two status summaries and a stale fixture
    count. A rule with no deliberately broken page behind it proves only that the current page is
    fine today.
    """
    d = os.path.join(HERE, "fixtures", "rendered")
    expect = {"duplicate_status_summary.html": "duplicate-status-summary",
              "stale_fixture_count.html": "fixture-count"}
    for name, rule in expect.items():
        path = os.path.join(d, name)
        if not os.path.exists(path):
            fail("rendered-fixture", name, "missing")
            continue
        before = len(failures)
        rule_12_rendered_artifact([path])
        caught = [f for f in failures[before:] if f[0] == rule]
        del failures[before:]
        if not caught:
            fail("rendered-fixture", name, f"did not trigger rule '{rule}'")


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
    rule_2_hook_nullity(banks)
    rule_3_active_claims(banks, ledger)
    rule_4_ledger_mapping(ledger)
    rule_4b_source_class(ledger)
    rule_10_provenance(banks)
    rule_12_rendered_artifact(RENDERED)
    rule_13_green_needs_no_agency_data(banks)
    rule_5_freshness(ledger, today)
    rule_6_hook_coverage(banks)
    rule_7_agency_provenance(banks)
    rule_8_lint(banks)
    rule_9_lint_can_fail()
    rule_11_structural_fixtures()
    rule_14_rendered_fixtures()

    if not quiet:
        for rule, where, detail in failures:
            print(f"{rule}: {where}\n  {detail}")
    print(f"{len(failures)} violation(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
