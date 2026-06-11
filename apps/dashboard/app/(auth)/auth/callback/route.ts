import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { BASE_PATH } from "@/lib/base-path";

/**
 * GET /auth/callback — magic-link return target.
 *
 * Supabase's PKCE flow appends `?code=<code>` to the redirect URL we passed
 * to `signInWithOtp({ options: { emailRedirectTo } })`. We hand that code to
 * `exchangeCodeForSession`, which writes the auth cookies via the server
 * client, then redirect into the app. On any failure we route back to
 * /login with an `error` flag so the operator gets a calm "please try again"
 * message rather than a stack trace.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Allow the caller to encode where they were headed before sign-in. We
  // accept only local paths to avoid open-redirect: anything that doesn't
  // start with "/" or that contains "//" falls back to the home route.
  const requestedNext = searchParams.get("next") ?? "/";
  const safeNext =
    requestedNext.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/";

  if (!code) {
    return NextResponse.redirect(`${origin}${BASE_PATH}/login?error=missing_code`);
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[/auth/callback] exchangeCodeForSession failed:", error.message);
      return NextResponse.redirect(`${origin}${BASE_PATH}/login?error=callback`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/auth/callback] unexpected failure:", message);
    return NextResponse.redirect(`${origin}${BASE_PATH}/login?error=callback`);
  }

  return NextResponse.redirect(`${origin}${BASE_PATH}${safeNext}`);
}
