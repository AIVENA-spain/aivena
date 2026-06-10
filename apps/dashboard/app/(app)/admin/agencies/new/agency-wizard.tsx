"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  Loader2,
  Copy,
  CircleCheck,
  CircleAlert,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import type { PlanTier } from "@/lib/api/admin-types";
import { checkSlugAction, createAgencyAction } from "../../admin-actions";

// 13 supported AIVENA locales.
const LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "nl", label: "Nederlands" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "da", label: "Dansk" },
  { code: "fi", label: "Suomi" },
  { code: "no", label: "Norsk" },
  { code: "pl", label: "Polski" },
  { code: "ru", label: "Русский" },
  { code: "sv", label: "Svenska" },
];

const PLANS: {
  tier: PlanTier;
  price: string;
  blurb: string;
  quotas: string[];
}[] = [
  {
    tier: "starter",
    price: "€599",
    blurb: "For a single office finding its feet.",
    quotas: ["10 ad creatives / mo", "10 social posts / mo", "300 voice min / mo"],
  },
  {
    tier: "pro",
    price: "€699",
    blurb: "More volume across content and voice.",
    quotas: ["20 ad creatives / mo", "20 social posts / mo", "900 voice min / mo"],
  },
  {
    tier: "unlimited",
    price: "€999",
    blurb: "No caps — for high-throughput agencies.",
    quotas: ["Unlimited content", "Unlimited voice", "Priority support"],
  },
];

const STEPS = ["Basics", "Plan & languages", "Channels", "Review", "Done"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

type SlugState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ok" }
  | { kind: "bad"; reason: string };

export function AgencyWizard() {
  const [step, setStep] = useState(0);

  // Form state
  const [tradingName, setTradingName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [legalName, setLegalName] = useState("");
  const [cifNif, setCifNif] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [region, setRegion] = useState("");

  const [planTier, setPlanTier] = useState<PlanTier>("starter");
  const [defaultLanguage, setDefaultLanguage] = useState("en");
  const [supportedLanguages, setSupportedLanguages] = useState<string[]>(["en"]);

  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);

  const [sendInvitation, setSendInvitation] = useState(true);

  // Submission + slug-check state
  const [slugState, setSlugState] = useState<SlugState>({ kind: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    agencyId: string;
    token: string | null;
  } | null>(null);

  const slugId = useId();

  // Auto-derive slug from trading name until the user edits the slug directly.
  useEffect(() => {
    if (!slugEdited) setSlug(slugify(tradingName));
  }, [tradingName, slugEdited]);

  // Debounced slug availability check.
  const slugTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (slugTimer.current) clearTimeout(slugTimer.current);
    if (!slug) {
      setSlugState({ kind: "idle" });
      return;
    }
    if (slug.length < 3 || !SLUG_RE.test(slug) || slug.includes("--")) {
      setSlugState({
        kind: "bad",
        reason:
          "Identifier needs 3+ characters: lowercase letters, numbers, and single hyphens.",
      });
      return;
    }
    setSlugState({ kind: "checking" });
    slugTimer.current = setTimeout(async () => {
      const res = await checkSlugAction(slug);
      setSlugState(
        res.available
          ? { kind: "ok" }
          : { kind: "bad", reason: res.reason ?? "This identifier is already in use." },
      );
    }, 400);
    return () => {
      if (slugTimer.current) clearTimeout(slugTimer.current);
    };
  }, [slug]);

  // Keep default language inside the supported set.
  const toggleLanguage = useCallback(
    (code: string) => {
      setSupportedLanguages((prev) => {
        const has = prev.includes(code);
        if (has && prev.length === 1) return prev; // keep at least one
        const next = has ? prev.filter((c) => c !== code) : [...prev, code];
        if (!next.includes(defaultLanguage)) setDefaultLanguage(next[0]);
        return next;
      });
    },
    [defaultLanguage],
  );

  const step1Valid =
    tradingName.trim().length >= 2 &&
    slugState.kind === "ok" &&
    EMAIL_RE.test(ownerEmail.trim());
  const step2Valid =
    supportedLanguages.length >= 1 &&
    supportedLanguages.includes(defaultLanguage);

  const canNext =
    (step === 0 && step1Valid) ||
    (step === 1 && step2Valid) ||
    step === 2 ||
    step === 3;

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    const res = await createAgencyAction({
      slug: slug.trim(),
      trading_name: tradingName.trim(),
      legal_name: legalName.trim() || undefined,
      cif_nif: cifNif.trim() || undefined,
      primary_owner_email: ownerEmail.trim(),
      primary_owner_phone: ownerPhone.trim() || undefined,
      primary_region: region.trim() || undefined,
      supported_languages: supportedLanguages,
      default_language: defaultLanguage,
      plan_tier: planTier,
      send_invitation: sendInvitation,
    });
    setSubmitting(false);
    if (!res.ok) {
      setSubmitError(res.error);
      return;
    }
    setCreated({
      agencyId: res.data.agency_id,
      token: res.data.invitation_token ?? null,
    });
    setStep(4);
  }

  return (
    <div className="flex flex-col gap-5">
      <Stepper step={step} />

      {step === 0 && (
        <StepCard title="Basics" subtitle="Who is this agency?">
          <Field label="Trading name" required>
            <Input
              value={tradingName}
              onChange={(e) => setTradingName(e.target.value)}
              placeholder="Mediterráneo Costa Homes"
              autoFocus
            />
          </Field>
          <Field
            label="Identifier (slug)"
            hint="Used in URLs and as the agency ID. Lowercase letters, numbers, hyphens. Permanent once created."
          >
            <Input
              id={slugId}
              value={slug}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value.toLowerCase());
              }}
              placeholder="mediterraneo-costa-homes"
              className="font-mono"
              aria-invalid={slugState.kind === "bad"}
            />
            <SlugStatus state={slugState} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Legal name" hint="Optional">
              <Input
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="Mediterráneo SL"
              />
            </Field>
            <Field label="CIF / NIF" hint="Optional — Spanish tax ID">
              <Input
                value={cifNif}
                onChange={(e) => setCifNif(e.target.value)}
                placeholder="B12345678"
                className="font-mono"
              />
            </Field>
          </div>
          <Field label="Primary owner email" required>
            <Input
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="owner@agency.es"
              aria-invalid={ownerEmail.length > 0 && !EMAIL_RE.test(ownerEmail.trim())}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Owner phone" hint="Optional">
              <Input
                value={ownerPhone}
                onChange={(e) => setOwnerPhone(e.target.value)}
                placeholder="+34 600 000 000"
              />
            </Field>
            <Field label="Primary region" hint="Optional">
              <Input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="Costa Blanca Sur"
              />
            </Field>
          </div>
        </StepCard>
      )}

      {step === 1 && (
        <StepCard title="Plan & languages" subtitle="Pick a tier and the languages this agency works in.">
          <div className="grid gap-3 sm:grid-cols-3">
            {PLANS.map((p) => (
              <button
                key={p.tier}
                type="button"
                onClick={() => setPlanTier(p.tier)}
                className={cn(
                  "flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors",
                  planTier === p.tier
                    ? "border-brand bg-brand-soft/50 ring-1 ring-brand"
                    : "border-border hover:border-foreground/20",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold capitalize text-foreground">
                    {p.tier}
                  </span>
                  {planTier === p.tier ? (
                    <Check className="h-4 w-4 text-brand" aria-hidden />
                  ) : null}
                </div>
                <span className="text-lg font-semibold text-foreground">
                  {p.price}
                  <span className="text-[11px] font-normal text-muted-foreground">
                    {" "}
                    / mo
                  </span>
                </span>
                <span className="text-[12px] text-muted-foreground">{p.blurb}</span>
                <ul className="mt-1 flex flex-col gap-1">
                  {p.quotas.map((q) => (
                    <li
                      key={q}
                      className="flex items-center gap-1.5 text-[12px] text-muted-foreground"
                    >
                      <Check className="h-3 w-3 flex-none text-brand" aria-hidden />
                      {q}
                    </li>
                  ))}
                </ul>
              </button>
            ))}
          </div>

          <Field label="Default language" hint="The agency's primary working language.">
            <Select
              value={defaultLanguage}
              onChange={(e) => setDefaultLanguage(e.target.value)}
              className="sm:w-64"
            >
              {supportedLanguages.map((code) => {
                const lang = LANGUAGES.find((l) => l.code === code);
                return (
                  <option key={code} value={code}>
                    {lang ? lang.label : code}
                  </option>
                );
              })}
            </Select>
          </Field>

          <Field
            label="Supported languages"
            hint="Languages this agency can serve buyers in. At least one."
          >
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGES.map((l) => {
                const on = supportedLanguages.includes(l.code);
                return (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => toggleLanguage(l.code)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[12.5px] transition-colors",
                      on
                        ? "border-brand bg-brand text-brand-fg"
                        : "border-border text-muted-foreground hover:border-foreground/30",
                    )}
                  >
                    {l.label}
                  </button>
                );
              })}
            </div>
          </Field>
        </StepCard>
      )}

      {step === 2 && (
        <StepCard
          title="Channels"
          subtitle="What can this agency send through? You can configure each fully after creation."
        >
          <ChannelRow
            label="Email"
            note="Always enabled."
            checked
            locked
            onChange={() => {}}
          />
          <ChannelRow
            label="WhatsApp"
            note="Requires WhatsApp Business setup after creation."
            checked={whatsappEnabled}
            onChange={setWhatsappEnabled}
          />
          <ChannelRow
            label="Voice agent"
            note="Requires Vapi setup after creation."
            checked={voiceEnabled}
            onChange={setVoiceEnabled}
          />
          <p className="font-serif text-[13.5px] italic text-muted-foreground">
            Only email is switched on at creation. WhatsApp and Voice are turned on
            from the agency&rsquo;s settings once their providers are connected.
          </p>
        </StepCard>
      )}

      {step === 3 && (
        <StepCard title="Review" subtitle="Confirm the details before creating.">
          <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            <Review label="Trading name" value={tradingName} />
            <Review label="Identifier" value={slug} mono />
            <Review label="Legal name" value={legalName || "—"} />
            <Review label="CIF / NIF" value={cifNif || "—"} mono />
            <Review label="Owner email" value={ownerEmail} />
            <Review label="Owner phone" value={ownerPhone || "—"} />
            <Review label="Region" value={region || "—"} />
            <Review label="Plan" value={planTier} capitalize />
            <Review
              label="Default language"
              value={LANGUAGES.find((l) => l.code === defaultLanguage)?.label ?? defaultLanguage}
            />
            <Review
              label="Languages"
              value={supportedLanguages
                .map((c) => LANGUAGES.find((l) => l.code === c)?.label ?? c)
                .join(", ")}
            />
          </div>

          <label className="mt-2 flex items-start gap-2.5 rounded-lg border border-border p-3">
            <input
              type="checkbox"
              checked={sendInvitation}
              onChange={(e) => setSendInvitation(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--brand,#0B7C3A)]"
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium text-foreground">
                Send an invitation to the primary owner now
              </span>
              <span className="font-serif text-[13px] italic text-muted-foreground">
                The agency is created, and the owner gets an email to set up their
                account.
              </span>
            </span>
          </label>

          {submitError ? (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
              {submitError}
            </div>
          ) : null}
        </StepCard>
      )}

      {step === 4 && created && (
        <StepCard title="" subtitle="">
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
              <CircleCheck className="h-6 w-6" aria-hidden />
            </div>
            <h2 className="text-xl font-semibold text-foreground">
              Agency created
            </h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{tradingName}</span> is
              live.{" "}
              {sendInvitation
                ? "The primary owner has been emailed an invitation to set up their account."
                : "No invitation was sent — you can invite the owner from the team page."}
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <Link
                href={`/admin/agencies/${created.agencyId}`}
                className={buttonVariants({ size: "sm" })}
              >
                Open agency
              </Link>
              {created.token ? <CopyInviteLink token={created.token} /> : null}
              <Link
                href="/admin/agencies/new"
                className={buttonVariants({ variant: "outline", size: "sm" })}
                onClick={() => {
                  // Hard reset by navigating to a fresh wizard mount.
                  window.location.assign("/admin/agencies/new");
                }}
              >
                Create another
              </Link>
            </div>
          </div>
        </StepCard>
      )}

      {/* Footer nav */}
      {step < 4 ? (
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={step === 0 || submitting}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Back
          </Button>
          {step < 3 ? (
            <Button
              type="button"
              size="sm"
              disabled={!canNext}
              onClick={() => setStep((s) => s + 1)}
            >
              Continue
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={submitting} onClick={submit}>
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              {sendInvitation ? "Create & invite" : "Create agency"}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─── Small presentational helpers ───────────────────────────────────────────

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {STEPS.map((label, i) => (
        <div key={label} className="flex flex-1 flex-col gap-1.5">
          <div
            className={cn(
              "h-1 rounded-full transition-colors",
              i < step ? "bg-brand" : i === step ? "bg-brand/60" : "bg-border",
            )}
          />
          <span
            className={cn(
              "text-[10.5px] font-medium uppercase tracking-wide",
              i === step ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

function StepCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-5 p-5">
      {title ? (
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {subtitle ? (
            <p className="text-[13px] text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      ) : null}
      {children}
    </Card>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        {label}
        {required ? <span className="text-brand"> *</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-[11.5px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function SlugStatus({ state }: { state: SlugState }) {
  if (state.kind === "idle") return null;
  if (state.kind === "checking")
    return (
      <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Checking
        availability…
      </p>
    );
  if (state.kind === "ok")
    return (
      <p className="flex items-center gap-1.5 text-[11.5px] text-brand">
        <Check className="h-3 w-3" aria-hidden /> Available
      </p>
    );
  return (
    <p className="flex items-center gap-1.5 text-[11.5px] text-destructive">
      <CircleAlert className="h-3 w-3" aria-hidden /> {state.reason}
    </p>
  );
}

function ChannelRow({
  label,
  note,
  checked,
  locked,
  onChange,
}: {
  label: string;
  note: string;
  checked: boolean;
  locked?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
      <div className="flex flex-col">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-[12px] text-muted-foreground">{note}</span>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={locked}
        aria-label={label}
      />
    </div>
  );
}

function Review({
  label,
  value,
  mono,
  capitalize,
}: {
  label: string;
  value: string;
  mono?: boolean;
  capitalize?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/50 pb-2">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-sm text-foreground",
          mono && "font-mono text-[13px]",
          capitalize && "capitalize",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function CopyInviteLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        const link = `${window.location.origin}/invite/accept?token=${token}`;
        try {
          await navigator.clipboard.writeText(link);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2500);
        } catch {
          // Clipboard can fail silently (permissions); no-op.
        }
      }}
    >
      {copied ? (
        <Check className="h-4 w-4" aria-hidden />
      ) : (
        <Copy className="h-4 w-4" aria-hidden />
      )}
      {copied ? "Copied" : "Copy invitation link"}
    </Button>
  );
}
