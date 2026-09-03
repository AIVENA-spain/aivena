"use client";

import { useCallback, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { saveAgencyProfileAction } from "../section-actions";

/**
 * The Agency Evidence Profile — five fields, and four of them are optional.
 *
 * Deliberately small. An agency should finish this in two or three minutes and start generating.
 * Everything heavier — completed sales, asking-versus-agreed prices, time-to-sell, renovation
 * outcomes, case studies — is collected later and only when a specific post would be better for it,
 * as one contextual question at that moment rather than twenty fields before anyone has seen a post.
 *
 * An absent fact never blocks the product. The public version of every topic exists without it; the
 * agency-specific version is an upgrade the agency unlocks by answering when asked.
 */
type Profile = {
  service_areas?: string;
  commission?: string;
  commission_vat?: string;
  mandate_types?: string;
  content_permission?: string;
};

const MANDATES = ["exclusive", "open", "both"] as const;
const VAT = ["exclusive", "inclusive"] as const;

export function AgencyProfileSection({ initial }: { initial: Profile }) {
  const t = useTranslations("settings.agencyProfile");
  const [form, setForm] = useState<Profile>(initial);
  const [saved, setSaved] = useState<Profile>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = useCallback(
    (k: keyof Profile, v: string) => setForm((f) => ({ ...f, [k]: v })),
    [],
  );

  const dirty = (Object.keys(form) as (keyof Profile)[]).some((k) => form[k] !== saved[k]);

  const save = useCallback(() => {
    setError(null);
    start(async () => {
      const res = await saveAgencyProfileAction(form);
      if (res.ok) setSaved(res.data.profile);
      else setError(res.error);
    });
  }, [form]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground max-w-prose">{t("intro")}</p>

      <div className="space-y-2">
        <Label htmlFor="ap-areas">{t("areas.label")}</Label>
        <Input
          id="ap-areas"
          value={form.service_areas ?? ""}
          onChange={(ev) => set("service_areas", ev.target.value)}
          placeholder={t("areas.placeholder")}
          disabled={pending}
        />
        <p className="text-xs text-muted-foreground">{t("areas.help")}</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("mandate.label")}</legend>
        <div className="flex flex-wrap gap-2 pt-1">
          {MANDATES.map((m) => {
            const on = form.mandate_types === m;
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                disabled={pending}
                onClick={() => set("mandate_types", on ? "" : m)}
                className={[
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "border-primary bg-primary text-primary-foreground"
                     : "border-input bg-background hover:bg-accent",
                ].join(" ")}
              >
                {t(`mandate.${m}`)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="space-y-2 border-t border-border/60 pt-5">
        <Label htmlFor="ap-commission">{t("commission.label")}</Label>
        <p className="text-xs text-muted-foreground max-w-prose">{t("commission.why")}</p>
        <Input
          id="ap-commission"
          value={form.commission ?? ""}
          onChange={(ev) => set("commission", ev.target.value)}
          placeholder={t("commission.placeholder")}
          disabled={pending}
        />
        {form.commission ? (
          <fieldset className="space-y-2 pt-2">
            <legend className="text-sm font-medium">{t("vat.label")}</legend>
            <p className="text-xs text-muted-foreground max-w-prose">{t("vat.help")}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {VAT.map((v) => {
                const on = form.commission_vat === v;
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={on}
                    disabled={pending}
                    onClick={() => set("commission_vat", v)}
                    className={[
                      "rounded-full border px-3 py-1 text-sm transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "border-primary bg-primary text-primary-foreground"
                         : "border-input bg-background hover:bg-accent",
                    ].join(" ")}
                  >
                    {t(`vat.${v}`)}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}
      </div>

      <div className="space-y-2 border-t border-border/60 pt-5">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={form.content_permission === "yes"}
            disabled={pending}
            onChange={(ev) => set("content_permission", ev.target.checked ? "yes" : "no")}
          />
          <span>
            <span className="font-medium">{t("permission.label")}</span>
            <span className="block text-xs text-muted-foreground max-w-prose">
              {t("permission.help")}
            </span>
          </span>
        </label>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={!dirty || pending}>
          {pending ? t("saving") : t("save")}
        </Button>
        <span className="text-sm text-muted-foreground">{t("later")}</span>
      </div>
    </div>
  );
}
