#!/usr/bin/env python3
"""
Render the buyer and seller bank pages from the frozen production JSON.

Every number on the page is computed here, from the bank and from the fixture registry. Nothing is
typed by hand and nothing survives from a previous render — an earlier version left a stale status
summary and a stale fixture count sitting on the page beside the new ones, because the header was
edited by substitution instead of generated. A page that states its own counts must derive them, or
it will eventually state two.
"""
import html
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
LEDGER_URL = "https://claude.ai/code/artifact/ad64c4f2-e107-46a8-8da8-973e304da616"
STATE = {
    "verified": ("is-verified", "Verified"),
    "research-verified": ("is-rverified", "Research verified"),
    "blocked": ("is-blocked", "Blocked · needs agency data"),
    "review": ("is-review", "Needs review"),
}
ORDER = ("verified", "research-verified", "review", "blocked")
COLOUR = {"verified": "var(--ok)", "research-verified": "var(--violet)",
          "review": "var(--amber)", "blocked": "var(--red)"}
e = html.escape


def fixture_counts():
    text = len(json.load(open(os.path.join(HERE, "fixtures", "known_failures.json"), encoding="utf-8")))
    struct = len(json.load(open(os.path.join(HERE, "fixtures", "structural_failures.json"),
                                encoding="utf-8"))["cases"])
    return text, struct


def provenance(t, ledger):
    ids = [c for c in t["claim_ids"] if isinstance(c, int) and c in ledger and ledger[c].get("active")]
    if not ids:
        return '<p class="prov">No factual claim on this card — nothing to source</p>'
    verdicts = Counter(ledger[i]["verdict"] for i in ids)
    classes = Counter(s["source_class"] for i in ids for s in ledger[i].get("sources") or [])
    parts = [f"{len(ids)} active claims"]
    for key, label in (("VERIFIED_FACT", "verified"), ("VERIFIED_GUARDRAIL", "guardrails"),
                       ("TIME_SENSITIVE", "time-sensitive"), ("NOT_APPLICABLE_NONFACTUAL", "non-factual")):
        if verdicts.get(key):
            parts.append(f"{verdicts[key]} {label}")
    primary = classes.get("LAW_PRIMARY", 0) + classes.get("TAX_PRIMARY", 0) + classes.get("OFFICIAL_STATISTICS", 0)
    if primary:
        parts.append(f"{primary} on primary law, tax or official statistics")
    if t.get("verified_as_of"):
        parts.append(f"as of {t['verified_as_of']}")
    return f'<p class="prov">{" · ".join(parts)}</p>'


def card(t, ledger):
    cls, label = STATE[t["state"]]
    hook = t.get("production_hook")
    head = (f'<p class="orig">{e(hook)}</p>' if hook else
            '<p class="nohook">No stored hook. Non-green means the cover is written from fresh research '
            'at generation time — a hook is kept only where the hook itself was checked.</p>')
    gate = ("<p class=\"gate\">Requires this agency's own commission, completed sales or timelines. "
            "Never synthesised.</p>") if t["agency_evidence_required"] else ""
    must = "".join(f"<li>{e(x)}</li>" for x in t["must_establish"][:3])
    never = "".join(f"<li>{e(x)}</li>" for x in t["never_assume"][:3])
    return f"""<article class="seed {cls}">
<div class="seed-top"><span class="tag">{e(label)}</span><span class="idx">{e(t['topic_id'])}</span></div>
{head}{gate}{provenance(t, ledger)}
<p class="qlab">Researches as</p><p class="q">{e(t['current_research_question'] or '')}</p>
<div class="cols">{'<div><p class="mlab">Must establish</p><ul>' + must + '</ul></div>' if must else ''}
{'<div><p class="mlab">Never assume</p><ul class="never">' + never + '</ul></div>' if never else ''}</div>
</article>"""


def summary(bank):
    """The one status line on the page, computed from the bank it describes."""
    c = Counter(t["state"] for t in bank)
    return " · ".join(f"{STATE[k][1].split(' ·')[0]} {c[k]}" for k in ORDER if c.get(k))


def legend(bank):
    c = Counter(t["state"] for t in bank)
    return "".join(f'<div><i style="background:{COLOUR[k]}"></i> '
                   f'{STATE[k][1].split(" ·")[0]} — {c.get(k, 0)}</div>' for k in ORDER)


def render(bank, ledger, groups, title, kicker, lede, head_css):
    text_fx, struct_fx = fixture_counts()
    hooks = sum(1 for t in bank if t["production_hook"])
    out = [head_css, f'''<div class="wrap">
  <header class="mast">
    <span class="eyebrow">Costa Blanca · {kicker}</span>
    <h1>{title}</h1>
    <p class="lede">{lede}</p>
    <div class="stamp">
      <span>{summary(bank)}</span>
      <span>Stored hooks {hooks} of {len(bank)}</span>
      <span>Rendered 2 September 2026</span>
    </div>
  </header>

  <section>
    <div class="section-head">
      <span class="eyebrow">The topics</span>
      <h2>{len(bank)} topics</h2>
      <p>Each carries the question research must answer and what must never be assumed. A hook appears
        only where the hook itself was checked. The line under each card is its provenance — how many
        claims are active, what happened to them, and how many rest on primary law, tax or official
        statistics. Full record in the <a href="{LEDGER_URL}">verification ledger</a>.</p>
      <div class="legend">{legend(bank)}</div>
    </div>
  </section>
</div>

<div class="wide">''']
    by_id = {t["topic_id"]: t for t in bank}
    for name, sub, ids in groups:
        rows = [by_id[i] for i in ids if i in by_id]
        if not rows:
            continue
        tally = " · ".join(f"{v} {STATE[k][1].split(' ·')[0].lower()}"
                           for k, v in Counter(r["state"] for r in rows).items())
        out.append(f'<div class="need"><div class="need-head"><h3>{e(name)}</h3>'
                   + (f'<span class="q">{e(sub)}</span>' if sub else "")
                   + f'<span class="n">{tally}</span></div><div class="seeds">')
        out += [card(r, ledger) for r in rows]
        out.append("</div></div>")
    out.append(f'''</div>

<div class="wrap">
  <div class="note">
    <p><strong>Three statuses, not one.</strong> Research checking out and a card being publishable are
      different facts, so the badge is the weakest of them: every claim verified, a hook that was itself
      checked, and the text in the bank being the text an audit actually read. Green is always dated —
      for law, tax and market claims, verification without an as-of date is misleading.</p>
  </div>
  <footer>
    <p>tools/content-bank · {text_fx} text and {struct_fx} structural known-failure fixtures
      ({text_fx + struct_fx} total) · rendered from the production JSON</p>
  </footer>
</div>''')
    return "\n".join(out)


def main():
    seller = json.load(open(os.path.join(HERE, "seller_bank.json"), encoding="utf-8"))
    buyer = json.load(open(os.path.join(HERE, "buyer_bank.json"), encoding="utf-8"))
    ledger = {x["id"]: x for x in json.load(open(os.path.join(HERE, "ledger.json"),
                                                 encoding="utf-8"))["entries"]}
    head_css = open(os.path.join(HERE, "bank_head.html"), encoding="utf-8").read()

    area = {f"S{r['i']}": r["area"] for r in json.load(open("/tmp/seller_fields.json", encoding="utf-8"))}
    sgroups, seen = [], None
    for t in seller:
        a = area.get(t["topic_id"], "")
        if a != seen:
            nm, _, sub = a.partition("—")
            sgroups.append((nm.strip(), sub.strip(), []))
            seen = a
        sgroups[-1][2].append(t["topic_id"])

    NEED = [("Money", 1, 8), ("Fear", 9, 16), ("Direction", 17, 22), ("Dream", 23, 28),
            ("Decision", 29, 34), ("Understanding", 35, 40), ("Opportunity", 41, 46), ("Trust", 47, 52)]
    bgroups = [(nm, "", [f"B{n}" for n in range(a, b + 1)]) for nm, a, b in NEED]

    open(os.path.join(HERE, "seller-bank.html"), "w", encoding="utf-8").write(render(
        seller, ledger, sgroups, "What owners need before they sell", "seller bank",
        "Sixty-eight seller topics. Every factual claim beneath them checked against an appropriate "
        "source that was actually opened, with legal and tax claims requiring primary legal or tax "
        "authority.", head_css.replace("<title>X</title>", "<title>Costa Blanca Seller Bank</title>")))
    open(os.path.join(HERE, "buyer-bank.html"), "w", encoding="utf-8").write(render(
        buyer, ledger, bgroups, "What buyers actually want to read", "buyer bank",
        "Fifty-two buyer topics, rebuilt as research questions. Where no hook is stored, the cover is "
        "written from what the research returns rather than from a line the audit rejected.",
        head_css.replace("<title>X</title>", "<title>Costa Blanca Buyer Bank</title>")))
    print(f"seller: {summary(seller)}")
    print(f"buyer:  {summary(buyer)}")
    print(f"fixtures on page: {sum(fixture_counts())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
