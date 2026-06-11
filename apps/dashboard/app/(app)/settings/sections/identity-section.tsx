"use client";

import { useCallback, useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CircleHelp } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { saveIdentityAction } from "../section-actions";
import type { SettingsResponse } from "@/lib/api/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sending identity — sending domain shown read-only with a Verified pill;
 * reply_to is the only editable field. The Hono endpoint explicitly rejects
 * any attempt to write from_email / sending_domain even if a UI bug sent them.
 */
export function IdentitySection({
  profile,
}: {
  profile: SettingsResponse["profile"];
}) {
  const t = useTranslations("settings.identity");

  const domainId = useId();
  const replyToId = useId();

  const [replyTo, setReplyTo] = useState(profile.reply_to ?? "");
  const [explainOpen, setExplainOpen] = useState(false);
  const hasDomain = Boolean(profile.sending_domain && profile.sending_domain.trim());
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const onSave = useCallback(() => {
    setError(null);
    if (!EMAIL_RE.test(replyTo.trim())) {
      setError(t("replyToLabel"));
      return;
    }
    startSaving(async () => {
      const res = await saveIdentityAction(replyTo.trim());
      if (res.ok) {
        setSavedAt(Date.now());
      } else {
        setError(res.error);
      }
    });
  }, [replyTo, t]);

  return (
    <Card id="identity" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor={domainId}>{t("domainLabel")}</Label>
            <button
              type="button"
              aria-label={t("domainExplainAria")}
              onClick={() => setExplainOpen((v) => !v)}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <CircleHelp className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          {explainOpen ? (
            <p className="max-w-md rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-[12px] leading-relaxed text-foreground">
              {t("domainExplainer")}
            </p>
          ) : null}
          {hasDomain ? (
            <>
              <div className="flex items-center gap-2">
                <Input
                  id={domainId}
                  value={profile.sending_domain ?? ""}
                  readOnly
                  aria-readonly
                  className="max-w-xs bg-muted/40 font-mono"
                />
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10.5px] font-semibold ${
                    profile.domain_verified
                      ? "bg-brand-soft text-brand"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                  }`}
                >
                  {profile.domain_verified ? t("verifiedPill") : t("notVerifiedPill")}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("domainHint")}</p>
            </>
          ) : (
            // No domain yet: a bare empty input + "not verified" reads as
            // broken. Show the onboarding explainer instead.
            <p className="max-w-md rounded-lg border border-dashed border-border bg-card px-3.5 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
              {t("domainPending")}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={replyToId}>{t("replyToLabel")}</Label>
          <Input
            id={replyToId}
            type="email"
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
            className="max-w-sm"
            spellCheck={false}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button type="button" onClick={onSave} disabled={saving}>
            {t("saveBtn")}
          </Button>
          {error ? (
            <p className="text-xs text-red-600 dark:text-red-300" role="alert">
              {error}
            </p>
          ) : savedAt ? (
            <p className="text-xs text-brand" aria-live="polite">
              {t("savedToast")}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
