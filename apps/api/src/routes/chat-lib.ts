/**
 * Amanda web-chat — pure request helpers (validation, error mapping, rate limit).
 * Kept db-free so it's unit-testable without the DB client / env. `chat.ts` (the
 * route) imports these plus the db client.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9 ().-]{6,20}$/;
export const CAP = { name: 120, email: 200, phone: 40, text: 2000, short: 160, transcript: 50 };

/** RPC RAISE code → friendly public message + status. Agency existence/test
 *  status is deliberately hidden behind one 404 (no slug/gating enumeration). */
export function mapCaptureError(code: string): { msg: string; status: 400 | 403 | 404 } {
  switch (code) {
    case 'consent_required':
      return { msg: 'Consent is required to send your details.', status: 400 };
    case 'nothing_to_capture':
      return { msg: 'Please provide your name, email, or phone.', status: 400 };
    case 'agency_not_found':
    case 'agency_not_enabled':
    default:
      return { msg: 'This chat is not available.', status: 404 };
  }
}

const str = (v: unknown, cap: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, cap) : null;
};
const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export type CaptureInput = {
  sessionToken: string | null; name: string | null; email: string | null; phone: string | null;
  consent: boolean; language: string | null; intent: string | null; budget: string | null;
  budgetMax: number | null; location: string | null; bedroomsMin: number | null;
  propertyType: string | null; transcript: Array<{ direction: string; content: string }> | null;
  pageUrl: string | null; referrer: string | null;
};

// ── Slice 2 (/message) — a single conversational turn ────────────────────────
export type MessageInput = {
  sessionToken: string; message: string; consent: boolean; language: string | null;
};

/** Pure validation for POST /:agencySlug/message. The widget owns the
 *  sessionToken (one per visitor session); a message is required; consent is
 *  optional here (only enforced at the capture hand-off). */
export function validateMessage(
  body: Record<string, unknown>,
): { ok: true; input: MessageInput } | { ok: false; error: string } {
  const sessionToken = str(body.sessionToken, CAP.short);
  if (!sessionToken) return { ok: false, error: 'Missing chat session.' };
  const message = str(body.message, CAP.text);
  if (!message) return { ok: false, error: 'Please type a message.' };
  return {
    ok: true,
    input: {
      sessionToken,
      message,
      consent: body.consent === true,
      language: str(body.language, 8),
    },
  };
}

/** Pure validation + normalisation of the request body. */
export function validateContact(body: Record<string, unknown>): { ok: true; input: CaptureInput } | { ok: false; error: string } {
  if (body.consent !== true) return { ok: false, error: 'Consent is required to send your details.' };
  const name = str(body.name, CAP.name);
  const email = str(body.email, CAP.email);
  const phone = str(body.phone, CAP.phone);
  if (!name && !email && !phone) return { ok: false, error: 'Please provide your name, email, or phone.' };
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: 'Please enter a valid email address.' };
  if (phone && !PHONE_RE.test(phone)) return { ok: false, error: 'Please enter a valid phone number.' };

  let transcript: CaptureInput['transcript'] = null;
  if (Array.isArray(body.transcript)) {
    transcript = body.transcript
      .slice(0, CAP.transcript)
      .map((m) => {
        const el = (m ?? {}) as Record<string, unknown>;
        const content = str(el.content, CAP.text);
        return content ? { direction: el.direction === 'outbound' ? 'outbound' : 'inbound', content } : null;
      })
      .filter((m): m is { direction: string; content: string } => m !== null);
    if (transcript.length === 0) transcript = null;
  }
  const ctx = (body.context ?? {}) as Record<string, unknown>;

  return {
    ok: true,
    input: {
      sessionToken: str(body.sessionToken, CAP.short), name, email, phone, consent: true,
      language: str(body.language, 8), intent: str(body.intent, 16), budget: str(body.budget, CAP.short),
      budgetMax: num(body.budgetMax), location: str(body.location, CAP.short), bedroomsMin: int(body.bedroomsMin),
      propertyType: str(body.propertyType, CAP.short), transcript,
      pageUrl: str(ctx.pageUrl ?? body.pageUrl, CAP.text), referrer: str(ctx.referrer ?? body.referrer, CAP.text),
    },
  };
}

/** Tiny in-memory sliding-window rate limiter (per key). Per-instance only — a
 *  shared store is a later hardening; enough as a basic spam guard for slice 1. */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return function allow(key: string, now: number): boolean {
    const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) { hits.set(key, arr); return false; }
    arr.push(now);
    hits.set(key, arr);
    return true;
  };
}
