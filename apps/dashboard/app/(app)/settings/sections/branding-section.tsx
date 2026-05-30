"use client";

import { useCallback, useId, useRef, useState, useTransition } from "react";
import { Upload, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { saveBrandingAction, uploadLogoAction, type BrandingPayload } from "../section-actions";
import type { SettingsResponse } from "@/lib/api/types";

/**
 * Branding + Voice & Tone — visually two cards, internally one form. Save
 * button lives on the branding card and POSTs every editable branding field
 * in one request, including tone + brand_voice from the Voice & Tone card.
 *
 * Logo upload is a separate flow (its own POST to the Edge Function wrapper);
 * the rendered preview swaps in-place on success without a page reload.
 */

const TONE_VALUES = ["warm", "formal", "concise", "playful", "luxury"] as const;
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg"]);

export function BrandingAndVoiceSection({
  branding,
}: {
  branding: SettingsResponse["branding"];
}) {
  const t = useTranslations("settings.branding");
  const tv = useTranslations("settings.voice");

  const nameId = useId();
  const colorId = useId();
  const sigNameId = useId();
  const sigRoleId = useId();
  const voiceId = useId();

  const [brandName, setBrandName] = useState(branding.brand_name ?? "");
  const [primaryColor, setPrimaryColor] = useState(
    branding.primary_color || "#1FE874",
  );
  const [sigName, setSigName] = useState(branding.email_signature_name ?? "");
  const [sigRole, setSigRole] = useState(branding.email_signature_role ?? "");
  const [tone, setTone] = useState<string>(branding.tone ?? "");
  const [brandVoice, setBrandVoice] = useState(branding.brand_voice ?? "");
  const [logoUrl, setLogoUrl] = useState<string | null>(branding.logo_url);

  const [saving, startSavingTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toneIsKnown = tone && (TONE_VALUES as readonly string[]).includes(tone);

  const onSave = useCallback(() => {
    setError(null);
    if (!brandName.trim()) {
      setError(t("agencyNamePlaceholder"));
      return;
    }
    if (!HEX_RE.test(primaryColor)) {
      setError(t("brandColorHint"));
      return;
    }
    const payload: BrandingPayload = {
      brand_name: brandName.trim(),
      primary_color: primaryColor,
      email_signature_name: sigName.trim(),
      email_signature_role: sigRole.trim(),
      tone: toneIsKnown ? tone : null,
      brand_voice: brandVoice,
    };
    startSavingTransition(async () => {
      const res = await saveBrandingAction(payload);
      if (res.ok) {
        setSavedAt(Date.now());
      } else {
        setError(res.error ?? t("saveFailedBranding"));
      }
    });
  }, [brandName, primaryColor, sigName, sigRole, tone, toneIsKnown, brandVoice, t]);

  const onFile = useCallback(
    async (file: File) => {
      setUploadError(null);
      if (!ALLOWED_LOGO_TYPES.has(file.type)) {
        setUploadError(t("logoHint"));
        return;
      }
      if (file.size > MAX_LOGO_BYTES) {
        setUploadError(t("logoHint"));
        return;
      }
      setUploading(true);
      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        // Browser-safe base64 in chunks (avoids RangeError on big strings).
        let binary = "";
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(
            null,
            Array.from(bytes.subarray(i, i + CHUNK)),
          );
        }
        const b64 = btoa(binary);
        const res = await uploadLogoAction({
          filename: file.name,
          content_type: file.type,
          content_base64: b64,
        });
        if (res.ok) {
          setLogoUrl(res.data.branding?.logo_url ?? logoUrl);
        } else {
          setUploadError(res.error);
        }
      } catch (err) {
        console.error("[branding] logo upload failed:", err);
        setUploadError(t("saveFailedBranding"));
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [t, logoUrl],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Agency branding card */}
      <Card id="branding" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Label htmlFor={nameId}>{t("agencyNameLabel")}</Label>
            <Input
              id={nameId}
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder={t("agencyNamePlaceholder")}
              className="max-w-sm"
            />
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>{t("logoLabel")}</Label>
              <div className="flex items-center gap-3">
                <LogoPreview logoUrl={logoUrl} brandName={brandName} />
                <div className="flex flex-col gap-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void onFile(file);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? (
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {t("logoUploading")}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Upload className="h-3.5 w-3.5" />
                        {logoUrl ? t("logoReplaceBtn") : t("logoUploadBtn")}
                      </span>
                    )}
                  </Button>
                  <p className="text-[11px] text-muted-foreground">{t("logoHint")}</p>
                  {uploadError ? (
                    <p
                      className="text-[11px] text-red-600 dark:text-red-300"
                      role="alert"
                    >
                      {uploadError}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor={colorId}>{t("brandColorLabel")}</Label>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-8 w-8 rounded-md border border-border"
                  style={{ backgroundColor: HEX_RE.test(primaryColor) ? primaryColor : "transparent" }}
                />
                <Input
                  id={colorId}
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value.trim())}
                  className="max-w-[140px] font-mono"
                  spellCheck={false}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">{t("brandColorHint")}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={sigNameId}>{t("signatureLabel")}</Label>
            <Input
              id={sigNameId}
              value={sigName}
              onChange={(e) => setSigName(e.target.value)}
              placeholder={t("signatureNamePlaceholder")}
              className="max-w-md"
            />
            <Input
              id={sigRoleId}
              value={sigRole}
              onChange={(e) => setSigRole(e.target.value)}
              placeholder={t("signatureRolePlaceholder")}
              className="max-w-md"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button type="button" onClick={onSave} disabled={saving}>
              {saving ? t("logoUploading") : t("saveBtn")}
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

      {/* Voice & tone — shares state, no separate save button */}
      <Card id="voice" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>{tv("title")}</CardTitle>
          <CardDescription>{tv("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {TONE_VALUES.map((value) => {
              const active = tone === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTone(value)}
                  className={`rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors ${
                    active
                      ? "border-brand/40 bg-brand-soft text-brand"
                      : "border-border bg-card text-foreground hover:bg-muted"
                  }`}
                >
                  {tv(`tone${capitalize(value)}` as ToneKey)}
                </button>
              );
            })}
          </div>
          {!toneIsKnown && tone ? (
            <p className="text-[12px] text-muted-foreground">
              {tv("currentToneHint", { tone })}
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor={voiceId}>{tv("describeLabel")}</Label>
            <textarea
              id={voiceId}
              value={brandVoice}
              onChange={(e) => setBrandVoice(e.target.value)}
              rows={4}
              placeholder={tv("describePlaceholder")}
              className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <p className="text-[12px] text-muted-foreground">{tv("honestSubLine")}</p>
        </CardContent>
      </Card>
    </div>
  );
}

type ToneKey =
  | "toneWarm"
  | "toneFormal"
  | "toneConcise"
  | "tonePlayful"
  | "toneLuxury";

function capitalize(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function LogoPreview({
  logoUrl,
  brandName,
}: {
  logoUrl: string | null;
  brandName: string;
}) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt="Agency logo"
        className="h-12 w-12 rounded-lg border border-border object-cover"
      />
    );
  }
  const initial = (brandName.trim()[0] ?? "A").toUpperCase();
  return (
    <span
      aria-hidden
      className="flex h-12 w-12 items-center justify-center rounded-lg bg-foreground text-lg font-bold text-[#1FE874]"
    >
      {initial}
    </span>
  );
}
