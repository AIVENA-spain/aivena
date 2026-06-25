"use client";

import { useTranslations } from "next-intl";
import { Plus, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { emailInitial } from "@/lib/auth/initials";
import type { SettingsResponse, TeamMember } from "@/lib/api/types";

/**
 * Team & access — accordion body. Member rows render READ-ONLY (no ···/remove/
 * role-change — those are staff-only). Invite is DISABLED during pilot: invites
 * are handled by AIVENA, and the agency-facing path does not yet send the email.
 */
export function TeamSection({
  team,
  currentUserId,
}: {
  team: SettingsResponse["team"];
  currentUserId: string;
}) {
  const t = useTranslations("settings.team");
  const members = team.members;

  return (
    <div className="flex flex-col gap-3">
      {members.length === 0 ? (
        <p className="py-1.5 text-[12.5px] text-muted-foreground">{t("emptyState")}</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <th className="pb-2 font-mono">{t("colMember")}</th>
              <th className="pb-2 font-mono">{t("colRole")}</th>
              <th className="pb-2 font-mono">{t("colAccess")}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <MemberRow key={m.user_id} member={m} isYou={m.user_id === currentUserId} t={t} />
            ))}
          </tbody>
        </table>
      )}

      <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-[12px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
        <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{t("invitePilotNote")}</span>
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" size="sm" variant="outline" disabled>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t("inviteBtn")}
        </Button>
        <span className="text-[11px] text-muted-foreground">{t("inviteDisabledNote")}</span>
      </div>
    </div>
  );
}

function MemberRow({
  member,
  isYou,
  t,
}: {
  member: TeamMember;
  isYou: boolean;
  t: ReturnType<typeof useTranslations<"settings.team">>;
}) {
  const access = member.role === "owner" ? t("accessFull") : t("accessScoped");
  return (
    <tr className="border-t border-border/60 text-[13px]">
      <td className="py-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-[10.5px] font-semibold text-muted-foreground">
            {emailInitial(member.email)}
          </span>
          <span className="text-foreground">{member.email}</span>
          {isYou ? (
            <span className="rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand">{t("youPill")}</span>
          ) : null}
        </div>
      </td>
      <td className="py-3">
        <span className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {roleLabel(member.role, t)}
        </span>
      </td>
      <td className="py-3 font-medium text-brand">{access}</td>
    </tr>
  );
}

function roleLabel(role: string, t: ReturnType<typeof useTranslations<"settings.team">>): string {
  switch (role) {
    case "owner": return t("roleOwner");
    case "agent": return t("roleAgent");
    case "viewer": return t("roleViewer");
    default: return role;
  }
}
