import { NextResponse, type NextRequest } from "next/server";

import { apiFetch, ApiError } from "@/lib/api/client";

/**
 * POST /api/studio/editable-preview — one template tile for the Studio gallery.
 *
 * This exists because a SERVER ACTION cannot do this job. The gallery renders 32
 * tiles through a `runLimited(items, 4, …)` limiter, and that limiter has never
 * limited anything: every preview was a server action, and Next serialises those.
 * From Next's own dispatcher (app-router-instance.js:154) — any action that is not
 * a navigation is appended to a linked list and "will be started by
 * runRemainingActions after the previous action finishes". Four workers, one queue,
 * effective concurrency of one.
 *
 * That is the whole reason the gallery filled in top-to-bottom: a real cold load in
 * production wrote 29 tiles over 49.6 seconds, in exact catalogue order, gaps of
 * 1.1–4.1s, never two at once. Row 1 landed at ~2s and row 8 at ~48s.
 *
 * A plain Route Handler is not queued, so the limiter finally means what it says.
 * The auth path is identical: apiFetch reads the same session cookie and forwards
 * the same Bearer token, so this adds a proxy hop and nothing else.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = await apiFetch<Record<string, unknown>>("/api/studio/editable-preview", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return NextResponse.json({ ...data, ok: true });
  } catch (err) {
    if (err instanceof ApiError) {
      const b = (err.body ?? {}) as Record<string, unknown>;
      return NextResponse.json(
        { ...b, ok: false, message: b.message ?? err.message },
        { status: err.status },
      );
    }
    return NextResponse.json({ ok: false, message: "Something went wrong. Please try again." }, { status: 500 });
  }
}
