#!/usr/bin/env python3
"""
Text-integrity lint for the buyer and seller topic banks.

Every failure class below is one that actually shipped in a published version of these banks, and
every one of them was found by a human reader rather than by us. That is the argument for the lint:
four careful passes each missed something the next one caught, and the misses were mechanical.

  reviewer commentary in live text  — a hook that began "Stop fixing the count and the gate in advance"
  paste-over duplication            — "oversells a choice-of-law election that is oversells a choice-of-law election"
  truncation                        — a rule ending mid-word at "and Agenc"
  mid-sentence starts               — "s own registration is a public, mandatory matter"
  known-false claims                — "roughly 15 days" eviction, a 48-hour police rule
  build regressions                 — a fix applied to the assembled HTML, then overwritten by a rebuild

Run against the JSON banks before any render. Exit code 1 on any finding.
"""
import json
import re
import sys

# --- failure classes -------------------------------------------------------------------

COMMENTARY = re.compile(
    r"^(Stop |Say ['\"]|Say that|Reword|Replace with|Add the|Rewrite|Narrow the|Split the|"
    r"Drop the|Also keep|Something like|E\.g\.|For example, write)", re.I)

# Claims established as false. Each cost a published error; none may return.
BANNED = [
    (r"\broughly 15 days\b|\b15[- ]day (eviction|deadline)\b",
     "the 15 days in art. 802 LECrim is a hearing-rescheduling window, not an eviction deadline"),
    (r"\b48[- ]hour\b.{0,40}(police|flagran|occup)",
     "no 48-hour rule exists in Spanish squatting law"),
    (r"golden visa\b(?!.{0,80}(abolish|ended|no longer|repeal))",
     "the golden visa was abolished with effect 3 April 2025 (LO 1/2025 DF 21ª)"),
    (r"(?<!Andalusia's )(?<!Andalusian )\bAFO\b(?!.{0,80}(Andalus|does not apply))",
     "AFO is an Andalusian figure; the Valencian instrument is TRLOTUP"),
    (r"VAT is added on top|VAT is always|commission carries VAT on top",
     "whether a quoted commission includes VAT is a fact of that agency's mandate"),
    (r"reclaimed later|(?:3%|withheld|withholding)[^.]{0,60}\bget it back\b|gets? the 3% back",
     "the 3% is settled against the final liability; only an excess, if any, returns"),
    (r"carries most weight",
     "Mosseri said sends matter *slightly* more for unconnected reach"),
    (r"only third[- ]country nationals (face|are subject)",
     "a third-country national with residence or Withdrawal Agreement rights is not on 90/180"),
    (r"send is worth (roughly )?\d",
     "no published send-to-like ratio exists"),
    (r"(idealista|Fotocasa)[^.]{0,60}official (body|statistic|source)",
     "portals are private listings companies, not official statistics"),
    (r"three independent tests in art\.? ?9|art\.? ?9[^.]{0,40}three (independent )?tests",
     "art. 9.1 LIRPF has two criteria plus a rebuttable family presumption, not three tests", True),
    (r"EES is (not )?uniformly live|assume EES is uniformly",
     "EES has been fully operational at all Schengen external borders since 10 April 2026", True),
    (r"the two routes back onto paper|the two routes to (bring|get) the paperwork",
     "the number of regularisation routes is not fixed and depends on land and planning status", True),
    (r"Notariado\s*/\s*MIVAU|MIVAU\s*/\s*(Consejo|Notariado)",
     "MIVAU valor tasado is an appraisal series, never a notarised transaction series"),
    (r"who is taking the difference",
     "implies wrongdoing without evidence"),
    (r"(IPV|Indice de Precios de Vivienda|Índice de Precios de Vivienda)[^.]{0,120}(area average|Alicante [\u20ac]?/?m|\u20ac/m\u00b2)",
     "INE's IPV is a price index published at Spain and autonomous-community level, not an Alicante area average"),
    (r"[a-z]{4,}\.\d{1,2}\s+[a-z]{2,}",
     "a replacement pasted over its own target leaves a visible join", True),
    (r"[Tt]ax residence is where a person lives",
     "Spanish tax residence is a statutory test, never ordinary-language residence", True),
    (r"[Ee]xactly one of them has that power",
     "LPH 9.1.e blocks authorisation, but is not the only possible impediment in every sale"),
    (r"\[(NAME|TOWN|FIGURE|INSERT|TODO|XX)\b[^\]]*\]",
     "a template placeholder reached production", True),
    (r"[Oo]nly one of these levers can currently be priced",
     "the Notariado portal reaches postcode and custom areas, so more than one lever is priceable"),
    (r"(convert|turn)[^.]{0,60}count into the probability",
     "an incident count is a numerator, never an individual probability", True),
    (r"ECLI\\+:",
     "backslash-escaped ECLI citation", True),
    (r"on a genuine gain there is nothing to return|3% as automatically (non-)?refundable",
     "AEAT refunds any excess over the final liability, even where a gain exists", True),
    (r"accepted offer is not a sale|nothing binds until the paperwork",
     "arts. 1450-1451 CC bind on agreement as to thing and price, before the notary", True),
    (r"(national single rental registry|ventanilla única digital|Registro Único)(?![^.]{0,120}(annul|Tribunal Supremo|no longer))",
     "RD 1312/2024's national Registro Único was largely annulled by the TS in May/June 2026"),
    (r"padrón series ends at 1 January 2022|2022 (is|as) the latest[^.]{0,40}nationality",
     "INE publishes the Censo Anual de Población 2021-2025 with municipality x nationality"),
    (r"\bhere is ours\b|\bwhat ours actually were\b|\bour (own )?completed sales\b",
     "an agency-specific claim needs Agency Evidence provenance"),
]

# Structural damage a paste-over leaves behind. Each of these shipped at least once.
MALFORMED = [
    (r"\.\.(?!\.)", "double period"),
    (r"\)\)", "doubled closing parenthesis"),
    (r"\s(?:and|but|or|with|of|the|to)\s+[A-Z][a-z]{1,5}$", "sentence stops mid-word"),
]

DUPE_PHRASE = re.compile(r"\b([A-Za-z][\w' ]{14,60}?)\s+(?:that is\s+|and\s+)?\1\b")
# "art. Art. 85" — a citation prefix left in front of a replacement that carried its own. Two of
# these survived four passes and the first lint, because nothing was looking for malformed citations.
BAD_CITE = re.compile(r"\b(?:arts?\.?|artículos?)\s+(?:arts?\.|artículos?)(?=\s|\d)", re.I)
# A clause repeated anywhere in the same string, not only adjacent to itself. The adjacent-only
# regex missed a question whose tail was appended twice and a correction pasted after its own target.
def repeated_clause(t, n=6, near=45, long_n=12):
    """A paste-over leaves its duplicate close by; deliberate parallel construction does not.

    Window size alone could not separate the two: at 8 words it missed a correction appended after
    its own target, and at 5 it flagged seven legitimate rules built on repetition ("never apply 24%
    to an owner tax-resident in the EU ... never apply 19% to an owner tax-resident in the UK").
    What distinguishes them is distance — an accidental duplicate sits within a clause of its twin,
    a parallel one is separated by the contrasting material that gives it its point. A long span
    repeated at any distance is wholesale duplication: parallel prose repeats a short stem, never
    twelve consecutive words.

    Slide word by word. re.finditer is non-overlapping and chunks the string instead, which made an
    earlier version step straight over the repeat it was looking for.
    """
    words = re.findall(r"\S+", t)
    starts, pos = [], 0
    for w in words:
        pos = t.index(w, pos)
        starts.append(pos)
        pos += len(w)
    for size, max_gap in ((n, near), (long_n, None)):
        if len(words) < size * 2:
            continue
        seen = {}
        # Compare on normalised words: the renvoi paste-over ended "nationals," on its second
        # occurrence and "nationals" on its first, so a literal comparison walked straight past it.
        norm = [w.lower().strip(".,;:()\u2014\u2013'\"\u201c\u201d") for w in words]
        for i in range(len(words) - size + 1):
            gram = " ".join(norm[i:i + size])
            if gram in seen:
                prev = seen[gram]
                gap = starts[i] - (starts[prev + size - 1] + len(words[prev + size - 1]))
                if max_gap is None or gap <= max_gap:
                    return " ".join(words[i:i + size])
            else:
                seen[gram] = i
    return None
    seen = {}
    for i in range(len(words) - n + 1):
        gram = " ".join(words[i:i + n]).lower()
        if gram in seen:
            return " ".join(words[i:i + n])
        seen[gram] = i
    return None
DUPE_WORD = re.compile(r"\b(\w{3,})\s+\1\b", re.I)
DUPE_OK = {"had", "that", "the"}


NEGATED = re.compile(r"\b(never|not|do not|don't|no longer|rather than|instead of|forbidden)\b", re.I)


def check(text, where, out):
    t = (text or "").strip()
    if not t or t.lower().startswith("none"):
        return
    if COMMENTARY.match(t):
        out.append((where, "commentary", t[:110]))
    if t.startswith("…") or (t[0].islower() and not t.startswith(("that ", "any ", "which "))):
        out.append((where, "starts mid-sentence", t[:110]))
    # No truncation heuristic. Two were tried — grammatical, then length-based — and both produced
    # more noise than signal, which buries the precise findings below. The real truncations came from
    # a stray slice in the correction script; the fix belongs there, not in a guess here.
    if BAD_CITE.search(t):
        out.append((where, "malformed citation", BAD_CITE.search(t).group(0)))
    rep = repeated_clause(t)
    if rep:
        out.append((where, "repeated clause", rep[:110]))
    for m in DUPE_PHRASE.finditer(t):
        out.append((where, "duplicated phrase", m.group(0)[:110]))
    for m in DUPE_WORD.finditer(t):
        if m.group(1).lower() not in DUPE_OK:
            out.append((where, "duplicated word", m.group(0)))
    for pat, why in MALFORMED:
        if re.search(pat, t):
            out.append((where, f"malformed text — {why}", t[-80:]))
    # Brackets must balance. An unmatched one is always an edit that went wrong, never prose.
    for op, cl, name in (("(", ")", "parenthesis"), ("[", "]", "bracket")):
        if t.count(op) != t.count(cl):
            out.append((where, f"unbalanced {name}", t[:110]))
    for rule in BANNED:
        pat, why = rule[0], rule[1]
        immune = len(rule) > 2 and rule[2]
        m = re.search(pat, t, re.I)
        if not m:
            continue
        if immune:
            out.append((where, f"banned claim — {why}", t[:110]))
            continue
        # An instruction that FORBIDS the claim is the fix, not the fault. Look at the clause the
        # match sits in rather than the whole line, so a long rule cannot excuse a real hit later on.
        clause = t[max(0, t.rfind(".", 0, m.start()) + 1):m.end() + 40]
        if NEGATED.search(clause):
            continue
        out.append((where, f"banned claim — {why}", t[:110]))


def main(paths):
    findings = []
    for path in paths:
        rows = json.load(open(path, encoding="utf-8"))
        rows = rows["topics"] if isinstance(rows, dict) else rows
        for r in rows:
            ident = r.get("i") or r.get("n") or r.get("topic_id")
            for field in ("hook", "original", "question", "must", "never",
                          "must_research", "never_assume", "problem",
                          # production bank field names
                          "production_hook", "current_research_question", "must_establish"):
                val = r.get(field)
                if val is None:
                    continue
                for j, line in enumerate(val if isinstance(val, list) else [val]):
                    check(line, f"{path.split('/')[-1]} [{ident}] {field}[{j}]", findings)

    for where, kind, snippet in findings:
        print(f"{where}\n  {kind}: {snippet}\n")
    print(f"{len(findings)} finding(s)")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["/tmp/seller_fields.json", "/tmp/wfres.json"]))
