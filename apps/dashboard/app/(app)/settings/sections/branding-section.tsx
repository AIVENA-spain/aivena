"use client";

import { useCallback, useId, useRef, useState, useTransition } from "react";
import { Upload, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { saveBrandingAction, uploadLogoAction, type BrandingPayload } from "../section-actions";
import type { SettingsResponse } from "@/lib/api/types";

/**
 * Agency profile & branding — accordion body. All fields persist via the
 * existing Tier-1a /branding write (agency_branding). tone + brand_voice are
 * NOT written here (handled read-only/disabled in the AI section).
 */
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const URL_LOOSE = /^(https?:\/\/)?\S+\.\S+$/i;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg"]);

export function BrandingSection({ branding }: { branding: SettingsResponse["branding"] }) {
  const t = useTranslations("settings.branding");

  const nameId = useId();
  const colorId = useId();
  const sigNameId = useId();
  const sigRoleId = useId();

  const [brandName, setBrandName] = useState(branding.brand_name ?? "");
  const [primaryColor, setPrimaryColor] = useState(branding.primary_color || "#1FE874");
  const [sigName, setSigName] = useState(branding.email_signature_name ?? "");
  const [sigRole, setSigRole] = useState(branding.email_signature_role ?? "");
  const [logoUrl, setLogoUrl] = useState<string | null>(branding.logo_url);

  const [phone, setPhone] = useState(branding.phone ?? "");
  const [whatsappNumber, setWhatsappNumber] = useState(branding.whatsapp_number ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(branding.website_url ?? "");
  const [bookingUrl, setBookingUrl] = useState(branding.booking_url ?? "");
  const [officeAddress, setOfficeAddress] = useState(branding.office_address ?? "");
  const [city, setCity] = useState(branding.city ?? "");
  const [region, setRegion] = useState(branding.region ?? "");
  const [country, setCountry] = useState(branding.country ?? "");
  const [instagramUrl, setInstagramUrl] = useState(branding.instagram_url ?? "");
  const [facebookUrl, setFacebookUrl] = useState(branding.facebook_url ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(branding.linkedin_url ?? "");

  const [saving, startSaving] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    const urlFields = [websiteUrl, bookingUrl, instagramUrl, facebookUrl, linkedinUrl];
    if (urlFields.some((v) => v.trim() && !URL_LOOSE.test(v.trim()))) {
      setError(t("invalidUrl"));
      return;
    }
    const payload: BrandingPayload = {
      brand_name: brandName.trim(),
      primary_color: primaryColor,
      email_signature_name: sigName.trim(),
      email_signature_role: sigRole.trim(),
      phone: phone.trim(),
      whatsapp_number: whatsappNumber.trim(),
      website_url: websiteUrl.trim(),
      booking_url: bookingUrl.trim(),
      office_address: officeAddress.trim(),
      city: city.trim(),
      region: region.trim(),
      country: country.trim(),
      instagram_url: instagramUrl.trim(),
      facebook_url: facebookUrl.trim(),
      linkedin_url: linkedinUrl.trim(),
    };
    startSaving(async () => {
      const res = await saveBrandingAction(payload);
      if (res.ok) setSavedAt(Date.now());
      else setError(res.error ?? t("saveFailedBranding"));
    });
  }, [
    brandName, primaryColor, sigName, sigRole, phone, whatsappNumber, websiteUrl,
    bookingUrl, officeAddress, city, region, country, instagramUrl, facebookUrl,
    linkedinUrl, t,
  ]);

  const onFile = useCallback(
    async (file: File) => {
      setUploadError(null);
      if (!ALLOWED_LOGO_TYPES.has(file.type) || file.size > MAX_LOGO_BYTES) {
        setUploadError(t("logoHint"));
        return;
      }
      setUploading(true);
      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
        }
        const res = await uploadLogoAction({ filename: file.name, content_type: file.type, content_base64: btoa(binary) });
        if (res.ok) setLogoUrl(res.data.branding?.logo_url ?? logoUrl);
        else setUploadError(res.error);
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
    <div className="flex flex-col gap-4">
      <SubLabel first>{t("subIdentity")}</SubLabel>
      <div className="grid gap-4 sm:grid-cols-2">
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
              <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                {uploading ? (
                  <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t("logoUploading")}</span>
                ) : (
                  <span className="flex items-center gap-1.5"><Upload className="h-3.5 w-3.5" />{logoUrl ? t("logoReplaceBtn") : t("logoUploadBtn")}</span>
                )}
              </Button>
              <p className="text-[11px] text-muted-foreground">{t("logoHint")}</p>
              {uploadError ? <p className="text-[11px] text-red-600 dark:text-red-300" role="alert">{uploadError}</p> : null}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={colorId}>{t("brandColorLabel")}</Label>
          <div className="flex items-center gap-2">
            <span aria-hidden className="h-9 w-9 rounded-md border border-border" style={{ backgroundColor: HEX_RE.test(primaryColor) ? primaryColor : "transparent" }} />
            <Input id={colorId} value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value.trim())} className="max-w-[140px] font-mono" spellCheck={false} />
          </div>
          <p className="text-[11px] text-muted-foreground">{t("brandColorHint")}</p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId}>{t("agencyNameLabel")}</Label>
        <Input id={nameId} value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder={t("agencyNamePlaceholder")} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={sigNameId}>{t("signatureLabel")}</Label>
          <Input id={sigNameId} value={sigName} onChange={(e) => setSigName(e.target.value)} placeholder={t("signatureNamePlaceholder")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={sigRoleId}>{t("signatureRoleHeading")}</Label>
          <Input id={sigRoleId} value={sigRole} onChange={(e) => setSigRole(e.target.value)} placeholder={t("signatureRolePlaceholder")} />
        </div>
      </div>

      <SubLabel>{t("contactHeading")}</SubLabel>
      <div className="grid gap-4 sm:grid-cols-2">
        <LabeledInput label={t("phoneLabel")} value={phone} onChange={setPhone} inputMode="tel" />
        <LabeledInput label={t("whatsappNumberLabel")} value={whatsappNumber} onChange={setWhatsappNumber} inputMode="tel" />
        <LabeledInput label={t("websiteUrlLabel")} value={websiteUrl} onChange={setWebsiteUrl} inputMode="url" />
        <LabeledInput label={t("bookingUrlLabel")} value={bookingUrl} onChange={setBookingUrl} inputMode="url" />
      </div>
      <p className="text-[11px] text-muted-foreground">{t("urlHint")}</p>

      <SubLabel>{t("addressHeading")}</SubLabel>
      <div className="grid gap-4 sm:grid-cols-2">
        <LabeledInput label={t("officeAddressLabel")} value={officeAddress} onChange={setOfficeAddress} />
        <LabeledInput label={t("cityLabel")} value={city} onChange={setCity} />
        <LabeledInput label={t("regionLabel")} value={region} onChange={setRegion} />
        <LabeledInput label={t("countryLabel")} value={country} onChange={setCountry} />
      </div>

      <SubLabel>{t("socialHeading")}</SubLabel>
      <div className="grid gap-4 sm:grid-cols-2">
        <LabeledInput label={t("instagramUrlLabel")} value={instagramUrl} onChange={setInstagramUrl} inputMode="url" />
        <LabeledInput label={t("facebookUrlLabel")} value={facebookUrl} onChange={setFacebookUrl} inputMode="url" />
        <LabeledInput label={t("linkedinUrlLabel")} value={linkedinUrl} onChange={setLinkedinUrl} inputMode="url" />
      </div>

      <div className="mt-1 flex items-center gap-3 border-t border-border/60 pt-4">
        <Button type="button" onClick={onSave} disabled={saving}>{saving ? t("logoUploading") : t("saveBtn")}</Button>
        {error ? (
          <p className="text-xs text-red-600 dark:text-red-300" role="alert">{error}</p>
        ) : savedAt ? (
          <p className="text-xs text-brand" aria-live="polite">{t("savedToast")}</p>
        ) : null}
      </div>
    </div>
  );
}

function SubLabel({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <h3 className={`font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground ${first ? "" : "mt-2 border-t border-border/60 pt-4"}`}>
      {children}
    </h3>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: "tel" | "url" | "text";
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} inputMode={inputMode} />
    </div>
  );
}

function LogoPreview({ logoUrl, brandName }: { logoUrl: string | null; brandName: string }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt="Agency logo" className="h-12 w-12 rounded-lg border border-border object-cover" />
    );
  }
  const initial = (brandName.trim()[0] ?? "A").toUpperCase();
  return (
    <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-lg bg-foreground text-lg font-bold text-[#1FE874]">
      {initial}
    </span>
  );
}
