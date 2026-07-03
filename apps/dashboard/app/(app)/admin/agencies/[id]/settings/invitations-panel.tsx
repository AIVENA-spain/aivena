"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Mail } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { AgencyInvitation } from "@/lib/api/admin-types";
import { resendInvitationAction, revokeInvitationAction } from "../../../admin-actions";

/**
 * Staff invitations panel (Phase 2). Lists an agency's invitations and offers
 * Resend (existing plain re-send) + Revoke (soft — marks revoked_at, keeps the
 * row) on still-pending ones. No delete. English-only (admin surface).
 */
type DisplayStatus = "pending" | "accepted" | "revoked" | "expired";

function displayStatus(inv: AgencyInvitation): DisplayStatus {
  // Derive from the concrete columns + status; never blanket-default an unknown to "revoked".
  if (inv.accepted_at || inv.status === "accepted") return "accepted";
  if (inv.revoked_at || inv.status === "revoked") return "revoked";
  if (inv.status === "expired") return "expired";
  if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) return "expired";
  return "pending";
}

const STATUS_CLS: Record<DisplayStatus, string> = {
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  accepted: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  revoked: "bg-muted text-muted-foreground",
  expired: "bg-muted text-muted-foreground",
};

export function InvitationsPanel({
  agencyId,
  invitations,
}: {
  agencyId: string;
  invitations: AgencyInvitation[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run(invId: string, fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setBusyId(invId);
    startTransition(async () => {
      const res = await fn();
      setBusyId(null);
      if (res.ok) {
        setMsg({ ok: true, text: okText });
        router.refresh();
      } else {
        setMsg({ ok: false, text: res.error ?? "That didn’t work — please try again." });
      }
    });
  }

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-foreground">Invitations</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Resend or revoke pending invites. Revoke is reversible-safe — it never deletes the record.
        </p>
      </div>

      {invitations.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">No invitations for this agency.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60">
          {invitations.map((inv) => {
            const s = displayStatus(inv);
            const actionable = s === "pending";
            const busy = pending && busyId === inv.id;
            return (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                    <Mail className="h-3.5 w-3.5 flex-none text-muted-foreground" aria-hidden />
                    {inv.email}
                    <span className="text-[11px] font-normal capitalize text-muted-foreground">· {inv.role}</span>
                  </span>
                  <span className="text-[11.5px] text-muted-foreground">
                    {inv.send_attempts > 0 ? `${inv.send_attempts} send${inv.send_attempts === 1 ? "" : "s"} · ` : ""}
                    {inv.expires_at ? `expires ${new Date(inv.expires_at).toLocaleDateString()}` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                      STATUS_CLS[s],
                    )}
                  >
                    {s}
                  </span>
                  {actionable ? (
                    <>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={pending}
                        onClick={() => run(inv.id, () => resendInvitationAction(agencyId, inv.id), "Invitation re-sent.")}
                      >
                        {busy ? "…" : "Resend"}
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="destructive"
                        disabled={pending}
                        onClick={() => run(inv.id, () => revokeInvitationAction(agencyId, inv.id), "Invitation revoked.")}
                      >
                        Revoke
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {msg ? (
        <div
          className={
            msg.ok
              ? "flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[12.5px] text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300"
              : "flex items-center gap-2 rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 text-[12.5px] text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300"
          }
        >
          {msg.ok ? (
            <CheckCircle2 className="h-4 w-4 flex-none" aria-hidden />
          ) : (
            <AlertTriangle className="h-4 w-4 flex-none" aria-hidden />
          )}
          {msg.text}
        </div>
      ) : null}
    </Card>
  );
}
