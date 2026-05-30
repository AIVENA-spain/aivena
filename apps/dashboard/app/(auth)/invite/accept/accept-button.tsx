"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type RpcSuccess = {
  agency_id: string;
  role: string;
  brand_name: string | null;
  display_name: string | null;
  accepted_at: string;
};

type AcceptState =
  | { kind: "idle" }
  | { kind: "accepting" }
  | { kind: "success"; data: RpcSuccess }
  | { kind: "error"; code: string };

const KNOWN_CODES = [
  "missing_token",
  "no_auth_context",
  "auth_user_missing_email",
  "invitation_not_found",
  "invitation_already_used",
  "invitation_expired",
  "email_mismatch",
] as const;

const SUCCESS_REDIRECT_MS = 2000;

/**
 * Client island for the /invite/accept consent + RPC call + result render.
 *
 * The server has already verified there is a session and that the URL carries
 * a token. We render a consent card by default; only on click of "Accept
 * invitation" do we call public.accept_invitation. Branch on the response:
 *
 *   - success                     → welcome card, auto-redirect to / after 2s
 *   - invitation_already_used     → silently route to /; the user is already
 *                                   a member from a prior accept (the RPC's
 *                                   user_agencies INSERT is ON CONFLICT DO
 *                                   NOTHING, so this is idempotent).
 *   - other typed errors          → friendly mapped copy in an error card
 */
export function AcceptInvitationButton({
  token,
  signInHref,
}: {
  token: string;
  signInHref: string;
}) {
  const router = useRouter();
  const t = useTranslations("auth.invite");
  const [state, setState] = useState<AcceptState>({ kind: "idle" });

  const onAccept = useCallback(() => {
    setState({ kind: "accepting" });
    void (async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.rpc("accept_invitation", {
          p_token: token,
        });
        if (error) {
          const code = matchCode(error.message ?? "");
          console.error(
            "[invite/accept] accept_invitation rejected:",
            JSON.stringify({ code, message: error.message }),
          );
          if (code === "invitation_already_used") {
            router.replace("/");
            return;
          }
          if (code === "no_auth_context") {
            // Defensive — server-side check passed, so this implies a stale
            // session. Send the user back through sign-in.
            router.replace(signInHref);
            return;
          }
          setState({ kind: "error", code: code ?? "unknown" });
          return;
        }
        setState({ kind: "success", data: data as RpcSuccess });
      } catch (err) {
        console.error("[invite/accept] rpc threw:", err);
        setState({ kind: "error", code: "unknown" });
      }
    })();
  }, [token, signInHref, router]);

  useEffect(() => {
    if (state.kind !== "success") return;
    const id = window.setTimeout(
      () => router.replace("/"),
      SUCCESS_REDIRECT_MS,
    );
    return () => window.clearTimeout(id);
  }, [state, router]);

  if (state.kind === "success") {
    const agencyName = state.data.display_name ?? state.data.brand_name ?? "—";
    const roleLabel = translateRoleName(t, state.data.role);
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("welcomeTitle", { agencyName })}</CardTitle>
          <CardDescription>
            {t("welcomeBody", { role: roleLabel })}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Link href="/" className={buttonVariants() + " w-full"}>
            {t("goToDashboard")}
          </Link>
        </CardFooter>
      </Card>
    );
  }

  if (state.kind === "error") {
    return <ErrorCard code={state.code} signInHref={signInHref} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("acceptTitle")}</CardTitle>
        <CardDescription>{t("acceptBody")}</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button
          type="button"
          className="w-full"
          disabled={state.kind === "accepting"}
          onClick={onAccept}
        >
          {state.kind === "accepting" ? t("accepting") : t("acceptCta")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function ErrorCard({
  code,
  signInHref,
}: {
  code: string;
  signInHref: string;
}) {
  const router = useRouter();
  const t = useTranslations("auth.invite");
  const [signingOut, startSigningOut] = useTransition();

  const onSignOutAndRetry = useCallback(() => {
    startSigningOut(() => {
      void (async () => {
        try {
          const supabase = createClient();
          await supabase.auth.signOut();
        } catch (err) {
          console.error("[invite/accept] signOut failed:", err);
        }
        router.replace(signInHref);
      })();
    });
  }, [router, signInHref]);

  const { title, body } = friendlyForCode(t, code);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
      <CardFooter>
        {code === "email_mismatch" ? (
          <Button
            type="button"
            className="w-full"
            disabled={signingOut}
            onClick={onSignOutAndRetry}
          >
            {t("signOutAndRetry")}
          </Button>
        ) : (
          <Link
            href="/login"
            className={buttonVariants({ variant: "outline" }) + " w-full"}
          >
            {t("signInCta")}
          </Link>
        )}
      </CardFooter>
    </Card>
  );
}

function friendlyForCode(
  t: ReturnType<typeof useTranslations<"auth.invite">>,
  code: string,
): { title: string; body: string } {
  switch (code) {
    case "invitation_not_found":
      return { title: t("invalidLink"), body: t("invalidLinkBody") };
    case "invitation_already_used":
      return { title: t("alreadyUsed"), body: t("alreadyUsedBody") };
    case "invitation_expired":
      return { title: t("expired"), body: t("expiredBody") };
    case "email_mismatch":
      return { title: t("emailMismatch"), body: t("emailMismatchBody") };
    case "auth_user_missing_email":
      return { title: t("authMissingEmailTitle"), body: t("authMissingEmailBody") };
    case "missing_token":
      return { title: t("errorTitle"), body: t("tokenMissing") };
    default:
      return { title: t("errorTitle"), body: t("errorBody") };
  }
}

function matchCode(message: string): string | null {
  for (const code of KNOWN_CODES) {
    if (message.includes(code)) return code;
  }
  return null;
}

function translateRoleName(
  t: ReturnType<typeof useTranslations<"auth.invite">>,
  role: string,
): string {
  switch (role) {
    case "owner":
      return t("roleNameOwner");
    case "agent":
      return t("roleNameAgent");
    case "viewer":
      return t("roleNameViewer");
    default:
      return role;
  }
}
