"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  ChevronRight,
  Loader2,
  Lock,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReadinessItem, ReadinessProviderState } from "@/lib/api/types";
import {
  statusTone,
  orderItems,
  isDone,
  type ChipTone,
} from "@/app/(app)/settings/sections/readiness-display";
import { updateAgencyDetailsAction } from "@/app/(app)/admin/admin-actions";
import type { AgencyDetailsPatch } from "@/lib/api/admin-types";

import {
  STATUS_LABEL,
  sectionForItem,
  SECTION_ORDER,
  SECTION_LABEL,
  providerPlainText,
  providerItemId,
  blockerLabel,
  type GoLiveSection,
} from "./go-live-display";

/**
 * Tappable go-live tasks (Christian's request): every readiness check is a
 * button that opens a task dialog. The dialog offers the HONEST completion path:
 *  - editable agency-detail items (legal name, owner) → an inline form that
 *    writes via the existing audited updateAgencyDetailsAction; the server
 *    re-checks readiness on save. Real completion, no new backend.
 *  - manual go-live gates → routed to the Go-Live control on this page (the
 *    real attestation tick lives there — never duplicated or faked here).
 *  - provider / consent / onboarding items → a plain explanation of what's
 *    needed and who completes it. No fake "mark complete" — that would violate
 *    the no-fake-functionality / no-go-live-logic-change rules.
 * Pure display + one existing write action; readiness logic is untouched.
 */

const TONE_CLS: Record<ChipTone, string> = {
  good: "bg-brand-soft text-brand",
  info: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  warn: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  muted: "bg-muted text-muted-foreground",
};

function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex flex-none items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        TONE_CLS[tone],
      )}
    >
      {children}
    </span>
  );
}

/** How a given check can be completed from the dialog. */
type FixMode =
  | { kind: "edit"; fields: EditField[] }
  | { kind: "manual" }
  | { kind: "settings" }
  | { kind: "explain" };

type EditField = {
  key: keyof AgencyDetailsPatch;
  label: string;
  placeholder: string;
};

function fixModeFor(id: string): FixMode {
  switch (id) {
    case "identity.name":
      return {
        kind: "edit",
        fields: [
          { key: "legal_name", label: "Legal name", placeholder: "Registered legal name" },
          { key: "trading_name", label: "Trading name", placeholder: "Public / trading name" },
        ],
      };
    case "team.owner":
      return {
        kind: "edit",
        fields: [
          {
            key: "primary_owner_email",
            label: "Owner email",
            placeholder: "owner@agency.com",
          },
        ],
      };
    // The 4 manual attestations + admin approval are confirmed in the control.
    case "posture.approval_first":
    case "lifecycle.go_live":
      return { kind: "manual" };
    default:
      // providers, consent, website, timezone, logo, catalog… — no admin write
      // action; explain what's needed. (Website/timezone aren't in the details
      // patch, so we route to the agency Settings tab rather than fake an edit.)
      return { kind: "explain" };
  }
}

export function GoLiveTasks({
  agencyId,
  items,
  providers,
}: {
  agencyId: string;
  items: ReadinessItem[];
  providers: ReadinessProviderState[];
}) {
  const [active, setActive] = useState<ReadinessItem | null>(null);
  const providerById = new Map(
    providers.map((p) => [providerItemId(p.provider), p]),
  );

  const bySection: Record<GoLiveSection, ReadinessItem[]> = {
    setup: [],
    providers: [],
    legal: [],
    safety: [],
  };
  for (const it of orderItems(items)) bySection[sectionForItem(it.id)].push(it);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-soft">
      <h2 className="text-sm font-semibold text-foreground">Readiness checks</h2>

      {SECTION_ORDER.map((section) =>
        bySection[section].length > 0 ? (
          <TaskSection
            key={section}
            title={SECTION_LABEL[section]}
            items={bySection[section]}
            providerById={providerById}
            onOpen={setActive}
          />
        ) : null,
      )}

      {active ? (
        <TaskDialog
          agencyId={agencyId}
          item={active}
          provider={providerById.get(active.id)}
          onClose={() => setActive(null)}
        />
      ) : null}
    </div>
  );
}

function TaskSection({
  title,
  items,
  providerById,
  onOpen,
}: {
  title: string;
  items: ReadinessItem[];
  providerById: Map<string, ReadinessProviderState>;
  onOpen: (it: ReadinessItem) => void;
}) {
  const todo = items.filter((i) => !isDone(i.status));
  const done = items.filter((i) => isDone(i.status));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold text-foreground">{title}</h3>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
            todo.length > 0
              ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
              : "bg-brand-soft text-brand",
          )}
        >
          {todo.length > 0
            ? `${todo.length} need${todo.length === 1 ? "s" : ""} action`
            : "All ready"}
        </span>
      </div>

      {todo.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border/60">
          {todo.map((it) => (
            <TaskRow
              key={it.id}
              item={it}
              provider={providerById.get(it.id)}
              onOpen={onOpen}
            />
          ))}
        </ul>
      ) : null}

      {done.length > 0 ? (
        <details className="text-[12px]">
          <summary className="cursor-pointer select-none py-1 text-muted-foreground hover:text-foreground">
            {done.length} ready ✓
          </summary>
          <ul className="flex flex-col divide-y divide-border/40">
            {done.map((it) => (
              <TaskRow
                key={it.id}
                item={it}
                provider={providerById.get(it.id)}
                onOpen={onOpen}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function TaskRow({
  item,
  provider,
  onOpen,
}: {
  item: ReadinessItem;
  provider?: ReadinessProviderState;
  onOpen: (it: ReadinessItem) => void;
}) {
  const done = isDone(item.status);
  const title = done ? item.label : blockerLabel(item.id, item.label);
  const copy = provider ? providerPlainText(provider) : item.uiCopy;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="flex w-full items-start justify-between gap-3 rounded-lg px-1.5 py-2 text-left transition-colors hover:bg-muted/50"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-foreground">{title}</span>
          <span className="text-[12px] text-muted-foreground">{copy}</span>
        </span>
        <span className="flex flex-none items-center gap-1.5">
          <Chip tone={statusTone(item.status)}>{STATUS_LABEL[item.status]}</Chip>
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        </span>
      </button>
    </li>
  );
}

function TaskDialog({
  agencyId,
  item,
  provider,
  onClose,
}: {
  agencyId: string;
  item: ReadinessItem;
  provider?: ReadinessProviderState;
  onClose: () => void;
}) {
  const router = useRouter();
  const mode = fixModeFor(item.id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = isDone(item.status);
  const title = done ? item.label : blockerLabel(item.id, item.label);
  const copy = provider ? providerPlainText(provider) : item.uiCopy;

  async function save(fields: EditField[]) {
    setError(null);
    const patch: AgencyDetailsPatch = {};
    for (const f of fields) {
      const v = (values[f.key] ?? "").trim();
      if (v) (patch as Record<string, string>)[f.key] = v;
    }
    if (Object.keys(patch).length === 0) {
      setError("Enter a value first.");
      return;
    }
    setSaving(true);
    const res = await updateAgencyDetailsAction(agencyId, patch);
    setSaving(false);
    if (res.ok) {
      onClose();
      router.refresh(); // server re-checks readiness
    } else {
      setError(res.error);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[14px] font-semibold text-foreground">{title}</span>
            <Chip tone={statusTone(item.status)}>{STATUS_LABEL[item.status]}</Chip>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">{copy}</p>

          {done ? (
            <div className="rounded-lg bg-brand-soft px-3 py-2 text-[12.5px] font-medium text-brand">
              This check is complete.
            </div>
          ) : mode.kind === "edit" ? (
            <div className="flex flex-col gap-3">
              {mode.fields.map((f) => (
                <label key={f.key} className="flex flex-col gap-1">
                  <span className="text-[12px] font-medium text-foreground">
                    {f.label}
                  </span>
                  <Input
                    value={values[f.key] ?? ""}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [f.key]: e.target.value }))
                    }
                    placeholder={f.placeholder}
                  />
                </label>
              ))}
              {error ? (
                <p className="text-[12px] text-red-600 dark:text-red-300" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={saving}
                  onClick={() => save(mode.fields)}
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : null}
                  Save &amp; complete
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Saved via the audited staff-edit action; the server re-checks
                readiness immediately.
              </p>
            </div>
          ) : mode.kind === "manual" ? (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[12.5px] text-muted-foreground">
              <Lock className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
              <span>
                This is a manual staff confirmation. Tick it in the{" "}
                <span className="font-medium text-foreground">
                  Change pilot status
                </span>{" "}
                control higher on this page when you go live — it can&rsquo;t be
                confirmed here, and an override can&rsquo;t bypass it.
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[12.5px] text-muted-foreground">
                {explainText(item.id)}
              </div>
              <Link
                href={`/admin/agencies/${agencyId}/settings`}
                className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted"
              >
                Open agency settings
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Plain "who/where" completion guidance for checks with no admin write action. */
function explainText(id: string): string {
  if (id.startsWith("provider."))
    return "Provider connections are completed in the agency's Settings → Channels, and some (WhatsApp templates, Meta, Google Calendar) require an external approval step. This check turns green automatically once the provider reports ready.";
  if (id === "consent.captured")
    return "Consent is captured at lead intake. Confirm the capture gates every marketing / re-engage send, then this check clears from its signal.";
  if (id === "catalog.quality" || id.startsWith("catalog"))
    return "Catalogue quality is driven by the real property feed. Review and import listings on the Properties page — the check reflects the live catalogue.";
  if (id === "identity.website" || id === "identity.timezone")
    return "This is confirmed from the agency's own profile settings during onboarding. Update it in the agency Settings tab.";
  return "Complete this from the agency's Settings. The check reflects the live signal once updated.";
}
