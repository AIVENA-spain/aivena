"use client";

import { useCallback, useId, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
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

function safeNext(raw: string | null): string | null {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
}

/**
 * Sign-in. Two options:
 *  - Password (default): client SDK signInWithPassword sets the SSR session
 *    cookies; we then hard-navigate to ?next (validated local path) or "/".
 *  - Magic link: signInWithOtp emails a link back to /auth/callback.
 * `?next=<local-path>` is threaded through both; open-redirect is enforced
 * here (safeNext) and again in /auth/callback.
 */
export default function LoginPage() {
  const t = useTranslations("auth.login");
  const emailId = useId();
  const passwordId = useId();
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<"password" | "magic">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, startPending] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      const trimmed = email.trim();
      if (!EMAIL_RE.test(trimmed)) {
        setError(mode === "password" ? t("errorInvalidCredentials") : t("errorGeneric"));
        return;
      }

      if (mode === "password") {
        if (!password) {
          setError(t("errorInvalidCredentials"));
          return;
        }
        startPending(async () => {
          const supabase = createClient();
          const { error: supaError } = await supabase.auth.signInWithPassword({
            email: trimmed,
            password,
          });
          if (supaError) {
            console.error("[login] signInWithPassword failed:", supaError.message);
            setError(t("errorInvalidCredentials"));
            return;
          }
          window.location.assign(safeNext(searchParams.get("next")) ?? "/");
        });
        return;
      }

      // Magic link
      startPending(async () => {
        const supabase = createClient();
        const next = safeNext(searchParams.get("next"));
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
    [mode, email, password, t, searchParams],
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

  const isPassword = mode === "password";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{isPassword ? t("subtitlePassword") : t("subtitle")}</CardDescription>
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
          {isPassword ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor={passwordId}>{t("passwordLabel")}</Label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {t("forgotLink")}
                </Link>
              </div>
              <Input
                id={passwordId}
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          ) : null}
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending
              ? isPassword
                ? t("signingIn")
                : t("sending")
              : isPassword
                ? t("signInBtn")
                : t("sendBtn")}
          </Button>
          <button
            type="button"
            onClick={() => {
              setMode(isPassword ? "magic" : "password");
              setError(null);
            }}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {isPassword ? t("useMagicLink") : t("usePassword")}
          </button>
        </CardFooter>
      </form>
    </Card>
  );
}
