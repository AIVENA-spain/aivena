import Link from "next/link";
import { getTranslations } from "next-intl/server";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * Invitation acceptance — Phase 1 stub UI. The accept_invitation RPC isn't
 * shipped yet; today this page renders a calm "we'll finish setting this up"
 * message so an invitee who clicks the link doesn't hit a 404 or a stack
 * trace. Phase 2 swaps the body for a real token verification + sign-in
 * flow that calls accept_invitation(token).
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("stubTitle")}</CardTitle>
        <CardDescription>{t("title")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>{t("stubBody")}</p>
        <p className="break-all rounded-md bg-muted/60 px-3 py-2 font-mono text-[11px] text-foreground/80">
          {token}
        </p>
      </CardContent>
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
