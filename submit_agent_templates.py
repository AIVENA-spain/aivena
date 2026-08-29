#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AIVENA - create + submit the TWO AGENT-FACING WhatsApp templates (English).

These are the first templates AIVENA sends to its own agents rather than to
buyers, and they exist to open the 24h WhatsApp window from the agent's side:

  agent_shift_checkin_v1  fires 15 minutes before an agent's shift; their reply
                          opens the window AND stamps last_checkin_at (presence).
  agent_question_ping_v1  the fallback ping when the window is closed and a
                          buyer question needs that specific agent.

Wording approved verbatim by Christian 2026-08-29. Category UTILITY for both:
each is a direct, expected, non-promotional message tied to the agent's own work.

MODES
  (default)  DRY-RUN: prints both payloads, validates placeholders against the
             sample variables, makes ZERO Twilio calls.
  --submit   REAL run (also requires typing SUBMIT). Creates each Content
             template, submits it for WhatsApp approval, appends the SID
             artifact. Idempotent: an already-created key is skipped.

NO SECRET IS EVER PRINTED - not the account SID, not the token, not in errors.
"""
import argparse, base64, json, os, re, sys, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(HERE, ".env")
OUT_PATH = os.path.join(HERE, "twilio_agent_template_sids.txt")
API = "https://content.twilio.com/v1/Content"
SID_RE = re.compile(r"^HX[0-9a-fA-F]{32}$")
LANG = "en"

TEMPLATES = {
    "agent_shift_checkin_v1": {
        "category": "UTILITY",
        "body": ("Good morning {{1}}. Your day at {{2}} starts in 15 minutes. "
                 "Reply here and I'll send you client questions as they come in."),
        "variables": {"1": "Anna", "2": "Costa Homes Realty"},
    },
    "agent_question_ping_v1": {
        "category": "UTILITY",
        "body": ("{{1}} has a question about {{2}}. Reply to this message to answer "
                 "and I'll pass it straight on."),
        "variables": {"1": "Marte", "2": "the villa in Quesada, ref IC-81596"},
    },
}
ORDER = list(TEMPLATES.keys())


def load_env(path):
    env = {}
    if not os.path.exists(path):
        return env
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def auth_header(env):
    ks = env.get("TWILIO_API_KEY_SID") or os.environ.get("TWILIO_API_KEY_SID")
    ksec = env.get("TWILIO_API_KEY_SECRET") or os.environ.get("TWILIO_API_KEY_SECRET")
    acct = env.get("TWILIO_ACCOUNT_SID") or os.environ.get("TWILIO_ACCOUNT_SID")
    tok = env.get("TWILIO_AUTH_TOKEN") or os.environ.get("TWILIO_AUTH_TOKEN")
    if ks and ksec:
        user, pw, mode = ks, ksec, "api_key"
    elif acct and tok:
        user, pw, mode = acct, tok, "account_token"
    else:
        return None, None
    return "Basic " + base64.b64encode(("%s:%s" % (user, pw)).encode()).decode("ascii"), mode


def post(url, body, auth):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Authorization", auth)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.getcode(), json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        t = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(t)
        except ValueError:
            return e.code, {"_raw": t[:300]}
    except Exception as e:
        return 0, {"_error": str(e)}


def placeholders(s):
    return sorted(set(re.findall(r"\{\{(\d+)\}\}", s or "")))


def load_done():
    done = {}
    if os.path.exists(OUT_PATH):
        for line in open(OUT_PATH, encoding="utf-8"):
            p = line.rstrip("\n").split("\t")
            if len(p) >= 3 and SID_RE.match(p[2]):
                done[p[0]] = p[2]
    return done


def validate():
    problems = []
    for key in ORDER:
        t = TEMPLATES[key]
        ph = placeholders(t["body"])
        sv = sorted(t["variables"].keys())
        if ph != sv:
            problems.append("%s: placeholders %s != sample variables %s" % (key, ph, sv))
        if not t["body"].strip():
            problems.append("%s: empty body" % key)
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--submit", action="store_true")
    args = ap.parse_args()

    problems = validate()
    if problems:
        print("VALIDATION FAILED:")
        for p in problems:
            print("  -", p)
        sys.exit(2)
    print("validation OK - placeholders match sample variables for both templates\n")

    done = load_done()
    for key in ORDER:
        t = TEMPLATES[key]
        mark = "ALREADY CREATED (skip)" if key in done else "to create"
        print("%s  [%s]  %s" % (key, t["category"], mark))
        print("  friendly_name: %s_%s   language: %s" % (key, LANG, LANG))
        print("  variables:     %s" % json.dumps(t["variables"], ensure_ascii=False))
        print("  body:          %s\n" % t["body"])

    if not args.submit:
        print("DRY RUN - no Twilio calls made. Re-run with --submit to send for approval.")
        return

    env = load_env(ENV_PATH)
    auth, mode = auth_header(env)
    if not auth:
        print("No Twilio credentials found - nothing sent.")
        sys.exit(3)
    print("auth mode: %s (no secret printed)" % mode)
    confirm = input('Type SUBMIT to create and submit these templates to WhatsApp/Meta: ')
    if confirm.strip() != "SUBMIT":
        print("aborted - nothing sent.")
        return

    out = open(OUT_PATH, "a", encoding="utf-8")
    for key in ORDER:
        if key in done:
            print("skip %s (already %s)" % (key, done[key]))
            continue
        t = TEMPLATES[key]
        payload = {"friendly_name": "%s_%s" % (key, LANG), "language": LANG,
                   "variables": t["variables"], "types": {"twilio/text": {"body": t["body"]}}}
        code, resp = post(API, payload, auth)
        sid = resp.get("sid") if isinstance(resp, dict) else None
        if code not in (200, 201) or not (sid and SID_RE.match(sid)):
            print("CREATE FAILED %s -> HTTP %s %s" % (key, code, json.dumps(resp)[:240]))
            continue
        acode, aresp = post("%s/%s/ApprovalRequests/whatsapp" % (API, sid),
                            {"name": key, "category": t["category"]}, auth)
        status = (aresp or {}).get("status") or (aresp or {}).get("whatsapp", {}).get("status")
        print("created %s -> %s | approval HTTP %s status=%s" % (key, sid, acode, status))
        out.write("%s\t%s\t%s\t%s\n" % (key, LANG, sid, status))
        out.flush()
    out.close()
    print("\ndone - SIDs appended to %s" % os.path.basename(OUT_PATH))


if __name__ == "__main__":
    main()
