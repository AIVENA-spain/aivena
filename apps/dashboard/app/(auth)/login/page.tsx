"use client";

import { useCallback, useId, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Magic-link sign-in. The client SDK calls signInWithOtp; on success Supabase
 * emails the user a link back to /auth/callback, where we trade the code for
 * a session and redirect into the app. No password is captured anywhere.
 *
 * `?next=<local-path>` (e.g. when redirected from /invite/accept) is threaded
 * through the emailRedirectTo so the callback knows where to land the user.
 * Only local paths are honoured — open-redirect is enforced again in
 * /auth/callback before we follow the value.
 */
export default function LoginPage() {
  const t = useTranslations("auth.login");
  const emailId = useId();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, startPending] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      const trimmed = email.trim();
      if (!EMAIL_RE.test(trimmed)) {
        setError(t("errorGeneric"));
        return;
      }
      startPending(async () => {
        const supabase = createClient();
        const nextRaw = searchParams.get("next");
        const next =
          nextRaw && nextRaw.startsWith("/") && !nextRaw.startsWith("//")
            ? nextRaw
            : null;
        const callback = next
          ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
          : `${window.location.origin}/auth/callback`;
        const { error: supaError } = await supabase.auth.signInWithOtp({
          email: trimmed,
          options: { emailRedirectTo: callback },
        });
        if (supaError) {
          console.error("[login] signInWithOtp failed:", supaError.message);
          setError(t("errorGeneric"));
          return;
        }
        setSent(true);
      });
    },
    [email, t, searchParams],
  );

  if (sent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("sentTitle")}</CardTitle>
          <CardDescription>{t("sentBody", { email })}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setSent(false)}
          >
            {t("sentResend")}
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={emailId}>{t("emailLabel")}</Label>
            <Input
              id={emailId}
              name="email"
              type="email"
              autoComplete="email"
              placeholder={t("emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? t("sending") : t("sendBtn")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
