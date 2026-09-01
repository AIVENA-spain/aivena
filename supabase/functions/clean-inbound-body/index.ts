// CAPTURE (version control) of the deploy-only Edge Function `clean-inbound-body`.
// Slug: clean-inbound-body · id 7becfd43-c3ee-4601-b224-c81ece34adcd · version 16 · ACTIVE
// verify_jwt=TRUE (unlike the webhook functions — keep it true on any redeploy)
// import_map=TRUE — this function ships deno.json alongside index.ts; both are captured.
// ezbr_sha256: 52f2fdee90afd837b43e30c5e630d3b584537bf4c2e27f428a8d6efbac4481fa
// Captured 2026-09-01 from the DEPLOYED source, byte-for-byte (no secrets present).
// Do NOT deploy this file without diffing against live first — the repo has been stale before.
//
// supabase/functions/clean-inbound-body/index.ts
//
// AIVENA — server-side inbound email cleaning.
// Pure transform: input a raw inbound body, output the buyer's fresh message only.
// NO database access (least privilege). Called by W4a at ingestion + the one-time backfill.
//
// Pipeline (per Vera's architecture: library = solution, regex = tidy-up):
//   1. HTML→text  — if the body is HTML, strip to plaintext (crude, pilot-grade).
//   2. Header pre-pass — truncate at the earliest multi-language "X wrote:" header line.
//   3. Library strip — email-reply-parser removes >-quoted blocks + signatures.
//   4. Fallback — if nothing survives, return body_clean=null so the dashboard shows RAW.
//
// email-reply-parser API: new EmailReplyParser().read(text).getVisibleText()

import EmailReplyParser from "npm:email-reply-parser@1.0.5";

// CC's proven combined header regex (from git stash@{0}), V8-verified across EN/ES/DE/FR/IT/NL.
const HEADER_RE =
  /^(?:On|El|Am|Le|Il|Op)\s+.+?(?:wrote|escribió|schrieb|a\s+écrit|ha\s+scritto|schreef).*?:\s*$/m;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Crude HTML→text. Pilot-grade. Flagged: revisit if HTML-only inbounds prove common.
function stripHtml(s: string): string {
  return s
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, "\n");
}

function looksLikeHtml(s: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(s);
}

// Step 2: truncate at the earliest header line. Returns {text, cut}.
function headerTruncate(text: string): { text: string; cut: boolean } {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (HEADER_RE.test(lines[i])) {
      return { text: lines.slice(0, i).join("\n"), cut: true };
    }
  }
  return { text, cut: false };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let payload: { raw_body?: unknown; is_html?: unknown };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const raw = payload?.raw_body;
  if (typeof raw !== "string") {
    return jsonResponse({ error: "raw_body_required", detail: "raw_body must be a string" }, 400);
  }

  const originalLength = raw.length;

  if (raw.trim().length === 0) {
    return jsonResponse({
      body_clean: null, was_stripped: false, method: "none",
      original_length: originalLength, clean_length: 0,
    });
  }

  try {
    const isHtml = payload?.is_html === true || looksLikeHtml(raw);
    const text = isHtml ? stripHtml(raw) : raw;

    const { text: afterHeader, cut } = headerTruncate(text);

    let afterLibrary = "";
    try {
      afterLibrary = new EmailReplyParser().read(afterHeader).getVisibleText() ?? "";
    } catch (_libErr) {
      afterLibrary = "";
    }

    const libClean = afterLibrary.trim();
    const headerClean = afterHeader.trim();

    let bodyClean: string | null;
    let method: string;
    if (libClean.length > 0) {
      bodyClean = libClean;
      method = cut ? "header+library" : "library";
    } else if (headerClean.length > 0) {
      bodyClean = headerClean;
      method = "header-only";
    } else {
      bodyClean = null;
      method = "none";
    }

    return jsonResponse({
      body_clean: bodyClean,
      was_stripped: bodyClean !== null && bodyClean.length < raw.trim().length,
      method,
      original_length: originalLength,
      clean_length: bodyClean ? bodyClean.length : 0,
    });
  } catch (_err) {
    return jsonResponse({
      body_clean: null, was_stripped: false, method: "error",
      original_length: originalLength, clean_length: 0,
    });
  }
});
