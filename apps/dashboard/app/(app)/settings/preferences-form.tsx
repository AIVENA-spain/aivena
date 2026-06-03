"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import {
  USER_PREF_LOCALES,
  USER_PREF_LOCALE_NAMES,
  type UserPrefLocale,
} from "@/lib/i18n/config";
import { updatePreferencesAction } from "./actions";

type ThemeChoice = "light" | "dark" | "system";

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error" };

export function PreferencesForm({
  initial,
}: {
  initial: { uiLanguage: string; messageLanguage: string; theme: string };
}) {
  const t = useTranslations("settings");
  const { setTheme } = useTheme();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [uiLanguage, setUiLanguage] = useState(initial.uiLanguage);
  const [messageLanguage, setMessageLanguage] = useState(initial.messageLanguage);
  const [theme, setLocalTheme] = useState<ThemeChoice>(
    (["light", "dark", "system"] as const).includes(
      initial.theme as ThemeChoice,
    )
      ? (initial.theme as ThemeChoice)
      : "system",
  );
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  async function save_patch(
    patch: Parameters<typeof updatePreferencesAction>[0],
    revert: () => void,
  ) {
    setSave({ kind: "saving" });
    startTransition(async () => {
      const result = await updatePreferencesAction(patch);
      if (result.ok) {
        setSave({ kind: "saved" });
        // If language changed, the messages catalogue changes — refresh so
        // the rest of the dashboard re-renders in the new locale.
        if (patch.uiLanguage) {
          router.refresh();
        }
      } else {
        revert();
        setSave({ kind: "error" });
      }
    });
  }

  function handleUiLanguageChange(value: string) {
    const prev = uiLanguage;
    setUiLanguage(value);
    void save_patch({ uiLanguage: value }, () => setUiLanguage(prev));
  }

  function handleMessageLanguageChange(value: string) {
    const prev = messageLanguage;
    setMessageLanguage(value);
    void save_patch({ messageLanguage: value }, () =>
      setMessageLanguage(prev),
    );
  }

  function handleThemeChange(value: ThemeChoice) {
    const prev = theme;
    setLocalTheme(value);
    setTheme(value);
    void save_patch({ theme: value }, () => {
      setLocalTheme(prev);
      setTheme(prev);
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Label htmlFor="ui-language">{t("dashboardLanguageLabel")}</Label>
        <select
          id="ui-language"
          value={uiLanguage}
          onChange={(e) => handleUiLanguageChange(e.target.value)}
          className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {USER_PREF_LOCALES.map((code) => (
            <option key={code} value={code}>
              {USER_PREF_LOCALE_NAMES[code as UserPrefLocale]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="message-language">{t("messageLanguageLabel")}</Label>
        <select
          id="message-language"
          value={messageLanguage}
          onChange={(e) => handleMessageLanguageChange(e.target.value)}
          className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {USER_PREF_LOCALES.map((code) => (
            <option key={code} value={code}>
              {USER_PREF_LOCALE_NAMES[code as UserPrefLocale]}
            </option>
          ))}
        </select>
        <p className="max-w-md text-xs text-muted-foreground">
          {t("messageLanguageHelp")}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("themeLabel")}</Label>
        <div className="inline-flex w-fit rounded-md border border-border bg-card p-0.5">
          <ThemeButton
            current={theme}
            value="light"
            onClick={handleThemeChange}
            icon={<Sun className="h-3.5 w-3.5" aria-hidden />}
            label={t("themeLight")}
          />
          <ThemeButton
            current={theme}
            value="dark"
            onClick={handleThemeChange}
            icon={<Moon className="h-3.5 w-3.5" aria-hidden />}
            label={t("themeDark")}
          />
          <ThemeButton
            current={theme}
            value="system"
            onClick={handleThemeChange}
            icon={<Monitor className="h-3.5 w-3.5" aria-hidden />}
            label={t("themeSystem")}
          />
        </div>
      </div>

      <SaveStatus state={save} t={t} />
    </div>
  );
}

function ThemeButton({
  current,
  value,
  onClick,
  icon,
  label,
}: {
  current: ThemeChoice;
  value: ThemeChoice;
  onClick: (v: ThemeChoice) => void;
  icon: React.ReactNode;
  label: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={cn(
        "flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      aria-pressed={active}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SaveStatus({
  state,
  t,
}: {
  state: SaveState;
  t: ReturnType<typeof useTranslations>;
}) {
  if (state.kind === "idle") return null;
  if (state.kind === "saving") {
    return (
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {t("saving")}
      </p>
    );
  }
  if (state.kind === "saved") {
    return (
      <p
        className="text-xs text-green-700 dark:text-green-300"
        aria-live="polite"
      >
        {t("saved")}
      </p>
    );
  }
  return (
    <p
      className="text-xs text-red-700 dark:text-red-300"
      role="alert"
      aria-live="polite"
    >
      {t("saveFailed")}
    </p>
  );
}
