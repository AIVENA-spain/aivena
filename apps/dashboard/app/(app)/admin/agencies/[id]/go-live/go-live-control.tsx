"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Lock, ShieldAlert, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PilotStatus } from "@/lib/api/types";
import { setPilotStatusAction, type SetPilotStatusResult } from "../../../admin-actions";

import {
  ATTESTATIONS,
  TARGETS,
  PILOT_STATUS_LABEL,
  attestationsRequired,
  overrideApplicable,
  reasonRequired,
  canSubmit,
  allAttestationsChecked,
  type Attestations,
  type AttestationKey,
  type PilotTarget,
} from "./go-live-display";

const ATTESTATION_LABEL = new Map(ATTESTATIONS.map((a) => [a.key, a.label]));

/**
 * The go-live control (C4, internal staff only). Lets staff move an agency
 * through the pilot lifecycle. For `live` it forces the four manual attestations;
 * pause/block/override force a reason. The BROWSER never decides readiness —
 * `canSubmit` only gates the button; the authoritative answer is the server's
 * response, and a 422 is shown verbatim (blockers + missing attestations).
 * English-only (admin surface, brief §12).
 */
export function GoLiveControl({
  agencyId,
  currentPilot,
  itemLabels,
}: {
  agencyId: string;
  currentPilot: PilotStatus | null;
  itemLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<PilotTarget | null>(null);
  const [attestations, setAttestations] = useState<Attestations>({});
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<SetPilotStatusResult | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setTarget(null);
    setAttestations({});
    setOverride(false);
    setReason("");
    setResult(null);
  }

  function selectTarget(t: PilotTarget) {
    setTarget(t);
    setAttestations({});
    setOverride(false);
    setReason("");
    setResult(null);
  }

  function toggleAttestation(key: AttestationKey) {
    setAttestations((a) => ({ ...a, [key]: !a[key] }));
  }

  const submittable =
    target !== null &&
    canSubmit({ target, attestations, override, reason, submitting: pending });

  function submit() {
    if (!target || !submittable) return;
    const trimmed = reason.trim();
    startTransition(async () => {
      const res = await setPilotStatusAction(agencyId, {
        target,
        attestations: attestationsRequired(target) ? attestations : undefined,
        override: overrideApplicable(target) ? override : false,
        reason: trimmed.length ? trimmed : null,
      });
      setResult(res);
      if (res.ok) {
        setTarget(null);
        setAttestations({});
        setOverride(false);
        setReason("");
        router.refresh(); // re-pull the readiness panel from the server
      }
    });
  }

  return (
    <Card className="gap-4 p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-foreground">Change pilot status</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Current:{" "}
          <span className="font-medium text-foreground">
            {currentPilot ? PILOT_STATUS_LABEL[currentPilot] : "Unknown"}
          </span>
          . The server re-checks readiness on every change — this control cannot force a
          fake &ldquo;ready&rdquo;.
        </p>
      </div>

      {/* Go-live requirements — ALWAYS visible so staff see the 4 manual gates upfront,
          before they even pick "Go live". */}
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
          <ShieldCheck className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
          Going live requires 4 manual confirmations
        </div>
        <p className="mt-1 text-[11.5px] text-muted-foreground">
          These are staff attestations with no automatic signal — <b>Go live stays blocked until
          all four are ticked</b>, and an override cannot bypass them.
        </p>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {ATTESTATIONS.map((a) => (
            <li key={a.key} className="flex items-start gap-1.5 text-[12px] text-foreground">
              <span className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-muted-foreground/50" aria-hidden />
              {a.label}
            </li>
          ))}
        </ul>
      </div>

      {/* Target selector */}
      <div className="flex flex-wrap gap-2">
        {TARGETS.map((t) => {
          const isCurrent = t.key === currentPilot;
          const selected = t.key === target;
          return (
            <Button
              key={t.key}
              type="button"
              size="sm"
              variant={selected ? "default" : "outline"}
              disabled={isCurrent || pending}
              onClick={() => selectTarget(t.key)}
              title={isCurrent ? "Already the current status" : t.blurb}
            >
              {t.label}
              {isCurrent ? " (current)" : ""}
            </Button>
          );
        })}
      </div>

      {/* Contextual form for the selected target */}
      {target ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-[12.5px] text-muted-foreground">
            {TARGETS.find((t) => t.key === target)?.blurb}
          </p>

          {/* Four manual attestations — only for `live`, hard-gated (not override-able).
              Prominent bordered block + a live "N of 4 confirmed" counter. */}
          {attestationsRequired(target) ? (
            <fieldset className="flex flex-col gap-2 rounded-lg border-2 border-amber-300 bg-amber-50/50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
              <legend className="flex items-center gap-2 px-1 text-[12px] font-semibold text-amber-800 dark:text-amber-200">
                <ShieldCheck className="h-4 w-4 flex-none" aria-hidden />
                Confirm all 4 manual gates to go live
                <span className="rounded-full bg-amber-200/70 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-500/25 dark:text-amber-100">
                  {ATTESTATIONS.filter((a) => attestations[a.key] === true).length} of 4 confirmed
                </span>
              </legend>
              {ATTESTATIONS.map((a) => (
                <label
                  key={a.key}
                  htmlFor={`att-${a.key}`}
                  className="flex cursor-pointer items-start gap-2.5 rounded-md p-1 hover:bg-amber-100/40 dark:hover:bg-amber-500/10"
                >
                  <input
                    id={`att-${a.key}`}
                    type="checkbox"
                    checked={attestations[a.key] === true}
                    onChange={() => toggleAttestation(a.key)}
                    disabled={pending}
                    className="mt-0.5 h-4 w-4 flex-none accent-amber-600"
                  />
                  <span className="flex flex-col">
                    <span className="text-[13px] font-medium text-foreground">{a.label}</span>
                    <span className="text-[12px] text-muted-foreground">{a.help}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}

          {/* Override — bypasses SOFT readiness gaps only; recorded; never attestations. */}
          {overrideApplicable(target) ? (
            <label htmlFor="override" className="flex cursor-pointer items-start gap-2.5">
              <input
                id="override"
                type="checkbox"
                checked={override}
                onChange={() => setOverride((v) => !v)}
                disabled={pending}
                className="mt-0.5 h-4 w-4 flex-none accent-amber-600"
              />
              <span className="flex flex-col">
                <span className="flex items-center gap-1.5 text-[13px] text-foreground">
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-600" aria-hidden />
                  Override unresolved readiness gaps
                </span>
                <span className="text-[12px] text-muted-foreground">
                  Proceed despite soft readiness gaps. Recorded in the audit trail. Does NOT
                  bypass the manual attestations.
                </span>
              </span>
            </label>
          ) : null}

          {/* Reason — required for pause / block / any override. */}
          {reasonRequired(target, override) ? (
            <div className="flex flex-col gap-1">
              <label htmlFor="reason" className="text-[12px] font-medium text-foreground">
                Reason <span className="text-muted-foreground">(required)</span>
              </label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={pending}
                maxLength={500}
                rows={2}
                placeholder="Why this change? (recorded in the audit trail)"
              />
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={target === "paused" || target === "blocked" ? "destructive" : "default"}
              disabled={!submittable}
              onClick={submit}
            >
              {pending ? (
                "Applying…"
              ) : target === "live" && !allAttestationsChecked(attestations) ? (
                <>
                  <Lock aria-hidden />
                  Confirm all 4 to go live
                </>
              ) : (
                (TARGETS.find((t) => t.key === target)?.label ?? "Apply")
              )}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {/* Result — success or the server's honest 422 detail. */}
      {result ? (
        result.ok ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-[12.5px] text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 flex-none" aria-hidden />
            <span>
              Status changed
              {result.data.from ? ` from ${result.data.from}` : ""}
              {result.data.pilot_status ? ` to ${result.data.pilot_status}` : ""}.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50/60 px-3 py-2.5 dark:border-red-500/25 dark:bg-red-500/10">
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-red-700 dark:text-red-300">
              <AlertTriangle className="h-4 w-4 flex-none" aria-hidden />
              {result.error}
            </div>
            {result.blockedBy && result.blockedBy.length > 0 ? (
              <div className="text-[12px] text-red-700/90 dark:text-red-200/90">
                <span className="font-medium">Resolve first:</span>
                <ul className="mt-0.5 flex flex-col gap-0.5">
                  {result.blockedBy.map((id) => (
                    <li key={id}>· {itemLabels[id] ?? id}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {result.missingAttestations && result.missingAttestations.length > 0 ? (
              <div className="text-[12px] text-red-700/90 dark:text-red-200/90">
                <span className="font-medium">Missing confirmations:</span>
                <ul className="mt-0.5 flex flex-col gap-0.5">
                  {result.missingAttestations.map((k) => (
                    <li key={k}>· {ATTESTATION_LABEL.get(k as AttestationKey) ?? k}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )
      ) : null}
    </Card>
  );
}
