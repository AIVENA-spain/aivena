#!/usr/bin/env python3
"""
Build the production content banks and the separate audit record.

The production bank is what the engine reads. It must contain no rejected hook, no "this was wrong
because" commentary, and no historical correction prose — a bank that carries its own errata is a
bank that can feed them back into generation. An earlier version rendered a struck-through rejected
hook inside a card badged green, which is both a contradiction and a route for a false claim to
reach the writer.

Production field set, and nothing else:
    topic_id · current_research_question · must_establish · never_assume
    research_status · hook_status · claim_ids · coverage · freshness · agency_evidence_required

Everything else — original hooks, audit findings, superseded wording — goes to audit_record.json,
which is for humans and CI, never for the writer.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# source field name -> production field name
FIELD_MAP = {
    "hook": "production_hook", "original": "production_hook",
    "question": "current_research_question",
    "must": "must_establish", "must_research": "must_establish",
    "never": "never_assume", "never_assume": "never_assume",
}


def build(rows, key, hook_field, question_field, must_field, never_field, ledger_by_topic, bank_name):
    production, audit = [], []
    for r in rows:
        tid = r[key]
        claims = ledger_by_topic.get(tid, [])
        prod = {
            "topic_id": f"{bank_name[0].upper()}{tid}",
            "current_research_question": r.get(question_field),
            "must_establish": list(r.get(must_field) or []),
            "never_assume": list(r.get(never_field) or []),
            "research_status": r.get("research_status", "UNRESOLVED"),
            "hook_status": r.get("hook_status", "UNCHECKED"),
            "freshness_status": r.get("freshness_status", "CURRENT"),
            "claim_ids": [c["id"] for c in claims],
            # Coverage was keyed by the source field names; the production bank renames them, and a
            # lookup against the old keys silently reports every field as uncovered.
            "coverage": {
                FIELD_MAP.get(k.split("[")[0], k.split("[")[0]) + "[" + k.split("[")[1]: v
                for k, v in (r.get("coverage") or {}).items()
            },
            "agency_evidence_required": bool(r.get("agency") or r.get("state") == "blocked"),
            "state": r.get("state", "review"),
            "verified_as_of": r.get("verified_as_of"),
        }
        # The production hook exists only when the hook itself survived checking. Anything else is
        # audit material — the writer receives the question, never a line we have rejected.
        if prod["hook_status"] in ("RETAINED", "REWRITTEN"):
            prod["production_hook"] = r.get(hook_field)
        else:
            prod["production_hook"] = None
        production.append(prod)

        audit.append({
            "topic_id": prod["topic_id"],
            "original_hook": r.get(hook_field),
            "hook_status": prod["hook_status"],
            "audit_finding": r.get("problem"),
            "risk_class": r.get("risk"),
            "ledger_claim_ids": prod["claim_ids"],
        })
    return production, audit


def main():
    seller = json.load(open("/tmp/seller_fields.json", encoding="utf-8"))
    buyer = json.load(open("/tmp/wfres.json", encoding="utf-8"))["topics"]
    ledger = json.load(open(os.path.join(HERE, "ledger.json"), encoding="utf-8"))
    ledger = ledger["entries"] if isinstance(ledger, dict) else ledger
    src = json.load(open("/tmp/ledger_in.json", encoding="utf-8"))

    by_topic = {"seller": {}, "buyer": {}}
    for i, s in enumerate(src):
        if i < len(ledger):
            by_topic[s["bank"]].setdefault(s["topic"], []).append(ledger[i])

    sp, sa = build(seller, "i", "hook", "question", "must", "never", by_topic["seller"], "seller")
    bp, ba = build(buyer, "n", "original", "question", "must_research", "never_assume",
                   by_topic["buyer"], "buyer")

    json.dump(sp, open(os.path.join(HERE, "seller_bank.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    json.dump(bp, open(os.path.join(HERE, "buyer_bank.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    json.dump({"seller": sa, "buyer": ba},
              open(os.path.join(HERE, "audit_record.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    leaked = [p["topic_id"] for p in sp + bp
              if p["production_hook"] is None and p["state"] == "verified"]
    print(f"seller_bank.json {len(sp)} topics · buyer_bank.json {len(bp)} topics")
    print(f"audit_record.json {len(sa) + len(ba)} entries (original hooks + findings, writer never sees these)")
    print(f"green cards with no production hook: {len(leaked)} {leaked if leaked else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
