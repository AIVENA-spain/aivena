#!/usr/bin/env bash
# Reproducible proof for the content bank. Run it yourself:
#
#     bash tools/content-bank/verify.sh
#
# It does not trust anything I said. It re-derives every claimed number from the files, proves the
# tests can fail by breaking them on purpose, and checks that what is published matches what is
# committed. Exit 0 means every assertion below was reproduced on your machine.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
fail=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }
head() { printf '\n\033[1m%s\033[0m\n' "$1"; }

head "1. The commits are on the remote, not just local"
git fetch -q origin
for c in 594d460 a79df17 17f78d2; do
  if git merge-base --is-ancestor "$c" origin/main 2>/dev/null; then
    ok "$c is an ancestor of origin/main — $(git log -1 --format=%s "$c" | cut -c1-64)"
  else
    bad "$c is NOT on origin/main"
  fi
done
[ "$(git rev-list --count origin/main..HEAD)" = "0" ] \
  && ok "nothing local is unpushed" || bad "local commits are not pushed"

head "2. The acceptance suite passes from a clean run"
if python3 tools/content-bank/test_content_bank.py --quiet >/tmp/ci.out 2>&1; then
  ok "CI: $(cat /tmp/ci.out)"
else
  bad "CI failed: $(cat /tmp/ci.out)"
fi

head "3. The suite can actually fail — every fixture is injected and must be caught"
python3 - <<'PY'
import json, os, subprocess, sys, tempfile
sys.path.insert(0, "tools/content-bank")
import test_content_bank as T

text = json.load(open("tools/content-bank/fixtures/known_failures.json", encoding="utf-8"))
r = subprocess.run([sys.executable, "tools/content-bank/lint_banks.py",
                    "tools/content-bank/fixtures/known_failures.json"],
                   capture_output=True, text=True)
tc = sum(1 for x in text if f"[{x['n']}]" in r.stdout)
print(f"  {'PASS' if tc == len(text) else 'FAIL'}  text fixtures caught {tc}/{len(text)}")

cases = json.load(open("tools/content-bank/fixtures/structural_failures.json", encoding="utf-8"))["cases"]
sc = 0
for c in cases:
    T.failures.clear()
    with tempfile.TemporaryDirectory() as d:
        bp = os.path.join(d, "b.json")
        json.dump(c["bank"], open(bp, "w"))
        T.rule_2_hook_nullity([bp]); T.rule_3_active_claims([bp], c["ledger"])
        T.rule_4_ledger_mapping(c["ledger"]); T.rule_4b_source_class(c["ledger"])
        T.rule_13_green_needs_no_agency_data([bp])
    sc += any(f[0] == c["rule"] for f in T.failures)
print(f"  {'PASS' if sc == len(cases) else 'FAIL'}  structural fixtures caught {sc}/{len(cases)}")

rend = {"duplicate_status_summary.html": "duplicate-status-summary",
        "stale_fixture_count.html": "fixture-count"}
rc = 0
for n, rule in rend.items():
    T.failures.clear()
    T.rule_12_rendered_artifact([os.path.join("tools/content-bank/fixtures/rendered", n)])
    rc += any(f[0] == rule for f in T.failures)
print(f"  {'PASS' if rc == len(rend) else 'FAIL'}  rendered fixtures caught {rc}/{len(rend)}")
sys.exit(0 if tc == len(text) and sc == len(cases) and rc == len(rend) else 1)
PY
[ $? -eq 0 ] || fail=1

head "4. Every headline number, re-derived from the files"
python3 - <<'PY'
import json
from collections import Counter
R = "tools/content-bank/"
S = json.load(open(R + "seller_bank.json", encoding="utf-8"))
B = json.load(open(R + "buyer_bank.json", encoding="utf-8"))
L = json.load(open(R + "ledger.json", encoding="utf-8"))["entries"]
act = [e for e in L if e.get("active")]
c = lambda v: sum(1 for e in act if e["verdict"] == v)
print("  seller states :", dict(Counter(t["state"] for t in S)))
print("  buyer  states :", dict(Counter(t["state"] for t in B)))
print("  stored hooks  : seller", sum(1 for t in S if t["production_hook"]), "/", len(S),
      "· buyer", sum(1 for t in B if t["production_hook"]), "/", len(B))
print("  active verdicts:", {k: c(k) for k in
      ("VERIFIED_FACT", "VERIFIED_GUARDRAIL", "TIME_SENSITIVE", "NOT_APPLICABLE_NONFACTUAL",
       "CORRECTED", "UNRESOLVED", "NO_PUBLIC_EVIDENCE", "AGENCY_EVIDENCE_REQUIRED")})
print("  ledger rows   :", len(L), "total,", len(act), "active,", len(L) - len(act), "history")
print("  sources classed:", sum(len(e.get("sources") or []) for e in L))
print("  provenance    :", sum(1 for t in S + B if t["provenance"]["has_provenance"]), "/", len(S + B))
PY

head "5. The four required-zero counters"
python3 - <<'PY'
import json, sys
R = "tools/content-bank/"
S = json.load(open(R + "seller_bank.json", encoding="utf-8"))
B = json.load(open(R + "buyer_bank.json", encoding="utf-8"))
L = json.load(open(R + "ledger.json", encoding="utf-8"))["entries"]
bad = {
 "non-green cards storing a hook":
   sum(1 for t in S + B if t["production_hook"] and t["state"] != "verified"),
 "active CORRECTED / UNRESOLVED / NO_PUBLIC_EVIDENCE / AGENCY_EVIDENCE_REQUIRED":
   sum(1 for e in L if e.get("active") and e["verdict"] in
       ("CORRECTED", "UNRESOLVED", "NO_PUBLIC_EVIDENCE", "AGENCY_EVIDENCE_REQUIRED")),
 "ledger rows with a blank mapping field":
   sum(1 for e in L if any(e.get(k) in ("", None)
       for k in ("bank", "topic", "field", "production_field_id"))),
 "cards with no provenance":
   sum(1 for t in S + B if not t["provenance"]["has_provenance"]),
}
for k, v in bad.items():
    print(f"  {'PASS' if v == 0 else 'FAIL'}  {k}: {v}")
sys.exit(0 if not any(bad.values()) else 1)
PY
[ $? -eq 0 ] || fail=1

head "6. What is published matches what is committed"
SC="/private/tmp/claude-501/-Users-christianscholte-aivena/bc34a68b-7bfe-45ec-b811-54bffbb9d30b/scratchpad"
for pair in "seller-bank.html:seller-brief.html" "buyer-bank.html:content-brief.html"; do
  repo="tools/content-bank/${pair%%:*}"; pub="$SC/${pair##*:}"
  if [ -f "$pub" ] && cmp -s "$repo" "$pub"; then
    ok "$(basename "$repo") published byte-identical  sha256 $(shasum -a 256 "$repo" | cut -c1-16)"
  else
    bad "$(basename "$repo") differs from what was published"
  fi
done

head "7. The bank rebuilds identically from source (no hand edits in the artifact)"
for f in seller_bank.json buyer_bank.json seller-bank.html buyer-bank.html; do
  cp "tools/content-bank/$f" "/tmp/before_$f" 2>/dev/null
done
python3 tools/content-bank/build_banks.py >/dev/null 2>&1
python3 tools/content-bank/render_banks.py >/dev/null 2>&1
for f in seller_bank.json buyer_bank.json seller-bank.html buyer-bank.html; do
  cmp -s "/tmp/before_$f" "tools/content-bank/$f" \
    && ok "$f regenerates identically" || bad "$f changed on rebuild — it was hand-edited"
done

head "8. Spot-check the evidence chain yourself"
python3 - <<'PY'
import json
L = json.load(open("tools/content-bank/ledger.json", encoding="utf-8"))["entries"]
picks = [e for e in L if e.get("active") and e["verdict"] == "VERIFIED_FACT"
         and e.get("sources") and e["claim_type"] in ("legislation", "tax_rate")][:3]
for e in picks:
    print(f"  claim #{e['id']} [{e['claim_type']}] -> {e['production_field_id']}")
    print(f"    says: {e['assertion'][:100]}")
    s = e["sources"][0]
    print(f"    source ({s['source_class']}): {s['url']}")
    print(f"    locator: {s['locator'][:100]}")
PY

printf '\n'
if [ $fail -eq 0 ]; then
  printf '\033[32mAll checks reproduced.\033[0m\n'
else
  printf '\033[31mAt least one check failed — do not treat the bank as frozen.\033[0m\n'
fi
exit $fail
