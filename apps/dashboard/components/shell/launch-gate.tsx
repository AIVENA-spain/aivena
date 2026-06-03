"use client";

import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The calm, deliberate gate shown on v1.15 feature shells whose backend isn't
 * wired yet (image-gen endpoints, WAA, valuation engine, matching engine).
 * Never a broken-looking control — a disabled primary action plus a small pill
 * that explains *why* it's inert. Two variants:
 *   - "launch"  → "Activates when your account goes live"
 *   - "tier"    → "Available on the Unlimited plan at launch" (€999 gating)
 */
export function GatePill({
  variant = "launch",
  className,
}: {
  variant?: "launch" | "tier";
  className?: string;
}) {
  const t = useTranslations("gate");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-brand/40 px-2 py-[2px] font-mono text-[9px] uppercase tracking-[0.06em] text-brand",
        className,
      )}
    >
      <Lock className="h-2.5 w-2.5" aria-hidden />
      {variant === "tier" ? t("tierPill") : t("launchPill")}
    </span>
  );
}

/**
 * A primary "fire" button that is permanently disabled at shell stage, with the
 * gate pill inline. Use for Generate / Send / Submit. `extraDisabledReason`
 * lets a caller require something *else* first (e.g. the renovation attestation
 * checkbox) — the button stays disabled either way, this only swaps the label.
 */
export function GatedActionButton({
  label,
  variant = "launch",
}: {
  label: string;
  variant?: "launch" | "tier";
}) {
  return (
    <button
      type="button"
      disabled
      aria-disabled
      className="flex flex-none cursor-not-allowed items-center gap-2 rounded-[10px] bg-primary px-[18px] py-[11px] text-[13px] font-semibold text-primary-foreground opacity-90"
    >
      {label}
      <GatePill variant={variant} />
    </button>
  );
}

/** A muted explanatory line to sit beneath a gated control. */
export function GateNote({ variant = "launch" }: { variant?: "launch" | "tier" }) {
  const t = useTranslations("gate");
  return (
    <p className="text-xs text-muted-foreground">
      {variant === "tier" ? t("tierNote") : t("launchNote")}
    </p>
  );
}
