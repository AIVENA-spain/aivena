import { getTranslations } from "next-intl/server";

import { apiFetch, ApiError } from "@/lib/api/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageLoadError } from "@/components/shell/page-error";

import { PreferencesForm } from "./preferences-form";

export const dynamic = "force-dynamic";

type PreferencesResponse = {
  uiLanguage: string;
  messageLanguage: string;
  theme: string;
};

const FALLBACK_PREFERENCES: PreferencesResponse = {
  uiLanguage: "en",
  messageLanguage: "en",
  theme: "system",
};

export default async function SettingsPage() {
  const t = await getTranslations("settings");

  let preferences: PreferencesResponse = FALLBACK_PREFERENCES;
  let loadFailed = false;

  try {
    preferences = await apiFetch<PreferencesResponse>(
      "/api/v1/me/preferences",
    );
  } catch (err) {
    loadFailed = true;
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[/settings] failed to load preferences:", detail);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
      </header>

      {loadFailed ? (
        <PageLoadError />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t("personal")}</CardTitle>
            <CardDescription>{t("personalDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <PreferencesForm initial={preferences} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
