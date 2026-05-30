"use client";

import { useCallback, useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  createInvitationAction,
  resendInvitationAction,
  revokeInvitationAction,
} from "../section-actions";
import { intlLocaleFor } from "@/lib/i18n/date-locale";
import { useLocale } from "next-intl";
import type { InvitationRow, SettingsResponse, TeamMember } from "@/lib/api/types";

function emailInitial(email: string): string {
  const head = email.split("@")[0] ?? "";
  const parts = head.split(/[.\-_]/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0]! + parts[1][0]!).toUpperCase();
  }
  return (head[0] ?? "?").toUpperCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type InviteRole = "owner" | "agent" | "viewer";

/**
 * Team & access — real members from team.members[], real pending invitations
 * from team.invitations[] (Vega's contract is live). Invite creates a real
 * row via the Phase-1 stub-with-real-INSERT endpoint; Phase 2 swaps the
 * back-end for the proper RPC + email-sending flow.
 */
export function TeamSection({
  team,
  currentUserId,
}: {
  team: SettingsResponse["team"];
  currentUserId: string;
}) {
  const t = useTranslations("settings.team");
  const locale = useLocale();

  const [members] = useState<TeamMember[]>(team.members);
  const [invitations, setInvitations] = useState<InvitationRow[]>(team.invitations);

  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const onCreated = useCallback((row: InvitationRow) => {
    setInvitations((arr) => [row, ...arr]);
    setToast(t("invitedToast"));
    window.setTimeout(() => setToast(null), 4000);
  }, [t]);

  const onRevoked = useCallback((id: string) => {
    setInvitations((arr) => arr.filter((i) => i.id !== id));
    setToast(t("revokedToast"));
    window.setTimeout(() => setToast(null), 3000);
  }, [t]);

  const onResent = useCallback(() => {
    setToast(t("resentToast"));
    window.setTimeout(() => setToast(null), 3000);
  }, [t]);

  return (
    <Card id="team" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        {members.map((m, idx) => (
          <MemberRow
            key={m.user_id}
            member={m}
            isYou={m.user_id === currentUserId}
            first={idx === 0}
            roleLabel={roleLabel(m.role, t)}
          />
        ))}

        {invitations.map((inv) => (
          <InvitationRowView
            key={inv.id}
            inv={inv}
            roleLabel={roleLabel(inv.role, t)}
            locale={locale}
            onRevoked={onRevoked}
            onResent={onResent}
          />
        ))}

        <div className="mt-5 flex items-center gap-3">
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#1FE874]" />
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("inviteBtn")}
          </Button>
          {toast ? (
            <p className="text-xs text-brand" aria-live="polite">
              {toast}
            </p>
          ) : null}
        </div>

        <p className="mt-4 text-[12px] text-muted-foreground">{t("footerSubLine")}</p>
      </CardContent>

      {open ? (
        <InviteModal onClose={() => setOpen(false)} onCreated={onCreated} />
      ) : null}
    </Card>
  );
}

function MemberRow({
  member,
  isYou,
  first,
  roleLabel,
}: {
  member: TeamMember;
  isYou: boolean;
  first: boolean;
  roleLabel: string;
}) {
  const t = useTranslations("settings.team");
  return (
    <div
      className={`flex items-center gap-3 py-3 ${first ? "" : "border-t border-border/60"}`}
    >
      <span
        aria-hidden
        className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-card"
      >
        {emailInitial(member.email)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-foreground">
          {member.email}
        </div>
        <div className="text-[11.5px] text-muted-foreground">{roleLabel}</div>
      </div>
      {isYou ? (
        <span className="rounded-full bg-brand-soft px-3 py-1 text-[10.5px] font-semibold text-brand">
          {t("youPill")}
        </span>
      ) : null}
    </div>
  );
}

function InvitationRowView({
  inv,
  roleLabel,
  locale,
  onRevoked,
  onResent,
}: {
  inv: InvitationRow;
  roleLabel: string;
  locale: string;
  onRevoked: (id: string) => void;
  onResent: () => void;
}) {
  const t = useTranslations("settings.team");
  const [working, startWorking] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // When last_sent_at is null the invite has never been sent — render the
  // dedicated "not yet sent" copy rather than templating an empty {ago} into
  // the "Pending — sent {ago}" string (which would read "Pending — sent
  // not sent yet"). Only compute the relative time when there's a real send.
  const lastSentAt = inv.last_sent_at;
  const dtf = new Intl.RelativeTimeFormat(intlLocaleFor(locale), { numeric: "auto" });
  const ago = lastSentAt
    ? dtf.format(
        -Math.round((Date.now() - new Date(lastSentAt).getTime()) / (1000 * 60 * 60 * 24)),
        "day",
      )
    : null;

  const handleRevoke = () => {
    setError(null);
    startWorking(async () => {
      const res = await revokeInvitationAction(inv.id);
      if (res.ok) {
        onRevoked(inv.id);
      } else {
        setError(res.error);
      }
    });
  };

  const handleResend = () => {
    setError(null);
    startWorking(async () => {
      const res = await resendInvitationAction(inv.id);
      if (res.ok) {
        onResent();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="flex items-center gap-3 border-t border-border/60 py-3 opacity-90">
      <span
        aria-hidden
        className="flex h-9 w-9 items-center justify-center rounded-full bg-muted-foreground/30 text-[11px] font-semibold text-foreground/70"
      >
        ?
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-foreground">{inv.email}</div>
        <div className="text-[11.5px] text-muted-foreground">
          {roleLabel} · {ago !== null ? t("pendingLabel", { ago }) : t("pendingNotSent")}
        </div>
        {error ? (
          <p className="text-[11px] text-red-600 dark:text-red-300" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleResend}
        disabled={working}
      >
        {t("resendBtn")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleRevoke}
        disabled={working}
      >
        {t("revokeBtn")}
      </Button>
    </div>
  );
}

function InviteModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (row: InvitationRow) => void;
}) {
  const t = useTranslations("settings.team");
  const emailId = useId();
  const roleId = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("agent");
  const [confirmOwner, setConfirmOwner] = useState(false);
  const [pending, startPending] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(() => {
    setError(null);
    if (!EMAIL_RE.test(email.trim())) {
      setError(t("modalEmailLabel"));
      return;
    }
    if (role === "owner" && !confirmOwner) {
      setConfirmOwner(true);
      return;
    }
    startPending(async () => {
      const res = await createInvitationAction(email.trim(), role);
      if (res.ok) {
        // Build a local row so the list reflects the new invite without waiting
        // for a hard refresh. The next page revalidation will replace it with
        // the canonical contract row.
        const now = new Date().toISOString();
        const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        onCreated({
          id: res.data.invitation_id,
          email: email.trim(),
          role,
          status: "pending",
          created_at: now,
          expires_at: res.data.expires_at ?? expires,
          send_attempts: 0,
          last_sent_at: null,
          invited_by: "",
        });
        onClose();
      } else {
        setError(res.error);
      }
    });
  }, [email, role, confirmOwner, onClose, onCreated, t]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("modalTitle")}
      className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/40 p-6 pt-24"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-elevated">
        <div className="flex items-center gap-3 border-b border-border/60 p-4">
          <h3 className="flex-1 text-[15px] font-semibold text-foreground">
            {t("modalTitle")}
          </h3>
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
          <div className="flex flex-col gap-1.5">
            <label htmlFor={emailId} className="text-[12px] font-medium text-foreground">
              {t("modalEmailLabel")}
            </label>
            <Input
              id={emailId}
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setConfirmOwner(false);
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={roleId} className="text-[12px] font-medium text-foreground">
              {t("modalRoleLabel")}
            </label>
            <select
              id={roleId}
              value={role}
              onChange={(e) => {
                setRole(e.target.value as InviteRole);
                setConfirmOwner(false);
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="agent">{t("modalRoleAgent")}</option>
              <option value="viewer">{t("modalRoleViewer")}</option>
              <option value="owner">{t("modalRoleOwner")}</option>
            </select>
          </div>

          {role === "owner" ? (
            <div className="rounded-md border border-amber-300/50 bg-amber-50/60 p-3 text-[12px] text-amber-900 dark:border-amber-300/30 dark:bg-amber-500/10 dark:text-amber-100">
              <div className="font-semibold">{t("ownerWarnTitle")}</div>
              <div className="mt-1">{t("ownerWarnBody")}</div>
            </div>
          ) : null}

          {error ? (
            <p className="text-xs text-red-600 dark:text-red-300" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t("modalCancel")}
            </Button>
            <Button type="button" size="sm" disabled={pending} onClick={onSubmit}>
              {pending
                ? t("modalSubmitting")
                : role === "owner" && !confirmOwner
                  ? t("ownerConfirm")
                  : t("modalSubmit")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function roleLabel(
  role: string,
  t: ReturnType<typeof useTranslations<"settings.team">>,
): string {
  switch (role) {
    case "owner":
      return t("roleOwner");
    case "agent":
      return t("roleAgent");
    case "viewer":
      return t("roleViewer");
    default:
      return role;
  }
}
