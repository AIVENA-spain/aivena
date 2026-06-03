"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

import { saveLanguagesAction, saveAgencyLanguagesAction } from "../section-actions";

// DB CHECK constraint supported_languages_known — 13 codes.
export const SUPPORTED_LANGUAGE_CODES = [
  "es", "en", "no", "sv", "da", "de", "nl", "fr", "it", "pt", "ru", "pl", "fi",
] as const;
type LangCode = (typeof SUPPORTED_LANGUAGE_CODES)[number];

/**
 * Languages — three controls bound to agency_settings:
 *   1. supported_languages   — the chip set (channels the agency operates in).
 *   2. translation_target_language — what inbound + AI drafts are translated
 *      INTO for the whole agency (v1.14.4). Drives the inbox translation pane.
 *   3. dashboard_display_language   — the per-agency DEFAULT dashboard language
 *      a new team member inherits (v1.14.5), owner-editable only.
 * Per-change optimistic save, revert on failure.
 */
export function LanguagesSection({
  initial,
  translationTarget,
  dashboardDisplay,
  canEditDefault,
}: {
  initial: string[];
  translationTarget: string;
  dashboardDisplay: string;
  canEditDefault: boolean;
}) {
  const t = useTranslations("settings.languages");

  const [langs, setLangs] = useState<string[]>(() =>
    initial.filter((c) => (SUPPORTED_LANGUAGE_CODES as readonly string[]).includes(c)),
  );
  const [adding, setAdding] = useState(false);
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Agency-level single-language selects (translation target + display default).
  const [target, setTarget] = useState(translationTarget);
  const [display, setDisplay] = useState(dashboardDisplay);
  const [agencySaving, startAgencySaving] = useTransition();
  const [agencyError, setAgencyError] = useState<string | null>(null);

  const saveTarget = useCallback((next: string, prev: string) => {
    setTarget(next);
    setAgencyError(null);
    startAgencySaving(async () => {
      const res = await saveAgencyLanguagesAction({ translation_target_language: next });
      if (!res.ok) { setTarget(prev); setAgencyError(res.error); }
    });
  }, []);

  const saveDisplay = useCallback((next: string, prev: string) => {
    setDisplay(next);
    setAgencyError(null);
    startAgencySaving(async () => {
      const res = await saveAgencyLanguagesAction({ dashboard_display_language: next });
      if (!res.ok) { setDisplay(prev); setAgencyError(res.error); }
    });
  }, []);

  const remaining = useMemo(
    () =>
      (SUPPORTED_LANGUAGE_CODES as readonly LangCode[]).filter(
        (c) => !langs.includes(c),
      ),
    [langs],
  );

  const persist = useCallback(
    (next: string[], rollback: string[]) => {
      setLangs(next);
      setError(null);
      startSaving(async () => {
        const res = await saveLanguagesAction(next);
        if (!res.ok) {
          setLangs(rollback);
          setError(res.error);
        }
      });
    },
    [],
  );

  const onRemove = useCallback(
    (code: string) => {
      if (langs.length <= 1) return;
      const next = langs.filter((c) => c !== code);
      persist(next, langs);
    },
    [langs, persist],
  );

  const onAdd = useCallback(
    (code: string) => {
      if (langs.includes(code)) return;
      const next = [...langs, code];
      persist(next, langs);
      setAdding(false);
    },
    [langs, persist],
  );

  const last = langs.length <= 1;

  return (
    <Card id="languages" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {langs.map((code) => {
            const isOnly = last;
            const name = t(("name_" + code) as LangNameKey);
            return (
              <span
                key={code}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand-soft py-1 pl-3 pr-1 text-[12px] font-medium text-brand"
              >
                {name}
                <button
                  type="button"
                  onClick={() => onRemove(code)}
                  disabled={isOnly || saving}
                  title={isOnly ? t("lastChipTooltip") : undefined}
                  aria-label={t("removeAria", { name })}
                  className="ml-0.5 flex h-5 w-5 items-center justify-center rounded-full hover:bg-brand/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}

          {remaining.length > 0 ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setAdding((v) => !v)}
                className="rounded-full border border-dashed border-border bg-card px-3.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted"
              >
                {t("addBtn")}
              </button>
              {adding ? (
                <div className="absolute left-0 top-full z-10 mt-1 w-48 rounded-md border border-border bg-card p-1 shadow-elevated">
                  {remaining.map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => onAdd(code)}
                      className="block w-full rounded px-3 py-1.5 text-left text-[12px] text-foreground hover:bg-muted"
                    >
                      {t(("name_" + code) as LangNameKey)}
                      <span className="ml-2 font-mono text-[10px] uppercase text-muted-foreground">
                        {code}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {error ? (
          <p className="text-xs text-red-600 dark:text-red-300" role="alert">
            {error}
          </p>
        ) : null}

        {/* Agency-level translation target + dashboard default. */}
        <div className="mt-2 flex flex-col gap-5 border-t border-border pt-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="translation-target">{t("translateInto")}</Label>
            <select
              id="translation-target"
              value={target}
              disabled={agencySaving}
              onChange={(e) => saveTarget(e.target.value, target)}
              className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {(SUPPORTED_LANGUAGE_CODES as readonly LangCode[]).map((code) => (
                <option key={code} value={code}>
                  {t(("name_" + code) as LangNameKey)}
                </option>
              ))}
            </select>
            <p className="max-w-md text-xs text-muted-foreground">
              {t("translateIntoHelp")}
            </p>
          </div>

          {canEditDefault ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="display-default">{t("displayDefault")}</Label>
              <select
                id="display-default"
                value={display}
                disabled={agencySaving}
                onChange={(e) => saveDisplay(e.target.value, display)}
                className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                {(SUPPORTED_LANGUAGE_CODES as readonly LangCode[]).map((code) => (
                  <option key={code} value={code}>
                    {t(("name_" + code) as LangNameKey)}
                  </option>
                ))}
              </select>
              <p className="max-w-md text-xs text-muted-foreground">
                {t("displayDefaultHelp")}
              </p>
            </div>
          ) : null}

          {agencyError ? (
            <p className="text-xs text-red-600 dark:text-red-300" role="alert">
              {agencyError}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

type LangNameKey =
  | "name_es" | "name_en" | "name_no" | "name_sv" | "name_da"
  | "name_de" | "name_nl" | "name_fr" | "name_it" | "name_pt"
  | "name_ru" | "name_pl" | "name_fi";
