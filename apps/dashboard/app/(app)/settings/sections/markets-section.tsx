"use client";

import { useCallback, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

import { saveTargetMarketsAction } from "../section-actions";

/**
 * Target markets — which countries this agency's buyers and sellers actually come from.
 *
 * This exists because "foreign buyer" is not a legal category, and treating it as one produces
 * wrong advice. A Norwegian has free movement and is not on the 90/180 clock; a British buyer
 * since 2021 is a third-country national who is. Written for a generic foreigner, a post is in
 * practice written for a British one — which is wrong for most of the Costa Blanca's actual market,
 * where Dutch buyers now outnumber British ones in Alicante province.
 *
 * Codes only are stored. The API owns the code → regime table, so when a country's status changes
 * we edit one table instead of every agency's saved settings.
 */
const REGIMES = [
  {
    key: "eu",
    codes: ["NL", "BE", "DE", "FR", "IE", "PL", "SE", "DK", "FI", "IT", "PT"],
  },
  { key: "eea", codes: ["NO", "IS", "LI"] },
  { key: "ch", codes: ["CH"] },
  { key: "third", codes: ["GB", "US", "CA", "RU", "UA"] },
] as const;

const NAMES: Record<string, string> = {
  NL: "Netherlands", BE: "Belgium", DE: "Germany", FR: "France", IE: "Ireland",
  PL: "Poland", SE: "Sweden", DK: "Denmark", FI: "Finland", IT: "Italy", PT: "Portugal",
  NO: "Norway", IS: "Iceland", LI: "Liechtenstein", CH: "Switzerland",
  GB: "United Kingdom", US: "United States", CA: "Canada", RU: "Russia", UA: "Ukraine",
};

export function MarketsSection({ initial }: { initial: string[] }) {
  const t = useTranslations("settings.markets");
  const [picked, setPicked] = useState<string[]>(initial);
  const [saved, setSaved] = useState<string[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = useCallback((code: string) => {
    setPicked((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));
  }, []);

  const dirty = picked.length !== saved.length || picked.some((c) => !saved.includes(c));

  const save = useCallback(() => {
    setError(null);
    start(async () => {
      const res = await saveTargetMarketsAction(picked);
      if (res.ok) setSaved(res.data.markets);
      else setError(res.error);
    });
  }, [picked]);

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground max-w-prose">{t("intro")}</p>

      {REGIMES.map(({ key, codes }) => (
        <fieldset key={key} className="space-y-2">
          <legend className="text-sm font-medium">{t(`regime.${key}.label`)}</legend>
          <p className="text-xs text-muted-foreground max-w-prose">{t(`regime.${key}.note`)}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {codes.map((code) => {
              const on = picked.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(code)}
                  disabled={pending}
                  className={[
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background hover:bg-accent",
                    pending ? "opacity-60" : "",
                  ].join(" ")}
                >
                  {NAMES[code] ?? code}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={!dirty || pending}>
          {pending ? t("saving") : t("save")}
        </Button>
        {!dirty && saved.length > 0 ? (
          <span className="text-sm text-muted-foreground">{t("count", { n: saved.length })}</span>
        ) : null}
        {saved.length === 0 && !dirty ? (
          <span className="text-sm text-muted-foreground">{t("empty")}</span>
        ) : null}
      </div>
    </div>
  );
}
