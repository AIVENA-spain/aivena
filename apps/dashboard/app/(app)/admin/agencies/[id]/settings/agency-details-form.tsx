"use client";

import { cloneElement, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { AgencyDetailsPatch } from "@/lib/api/admin-types";
import { updateAgencyDetailsAction } from "../../../admin-actions";

/**
 * Staff edit form for an agency's core details (Phase 2). Sends only changed fields;
 * the server whitelists + validates + audits. Identifier (slug) is immutable and shown
 * read-only — it can't be edited here (nor can status/is_test/pilot, which have their own
 * controls). English-only (admin surface).
 */
type Fields = {
  legal_name: string;
  trading_name: string;
  cif_nif: string;
  primary_region: string;
  primary_owner_email: string;
  primary_owner_phone: string;
  notes: string;
};

export function AgencyDetailsForm({
  agencyId,
  slug,
  initial,
}: {
  agencyId: string;
  slug: string;
  initial: Fields;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [f, setF] = useState<Fields>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const dirty = (Object.keys(f) as (keyof Fields)[]).some((k) => f[k] !== initial[k]);
  const canSave = dirty && f.trading_name.trim().length > 0 && !pending;

  function submit() {
    if (!canSave) return;
    const patch: AgencyDetailsPatch = {};
    (Object.keys(f) as (keyof Fields)[]).forEach((k) => {
      if (f[k] !== initial[k]) patch[k] = f[k];
    });
    startTransition(async () => {
      const res = await updateAgencyDetailsAction(agencyId, patch);
      if (res.ok) {
        setMsg({ ok: true, text: "Details saved." });
        router.refresh();
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  }

  return (
    <Card className="gap-4 p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-foreground">Agency details</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Staff-only. Changes are recorded in the Audit tab. The identifier can&rsquo;t be changed.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Identifier (read-only)">
          <Input value={slug} readOnly disabled className="font-mono text-muted-foreground" />
        </Field>
        <Field label="Trading name" required>
          <Input value={f.trading_name} onChange={set("trading_name")} disabled={pending} />
        </Field>
        <Field label="Legal name">
          <Input value={f.legal_name} onChange={set("legal_name")} disabled={pending} placeholder="—" />
        </Field>
        <Field label="CIF / NIF">
          <Input value={f.cif_nif} onChange={set("cif_nif")} disabled={pending} placeholder="—" />
        </Field>
        <Field label="Owner email">
          <Input
            type="email"
            value={f.primary_owner_email}
            onChange={set("primary_owner_email")}
            disabled={pending}
            placeholder="—"
          />
        </Field>
        <Field label="Owner phone">
          <Input value={f.primary_owner_phone} onChange={set("primary_owner_phone")} disabled={pending} placeholder="—" />
        </Field>
        <Field label="Region">
          <Input value={f.primary_region} onChange={set("primary_region")} disabled={pending} placeholder="—" />
        </Field>
      </div>

      <Field label="Internal notes">
        <Textarea
          value={f.notes}
          onChange={set("notes")}
          disabled={pending}
          rows={3}
          placeholder="Staff-only notes about this agency (onboarding context, follow-ups, …)"
        />
      </Field>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={!canSave} onClick={submit}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        {dirty && !pending ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setF(initial);
              setMsg(null);
            }}
          >
            Discard
          </Button>
        ) : null}
      </div>

      {msg ? (
        <div
          className={
            msg.ok
              ? "flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-[12.5px] text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300"
              : "flex items-center gap-2 rounded-lg border border-red-200 bg-red-50/60 px-3 py-2.5 text-[12.5px] text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300"
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

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactElement;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-[12px] font-medium text-foreground">
        {label}
        {required ? <span className="text-muted-foreground"> *</span> : null}
      </Label>
      {cloneElement(children as React.ReactElement<{ id?: string }>, { id })}
    </div>
  );
}
