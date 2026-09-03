#!/usr/bin/env python3
"""
Compile the frozen banks into a TypeScript module the running API can import.

WHY A .ts FILE AND NOT A JSON IMPORT: Railway builds the API with
`npx tsc --project apps/api/tsconfig.json` and starts `node dist/apps/api/src/index.js`. The banks
live in tools/content-bank/, outside the API's rootDir, so a JSON import would either fail to emit
into dist or land at an unpredictable path. A generated .ts module compiles like any other source
file and needs no runtime filesystem access at all.

The module carries a checksum of its two sources. A test asserts the checksum still matches, so the
engine's copy of the guardrails can never silently drift behind the bank — which is the whole reason
the guardrails failed to protect a post in the first place.
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "apps", "api", "src", "lib", "studio-bank.generated.ts")
SOURCES = (("seller_bank.json", "seller"), ("buyer_bank.json", "buyer"))


def build():
    cards, h = [], hashlib.sha256()
    for fname, bank in SOURCES:
        raw = open(os.path.join(HERE, fname), "rb").read()
        h.update(raw)
        for t in json.loads(raw.decode("utf-8")):
            # never_assume and must_establish are the whole point: they are the only fields that tell
            # a writer what it may not say. Everything cosmetic is dropped.
            cards.append({
                "id": t["topic_id"],
                "bank": bank,
                "state": t["state"],
                "question": t["current_research_question"] or "",
                "hook": t.get("production_hook") or "",
                "must": t["must_establish"],
                "never": t["never_assume"],
                "agencyRequired": bool(t["agency_evidence_required"]),
                "asOf": t.get("verified_as_of") or None,
            })
    return cards, h.hexdigest()


def main():
    cards, digest = build()
    body = ",\n".join("  " + json.dumps(c, ensure_ascii=False) for c in cards)
    src = f"""// GENERATED FILE — do not edit by hand.
// Rebuild with:  python3 tools/content-bank/export_for_engine.py
//
// The verified content bank, compiled for the running engine. Every card carries the two fields
// that matter at generation time: what research must establish, and what the writer may never
// assume. A bank that only exists as a document protects nothing — a post shipped a legal claim
// this file forbids, because the writer could not read it.

export interface BankCard {{
  /** e.g. "B12" */
  id: string;
  bank: 'seller' | 'buyer';
  /** verified | research-verified | review | blocked */
  state: string;
  /** the question research must answer for this topic */
  question: string;
  /** the checked cover line, empty when the hook itself was not verified */
  hook: string;
  must: string[];
  never: string[];
  /** true when the topic cannot be written without the agency's own figures */
  agencyRequired: boolean;
  asOf: string | null;
}}

/** sha256 of seller_bank.json + buyer_bank.json, in that order, at generation time. */
export const BANK_SOURCE_DIGEST = '{digest}';

export const BANK_CARDS: readonly BankCard[] = [
{body},
];
"""
    open(os.path.abspath(OUT), "w", encoding="utf-8").write(src)
    print(f"wrote {os.path.relpath(os.path.abspath(OUT), os.path.join(HERE, '..', '..'))}: "
          f"{len(cards)} cards, {len(src) / 1024:.0f} KB, digest {digest[:16]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
