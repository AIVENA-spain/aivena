"use client";

import { useCallback, useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Mail, MessageSquare, CalendarDays, Sparkles, X } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SettingsResponse } from "@/lib/api/types";

type ModalKind = "whatsapp" | "calendar" | "social";

/**
 * Connected channels — Email is live (uses profile.sending_domain); the other
 * three are stubbed-but-real-feeling. Each Connect button opens a modal that
 * mirrors the real connection flow's first step, and submission returns a
 * friendly "we'll email you when it's live" — no fake success.
 */
export function ChannelsSection({
  channels,
  sendingDomain,
}: {
  channels: SettingsResponse["channels"];
  sendingDomain: string;
}) {
  const t = useTranslations("settings.channels");
  const [openModal, setOpenModal] = useState<ModalKind | null>(null);
  const [submittedToast, setSubmittedToast] = useState(false);

  const onSubmitModal = useCallback(() => {
    setOpenModal(null);
    setSubmittedToast(true);
    window.setTimeout(() => setSubmittedToast(false), 3500);
  }, []);

  return (
    <Card id="channels" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        <ChannelRow
          icon={<Mail className="h-4 w-4" />}
          iconBg="bg-blue-500/15 text-blue-600 dark:text-blue-300"
          name={t("email")}
          sub={t("emailHint", { domain: sendingDomain || "—" })}
          right={
            <span className="rounded-full bg-brand-soft px-3 py-1 text-[10.5px] font-semibold text-brand">
              {t("connectedPill")}
            </span>
          }
          subline={null}
          first
        />
        <ChannelRow
          icon={<MessageSquare className="h-4 w-4" />}
          iconBg="bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
          name={t("whatsapp")}
          sub={t("whatsappSub")}
          right={
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setOpenModal("whatsapp")}
            >
              {t("connectBtn")}
            </Button>
          }
          subline={t("comingSoonNote")}
        />
        <ChannelRow
          icon={<CalendarDays className="h-4 w-4" />}
          iconBg="bg-blue-500/12 text-blue-600 dark:text-blue-300"
          name={t("calendar")}
          sub={t("calendarSub")}
          right={
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setOpenModal("calendar")}
            >
              {t("connectBtn")}
            </Button>
          }
          subline={t("comingSoonNote")}
        />
        <ChannelRow
          icon={<Sparkles className="h-4 w-4" />}
          iconBg="bg-purple-500/15 text-purple-600 dark:text-purple-300"
          name={t("social")}
          sub={t("socialSub")}
          right={
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setOpenModal("social")}
            >
              {t("connectBtn")}
            </Button>
          }
          subline={t("comingSoonNote")}
        />

        {submittedToast ? (
          <p className="mt-3 text-xs text-brand" aria-live="polite">
            {t("submittedToast")}
          </p>
        ) : null}
      </CardContent>

      {openModal ? (
        <ConnectModal kind={openModal} onClose={() => setOpenModal(null)} onSubmit={onSubmitModal} />
      ) : null}
    </Card>
  );
}

function ChannelRow({
  icon,
  iconBg,
  name,
  sub,
  right,
  subline,
  first,
}: {
  icon: React.ReactNode;
  iconBg: string;
  name: string;
  sub: string;
  right: React.ReactNode;
  subline: string | null;
  first?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-1 py-3 ${first ? "" : "border-t border-border/60"}`}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconBg}`}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-foreground">{name}</div>
          <div className="text-[11.5px] text-muted-foreground">{sub}</div>
        </div>
        {right}
      </div>
      {subline ? (
        <p className="ml-12 text-[11px] text-muted-foreground">{subline}</p>
      ) : null}
    </div>
  );
}

function ConnectModal({
  kind,
  onClose,
  onSubmit,
}: {
  kind: ModalKind;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const t = useTranslations("settings.channels");
  const phoneId = useId();
  const [phone, setPhone] = useState("");
  const [pending, startPending] = useTransition();

  const title =
    kind === "whatsapp" ? t("whatsappModalTitle") : kind === "calendar" ? t("calendarModalTitle") : t("socialModalTitle");
  const body =
    kind === "whatsapp" ? t("whatsappModalBody") : kind === "calendar" ? t("calendarModalBody") : t("socialModalBody");
  const submitLabel =
    kind === "whatsapp" ? t("whatsappSubmit") : kind === "calendar" ? t("calendarSubmit") : t("socialSubmit");

  const handleSubmit = () => {
    // No backend yet — give the request a brief pending state for honesty,
    // then close and surface the friendly toast.
    startPending(() => {
      window.setTimeout(onSubmit, 250);
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/40 p-6 pt-24"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-elevated">
        <div className="flex items-center gap-3 border-b border-border/60 p-4">
          <h3 className="flex-1 text-[15px] font-semibold text-foreground">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("modalCancel")}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-4 p-4">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">{body}</p>

          {kind === "whatsapp" ? (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={phoneId}
                className="text-[12px] font-medium text-foreground"
              >
                {t("whatsappPhoneLabel")}
              </label>
              <Input
                id={phoneId}
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("whatsappPhonePlaceholder")}
                className="max-w-sm font-mono text-[12px]"
              />
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t("modalCancel")}
            </Button>
            <Button type="button" size="sm" disabled={pending} onClick={handleSubmit}>
              {submitLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
