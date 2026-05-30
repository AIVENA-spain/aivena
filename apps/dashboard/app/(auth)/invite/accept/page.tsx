import Link from "next/link";
import { getTranslations } from "next-intl/server";

import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

import { AcceptInvitationButton } from "./accept-button";

export const dynamic = "force-dynamic";

/**
 * /invite/accept?token=… — Phase 2 wiring.
 *
 * Server-rendered orchestrator. We DO NOT call accept_invitation on page load
 * (calling on render would consume the invite before the user has consented,
 * and a refresh would silently produce a confusing "already used" branch).
 * Instead we pick one of three branches:
 *
 *   1. No token in URL          → "invitation link missing token" card.
 *   2. Token present, no session → "Sign in to accept this invitation" card
 *                                   linking to /login?next=<encoded URL>.
 *                                   The magic-link flow returns the user here
 *                                   after sign-in.
 *   3. Token present + session   → Server-render a consent card with an
 *                                   "Accept invitation" button (a client
 *                                   island). Only on click do we call the
 *                                   RPC, branch on success or typed errors,
 *                                   and auto-redirect on success.
 */
export default async function InviteAcceptPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const t = await getTranslations("auth.invite");
  const { token: rawToken } = await searchParams;
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("errorTitle")}</CardTitle>
          <CardDescription>{t("tokenMissing")}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Link
            href="/login"
            className={buttonVariants({ variant: "outline" }) + " w-full"}
          >
            AIVENA
          </Link>
        </CardFooter>
      </Card>
    );
  }

  // Round-trip the full path so the user lands back here after magic-link
  // sign-in. URL-encode the `?token=…` so it survives as a single `next=…`
  // value through /login → /auth/callback.
  const nextPath = `/invite/accept?token=${token}`;
  const signInHref = `/login?next=${encodeURIComponent(nextPath)}`;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("signInRequired")}</CardTitle>
          <CardDescription>{t("signInRequiredBody")}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Link href={signInHref} className={buttonVariants() + " w-full"}>
            {t("signInCta")}
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return <AcceptInvitationButton token={token} signInHref={signInHref} />;
}
