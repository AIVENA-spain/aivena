"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Home } from "lucide-react";

import { Label } from "@/components/ui/label";
import { GatePill } from "@/components/shell/launch-gate";

const LANG_CODES = [
  "es", "en", "no", "sv", "da", "de", "nl", "fr", "it", "pt", "ru", "pl", "fi",
] as const;

/**
 * W19 valuation lead magnet — public embeddable form (v1.14.6). SHELL stage:
 * every field is interactive; the two LOPDGDD consent checkboxes both default
 * UNCHECKED; the ECO/805/2003 disclaimer is always visible; the submit is gated
 * until the required consent is ticked AND Vega ships the capture endpoint +
 * valuation engine. No auth, no JWT, no RLS — this lives outside the dashboard
 * perimeter so it can be embedded on the agency's own site.
 */
export function ValuationForm({ brandName }: { brandName: string }) {
  const t = useTranslations("valuation");
  const tl = useTranslations("settings.languages");
  const [dataConsent, setDataConsent] = useState(false);
  const [commsConsent, setCommsConsent] = useState(false);

  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-elevated">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-6 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-brand">
            <Home className="h-5 w-5" aria-hidden />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[15px] font-semibold text-foreground">
              {t("title")}
            </span>
            <span className="text-[12px] text-muted-foreground">
              {t("subtitle", { agency: brandName })}
            </span>
          </div>
        </div>

        <form
          className="flex flex-col gap-4 px-6 py-5"
          onSubmit={(e) => e.preventDefault()}
        >
          <Field id="v-address" label={t("addressLabel")} placeholder={t("addressPlaceholder")} />
          <div className="grid grid-cols-2 gap-3">
            <Field id="v-bedrooms" label={t("bedroomsLabel")} type="number" />
            <Field id="v-area" label={t("areaLabel")} type="number" />
          </div>
          <Field id="v-name" label={t("nameLabel")} />
          <Field id="v-email" label={t("emailLabel")} type="email" />

          {/* Seller language */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="v-lang">{t("languageLabel")}</Label>
            <select
              id="v-lang"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {LANG_CODES.map((code) => (
                <option key={code} value={code}>
                  {tl(("name_" + code) as LangNameKey)}
                </option>
              ))}
            </select>
          </div>

          {/* Two-checkbox LOPDGDD consent — both default unchecked */}
          <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-muted/30 p-3">
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={dataConsent}
                onChange={(e) => setDataConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
              />
              <span className="text-[12px] leading-snug text-foreground">
                {t("consentData")}{" "}
                <span className="text-muted-foreground">{t("consentRequired")}</span>
              </span>
            </label>
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={commsConsent}
                onChange={(e) => setCommsConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
              />
              <span className="text-[12px] leading-snug text-foreground">
                {t("consentComms")}{" "}
                <span className="text-muted-foreground">{t("consentOptional")}</span>
              </span>
            </label>
          </div>

          {/* ECO/805/2003 disclaimer — always visible */}
          <p className="rounded-lg border border-border bg-card px-3 py-2 text-[11px] leading-snug text-muted-foreground">
            {t("ecoDisclaimer")}
          </p>

          {/* Gated submit — disabled until required consent + launch */}
          <div className="flex flex-col gap-2">
            <button
              type="submit"
              disabled
              aria-disabled
              className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground opacity-90"
            >
              {t("submit")}
              <GatePill />
            </button>
            {!dataConsent && (
              <p className="text-[11px] text-muted-foreground">{t("consentNeeded")}</p>
            )}
          </div>
        </form>
      </div>

      <p className="mt-3 text-center text-[11px] text-muted-foreground">
        {t("poweredBy")}
      </p>
    </div>
  );
}

function Field({
  id,
  label,
  placeholder,
  type = "text",
}: {
  id: string;
  label: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
      />
    </div>
  );
}

type LangNameKey =
  | "name_es" | "name_en" | "name_no" | "name_sv" | "name_da"
  | "name_de" | "name_nl" | "name_fr" | "name_it" | "name_pt"
  | "name_ru" | "name_pl" | "name_fi";
