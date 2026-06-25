import { getTranslations } from "next-intl/server";

/**
 * Plan & preferences — accordion body. Entirely READ-ONLY display (tier,
 * region, billing summary, dashboard language, appearance, signed-in identity).
 * No editable controls: plan/billing are provisioning-only, theme persistence
 * is parked, dashboard-language editing is read-only at pilot.
 */
export async function PlanPrefsSection({
  planTier,
  region,
  dashboardLanguage,
  theme,
  signedInEmail,
}: {
  planTier: string;
  region: string;
  dashboardLanguage: string;
  theme: string;
  signedInEmail: string;
}) {
  const t = await getTranslations("settings.plan");
  const tl = await getTranslations("settings.languages");

  const langName = isLangCode(dashboardLanguage) ? tl(("name_" + dashboardLanguage) as LangNameKey) : dashboardLanguage || "—";
  const themeLabel =
    theme === "dark" ? t("themeDark") : theme === "system" ? t("themeSystem") : t("themeLight");

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="flex flex-col">
        <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.07em] text-muted-foreground">{t("planHeading")}</h3>
        <Kv k={t("tierLabel")} v={t(("tier_" + planTier) as TierKey)} />
        <Kv k={t("regionLabel")} v={region || "—"} />
        <Kv k={t("billingLabel")} v={t("billingManaged")} />
        <a href="mailto:hello@aivena.es" className="mt-3 text-[12.5px] font-semibold text-brand hover:underline">
          {t("talkToUs")}
        </a>
      </div>
      <div className="flex flex-col">
        <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.07em] text-muted-foreground">{t("prefsHeading")}</h3>
        <Kv k={t("dashboardLanguageLabel")} v={langName} />
        <Kv k={t("appearanceLabel")} v={themeLabel} />
        <Kv k={t("signedInLabel")} v={signedInEmail || "—"} />
      </div>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 py-2 text-[13px] last:border-b-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium text-foreground">{v}</span>
    </div>
  );
}

type TierKey = "tier_starter" | "tier_pro" | "tier_unlimited";
type LangNameKey =
  | "name_es" | "name_en" | "name_no" | "name_sv" | "name_da"
  | "name_de" | "name_nl" | "name_fr" | "name_it" | "name_pt"
  | "name_ru" | "name_pl" | "name_fi";

function isLangCode(c: string): boolean {
  return ["es", "en", "no", "sv", "da", "de", "nl", "fr", "it", "pt", "ru", "pl", "fi"].includes(c);
}
