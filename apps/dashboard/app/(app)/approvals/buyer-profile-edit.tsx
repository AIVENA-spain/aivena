"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  formFromPrefs,
  buildPrefPatch,
  hasChanges,
  type EditablePrefs,
  type PrefError,
} from "./buyer-profile-edit-model";
import { updateLeadPreferencesAction } from "./preferences-actions";

/**
 * Inline "edit buyer profile" form — the agent-facing manual override for a lead's
 * saved search (location / budget / property type / bedrooms / bathrooms). On save
 * it PATCHes the live `update_lead_preferences` endpoint, which re-embeds + re-matches
 * the lead, so the recommended properties refresh (the parent re-fetches on success).
 * Honesty: validation mirrors the API's own rules; only changed fields are sent; a
 * failed save keeps the form so the agent can retry; nothing here sends to the buyer.
 */
export function BuyerProfileEdit({
  leadId,
  original,
  onSaved,
  onCancel,
}: {
  leadId: string;
  original: EditablePrefs;
  /** Called after a successful save so the parent can refresh intel + matches. */
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("inbox.intel");
  const [form, setForm] = useState(() => formFromPrefs(original));
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const built = buildPrefPatch(form, original);
  const localError: string | null = built.ok ? null : errText(built.error);
  const dirty = built.ok && hasChanges(built.patch);
  const canSave = dirty && !busy;

  function errText(e: PrefError): string {
    if (e === "invalid_budget") return t("editErrBudget");
    if (e === "invalid_number") return t("editErrNumber");
    return t("editErrRange");
  }

  function set(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setForm((f) => ({ ...f, [key]: v }));
      setApiError(null);
    };
  }

  async function handleSave() {
    if (!built.ok || !hasChanges(built.patch) || busy) return;
    setBusy(true);
    setApiError(null);
    const res = await updateLeadPreferencesAction(leadId, built.patch);
    if (res.ok) {
      setBusy(false);
      onSaved();
    } else {
      setApiError(res.error);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid gap-x-6 gap-y-2.5 @[320px]:grid-cols-2">
        <EditField label={t("location")}>
          <Input value={form.location} onChange={set("location")} className="h-8 text-[12px]" />
        </EditField>
        <EditField label={t("budget")}>
          <Input
            value={form.budget}
            onChange={set("budget")}
            inputMode="numeric"
            placeholder="€"
            className="h-8 text-[12px]"
          />
        </EditField>
        <EditField label={t("propertyType")}>
          <Input value={form.propertyType} onChange={set("propertyType")} className="h-8 text-[12px]" />
        </EditField>
        <EditField label={t("bathrooms")}>
          <Input
            value={form.bathroomsMin}
            onChange={set("bathroomsMin")}
            inputMode="numeric"
            placeholder={t("editMin")}
            className="h-8 text-[12px]"
          />
        </EditField>
        <EditField label={t("bedrooms")}>
          <div className="flex items-center gap-1.5">
            <Input
              value={form.bedroomsMin}
              onChange={set("bedroomsMin")}
              inputMode="numeric"
              placeholder={t("editMin")}
              className="h-8 text-[12px]"
              aria-label={`${t("bedrooms")} ${t("editMin")}`}
            />
            <span className="text-muted-foreground">–</span>
            <Input
              value={form.bedroomsMax}
              onChange={set("bedroomsMax")}
              inputMode="numeric"
              placeholder={t("editMax")}
              className="h-8 text-[12px]"
              aria-label={`${t("bedrooms")} ${t("editMax")}`}
            />
          </div>
        </EditField>
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground">{t("editHint")}</p>

      {localError || apiError ? (
        <p
          role="alert"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11.5px] text-amber-700 dark:text-amber-300"
        >
          {localError ?? apiError}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={!canSave} onClick={handleSave}>
          {busy ? t("editSaving") : t("editSave")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          disabled={busy}
          onClick={onCancel}
        >
          {t("editCancel")}
        </Button>
      </div>
    </div>
  );
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
